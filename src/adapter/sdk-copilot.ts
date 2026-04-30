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

// SDK 0.3.0 changed the kind from 'approved' to 'approve-once'. The official
// `approveAll` export from the SDK uses this same shape.
const approveAll = () => ({ kind: 'approve-once' as const });

const MAX_PROMPT_LENGTH = 100_000;

export class SdkCopilotAdapter implements IAgentAdapter {
  private readonly _client: ICopilotClient;

  constructor(client: ICopilotClient) {
    this._client = client;
  }

  async run(options: AgentRunOptions): Promise<AgentResult> {
    const {
      prompt,
      sessionId,
      onEvent,
      model,
      reasoningEffort,
      configDir,
      mcpServers,
    } = options;

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
          ...(options.cwd && { workingDirectory: options.cwd }),
          ...(model && { model }),
          ...(reasoningEffort && { reasoningEffort }),
          ...(configDir && { configDir }),
          ...(mcpServers && { mcpServers }),
        })
      : await this._client.createSession({
          streaming: !!onEvent,
          onPermissionRequest: approveAll,
          ...(options.cwd && { workingDirectory: options.cwd }),
          ...(model && { model }),
          ...(reasoningEffort && { reasoningEffort }),
          ...(configDir && { configDir }),
          ...(mcpServers && { mcpServers }),
        });

    // Emit session_start so the runner can capture sessionId for timeout termination
    if (onEvent) {
      onEvent({
        type: 'session_start',
        timestamp: new Date().toISOString(),
        data: { sessionId: session.sessionId },
      });
    }

    let sessionDestroyed = false;
    let unsubscribeRun: (() => void) | undefined;

    try {
      let output = '';
      let hasStreamedThinking = false;
      let hasStreamedText = false;
      let idleSettled = false;

      const idlePromise = new Promise<void>((resolve, reject) => {
        const unsubscribe = session.on((event: CopilotSessionEventLike) => {
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

          if (isSessionIdleEvent(event)) {
            hasStreamedThinking = false;
            hasStreamedText = false;
            if (!idleSettled) {
              idleSettled = true;
              resolve();
            }
          }
          if (isSessionErrorEvent(event) && !idleSettled) {
            idleSettled = true;
            reject(new Error(sessionErrorMessage(event)));
          }
        });
        unsubscribeRun = unsubscribe;
      });

      const sender = {
        send: async (nextPrompt: string): Promise<string> => {
          await session.send({ prompt: nextPrompt });
          return nextPrompt;
        },
      };

      const initialSend = session.send({ prompt: prompt.trim() });
      try {
        options.onSessionReady?.(sender);
      } catch (error) {
        await initialSend;
        throw error;
      }
      await initialSend;
      await idlePromise;

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
      if (unsubscribeRun) {
        unsubscribeRun();
      }
      if (!sessionDestroyed) {
        sessionDestroyed = true;
        // Disconnect but don't destroy — session state preserved for resumption
        await session.disconnect();
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
    } finally {
      // Disconnect but don't destroy — session state preserved for resumption
      await session.disconnect();
    }
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

function isSessionIdleEvent(event: CopilotSessionEventLike): boolean {
  return event.type === 'session.idle' || event.type === 'session_idle';
}

function isSessionErrorEvent(event: CopilotSessionEventLike): boolean {
  return event.type === 'session.error' || event.type === 'session_error';
}

function sessionErrorMessage(event: CopilotSessionEventLike): string {
  return event.data?.message ?? 'Session error';
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
    case 'session_idle':
      return {
        type: 'session_idle',
        timestamp,
        data: {},
      };

    case 'session.error':
    case 'session_error':
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
          output:
            event.data?.result?.detailedContent ??
            event.data?.result?.content ??
            event.data?.error?.message ??
            '',
          isError: !event.data?.success,
        },
      };

    case 'assistant.reasoning':
      return {
        type: 'thinking',
        timestamp,
        data: { content: event.data?.content ?? '', isDelta: false },
      };

    case 'assistant.reasoning_delta':
      return {
        type: 'thinking',
        timestamp,
        data: { content: event.data?.deltaContent ?? '', isDelta: true },
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
