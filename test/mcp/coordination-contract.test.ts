import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { McpServerContext } from '../../src/mcp/context.js';
import { inboxSend } from '../../src/mcp/tools/inbox.js';
import { stateTransition } from '../../src/mcp/tools/state.js';
import type { InboxMessage } from '../../src/runner/types.js';

/**
 * End-to-end coordination contract test.
 *
 * Magic-wand from the FX001 code-review:
 *   "Add one end-to-end coordination contract test that boots a coordinated agent
 *    fixture and asserts both state publication and ackOf-linked reply messages
 *    through the real MCP tool surface."
 *
 * Cases:
 *   (a) state publication with the preferred `state/inside-state.schema.json`
 *       location — proves `state/inside.json` AND `state/history.ndjson` are
 *       written when the agent's custom enum is honored.
 *   (b) back-compat: legacy `<agentDir>/inside-state.schema.json` location
 *       still works (preserves coordination-smoke-test, coordination-loop-validator).
 *   (c) inbox_send with `ackOf` — proves the field reaches disk through the
 *       MCP tool surface (Workshop 007's reply-correlation contract).
 */

const CUSTOM_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  required: ['status', 'data', 'updatedAt', 'updatedBy'],
  properties: {
    status: { type: 'string', enum: ['idle', 'reading'] },
    data: { type: 'object' },
    updatedAt: { type: 'string' },
    updatedBy: { const: 'inside' },
  },
  additionalProperties: false,
};

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-coord-contract-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function buildContext(slug: string): McpServerContext {
  const agentsDir = path.join(tmpDir, 'agents');
  const agentDir = path.join(agentsDir, slug);
  const runId = 'run-contract-001';
  const runDir = path.join(agentDir, 'runs', runId);
  fs.mkdirSync(runDir, { recursive: true });
  return {
    context: 'inside',
    side: 'inside',
    runId,
    runDir,
    agentSlug: slug,
    agentsDir,
    agentDir,
    inboxDir: path.join(runDir, 'inbox'),
    stateDir: path.join(runDir, 'state'),
    processMarker: `minih-mcp-${runId}`,
  };
}

function readNdjson<T>(file: string): T[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as T);
}

describe('coordination contract — real MCP tool surface', () => {
  it('(a) state_transition honors agent-local state/inside-state.schema.json (preferred location)', () => {
    const ctx = buildContext('coord-contract-a');
    const stateSchemaDir = path.join(ctx.agentDir, 'state');
    fs.mkdirSync(stateSchemaDir, { recursive: true });
    fs.writeFileSync(
      path.join(stateSchemaDir, 'inside-state.schema.json'),
      JSON.stringify(CUSTOM_SCHEMA),
    );

    const result = stateTransition(ctx, { to: 'reading' }).structuredContent;
    expect(result?.transitioned).toBe(true);
    expect(result?.to).toBe('reading');

    const insideJsonPath = path.join(ctx.stateDir, 'inside.json');
    expect(fs.existsSync(insideJsonPath)).toBe(true);
    const persisted = JSON.parse(fs.readFileSync(insideJsonPath, 'utf8'));
    expect(persisted.status).toBe('reading');
    expect(persisted.updatedBy).toBe('inside');

    const historyPath = path.join(ctx.stateDir, 'history.ndjson');
    expect(fs.existsSync(historyPath)).toBe(true);
    const history = readNdjson<{ from: string; to: string; side: string }>(
      historyPath,
    );
    expect(history.length).toBe(1);
    expect(history[0]).toMatchObject({
      from: 'idle',
      to: 'reading',
      side: 'inside',
    });
  });

  it('(b) state_transition still works with legacy <agentDir>/inside-state.schema.json (back-compat)', () => {
    const ctx = buildContext('coord-contract-b');
    fs.mkdirSync(ctx.agentDir, { recursive: true });
    fs.writeFileSync(
      path.join(ctx.agentDir, 'inside-state.schema.json'),
      JSON.stringify(CUSTOM_SCHEMA),
    );

    const result = stateTransition(ctx, { to: 'reading' }).structuredContent;
    expect(result?.transitioned).toBe(true);
    expect(result?.to).toBe('reading');

    const insideJsonPath = path.join(ctx.stateDir, 'inside.json');
    expect(fs.existsSync(insideJsonPath)).toBe(true);
    const persisted = JSON.parse(fs.readFileSync(insideJsonPath, 'utf8'));
    expect(persisted.status).toBe('reading');
  });

  it('(c) inbox_send accepts and persists ackOf for reply correlation', () => {
    const ctx = buildContext('coord-contract-c');
    const ackedId = '01HXXXXXXXXXXXXXXXXXXXXXXX';

    const result = inboxSend(ctx, {
      subject: 'finding: state pane empty',
      body: 'state/inside.json was never written.',
      type: 'finding',
      ackOf: ackedId,
    }).structuredContent as { message: InboxMessage } | undefined;

    expect(result?.message?.ackOf).toBe(ackedId);

    const insideMessages = readNdjson<InboxMessage>(
      path.join(ctx.inboxDir, 'inside', 'messages.ndjson'),
    );
    expect(insideMessages.length).toBe(1);
    expect(insideMessages[0].ackOf).toBe(ackedId);
    expect(insideMessages[0].type).toBe('finding');
    expect(insideMessages[0].subject).toBe('finding: state pane empty');
  });
});
