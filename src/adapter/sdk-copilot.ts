/**
 * SdkCopilotAdapter — wraps @github/copilot-sdk behind IAgentAdapter.
 *
 * This is the ONLY code that touches the Copilot SDK. It translates SDK
 * events into our AgentEvent union, auto-approves all permissions (yolo),
 * suppresses duplicate consolidated events, and validates prompts.
 *
 * Extracted from: packages/shared/src/adapters/sdk-copilot-adapter.ts
 * Adapted: dropped ILogger, dropped workspaceRoot, simplified constructor,
 *          removed console.log debug noise.
 *
 * Plan 026 (stall watchdog): every SDK cleanup await (terminate rungs,
 * the run/compact `finally` disconnects) is deadline-bounded — a wedged
 * CLI subprocess that stops answering JSON-RPC must never block the
 * runner's terminal artifact writes. A hung or failed terminate rung
 * escalates to client.forceStop() (SIGKILL on the subprocess).
 */

import type {
  CopilotSessionEventLike,
  ICopilotClient,
} from './copilot-types.js';
import { DEADLINE_EXPIRED, withDeadline } from './deadline.js';
import type { AgentEvent, AgentResult, AgentRunOptions } from './events.js';
import type { IAgentAdapter } from './interface.js';

// SDK 0.3.0 changed the kind from 'approved' to 'approve-once'. The official
// `approveAll` export from the SDK uses this same shape.
const approveAll = () => ({ kind: 'approve-once' as const });

const MAX_PROMPT_LENGTH = 100_000;

const DEFAULT_CLEANUP_RUNG_TIMEOUT_MS = 5_000;

export interface SdkCopilotAdapterOptions {
  /** Per-rung bound on SDK cleanup awaits. Tests inject tiny values. */
  cleanupRungTimeoutMs?: number;
}

export class SdkCopilotAdapter implements IAgentAdapter {
  private readonly _client: ICopilotClient;
  private readonly _cleanupRungTimeoutMs: number;

  constructor(client: ICopilotClient, options?: SdkCopilotAdapterOptions) {
    this._client = client;
    this._cleanupRungTimeoutMs =
      options?.cleanupRungTimeoutMs ?? DEFAULT_CLEANUP_RUNG_TIMEOUT_MS;
  }

  /**
   * Await one cleanup rung, bounded. Returns true only when the rung
   * settled cleanly within the deadline — hangs and rejections both
   * report false so the caller can escalate.
   */
  private async _boundedRung(rung: Promise<unknown>): Promise<boolean> {
    const outcome = await withDeadline(
      rung.then(
        () => true,
        () => false,
      ),
      this._cleanupRungTimeoutMs,
    );
    return outcome === DEADLINE_EXPIRED ? false : outcome;
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
      skillDirectories,
      disabledSkills,
      permissionHandler,
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

    // Plan 018 R1 — wrap the user-supplied permissionHandler so we can
    // emit `permission_denied` events on rejects. Idempotent on requestId.
    const deniedRequestIds = new Set<string>();
    const wrappedHandler = permissionHandler
      ? async (
          request: Parameters<
            NonNullable<AgentRunOptions['permissionHandler']>
          >[0],
          invocation: { sessionId: string },
        ) => {
          const decision = await permissionHandler(request, invocation);
          if (decision.kind === 'reject') {
            const id = request.requestId ?? request.toolCallId ?? '';
            if (!id || !deniedRequestIds.has(id)) {
              if (id) deniedRequestIds.add(id);
              if (onEvent) {
                onEvent({
                  type: 'permission_denied',
                  timestamp: new Date().toISOString(),
                  data: {
                    kind: request.kind,
                    decision: 'deny',
                    toolName: request.toolName,
                    requestId: request.requestId,
                    toolCallId: request.toolCallId,
                    message:
                      decision.feedback ?? `permission denied: ${request.kind}`,
                  },
                });
              }
            }
          }
          return decision;
        }
      : approveAll;

    const session = sessionId
      ? await this._client.resumeSession(sessionId, {
          onPermissionRequest: wrappedHandler,
          ...(options.cwd && { workingDirectory: options.cwd }),
          ...(model && { model }),
          ...(reasoningEffort && { reasoningEffort }),
          ...(configDir && { configDir }),
          ...(mcpServers && { mcpServers }),
          ...(skillDirectories && { skillDirectories }),
          ...(disabledSkills && { disabledSkills }),
        })
      : await this._client.createSession({
          streaming: !!onEvent,
          onPermissionRequest: wrappedHandler,
          ...(options.cwd && { workingDirectory: options.cwd }),
          ...(model && { model }),
          ...(reasoningEffort && { reasoningEffort }),
          ...(configDir && { configDir }),
          ...(mcpServers && { mcpServers }),
          ...(skillDirectories && { skillDirectories }),
          ...(disabledSkills && { disabledSkills }),
        });

    // Emit session_start so the runner can capture sessionId for timeout termination
    if (onEvent) {
      onEvent({
        type: 'session_start',
        timestamp: new Date().toISOString(),
        data: { sessionId: session.sessionId },
      });
    }

    let sessionDisconnected = false;
    let unsubscribeRun: (() => void) | undefined;
    // Plan 025 FX012 / PL-06 — track the LATEST in-flight message so a
    // stream that dies mid-message can be diagnosed as an abort. Cleared
    // on the consolidated message or on idle (settlement). Read by the
    // catch block, so declared outside the try.
    let inFlightMessage: { messageId?: string } | null = null;
    let abortEmitted = false;

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
            inFlightMessage = { messageId: event.data?.messageId };
          }
          if (event.type === 'assistant.reasoning' && hasStreamedThinking) {
            return;
          }
          if (event.type === 'assistant.message' && hasStreamedText) {
            output = event.data?.content ?? '';
            inFlightMessage = null;
            return;
          }

