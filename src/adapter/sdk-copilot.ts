/**
 * SdkCopilotAdapter — wraps @github/copilot-sdk behind IAgentAdapter.
 *
 * This is the ONLY code that touches the Copilot SDK. It translates SDK
 * events into our AgentEvent union, auto-approves all permissions (yolo),
 * suppresses duplicate consolidated events, and validates prompts.
 *
 * Extracted from: packages/shared/src/adapters/sdk-copilot-adapter.ts
 * Adapted: dropped ILogger, dropped workspaceRoot, simplified constructor,
 *          removed console.log debug noise, added session destroy guard.
 */

import type {
  CopilotSessionEventLike,
  ICopilotClient,
} from './copilot-types.js';
import type { AgentEvent, AgentResult, AgentRunOptions } from './events.js';
import type { IAgentAdapter } from './interface.js';

const approveAll = () => ({ kind: 'approved' as const });

const MAX_PROMPT_LENGTH = 100_000;

export class SdkCopilotAdapter implements IAgentAdapter {
  private readonly _client: ICopilotClient;

  constructor(client: ICopilotClient) {
    this._client = client;
  }

  async run(options: AgentRunOptions): Promise<AgentResult> {
    const { prompt, sessionId, onEvent, model, reasoningEffort } = options;

    const validationError = validatePrompt(prompt);
    if (validationError) {
      return {
        output: `Validation error: ${validationError}`,
        sessionId: sessionId ?? '',
        status: 'failed',
        exitCode: -1,
        tokens: null,
      };
    }

    const session = sessionId
      ? await this._client.resumeSession(sessionId, {
          onPermissionRequest: approveAll,
          ...(model && { model }),
          ...(reasoningEffort && { reasoningEffort }),
        })
      : await this._client.createSession({
          streaming: !!onEvent,
          onPermissionRequest: approveAll,
          ...(model && { model }),
          ...(reasoningEffort && { reasoningEffort }),
        });

    let sessionDestroyed = false;

    try {
      let output = '';
      let hasStreamedThinking = false;
      let hasStreamedText = false;

      session.on((event: CopilotSessionEventLike) => {
        // Suppress duplicate consolidated events.
        // SDK emits deltas during streaming, then re-emits full consolidated
        // content after the turn. We skip the duplicates.
        if (event.type === 'assistant.reasoning_delta') {
          hasStreamedThinking = true;
        }
        if (event.type === 'assistant.message_delta') {
          hasStreamedText = true;
        }
        if (event.type === 'assistant.reasoning' && hasStreamedThinking) {
          return;
        }
        if (event.type === 'assistant.message' && hasStreamedText) {
          output = event.data?.content ?? '';
          return;
        }

        const agentEvent = translateEvent(event);
        if (agentEvent && onEvent) {
          onEvent(agentEvent);
        }

        if (event.type === 'assistant.message') {
          output = event.data?.content ?? '';
        }
      });

      await session.sendAndWait({ prompt: prompt.trim() }, options.timeout);

      return {
        output,
        sessionId: session.sessionId,
        status: 'completed',
        exitCode: 0,
        tokens: null,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      if (onEvent) {
        onEvent({
          type: 'session_error',
          timestamp: new Date().toISOString(),
          data: {
            sessionId: session.sessionId,
            errorType: 'EXECUTION_ERROR',
            message: errorMessage,
          },
        });
      }

      return {
        output: errorMessage,
        sessionId: session.sessionId,
        status: 'failed',
        exitCode: 1,
        tokens: null,
      };
    } finally {
      if (!sessionDestroyed) {
        sessionDestroyed = true;
        await session.destroy();
      }
    }
  }

  async compact(sessionId: string): Promise<AgentResult> {
    const session = await this._client.resumeSession(sessionId, {
      onPermissionRequest: approveAll,
    });

    try {
      let output = '';
      session.on((event: CopilotSessionEventLike) => {
        if (event.type === 'assistant.message') {
          output = event.data?.content ?? '';
        }
      });

      await session.sendAndWait({ prompt: '/compact' });

      return {
        output,
        sessionId: session.sessionId,
        status: 'completed',
        exitCode: 0,
        tokens: null,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        output: `Compact failed: ${errorMessage}`,
        sessionId,
        status: 'failed',
        exitCode: 1,
        tokens: null,
      };
    }
    // No destroy — session must stay alive for subsequent turns
  }

  async terminate(sessionId: string): Promise<AgentResult> {
    const session = await this._client.resumeSession(sessionId, {
      onPermissionRequest: approveAll,
    });

    try {
      await session.abort();
    } finally {
      await session.destroy();
    }

    return {
      output: '',
      sessionId,
      status: 'killed',
      exitCode: 137,
      tokens: null,
    };
  }
}

function validatePrompt(prompt: string): string | null {
  const trimmed = prompt.trim();
  if (!trimmed) {
    return 'Prompt cannot be empty or whitespace-only';
  }
  if (trimmed.length > MAX_PROMPT_LENGTH) {
    return `Prompt exceeds maximum length of ${MAX_PROMPT_LENGTH} characters`;
  }
  // Reject control characters except newline, carriage return, and tab
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional security validation
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(trimmed)) {
    return 'Prompt contains invalid control characters';
  }
  return null;
}

function translateEvent(event: CopilotSessionEventLike): AgentEvent | null {
  const timestamp = new Date().toISOString();

  switch (event.type) {
    case 'assistant.message_delta':
      return {
        type: 'text_delta',
        timestamp,
        data: {
          content: event.data?.deltaContent ?? '',
          messageId: event.data?.messageId,
        },
      };

    case 'assistant.message':
      return {
        type: 'message',
        timestamp,
        data: {
          content: event.data?.content ?? '',
          messageId: event.data?.messageId,
        },
      };

    case 'assistant.usage':
      return {
        type: 'usage',
        timestamp,
        data: {
          inputTokens: event.data?.inputTokens,
          outputTokens: event.data?.outputTokens,
        },
      };

    case 'session.idle':
      return {
        type: 'session_idle',
        timestamp,
        data: {},
      };

    case 'session.error':
      return null; // Handled in catch block

    case 'tool.execution_start':
      return {
        type: 'tool_call',
        timestamp,
        data: {
          toolName: event.data?.toolName ?? 'unknown',
          input: event.data?.arguments,
          toolCallId: event.data?.toolCallId ?? '',
        },
      };

    case 'tool.execution_complete':
      return {
        type: 'tool_result',
        timestamp,
        data: {
          toolCallId: event.data?.toolCallId ?? '',
          output: event.data?.result?.content ?? '',
          isError: !event.data?.success,
        },
      };

    case 'assistant.reasoning':
      return {
        type: 'thinking',
        timestamp,
        data: { content: event.data?.content ?? '' },
      };

    case 'assistant.reasoning_delta':
      return {
        type: 'thinking',
        timestamp,
        data: { content: event.data?.deltaContent ?? '' },
      };

    // Lifecycle noise — skip
    case 'pending_messages.modified':
    case 'user.message':
    case 'assistant.turn_start':
    case 'assistant.turn_end':
    case 'session.usage_info':
      return null;

    default:
      return {
        type: 'raw',
        timestamp,
        data: {
          provider: 'copilot',
          originalType: event.type,
          originalData: event,
        },
      };
  }
}
