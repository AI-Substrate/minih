import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { McpServerContext } from '../../src/mcp/context.js';
import {
  stateGet,
  stateSet,
  stateTransition,
} from '../../src/mcp/tools/state.js';
import { McpToolError } from '../../src/mcp/types.js';
import { historyPath, stateFilePath } from '../../src/runner/folder.js';
import { writeState } from '../../src/runner/state.js';

let tmpDir: string;
let context: McpServerContext;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-mcp-state-'));
  const agentsDir = path.join(tmpDir, 'agents');
  const agentSlug = 'code-review';
  const agentDir = path.join(agentsDir, agentSlug);
  context = {
    context: 'inside',
    side: 'inside',
    runId: 'run-123',
    runDir: path.join(agentDir, 'runs', 'run-123'),
    agentSlug,
    agentsDir,
    agentDir,
    inboxDir: path.join(agentDir, 'inbox'),
    stateDir: path.join(agentDir, 'state'),
    processMarker: 'minih-mcp-run-123',
  };
  fs.mkdirSync(context.runDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('stateGet', () => {
  it('reads the synthetic inside default without writing it', () => {
    const result = stateGet(context).structuredContent;

    expect(result?.self).toMatchObject({
      status: 'idle',
      data: {},
      updatedBy: 'inside',
    });
    expect(result?.peer).toMatchObject({
      status: 'idle',
      data: {},
      updatedBy: 'outside',
    });
    expect(
      fs.existsSync(
        stateFilePath(context.agentSlug, context.agentsDir, 'inside'),
      ),
    ).toBe(false);
  });

  it('reads peer outside state', () => {
    writeState('outside', context.agentSlug, context.agentsDir, {
      status: 'in-progress',
      data: { phase: 4 },
      updatedAt: '2026-04-26T00:00:00.000Z',
      updatedBy: 'outside',
    });

    expect(
      stateGet(context, { side: 'outside' }).structuredContent?.state,
    ).toMatchObject({
      status: 'in-progress',
      data: { phase: 4 },
      updatedBy: 'outside',
    });
  });

  it('supports peer/self aliases and keyed reads', () => {
    stateSet(context, { status: 'reviewing', data: { phase: 4 } });
    writeState('outside', context.agentSlug, context.agentsDir, {
      status: 'done',
      data: { phase: 3 },
      updatedAt: '2026-04-26T00:00:00.000Z',
      updatedBy: 'outside',
    });

    expect(
      stateGet(context, { side: 'peer', key: 'status' }).structuredContent,
    ).toMatchObject({
      key: 'status',
      value: 'done',
    });
    expect(stateGet(context, { key: 'data.phase' }).structuredContent).toEqual({
      key: 'data.phase',
      self: 4,
      peer: 3,
    });
  });

  it('maps corrupt state files to typed MCP errors', () => {
    const filePath = stateFilePath(
      context.agentSlug,
      context.agentsDir,
      'inside',
    );
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, '{not json');

    expectMcpError(() => stateGet(context), 'MCP_STATE_CORRUPT');
  });
});

describe('stateSet', () => {
  it('writes data-only inside state using the default schema', () => {
    const result = stateSet(context, {
      status: 'reviewing',
      data: { task: 'T004' },
    }).structuredContent;

    expect(result?.state).toMatchObject({
      status: 'reviewing',
      data: { task: 'T004' },
      updatedBy: 'inside',
    });
    expect(JSON.parse(readStateFile('inside'))).toMatchObject(
      result?.state ?? {},
    );
  });

  it('rejects statuses outside the selected schema enum', () => {
    expectMcpError(
      () => stateSet(context, { status: 'blocked', data: {} }),
      'MCP_INVALID_ARGUMENT',
    );
  });

  it('prefers an agent-local inside-state schema', () => {
    writeLocalInsideSchema(['idle', 'blocked']);

    const result = stateSet(context, {
      status: 'blocked',
      data: { reason: 'waiting' },
    }).structuredContent;

    expect(result?.state.status).toBe('blocked');
    expectMcpError(
      () => stateSet(context, { status: 'reviewing', data: {} }),
      'MCP_INVALID_ARGUMENT',
    );
  });
});

describe('stateTransition', () => {
  it('validates, appends history, and writes the next state', () => {
    writeState('outside', context.agentSlug, context.agentsDir, {
      status: 'in-progress',
      data: {},
      updatedAt: '2026-04-26T00:00:00.000Z',
      updatedBy: 'outside',
    });

    const result = stateTransition(context, {
      to: 'reviewing',
      reason: 'ready for review',
      data: { pr: 42 },
    }).structuredContent;

    expect(result).toMatchObject({
      transitioned: true,
      from: 'idle',
      to: 'reviewing',
      state: { status: 'reviewing', data: { pr: 42 } },
    });
    const history = JSON.parse(
      fs.readFileSync(
        historyPath(context.agentSlug, context.agentsDir),
        'utf8',
      ),
    );
    expect(history).toMatchObject({
      side: 'inside',
      from: 'idle',
      to: 'reviewing',
      reason: 'ready for review',
      peerStateAtTime: { status: 'in-progress' },
    });
  });

  it('does not append history for a no-op transition', () => {
    stateSet(context, { status: 'reviewing', data: { pr: 42 } });

    const result = stateTransition(context, {
      to: 'reviewing',
      data: { pr: 42 },
    }).structuredContent;

    expect(result).toMatchObject({
      transitioned: false,
      from: 'reviewing',
      to: 'reviewing',
    });
    expect(
      fs.existsSync(historyPath(context.agentSlug, context.agentsDir)),
    ).toBe(false);
  });

  it('treats data with different object key order as a no-op transition', () => {
    stateSet(context, { status: 'reviewing', data: { a: 1, b: 2 } });

    const result = stateTransition(context, {
      to: 'reviewing',
      data: { b: 2, a: 1 },
    }).structuredContent;

    expect(result?.transitioned).toBe(false);
    expect(
      fs.existsSync(historyPath(context.agentSlug, context.agentsDir)),
    ).toBe(false);
  });

  it('maps history overflow to a typed MCP error without changing state', () => {
    expectMcpError(
      () =>
        stateTransition(context, {
          to: 'reviewing',
          reason: 'x'.repeat(5000),
        }),
      'MCP_HISTORY_TOO_LARGE',
    );
    expect(
      stateGet(context, { side: 'inside' }).structuredContent?.state?.status,
    ).toBe('idle');
  });
});

function readStateFile(side: 'inside' | 'outside'): string {
  return fs.readFileSync(
    stateFilePath(context.agentSlug, context.agentsDir, side),
    'utf8',
  );
}

function writeLocalInsideSchema(statuses: string[]): void {
  fs.mkdirSync(context.agentDir, { recursive: true });
  fs.writeFileSync(
    path.join(context.agentDir, 'inside-state.schema.json'),
    JSON.stringify({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      required: ['status', 'data', 'updatedAt', 'updatedBy'],
      properties: {
        status: { type: 'string', enum: statuses },
        data: { type: 'object' },
        updatedAt: { type: 'string', format: 'date-time' },
        updatedBy: { const: 'inside' },
      },
      additionalProperties: false,
    }),
  );
}

function expectMcpError(fn: () => unknown, code: string): void {
  try {
    fn();
    throw new Error('expected MCP error');
  } catch (error) {
    expect(error).toBeInstanceOf(McpToolError);
    expect((error as McpToolError).code).toBe(code);
  }
}