          const agentEvent = translateEvent(event);
          if (agentEvent && onEvent) {
            onEvent(agentEvent);
          }

          if (event.type === 'assistant.message') {
            output = event.data?.content ?? '';
            inFlightMessage = null;
          }

          if (isSessionIdleEvent(event)) {
            hasStreamedThinking = false;
            hasStreamedText = false;
            inFlightMessage = null;
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

      // Plan 025 FX012 — the stream ended while a message was in flight:
      // emit the abort diagnosis (at most once) before the generic error.
      // Snapshot via cast: TS narrows the closure-mutated `let` to its
      // initializer (`null`) here, which is wrong — the event handler
      // assigns it before this catch can run.
      const inFlight = inFlightMessage as { messageId?: string } | null;
      if (inFlight !== null && !abortEmitted && onEvent) {
        abortEmitted = true;
        onEvent({
          type: 'provider_stream_aborted',
          timestamp: new Date().toISOString(),
          data: {
            ...(inFlight.messageId !== undefined && {
              messageId: inFlight.messageId,
            }),
            reason: errorMessage,
          },
        });
      }

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
      if (!sessionDisconnected) {
        sessionDisconnected = true;
        // Disconnect but don't delete — session state preserved for
        // resumption. Bounded: a wedged subprocess must not block run()
        // from returning its result (plan 026).
        await this._boundedRung(session.disconnect());
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
      // Disconnect but don't delete — session state preserved for
      // resumption. Bounded for the same reason as run()'s finally.
      await this._boundedRung(session.disconnect());
    }
  }

  async terminate(sessionId: string): Promise<AgentResult> {
    // Bounded cleanup ladder: resume → abort → disconnect, each rung
    // deadline-bounded; any hang or rejection escalates to forceStop().
    // (SDK 1.0.1 removed session.destroy() — abort+disconnect is the
    // graceful path; session state stays on disk for post-mortem.)
    let escalate = false;

    const session = await withDeadline(
      this._client
        .resumeSession(sessionId, { onPermissionRequest: approveAll })
        .catch(() => null),
      this._cleanupRungTimeoutMs,
    );

    if (session === DEADLINE_EXPIRED || session === null) {
      escalate = true;
    } else {
      const aborted = await this._boundedRung(session.abort());
      const disconnected = await this._boundedRung(session.disconnect());
      if (!aborted || !disconnected) {
        escalate = true;
      }
    }

    if (escalate) {
      const force = this._client.forceStop?.();
      if (force) {
        await this._boundedRung(force);
      }
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

function normalizeLoadedSkills(
  data: unknown,
): Array<{ name: string; path?: string }> {
  const rec =
    typeof data === 'object' && data !== null
      ? (data as Record<string, unknown>)
      : {};
  const rawSkills = Array.isArray(rec.skills)
    ? rec.skills
    : Array.isArray(rec.loadedSkills)
      ? rec.loadedSkills
      : [];
  return rawSkills.map((item) => {
    if (typeof item === 'string') return { name: item };
    if (typeof item === 'object' && item !== null) {
      const skill = item as Record<string, unknown>;
      const name = String(
        skill.name ?? skill.skillName ?? skill.id ?? 'unknown',
      );
      const skillPath = skill.path ?? skill.skillPath;
      return {
        name,
        ...(typeof skillPath === 'string' && { path: skillPath }),
      };
    }
    return { name: 'unknown' };
  });
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

    case 'session.skills_loaded': {
      const skills = normalizeLoadedSkills(event.data);
      return {
        type: 'skills_loaded',
        timestamp,
        data: { skills, raw: event.data },
      };
    }

    case 'skill.invoked': {
      const name =
        event.data?.name ??
        event.data?.skillName ??
        event.data?.skill?.name ??
        'unknown';
      const skillPath =
        event.data?.path ?? event.data?.skillPath ?? event.data?.skill?.path;
      return {
        type: 'skill_invoked',
        timestamp,
        data: {
          name,
          ...(skillPath && { path: skillPath }),
          raw: event.data,
        },
      };
    }

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
