/**
 * Plan 014 — MCP `wait_for_any` tool handler.
 *
 * Validates input shape (caps, kinds, duplicates, bounds), delegates to
 * `runner.waitForAny`, maps runner errors to MCP error codes.
 */

import { coordinationRunLocation } from '../../runner/folder.js';
import {
  EventWaitInboxCorruptError,
  StateFileCorruptError,
  waitForAny,
} from '../../runner/event-wait.js';
import type {
  EventKind,
  WaitForAnyResult,
  WatchEntry,
} from '../../runner/types.js';
import type { McpServerContext } from '../context.js';
import {
  jsonResult,
  MAX_INBOX_WAIT_MS,
  McpToolError,
  type McpToolResult,
} from '../types.js';

const SUPPORTED_KINDS: readonly EventKind[] = [
  'inbox.message',
  'state.peer.changed',
  'state.self.changed',
];

export async function waitForAnyTool(
  context: McpServerContext,
  input: Record<string, unknown> = {},
): Promise<McpToolResult<WaitForAnyResult>> {
  const events = parseEvents(input.events);
  const waitMs = parseWaitMs(input.waitMs);
  const location = coordinationRunLocation(
    context.agentSlug,
    context.agentsDir,
    context.runId,
  );

  try {
    const result = await waitForAny({
      location,
      side: 'inside', // MCP server always runs inside the agent
      events,
      waitMs,
    });
    return jsonResult(result);
  } catch (error) {
    if (error instanceof StateFileCorruptError) {
      throw new McpToolError('MCP_STATE_CORRUPT', error.message);
    }
    if (error instanceof EventWaitInboxCorruptError) {
      throw new McpToolError('MCP_INBOX_CORRUPT', error.message);
    }
    if (error instanceof McpToolError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new McpToolError('MCP_INTERNAL_ERROR', message);
  }
}

function parseEvents(value: unknown): WatchEntry[] {
  if (!Array.isArray(value)) {
    throw new McpToolError(
      'MCP_INVALID_ARGUMENT',
      'events must be an array of watch entries',
    );
  }
  if (value.length < 1) {
    throw new McpToolError(
      'MCP_INVALID_ARGUMENT',
      'events must contain at least one watch entry',
    );
  }
  if (value.length > 8) {
    throw new McpToolError(
      'MCP_INVALID_ARGUMENT',
      'events must contain at most 8 watch entries',
    );
  }

  const seenKinds = new Set<string>();
  const out: WatchEntry[] = [];
  for (const [index, raw] of value.entries()) {
    if (typeof raw !== 'object' || raw === null) {
      throw new McpToolError(
        'MCP_INVALID_ARGUMENT',
        `events[${index}] must be an object with a 'kind' field`,
      );
    }
    const obj = raw as Record<string, unknown>;
    const kind = obj.kind;
    if (typeof kind !== 'string' || !SUPPORTED_KINDS.includes(kind as EventKind)) {
      throw new McpToolError(
        'MCP_INVALID_ARGUMENT',
        `events[${index}].kind must be one of ${SUPPORTED_KINDS.join(', ')} (got ${JSON.stringify(kind)})`,
      );
    }
    if (seenKinds.has(kind)) {
      throw new McpToolError(
        'MCP_INVALID_ARGUMENT',
        `events must not contain duplicate kind '${kind}'`,
      );
    }
    seenKinds.add(kind);

    if (kind === 'inbox.message') {
      const filter = parseInboxFilter(obj.filter, index);
      out.push({ kind, filter });
    } else {
      // state.peer.changed / state.self.changed — no filter in v1
      if (obj.filter !== undefined) {
        throw new McpToolError(
          'MCP_INVALID_ARGUMENT',
          `events[${index}].filter is not supported for kind '${kind}'`,
        );
      }
      out.push({ kind: kind as 'state.peer.changed' | 'state.self.changed' });
    }
  }
  return out;
}

function parseInboxFilter(
  value: unknown,
  index: number,
): { types?: string[] } | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null) {
    throw new McpToolError(
      'MCP_INVALID_ARGUMENT',
      `events[${index}].filter must be an object`,
    );
  }
  const obj = value as Record<string, unknown>;
  if (obj.types === undefined) return {};
  if (!Array.isArray(obj.types)) {
    throw new McpToolError(
      'MCP_INVALID_ARGUMENT',
      `events[${index}].filter.types must be an array of strings`,
    );
  }
  if (obj.types.length === 0 || obj.types.length > 16) {
    throw new McpToolError(
      'MCP_INVALID_ARGUMENT',
      `events[${index}].filter.types must contain 1 to 16 entries`,
    );
  }
  const types: string[] = [];
  for (const [i, t] of obj.types.entries()) {
    if (typeof t !== 'string' || t.trim() === '' || t.length > 64) {
      throw new McpToolError(
        'MCP_INVALID_ARGUMENT',
        `events[${index}].filter.types[${i}] must be a non-empty string up to 64 characters`,
      );
    }
    types.push(t);
  }
  return { types };
}

function parseWaitMs(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new McpToolError(
      'MCP_INVALID_ARGUMENT',
      'waitMs must be an integer',
    );
  }
  if (value < 0) {
    throw new McpToolError(
      'MCP_INVALID_ARGUMENT',
      'waitMs must be at least 0',
    );
  }
  if (value > MAX_INBOX_WAIT_MS) {
    throw new McpToolError(
      'MCP_INVALID_ARGUMENT',
      `waitMs must be at most ${MAX_INBOX_WAIT_MS}`,
    );
  }
  return value;
}
