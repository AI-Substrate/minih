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

export interface AgentRunOptions {
  prompt: string;
  sessionId?: string;
  cwd?: string;
  onEvent?: AgentEventHandler;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  timeout?: number;
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
  };
}

export interface AgentUserPromptEvent extends AgentEventBase {
  type: 'user_prompt';
  data: {
    content: string;
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
  | AgentUserPromptEvent;

export type AgentEventHandler = (event: AgentEvent) => void;
