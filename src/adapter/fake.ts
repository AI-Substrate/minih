/**
 * FakeAgentAdapter — test double for IAgentAdapter.
 *
 * Configurable responses, event emission, call history tracking,
 * and assertion helpers for testing.
 *
 * Extracted from: packages/shared/src/fakes/fake-agent-adapter.ts
 */

import type {
  AgentEvent,
  AgentResult,
  AgentRunOptions,
  AgentStatus,
  TokenMetrics,
} from './events.js';
import type { IAgentAdapter } from './interface.js';

export interface FakeAgentAdapterOptions {
  sessionId?: string;
  output?: string;
  status?: AgentStatus;
  exitCode?: number;
  stderr?: string;
  tokens?: TokenMetrics | null;
  /** Simulate slow run() for timeout testing (milliseconds). */
  runDuration?: number;
  /** Events to emit via onEvent callback during run(). */
  events?: AgentEvent[];
}

type ResolvedOptions = Required<
  Omit<FakeAgentAdapterOptions, 'runDuration' | 'stderr' | 'events'>
> & {
  stderr?: string;
};

export class FakeAgentAdapter implements IAgentAdapter {
  private readonly _options: ResolvedOptions;
  private readonly _runDuration: number;
  private _events: AgentEvent[];
  private _queuedRun: AgentEvent[][] | null = null;
  private _suppressFinalIdle = false;
  private _sessionSendHistory: string[] = [];
  private _runHistory: AgentRunOptions[] = [];
  private _terminateHistory: string[] = [];
  private _compactHistory: string[] = [];

  constructor(options: FakeAgentAdapterOptions = {}) {
    this._options = {
      sessionId: options.sessionId ?? `fake-session-${Date.now()}`,
      output: options.output ?? '',
      status: options.status ?? 'completed',
      exitCode: options.exitCode ?? 0,
      stderr: options.stderr,
      tokens:
        options.tokens === undefined
          ? { used: 0, total: 0, limit: 200000 }
          : options.tokens,
    };
    this._runDuration = options.runDuration ?? 0;
    this._events = options.events ?? [];
  }

  async run(options: AgentRunOptions): Promise<AgentResult> {
    this._runHistory.push({ ...options });

    options.onSessionReady?.({
      send: async (prompt: string): Promise<string> => {
        this._sessionSendHistory.push(prompt);
        return prompt;
      },
    });

    if (this._runDuration > 0) {
      await new Promise((resolve) => setTimeout(resolve, this._runDuration));
    }

    if (options.onEvent) {
      if (this._queuedRun) {
        for (const [index, turn] of this._queuedRun.entries()) {
          for (const event of turn) {
            options.onEvent(event);
          }
          // T008 (plan 025) — abort scenarios end without settlement: the
          // final turn's auto-idle is suppressible via setQueuedRun options.
          const isFinalTurn = index === this._queuedRun.length - 1;
          if (!(isFinalTurn && this._suppressFinalIdle)) {
            options.onEvent(createSessionIdleEvent());
          }
        }
      } else {
        for (const event of this._events) {
          options.onEvent(event);
        }
      }
    }

    const sessionId = options.sessionId ?? this._options.sessionId;

    return {
      output: this._options.output,
      sessionId,
      status: this._options.status,
      exitCode: this._options.exitCode,
      stderr: this._options.stderr,
      tokens: this._options.tokens,
    };
  }

  async compact(sessionId: string): Promise<AgentResult> {
    this._compactHistory.push(sessionId);
    return {
      output: '',
      sessionId,
      status: 'completed',
      exitCode: 0,
      tokens: this._options.tokens ?? null,
    };
  }

  async terminate(sessionId: string): Promise<AgentResult> {
    this._terminateHistory.push(sessionId);
    return {
      output: '',
      sessionId,
      status: 'killed',
      exitCode: 143,
      tokens: this._options.tokens ?? null,
    };
  }

  // ============================================
  // Test helpers
  // ============================================

  getRunHistory(): AgentRunOptions[] {
    return [...this._runHistory];
  }

  getTerminateHistory(): string[] {
    return [...this._terminateHistory];
  }

  getCompactHistory(): string[] {
    return [...this._compactHistory];
  }

  getSessionSendHistory(): string[] {
    return [...this._sessionSendHistory];
  }

  assertRunCalled(expected: Partial<AgentRunOptions>): void {
    const match = this._runHistory.some((call) => {
      return Object.entries(expected).every(([key, value]) => {
        return call[key as keyof AgentRunOptions] === value;
      });
    });
    if (!match) {
      const history =
        this._runHistory.length === 0
          ? '(no calls)'
          : this._runHistory.map((c) => JSON.stringify(c)).join('\n  ');
      throw new Error(
        `Expected run() to be called with ${JSON.stringify(expected)}\nActual calls:\n  ${history}`,
      );
    }
  }

  assertTerminateCalled(sessionId: string): void {
    if (!this._terminateHistory.includes(sessionId)) {
      const history =
        this._terminateHistory.length === 0
          ? '(no calls)'
          : this._terminateHistory.join(', ');
      throw new Error(
        `Expected terminate() to be called with sessionId "${sessionId}"\nActual calls: ${history}`,
      );
    }
  }

  assertCompactCalled(sessionId: string): void {
    if (!this._compactHistory.includes(sessionId)) {
      const history =
        this._compactHistory.length === 0
          ? '(no calls)'
          : this._compactHistory.join(', ');
      throw new Error(
        `Expected compact() to be called with sessionId "${sessionId}"\nActual calls: ${history}`,
      );
    }
  }

  reset(): void {
    this._runHistory = [];
    this._terminateHistory = [];
    this._compactHistory = [];
    this._sessionSendHistory = [];
  }

  setEvents(events: AgentEvent[]): void {
    this._events = [...events];
    this._queuedRun = null;
  }

  setQueuedRun(
    turns: AgentEvent[][],
    options: { suppressFinalIdle?: boolean } = {},
  ): void {
    this._queuedRun = turns.map((turn) => [...turn]);
    this._suppressFinalIdle = options.suppressFinalIdle ?? false;
  }

  addEvent(event: AgentEvent): void {
    this._queuedRun = null;
    this._events.push(event);
  }

  clearEvents(): void {
    this._queuedRun = null;
    this._events = [];
  }

  getEvents(): AgentEvent[] {
    return [...this._events];
  }

  emitToolCall(toolName: string, input: unknown, toolCallId: string): void {
    this._queuedRun = null;
    this._events.push({
      type: 'tool_call',
      timestamp: new Date().toISOString(),
      data: { toolName, input, toolCallId },
    });
  }

  emitToolResult(toolCallId: string, output: string, isError = false): void {
    this._queuedRun = null;
    this._events.push({
      type: 'tool_result',
      timestamp: new Date().toISOString(),
      data: { toolCallId, output, isError },
    });
  }

  emitThinking(content: string, signature?: string): void {
    this._queuedRun = null;
    this._events.push({
      type: 'thinking',
      timestamp: new Date().toISOString(),
      data: { content, signature },
    });
  }

  emitSessionIdle(): void {
    this._queuedRun = null;
    this._events.push(createSessionIdleEvent());
  }

  emitPendingMessagesModified(queueDepth: number): void {
    this._queuedRun = null;
    this._events.push({
      type: 'raw',
      timestamp: new Date().toISOString(),
      data: {
        provider: 'fake',
        originalType: 'pending_messages.modified',
        originalData: { queueDepth },
      },
    });
  }
}

function createSessionIdleEvent(): AgentEvent {
  return {
    type: 'session_idle',
    timestamp: new Date().toISOString(),
    data: {},
  };
}
