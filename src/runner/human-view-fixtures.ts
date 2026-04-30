/**
 * Human View — fixture builders for Phase 1 tests.
 *
 * Pure data builders. No I/O. Reusable from runner unit tests, Phase 2 CLI
 * tests, and Phase 3 snapshot tests. Every builder returns a fresh object,
 * so callers can mutate freely.
 */

import type {
  AgentEvent,
  AgentMessageEvent,
  AgentSessionEvent,
  AgentTextDeltaEvent,
  AgentThinkingEvent,
  AgentToolCallEvent,
  AgentToolResultEvent,
  AgentUserPromptEvent,
} from '../adapter/events.js';
import type {
  CompletedMetadata,
  InboxMessage,
  InsideState,
  LiveRunManifest,
  OutsideState,
  StateHistoryEntry,
  ValidationResult,
} from './types.js';

let counter = 0;
function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter.toString().padStart(4, '0')}`;
}

export function resetFixtureCounter(seed = 0): void {
  counter = seed;
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

export function makeManifest(
  overrides: Partial<LiveRunManifest> = {},
): LiveRunManifest {
  const startedAt = '2026-04-28T00:00:00.000Z';
  return {
    schemaVersion: 1,
    slug: 'demo',
    runId: '01HXY00000000000000000DEMO',
    runDir: '/tmp/runs/01HXY00000000000000000DEMO',
    pid: 12345,
    startedAt,
    updatedAt: startedAt,
    status: 'starting',
    sessionId: null,
    model: 'gpt-test',
    control: { available: false, kind: 'none' },
    counters: { events: 0, toolCalls: 0, messages: 0, errors: 0 },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Completed metadata
// ---------------------------------------------------------------------------

export function makeCompleted(
  overrides: Partial<CompletedMetadata> = {},
): CompletedMetadata {
  return {
    slug: 'demo',
    runId: '01HXY00000000000000000DEMO',
    startedAt: '2026-04-28T00:00:00.000Z',
    completedAt: '2026-04-28T00:00:10.000Z',
    durationMs: 10_000,
    sessionId: 'sess-demo',
    result: 'completed',
    exitCode: 0,
    validated: true,
    validationErrors: [],
    systemValidated: true,
    userValidated: true,
    eventCount: 4,
    toolCallCount: 1,
    artifacts: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export function makeSessionStart(sessionId = 'sess-demo'): AgentSessionEvent {
  return {
    type: 'session_start',
    timestamp: '2026-04-28T00:00:01.000Z',
    eventId: nextId('evt'),
    data: { sessionId },
  };
}

export function makeUserPrompt(content: string): AgentUserPromptEvent {
  return {
    type: 'user_prompt',
    timestamp: '2026-04-28T00:00:02.000Z',
    eventId: nextId('evt'),
    data: { content },
  };
}

export function makeTextDelta(
  content: string,
  messageId = 'msg-1',
): AgentTextDeltaEvent {
  return {
    type: 'text_delta',
    timestamp: '2026-04-28T00:00:03.000Z',
    eventId: nextId('evt'),
    data: { content, messageId },
  };
}

export function makeMessage(
  content: string,
  messageId = 'msg-1',
): AgentMessageEvent {
  return {
    type: 'message',
    timestamp: '2026-04-28T00:00:04.000Z',
    eventId: nextId('evt'),
    data: { content, messageId },
  };
}

/**
 * FX002-1 — fixture builder for `thinking` events. Thinking events have no
 * messageId; the reducer coalesces consecutive thinking deltas into one
 * "thinking burst" transcript row, finalised on the next non-thinking event.
 */
export function makeThinking(
  content: string,
  isDelta = true,
): AgentThinkingEvent {
  return {
    type: 'thinking',
    timestamp: '2026-04-28T00:00:02.500Z',
    eventId: nextId('evt'),
    data: { content, isDelta },
  };
}

export function makeToolCall(
  toolName: string,
  toolCallId: string,
  input: unknown = {},
): AgentToolCallEvent {
  return {
    type: 'tool_call',
    timestamp: '2026-04-28T00:00:05.000Z',
    eventId: nextId('evt'),
    data: { toolName, toolCallId, input },
  };
}

export function makeToolResult(
  toolCallId: string,
  output: string,
  isError = false,
): AgentToolResultEvent {
  return {
    type: 'tool_result',
    timestamp: '2026-04-28T00:00:06.000Z',
    eventId: nextId('evt'),
    data: { toolCallId, output, isError },
  };
}

export function makeEventLog(events: AgentEvent[]): AgentEvent[] {
  return events.map((e) => ({ ...e }));
}

// ---------------------------------------------------------------------------
// Inbox / state / history / output / validation
// ---------------------------------------------------------------------------

export function makeInboxMessage(
  overrides: Partial<InboxMessage> & { lane?: 'outside' | 'inside' } = {},
): InboxMessage & { lane: 'outside' | 'inside' } {
  const { lane = 'outside', ...rest } = overrides;
  return {
    id: nextId('msg').replace('msg-', '01HXM'),
    sender: lane,
    type: 'note',
    subject: 'hello',
    body: 'hi from fixture',
    ts: '2026-04-28T00:00:07.000Z',
    lane,
    ...rest,
  } as InboxMessage & { lane: 'outside' | 'inside' };
}

export interface InboxLane {
  lane: 'outside' | 'inside';
  messages: InboxMessage[];
}

export function makeInboxLane(
  lane: 'outside' | 'inside',
  messages: InboxMessage[] = [],
): InboxLane {
  return { lane, messages: messages.map((m) => ({ ...m, sender: lane })) };
}

export function makeStateFile(
  side: 'outside' | 'inside',
  status = 'in-progress',
): OutsideState | InsideState {
  if (side === 'outside') {
    return {
      status,
      data: {},
      updatedAt: '2026-04-28T00:00:08.000Z',
      updatedBy: 'outside',
    };
  }
  return {
    status,
    data: {},
    updatedAt: '2026-04-28T00:00:08.000Z',
    updatedBy: 'inside',
  };
}

export function makeHistory(entries: StateHistoryEntry[]): StateHistoryEntry[] {
  return entries.map((e) => ({ ...e }));
}

export function makeHistoryEntry(
  overrides: Partial<StateHistoryEntry> = {},
): StateHistoryEntry {
  return {
    ts: '2026-04-28T00:00:09.000Z',
    side: 'inside',
    from: 'idle',
    to: 'in-progress',
    reason: null,
    peerStateAtTime: { status: 'idle' },
    ...overrides,
  };
}

export interface OutputArtifact {
  outputPath: string;
  exists: boolean;
  bytes: number | null;
}

export function makeOutput(
  overrides: Partial<OutputArtifact> = {},
): OutputArtifact {
  return {
    outputPath: '/tmp/runs/01HXY00000000000000000DEMO/output/report.json',
    exists: true,
    bytes: 256,
    ...overrides,
  };
}

export function makeValidation(
  overrides: Partial<ValidationResult> = {},
): ValidationResult {
  return { valid: true, errors: [], ...overrides };
}
