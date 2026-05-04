/**
 * Agent event types — the observability layer.
 *
 * Every event the agent produces during execution is typed here.
 * Events stream to NDJSON for tail -f observability and are displayed
 * in the terminal with formatted icons.
 *
 * Extracted from:
 *   - packages/shared/src/interfaces/agent-types.ts
 *   - packages/shared/src/schemas/agent-event.schema.ts
 * Zod schemas dropped — plain TypeScript interfaces only.
 */

// ============================================
// Core Types
// ============================================

export type AgentStatus = 'completed' | 'failed' | 'killed';

export type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh';

export interface TokenMetrics {
  used: number;
  total: number;
  limit: number;
}

export interface AgentResult {
  output: string;
  sessionId: string;
  status: AgentStatus;
  exitCode: number;
  stderr?: string;
  tokens: TokenMetrics | null;
}

export interface SessionSender {
  send(prompt: string): Promise<string>;
}

export interface AgentRunOptions {
  prompt: string;
  sessionId?: string;
  cwd?: string;
  onEvent?: AgentEventHandler;
  onSessionReady?: (sender: SessionSender) => void;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  timeout?: number;
  configDir?: string;
  mcpServers?: Record<string, unknown>;
  /**
   * Permission handler for SDK 0.3.0+ permission gating. Plan 018 R1.
   * When omitted, the adapter falls back to its built-in `approveAll`
   * (yolo) behaviour for backward-compatibility with un-migrated agents.
   *
   * Shape mirrors `CopilotPermissionHandler` from copilot-types — we keep
   * a structural type here so the runner can wire the handler without
   * importing copilot-types directly.
   */
  permissionHandler?: (
    request: {
      kind:
        | 'shell'
        | 'write'
        | 'mcp'
        | 'read'
        | 'url'
        | 'custom-tool'
        | 'memory'
        | 'hook';
      toolCallId?: string;
      requestId?: string;
      toolName?: string;
      arguments?: unknown;
    },
    invocation: { sessionId: string },
  ) =>
    | { kind: 'approve-once' }
    | { kind: 'reject'; feedback?: string }
    | Promise<{ kind: 'approve-once' } | { kind: 'reject'; feedback?: string }>;
}

// ============================================
// Event Types (discriminated union)
// ============================================

export interface AgentEventBase {
  timestamp: string;
  eventId?: string;
}

export interface AgentTextDeltaEvent extends AgentEventBase {
  type: 'text_delta';
  data: {
    content: string;
    messageId?: string;
  };
}

export interface AgentMessageEvent extends AgentEventBase {
  type: 'message';
  data: {
    content: string;
    messageId?: string;
  };
}

export interface AgentUsageEvent extends AgentEventBase {
  type: 'usage';
  data: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    tokenLimit?: number;
  };
}

export interface AgentSessionEvent extends AgentEventBase {
  type: 'session_start' | 'session_idle' | 'session_error';
  data: {
    sessionId?: string;
    errorType?: string;
    message?: string;
  };
}

export interface AgentRawEvent extends AgentEventBase {
  type: 'raw';
  data: {
    provider: string;
    originalType: string;
    originalData: unknown;
  };
}

export interface AgentToolCallEvent extends AgentEventBase {
  type: 'tool_call';
  data: {
    toolName: string;
    input: unknown;
    toolCallId: string;
  };
}

export interface AgentToolResultEvent extends AgentEventBase {
  type: 'tool_result';
  data: {
    toolCallId: string;
    output: string;
    isError: boolean;
  };
}

export interface AgentThinkingEvent extends AgentEventBase {
  type: 'thinking';
  data: {
    content: string;
    signature?: string;
    isDelta?: boolean;
  };
}

export interface AgentUserPromptEvent extends AgentEventBase {
  type: 'user_prompt';
  data: {
    content: string;
  };
}

/**
 * Plan 018 R1 — emitted when the SDK requests permission and the runner's
 * `permissionHandler` returns a `reject` decision. Idempotent on
 * `requestId` (same denial fires once even if SDK re-asks).
 *
 * The emitted event triggers the 5-signal denial protocol downstream
 * (events.ndjson + run.json mandatory; inside-state + outside-inbox
 * best-effort for coordinated agents). See `src/runner/permissions/error-signal.ts`.
 */
export interface AgentPermissionDeniedEvent extends AgentEventBase {
  type: 'permission_denied';
  data: {
    kind:
      | 'shell'
      | 'write'
      | 'mcp'
      | 'read'
      | 'url'
      | 'custom-tool'
      | 'memory'
      | 'hook';
    /** Why minih denied — `'deny'` (preset/overrides) or `'prompt-user'` (FX002 stub). */
    decision: 'deny' | 'prompt-user';
    toolName?: string;
    /** Path the agent attempted (only set for path-bearing kinds). */
    attemptedPath?: string;
    requestId?: string;
    toolCallId?: string;
    message: string;
  };
}

export type AgentEvent =
  | AgentTextDeltaEvent
  | AgentMessageEvent
  | AgentUsageEvent
  | AgentSessionEvent
  | AgentRawEvent
  | AgentToolCallEvent
  | AgentToolResultEvent
  | AgentThinkingEvent
  | AgentUserPromptEvent
  | AgentPermissionDeniedEvent;

export type AgentEventHandler = (event: AgentEvent) => void;
