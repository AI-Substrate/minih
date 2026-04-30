/**
 * Plan 014 T008 — `wait_for_any` MCP tool input validation tests.
 *
 * Covers ACs 7–11 (caps, required fields, unknown/duplicate kind, bounds) and
 * AC-17 (forward-compat envelope shape on success).
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { coordinationRunLocation, inboxLanePath } from '../../src/runner/folder.js';
import { waitForAnyTool } from '../../src/mcp/tools/wait.js';
import type { McpServerContext } from '../../src/mcp/context.js';
import { McpToolError } from '../../src/mcp/types.js';

let tmpDir: string;
let agentsDir: string;
const slug = 'agent-x';
const runId = 'run-1';

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-tools-wait-'));
  agentsDir = path.join(tmpDir, 'agents');
  fs.mkdirSync(agentsDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function ctx(): McpServerContext {
  const runDir = path.join(agentsDir, slug, 'runs', runId);
  return {
    context: 'inside',
    side: 'inside',
    runId,
    runDir,
    agentSlug: slug,
    agentsDir,
    agentDir: path.join(agentsDir, slug),
    inboxDir: path.join(runDir, 'inbox'),
    stateDir: path.join(runDir, 'state'),
    processMarker: 'minih-test',
  };
}

async function expectInvalidArg(
  call: () => Promise<unknown>,
  contains: string,
): Promise<void> {
  await expect(call()).rejects.toMatchObject({
    code: 'MCP_INVALID_ARGUMENT',
    message: expect.stringContaining(contains),
  });
}

describe('waitForAnyTool input validation (plan 014 T008)', () => {
  it('AC-8: missing events → MCP_INVALID_ARGUMENT', async () => {
    await expectInvalidArg(
      () => waitForAnyTool(ctx(), { waitMs: 100 }),
      'events must be an array',
    );
  });

  it('AC-8: missing waitMs → MCP_INVALID_ARGUMENT', async () => {
    await expectInvalidArg(
      () => waitForAnyTool(ctx(), { events: [{ kind: 'inbox.message' }] }),
      'waitMs must be an integer',
    );
  });

  it('AC-7: empty events array → MCP_INVALID_ARGUMENT', async () => {
    await expectInvalidArg(
      () => waitForAnyTool(ctx(), { events: [], waitMs: 100 }),
      'at least one watch entry',
    );
  });

  it('AC-7: 9 events (over cap) → MCP_INVALID_ARGUMENT', async () => {
    const events = Array.from({ length: 9 }, () => ({ kind: 'inbox.message' }));
    await expectInvalidArg(
      () => waitForAnyTool(ctx(), { events, waitMs: 100 }),
      'at most 8 watch entries',
    );
  });

  it('AC-9: unknown kind → MCP_INVALID_ARGUMENT', async () => {
    await expectInvalidArg(
      () =>
        waitForAnyTool(ctx(), {
          events: [{ kind: 'fs.changed' }],
          waitMs: 100,
        }),
      'kind must be one of',
    );
  });

  it('AC-10: duplicate kind → MCP_INVALID_ARGUMENT', async () => {
    await expectInvalidArg(
      () =>
        waitForAnyTool(ctx(), {
          events: [{ kind: 'inbox.message' }, { kind: 'inbox.message' }],
          waitMs: 100,
        }),
      'duplicate kind',
    );
  });

  it('AC-11: waitMs < 0 → MCP_INVALID_ARGUMENT', async () => {
    await expectInvalidArg(
      () =>
        waitForAnyTool(ctx(), {
          events: [{ kind: 'inbox.message' }],
          waitMs: -1,
        }),
      'at least 0',
    );
  });

  it('AC-11: waitMs > 30000 → MCP_INVALID_ARGUMENT', async () => {
    await expectInvalidArg(
      () =>
        waitForAnyTool(ctx(), {
          events: [{ kind: 'inbox.message' }],
          waitMs: 30001,
        }),
      'at most 30000',
    );
  });

  it('rejects non-integer waitMs', async () => {
    await expectInvalidArg(
      () =>
        waitForAnyTool(ctx(), {
          events: [{ kind: 'inbox.message' }],
          waitMs: 100.5,
        }),
      'waitMs must be an integer',
    );
  });

  it('rejects events[i] without kind field', async () => {
    await expectInvalidArg(
      () => waitForAnyTool(ctx(), { events: [{}], waitMs: 100 }),
      'kind must be one of',
    );
  });

  it('rejects filter on state kinds', async () => {
    await expectInvalidArg(
      () =>
        waitForAnyTool(ctx(), {
          events: [{ kind: 'state.peer.changed', filter: { foo: 'bar' } }],
          waitMs: 100,
        }),
      'filter is not supported',
    );
  });

  it('AC-6: happy-path returns clean-timeout envelope', async () => {
    // Set up an empty inbox lane so the watcher can register
    const lanePath = inboxLanePath(
      coordinationRunLocation(slug, agentsDir, runId),
      'outside',
    );
    fs.mkdirSync(path.dirname(lanePath), { recursive: true });
    fs.writeFileSync(lanePath, '');

    const result = await waitForAnyTool(ctx(), {
      events: [{ kind: 'inbox.message' }],
      waitMs: 50,
    });

    expect(result.structuredContent).toBeDefined();
    expect(result.structuredContent?.events).toEqual([]);
    expect(result.structuredContent?.wait).toMatchObject({
      requestedMs: 50,
      timedOut: true,
      matched: false,
    });
    expect(typeof result.structuredContent?.wait.elapsedMs).toBe('number');
  });

  it('accepts inbox filter.types as a non-empty string array', async () => {
    const lanePath = inboxLanePath(
      coordinationRunLocation(slug, agentsDir, runId),
      'outside',
    );
    fs.mkdirSync(path.dirname(lanePath), { recursive: true });
    fs.writeFileSync(lanePath, '');

    const result = await waitForAnyTool(ctx(), {
      events: [{ kind: 'inbox.message', filter: { types: ['task'] } }],
      waitMs: 50,
    });
    expect(result.structuredContent?.wait.timedOut).toBe(true);
  });

  it('rejects filter.types empty array', async () => {
    await expectInvalidArg(
      () =>
        waitForAnyTool(ctx(), {
          events: [{ kind: 'inbox.message', filter: { types: [] } }],
          waitMs: 100,
        }),
      'filter.types must contain 1 to 16 entries',
    );
  });
});

// Sanity check that errors thrown are McpToolError instances (the matcher
// above relies on the .code property, but worth one assertion that the
// constructor identity is preserved for downstream catch blocks).
describe('McpToolError identity', () => {
  it('wraps validation errors as McpToolError', async () => {
    let caught: unknown;
    try {
      await waitForAnyTool(ctx(), {});
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(McpToolError);
  });
});
