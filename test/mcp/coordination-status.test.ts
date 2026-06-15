import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { McpServerContext } from '../../src/mcp/context.js';
import { coordinationStatus } from '../../src/mcp/tools/coordination-status.js';
import { McpToolError } from '../../src/mcp/types.js';
import {
  type CoordinationRunLocation,
  coordinationRunLocation,
  inboxLanePath,
} from '../../src/runner/folder.js';
import type { InboxMessage } from '../../src/runner/types.js';

/**
 * Plan 027 Phase 4 — T004. `coordination_status` mirrors `permission-status.ts`:
 * the handler takes only the context, builds a CoordinationRunLocation, and
 * returns the derived ledger + draft + pinned coordinationMode in
 * `structuredContent`.
 */

let tmpDir: string;
let context: McpServerContext;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-coord-status-'));
  const agentsDir = path.join(tmpDir, 'agents');
  const agentSlug = 'code-review-companion';
  const agentDir = path.join(agentsDir, agentSlug);
  context = {
    context: 'inside',
    side: 'inside',
    runId: 'run-1',
    runDir: path.join(agentDir, 'runs', 'run-1'),
    agentSlug,
    agentsDir,
    agentDir,
    inboxDir: path.join(agentDir, 'runs', 'run-1', 'inbox'),
    stateDir: path.join(agentDir, 'runs', 'run-1', 'state'),
    processMarker: 'minih-mcp-run-1',
  };
  fs.mkdirSync(context.runDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function loc(): CoordinationRunLocation {
  return coordinationRunLocation(
    context.agentSlug,
    context.agentsDir,
    context.runId,
  );
}

function appendMsg(lane: 'inside' | 'outside', m: InboxMessage): void {
  const file = inboxLanePath(loc(), lane);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(m)}\n`);
}

function msg(
  id: string,
  sender: 'inside' | 'outside',
  type: string,
  ts: string,
  extra: Partial<InboxMessage> = {},
): InboxMessage {
  return {
    id,
    sender,
    type,
    subject: `S ${id}`,
    body: `B ${id}`,
    ts,
    ...extra,
  };
}

describe('coordination_status MCP tool', () => {
  it('returns the derived ledger + draft + pinned coordinationMode in structuredContent', () => {
    appendMsg(
      'outside',
      msg('m1', 'outside', 'task', '2026-06-15T10:00:00.000Z'),
    );
    appendMsg(
      'inside',
      msg('a1', 'inside', 'ack', '2026-06-15T10:01:00.000Z', { ackOf: 'm1' }),
    );
    appendMsg(
      'inside',
      msg('f1', 'inside', 'finding', '2026-06-15T10:02:00.000Z'),
    );
    // Completion summary acking m1 — this is what marks the review done (F002).
    appendMsg(
      'inside',
      msg('s1', 'inside', 'summary', '2026-06-15T10:03:00.000Z', {
        ackOf: 'm1',
      }),
    );

    const result = coordinationStatus(context);
    const sc = result.structuredContent;

    expect(sc?.agentSlug).toBe('code-review-companion');
    // No frozen prompt.md in the run dir → pinned to 'disabled' (PIC-B).
    expect(sc?.coordinationMode).toBe('disabled');
    expect(sc?.ledger.reviewedIds).toEqual(['m1']);
    expect(sc?.ledger.findingsCount).toBe(1);
    expect(sc?.draftFarewell).not.toBeNull();
    // text mirror present (permission-status shape parity).
    expect(result.content[0]?.type).toBe('text');
  });

  it('throws MCP_INBOX_CORRUPT on a torn lane (no silent swallow)', () => {
    const file = inboxLanePath(loc(), 'outside');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{ not json\n');

    try {
      coordinationStatus(context);
      throw new Error('expected coordinationStatus to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(McpToolError);
      expect((err as McpToolError).code).toBe('MCP_INBOX_CORRUPT');
    }
  });
});

/**
 * Plan 027 Phase 5 — AC-12 / T002. The configured idle budget is discoverable at
 * runtime: `coordination_status` surfaces `idleBudgetSec`, read off the run's
 * recorded `run.json` `budgets.idleBudgetMs` (NOT MINIH_PARAMS — that env never
 * reaches the inside-MCP subprocess, PIC-P5-E / validate-v2 A2).
 */
describe('coordination_status idle budget (AC-12)', () => {
  function writeRunManifest(budgets: Record<string, unknown> | null): void {
    const manifest = {
      schemaVersion: 1,
      slug: context.agentSlug,
      runId: context.runId,
      ...(budgets ? { budgets } : {}),
    };
    fs.writeFileSync(
      path.join(context.runDir, 'run.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
  }

  it('surfaces a NON-DEFAULT idleBudgetMs as idleBudgetSec (a stub returning the default would fail here)', () => {
    writeRunManifest({
      timeoutSec: 7200,
      stallTimeoutSec: 300,
      maxTurns: 0,
      idleBudgetMs: 120_000,
    });
    const sc = coordinationStatus(context).structuredContent;
    expect(sc?.idleBudgetSec).toBe(120);
  });

  it('falls back to the schema default (1800s) when run.json records no idle budget', () => {
    writeRunManifest({ timeoutSec: 7200, stallTimeoutSec: 300, maxTurns: 0 });
    const sc = coordinationStatus(context).structuredContent;
    expect(sc?.idleBudgetSec).toBe(1800);
  });

  it('falls back to the schema default when run.json is absent entirely', () => {
    const sc = coordinationStatus(context).structuredContent;
    expect(sc?.idleBudgetSec).toBe(1800);
  });
});
