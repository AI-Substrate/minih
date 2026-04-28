/**
 * Pure HumanViewModel reducer — workshop 004 §Reducer Pipeline, plan 009.
 *
 * Turns raw run artifacts into the Workshop 004 view model. Pure: no I/O,
 * no `await fs.*`, no clocks (other than reading provided values).
 * Deterministic: calling twice with the same input returns deeply equal
 * output. Resilient: malformed lines emit `ViewDiagnostic` and are skipped,
 * not thrown.
 *
 * Phase 2 wraps this in a file-watch loop; Phase 3 wraps it in the
 * non-TTY snapshot renderer.
 */

import type { AgentEvent } from '../adapter/events.js';
import type { InboxLane } from './human-view-fixtures.js';
import type {
  CompletedMetadata,
  CoordinationTimelineEntry,
  HumanHeaderView,
  HumanViewModel,
  InboxMessage,
  InboxTimelineEntry,
  InputFooterView,
  InsideState,
  LiveRunManifest,
  OutputPaneView,
  OutsideState,
  StateHistoryEntry,
  StatePaneView,
  StateTransitionTimelineEntry,
  ToolCallView,
  TranscriptEntry,
  ValidationResult,
  ValidationTimelineEntry,
  ViewDiagnostic,
} from './types.js';

export interface HumanViewSources {
  events: AgentEvent[];
  manifest: LiveRunManifest | null;
  completed: CompletedMetadata | null;
  inbox: InboxLane[];
  state: { inside: InsideState | null; outside: OutsideState | null };
  history: StateHistoryEntry[];
  output: { outputPath: string; exists: boolean; bytes: number | null } | null;
  validation: ValidationResult | null;
}

const KNOWN_EVENT_TYPES = new Set<string>([
  'text_delta',
  'message',
  'usage',
  'session_start',
  'session_idle',
  'session_error',
  'raw',
  'tool_call',
  'tool_result',
  'thinking',
  'user_prompt',
]);

export function buildHumanViewModel(sources: HumanViewSources): HumanViewModel {
  const diagnostics: ViewDiagnostic[] = [];
  const transcript = projectTranscript(sources.events, diagnostics);
  const tools = projectTools(sources.events, diagnostics);
  const inboxEntries = projectInbox(sources.inbox, diagnostics);
  const stateEntries = projectStateTransitions(sources.history);
  const validationEntries = projectValidation(
    sources.validation,
    sources.completed,
  );
  const coordination: CoordinationTimelineEntry[] = [
    ...inboxEntries,
    ...stateEntries,
    ...validationEntries,
  ].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));

  const header = projectHeader(
    sources.manifest,
    sources.completed,
    transcript,
    tools,
    inboxEntries,
  );
  const state = projectStatePane(sources.state);
  const output = projectOutput(sources.output, sources.validation);
  const input = projectInputFooter(header);

  return {
    header,
    transcript,
    tools,
    coordination,
    state,
    output,
    input,
    diagnostics,
  };
}

// ---------------------------------------------------------------------------
// Transcript
// ---------------------------------------------------------------------------

