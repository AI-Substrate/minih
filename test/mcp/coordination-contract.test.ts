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
 *   (d) AC-6 (#27/#31): every status the code-review-companion prompt publishes
 *       (`idle/reading/reviewing/reporting/blocked/stopping`) is accepted by the
 *       *real shipped* companion schema, resolved at agent ROOT (level 2 of the
 *       3-level fallback — PIC-1: `state/` is install-denied, root ships the file).
 *   (e) AC-6 discriminating negative: dropping one value from that enum makes the
 *       matching transition hard-reject with `MCP_INVALID_ARGUMENT` — proving the
 *       (d) acceptance test would fail loudly if an enum value were ever removed.
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

  it('(d) accepts every companion state_transition target against the resolved companion schema (AC-6)', () => {
    // Read the *real shipped* companion schema and place it at the agent ROOT —
    // the install-payload location. PIC-1: `state/` is install-denied, so the
    // companion ships its schema at root, which insideStateSchemaPath resolves at
    // level 2. No `state/` dir is created here, so a green run proves root-level
    // resolution works for the published pack (the keep-root disposition, T002).
    const ctx = buildContext('coord-contract-companion');
    fs.mkdirSync(ctx.agentDir, { recursive: true });
    const companionSchema = JSON.parse(
      fs.readFileSync(
        path.resolve('agents/code-review-companion/inside-state.schema.json'),
        'utf8',
      ),
    ) as { properties: { status: { enum: string[] } } };
    fs.writeFileSync(
      path.join(ctx.agentDir, 'inside-state.schema.json'),
      JSON.stringify(companionSchema),
    );

    const targets = companionSchema.properties.status.enum;
    // Pin the published vocabulary itself: if the pack's enum ever changes, this
    // assertion forces a deliberate revisit (it guards the #27/#31 contract).
    expect(targets).toEqual([
      'idle',
      'reading',
      'reviewing',
      'reporting',
      'blocked',
      'stopping',
    ]);

    // Every published target must be ACCEPTED. validateInsideState runs at
    // state.ts:100 *before* the no-op short-circuit, so each target is validated
    // against the enum regardless of the prior status.
    for (const target of targets) {
      const result = stateTransition(ctx, { to: target }).structuredContent;
      expect(result?.to).toBe(target);
    }
  });

  it('(e) rejects a target dropped from a truncated companion schema with MCP_INVALID_ARGUMENT (discriminating negative, AC-6)', () => {
    // Discriminating proof that (d) has teeth: drop one published value and the
    // matching transition must hard-reject — so the suite fails loudly if an enum
    // value is ever removed (the exact #27/#31 regression).
    const ctx = buildContext('coord-contract-truncated');
    fs.mkdirSync(ctx.agentDir, { recursive: true });
    const companionSchema = JSON.parse(
      fs.readFileSync(
        path.resolve('agents/code-review-companion/inside-state.schema.json'),
        'utf8',
      ),
    ) as { properties: { status: { enum: string[] } } };
    const truncated = {
      ...companionSchema,
      properties: {
        ...companionSchema.properties,
        status: {
          ...companionSchema.properties.status,
          enum: companionSchema.properties.status.enum.filter(
            (s) => s !== 'stopping',
          ),
        },
      },
    };
    fs.writeFileSync(
      path.join(ctx.agentDir, 'inside-state.schema.json'),
      JSON.stringify(truncated),
    );

    let caught: unknown;
    try {
      stateTransition(ctx, { to: 'stopping' });
    } catch (error) {
      caught = error;
    }
    expect((caught as { code?: string })?.code).toBe('MCP_INVALID_ARGUMENT');

    // A still-present value resolves fine — proving the rejection is about the
    // dropped enum value, not a broken fixture.
    expect(stateTransition(ctx, { to: 'reading' }).structuredContent?.to).toBe(
      'reading',
    );
  });
});
