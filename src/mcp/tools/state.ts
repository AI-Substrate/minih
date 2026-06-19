import * as fs from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { coordinationRunLocation } from '../../runner/folder.js';
import {
  appendHistory,
  HistoryLineTooLargeError,
  readStateLazy,
  StateCorruptError,
  writeState,
} from '../../runner/state.js';
import type { InsideState, Side, SideState } from '../../runner/types.js';
import {
  addSpanAttributes,
  coordinationStateTransitions,
} from '../../telemetry/index.js';
import type { McpServerContext } from '../context.js';
import { jsonResult, McpToolError, type McpToolResult } from '../types.js';
import { insideStateSchemaPath } from './inside-state-schema.js';

export interface StateGetOutput {
  state?: SideState;
  self?: unknown;
  peer?: unknown;
  key?: string;
  value?: unknown;
}

export interface StateSetOutput {
  state: InsideState;
}

export interface StateTransitionOutput {
  state: InsideState;
  transitioned: boolean;
  from: string;
  to: string;
}

export function stateGet(
  context: McpServerContext,
  input: Record<string, unknown> = {},
): McpToolResult<StateGetOutput> {
  return withStateErrors(() => {
    const selection = parseOptionalStateSelection(input.side);
    const key = parseOptionalKey(input.key);
    const location = coordinationRunLocationFromContext(context);
    const inside = readStateLazy(location, 'inside');
    const outside = readStateLazy(location, 'outside');

    if (selection === 'both') {
      if (key !== undefined) {
        return jsonResult({
          key,
          self: readStateKey(inside, key),
          peer: readStateKey(outside, key),
        });
      }
      return jsonResult({ self: inside, peer: outside });
    }

    const state = selection === 'inside' ? inside : outside;
    if (key !== undefined) {
      return jsonResult({ key, value: readStateKey(state, key) });
    }

    return jsonResult({
      state,
      [selection === 'inside' ? 'self' : 'peer']: state,
    });
  });
}

export function stateSet(
  context: McpServerContext,
  input: Record<string, unknown>,
): McpToolResult<StateSetOutput> {
  return withStateErrors(() => {
    const state = buildInsideState(input.status, input.data);
    validateInsideState(context, state);
    writeState(coordinationRunLocationFromContext(context), 'inside', state);
    return jsonResult({ state });
  });
}

export function stateTransition(
  context: McpServerContext,
  input: Record<string, unknown>,
): McpToolResult<StateTransitionOutput> {
  return withStateErrors(() => {
    const to = requireNonEmptyString(input.to, 'to');
    const location = coordinationRunLocationFromContext(context);
    const current = readStateLazy(location, 'inside') as InsideState;
    const data =
      input.data === undefined
        ? current.data
        : requireRecord(input.data, 'data');
    const next = buildInsideState(to, data);
    validateInsideState(context, next);

    if (current.status === next.status && deepEqual(current.data, next.data)) {
      return jsonResult({
        state: current,
        transitioned: false,
        from: current.status,
        to: next.status,
      });
    }

    appendHistory(location, {
      ts: next.updatedAt,
      side: 'inside',
      from: current.status,
      to: next.status,
      reason: parseOptionalReason(input.reason),
    });
    writeState(location, 'inside', next);

    // OPP-3/OPP-4: enrich the dispatch span (minih.mcp.state_transition) and
    // record the transition counter. Only on a real transition.
    addSpanAttributes({
      'state.from': current.status,
      'state.to': next.status,
    });
    coordinationStateTransitions.add(1, {
      from: current.status,
      to: next.status,
    });

    return jsonResult({
      state: next,
      transitioned: true,
      from: current.status,
      to: next.status,
    });
  });
}

function buildInsideState(status: unknown, data: unknown): InsideState {
  return {
    status: requireNonEmptyString(status, 'status'),
    data: data === undefined ? {} : requireRecord(data, 'data'),
    updatedAt: new Date().toISOString(),
    updatedBy: 'inside',
  };
}

function validateInsideState(
  context: McpServerContext,
  state: InsideState,
): void {
  const schemaPath = insideStateSchemaPath(context);
  let schema: unknown;
  try {
    schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  } catch {
    throw new McpToolError(
      'MCP_STATE_SCHEMA_INVALID',
      'inside state schema is not valid JSON',
    );
  }

  const ajv = new Ajv2020({ allErrors: true });
  addFormats(ajv);
  let validate: ReturnType<typeof ajv.compile>;
  try {
    validate = ajv.compile(schema as Record<string, unknown>);
  } catch {
    throw new McpToolError(
      'MCP_STATE_SCHEMA_INVALID',
      'inside state schema failed to compile',
    );
  }

  if (validate(state)) return;
  throw new McpToolError(
    'MCP_INVALID_ARGUMENT',
    'state does not match inside state schema',
  );
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new McpToolError(
      'MCP_INVALID_ARGUMENT',
      `${field} must be a non-empty string`,
    );
  }
  return value;
}

function parseOptionalStateSelection(value: unknown): Side | 'both' {
  if (value === undefined || value === 'both') return 'both';
  if (value === 'self') return 'inside';
  if (value === 'peer') return 'outside';
  if (value !== 'inside' && value !== 'outside') {
    throw new McpToolError(
      'MCP_INVALID_ARGUMENT',
      'side must be inside, outside, self, peer, or both',
    );
  }
  return value;
}

function parseOptionalKey(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const key = requireNonEmptyString(value, 'key');
  if (key.split('.').some((part) => part === '')) {
    throw new McpToolError(
      'MCP_INVALID_ARGUMENT',
      'key must be a dot path without empty segments',
    );
  }
  return key;
}

function parseOptionalReason(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return requireNonEmptyString(value, 'reason');
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new McpToolError(
      'MCP_INVALID_ARGUMENT',
      `${field} must be an object`,
    );
  }
  return value as Record<string, unknown>;
}

function withStateErrors<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof McpToolError) throw error;
    if (error instanceof StateCorruptError) {
      throw new McpToolError('MCP_STATE_CORRUPT', 'state file is corrupt');
    }
    if (error instanceof HistoryLineTooLargeError) {
      throw new McpToolError(
        'MCP_HISTORY_TOO_LARGE',
        'state history entry is too large',
      );
    }
    throw error;
  }
}

function deepEqual(left: unknown, right: unknown): boolean {
  return stableStringify(left) === stableStringify(right);
}

function readStateKey(state: SideState, key: string): unknown {
  let current: unknown = state;
  for (const segment of key.split('.')) {
    if (typeof current !== 'object' || current === null) return null;
    if (!Object.hasOwn(current, segment)) return null;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}

export type { Side };

function coordinationRunLocationFromContext(context: McpServerContext) {
  return coordinationRunLocation(
    context.agentSlug,
    context.agentsDir,
    context.runId,
  );
}