function projectTranscript(
  events: AgentEvent[],
  diagnostics: ViewDiagnostic[],
): TranscriptEntry[] {
  const messageBuffers = new Map<
    string,
    { content: string; sourceEventIds: string[]; ts: string }
  >();
  const finalized = new Set<string>();
  const out: TranscriptEntry[] = [];

  let unkeyedDeltaIdx = 0;

  for (const ev of events) {
    if (!isKnownEvent(ev)) {
      diagnostics.push({
        source: 'events',
        message: `unknown event type: ${String((ev as { type?: unknown }).type)}`,
      });
      continue;
    }
    switch (ev.type) {
      case 'user_prompt': {
        out.push({
          id: ev.eventId ?? `user-${out.length}`,
          ts: ev.timestamp,
          role: 'user',
          actorLabel: 'Outside actor',
          content: ev.data.content,
          status: 'final',
          sourceEventIds: ev.eventId ? [ev.eventId] : [],
          messageId: null,
        });
        break;
      }
      case 'text_delta': {
        const key = ev.data.messageId ?? `__unkeyed-${unkeyedDeltaIdx++}`;
        if (finalized.has(key)) break;
        const buf = messageBuffers.get(key) ?? {
          content: '',
          sourceEventIds: [],
          ts: ev.timestamp,
        };
        buf.content += ev.data.content;
        if (ev.eventId) buf.sourceEventIds.push(ev.eventId);
        messageBuffers.set(key, buf);
        break;
      }
      case 'message': {
        const key = ev.data.messageId ?? `__msg-${out.length}`;
        const buf = messageBuffers.get(key);
        const content = ev.data.content || (buf?.content ?? '');
        const sourceIds = buf?.sourceEventIds ?? [];
        if (ev.eventId) sourceIds.push(ev.eventId);
        out.push({
          id: ev.eventId ?? `assistant-${out.length}`,
          ts: ev.timestamp,
          role: 'assistant',
          actorLabel: 'Inside agent',
          content,
          status: 'final',
          sourceEventIds: sourceIds,
          messageId: ev.data.messageId ?? null,
        });
        finalized.add(key);
        messageBuffers.delete(key);
        break;
      }
      case 'session_error': {
        out.push({
          id: ev.eventId ?? `error-${out.length}`,
          ts: ev.timestamp,
          role: 'error',
          actorLabel: 'Error',
          content: `${ev.data.errorType ?? 'ERROR'}: ${ev.data.message ?? ''}`,
          status: 'error',
          sourceEventIds: ev.eventId ? [ev.eventId] : [],
          messageId: null,
        });
        break;
      }
      // Other event types (usage, session_start, session_idle, raw, thinking,
      // tool_call, tool_result) are projected elsewhere or intentionally skipped.
      default:
        break;
    }
  }

  // Any unfinalised text_delta buckets become 'streaming' transcript entries.
  for (const [key, buf] of messageBuffers.entries()) {
    out.push({
      id: `streaming-${key}`,
      ts: buf.ts,
      role: 'assistant',
      actorLabel: 'Inside agent',
      content: buf.content,
      status: 'streaming',
      sourceEventIds: buf.sourceEventIds,
      messageId: key.startsWith('__') ? null : key,
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

function projectTools(
  events: AgentEvent[],
  diagnostics: ViewDiagnostic[],
): ToolCallView[] {
  const tools = new Map<string, ToolCallView>();
  for (const ev of events) {
    if (!isKnownEvent(ev)) continue;
    if (ev.type === 'tool_call') {
      const id = ev.data.toolCallId;
      tools.set(id, {
        id,
        toolName: ev.data.toolName,
        startedAt: ev.timestamp,
        completedAt: null,
        status: 'running',
        inputSummary: summarizeInput(ev.data.input),
        outputSummary: null,
        outputTruncated: false,
      });
    } else if (ev.type === 'tool_result') {
      const id = ev.data.toolCallId;
      const existing = tools.get(id);
      if (!existing) {
        // Result without a matching call — surface a diagnostic but
        // still synthesize a row so users can see it happened.
        diagnostics.push({
          source: 'events',
          message: `tool_result for unknown toolCallId: ${id}`,
        });
        tools.set(id, {
          id,
          toolName: '<unknown>',
          startedAt: ev.timestamp,
          completedAt: ev.timestamp,
          status: ev.data.isError ? 'error' : 'ok',
          inputSummary: '',
          outputSummary: truncate(ev.data.output, 240),
          outputTruncated: ev.data.output.length > 240,
        });
      } else {
        existing.completedAt = ev.timestamp;
        existing.status = ev.data.isError ? 'error' : 'ok';
        existing.outputSummary = truncate(ev.data.output, 240);
        existing.outputTruncated = ev.data.output.length > 240;
      }
    }
  }
  return Array.from(tools.values());
}

// ---------------------------------------------------------------------------
// Inbox / coordination timeline
// ---------------------------------------------------------------------------

function projectInbox(
  lanes: InboxLane[],
  diagnostics: ViewDiagnostic[],
): InboxTimelineEntry[] {
  // First pass: gather every message with its lane.
  const all: Array<{ msg: InboxMessage; lane: 'outside' | 'inside' }> = [];
  for (const lane of lanes) {
    for (const m of lane.messages) {
      if (!m || typeof m !== 'object' || !m.id) {
        diagnostics.push({
          source: 'inbox',
          message: 'malformed inbox message skipped',
        });
        continue;
      }
      all.push({ msg: m, lane: lane.lane });
    }
  }
  const ackedIds = new Set<string>();
  for (const { msg } of all) if (msg.ackOf) ackedIds.add(msg.ackOf);

  return all.map(({ msg, lane }) => {
    const ackState: InboxTimelineEntry['ackState'] = msg.ackOf
      ? 'acks-other'
      : ackedIds.has(msg.id)
        ? 'acked'
        : 'unacked';
    return {
      kind: 'inbox',
      id: msg.id,
      ts: msg.ts,
      lane,
      type: msg.type,
      subject: msg.subject,
      bodyPreview: truncate(msg.body, 120),
      ackOf: msg.ackOf ?? null,
      ackState,
    };
  });
}

function projectStateTransitions(
  history: StateHistoryEntry[],
): StateTransitionTimelineEntry[] {
  return history.map((h, i) => ({
    kind: 'state-transition',
    id: `state-${i}-${h.ts}`,
    ts: h.ts,
    side: h.side,
    from: h.from,
    to: h.to,
    reason: h.reason,
    peerStatus: h.peerStateAtTime?.status ?? null,
  }));
}

function projectValidation(
  validation: ValidationResult | null,
  completed: CompletedMetadata | null,
): ValidationTimelineEntry[] {
  if (!validation) return [];
  return [
    {
      kind: 'validation',
      id: 'validation-final',
      ts: completed?.completedAt ?? new Date(0).toISOString(),
      valid: validation.valid,
      errors: validation.errors,
    },
  ];
}

// ---------------------------------------------------------------------------
// Header / state / output / input
// ---------------------------------------------------------------------------

function projectHeader(
  manifest: LiveRunManifest | null,
  completed: CompletedMetadata | null,
  transcript: TranscriptEntry[],
  tools: ToolCallView[],
  inbox: InboxTimelineEntry[],
): HumanHeaderView {
  const eventCount = transcript.length + tools.length;
  const toolCallCount = tools.length;
  const unreadCount = inbox.filter(
    (i) => i.lane === 'outside' && i.ackState !== 'acked',
  ).length;

  if (completed) {
    return {
      slug: completed.slug,
      runId: completed.runId,
      sessionId: completed.sessionId || null,
      model: manifest?.model ?? null,
      status: completed.result === 'failed' ? 'failed' : 'completed',
      capability: 'completed',
      elapsedMs: completed.durationMs,
      eventCount: completed.eventCount,
      toolCallCount: completed.toolCallCount,
      unreadCount,
    };
  }

  if (!manifest) {
    return {
      slug: '',
      runId: '',
      sessionId: null,
      model: null,
      status: 'unknown',
      capability: 'starting',
      elapsedMs: null,
      eventCount,
      toolCallCount,
      unreadCount,
    };
  }

  const status: HumanHeaderView['status'] =
    manifest.status === 'starting'
      ? 'starting'
      : manifest.status === 'completed'
        ? 'completed'
        : manifest.status === 'failed'
          ? 'failed'
          : manifest.status === 'stale'
            ? 'stale'
            : 'active';
  const capability: HumanHeaderView['capability'] =
    status === 'completed' || status === 'failed'
      ? 'completed'
      : status === 'starting'
        ? 'starting'
        : manifest.control.available
          ? 'input-available'
          : 'input-read-only';

  const startedAt = Date.parse(manifest.startedAt);
  const elapsedMs = Number.isFinite(startedAt)
    ? Date.parse(manifest.updatedAt) - startedAt
    : null;

  return {
    slug: manifest.slug,
    runId: manifest.runId,
    sessionId: manifest.sessionId,
    model: manifest.model,
    status,
    capability,
    elapsedMs,
    eventCount: manifest.counters.events || eventCount,
    toolCallCount: manifest.counters.toolCalls || toolCallCount,
    unreadCount,
  };
}

function projectStatePane(state: {
  inside: InsideState | null;
  outside: OutsideState | null;
}): StatePaneView {
  return {
    inside: state.inside
      ? { status: state.inside.status, updatedAt: state.inside.updatedAt }
      : null,
    outside: state.outside
      ? { status: state.outside.status, updatedAt: state.outside.updatedAt }
      : null,
  };
}

function projectOutput(
  output: { outputPath: string; exists: boolean; bytes: number | null } | null,
  validation: ValidationResult | null,
): OutputPaneView {
  if (!output) {
    return {
      outputPath: null,
      exists: false,
      bytes: null,
      lastValidation: validation,
    };
  }
  return {
    outputPath: output.outputPath,
    exists: output.exists,
    bytes: output.bytes,
    lastValidation: validation,
  };
}

function projectInputFooter(header: HumanHeaderView): InputFooterView {
  if (header.capability === 'completed') {
    return {
      enabled: false,
      mode: 'completed',
      disabledReason: 'run is completed',
      draft: '',
      followPaused: false,
      pendingCommandCount: 0,
    };
  }
  if (header.capability === 'input-available') {
    return {
      enabled: true,
      mode: 'same-process',
      disabledReason: null,
      draft: '',
      followPaused: false,
      pendingCommandCount: 0,
    };
  }
  if (header.capability === 'starting') {
    return {
      enabled: false,
      mode: 'attached-read-only',
      disabledReason: 'run is starting — waiting for session_start',
      draft: '',
      followPaused: false,
      pendingCommandCount: 0,
    };
  }
  return {
    enabled: false,
    mode: 'attached-read-only',
    disabledReason: 'this attach view cannot deliver outside messages',
    draft: '',
    followPaused: false,
    pendingCommandCount: 0,
  };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function isKnownEvent(ev: AgentEvent): boolean {
  return KNOWN_EVENT_TYPES.has((ev as { type: string }).type);
}

function summarizeInput(input: unknown): string {
  if (input == null) return '';
  if (typeof input === 'string') return truncate(input, 120);
  try {
    return truncate(JSON.stringify(input), 120);
  } catch {
    return '<unserialisable input>';
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}
