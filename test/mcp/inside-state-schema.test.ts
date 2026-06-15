import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { McpServerContext } from '../../src/mcp/context.js';
import {
  DEFAULT_INSIDE_STATE_SCHEMA,
  insideStateSchemaPath,
} from '../../src/mcp/tools/inside-state-schema.js';

/**
 * Plan 027 Phase 6 — T002. Pins the 3-level fallback of the shared inside-state
 * schema resolver after its extraction from state.ts. The legacy ROOT level is
 * load-bearing (PIC-1): the code-review-companion's schema lives at the agent
 * root and MUST keep resolving there, since `state/` is install-denied.
 */

let tmpDir: string;
let context: McpServerContext;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-inside-schema-'));
  const agentsDir = path.join(tmpDir, 'agents');
  const agentSlug = 'code-review-companion';
  const agentDir = path.join(agentsDir, agentSlug);
  fs.mkdirSync(agentDir, { recursive: true });
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
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('insideStateSchemaPath — 3-level fallback (T002)', () => {
  it('returns the built-in DEFAULT when the agent ships no schema', () => {
    expect(insideStateSchemaPath(context)).toBe(DEFAULT_INSIDE_STATE_SCHEMA);
  });

  it('resolves the legacy ROOT path (PIC-1: the companion keeps its schema here)', () => {
    const root = path.join(context.agentDir, 'inside-state.schema.json');
    fs.writeFileSync(root, '{}');
    expect(insideStateSchemaPath(context)).toBe(root);
  });

  it('prefers state/ over the legacy ROOT when both exist', () => {
    const root = path.join(context.agentDir, 'inside-state.schema.json');
    const preferred = path.join(
      context.agentDir,
      'state',
      'inside-state.schema.json',
    );
    fs.mkdirSync(path.dirname(preferred), { recursive: true });
    fs.writeFileSync(root, '{}');
    fs.writeFileSync(preferred, '{}');
    expect(insideStateSchemaPath(context)).toBe(preferred);
  });
});
