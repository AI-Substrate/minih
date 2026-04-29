/**
 * T010 (Plan 011 HF-C) — TDD RED bar for runAgent auto-append branch.
 *
 * Wires `appendRetroEntry` / `appendRetroStub` (from src/runner/retro-ledger.ts)
 * into runAgent at every terminal branch:
 *   - Success path with retrospective → entry
 *   - Success / degraded without retrospective → no-op (we trust the report)
 *   - Timeout, failed, degraded with no report → stub
 *   - Input-validation early-return → stub
 *   - Uncaught crash mid-run → stub (top-level finally hook)
 *
 * Honors MINIH_NO_AUTO_HARVEST=1 (skip silently). Honors MINIH_PLAN_ID
 * (dual-write per-plan ledger). Failure to write is silent (debug stderr
 * only) — never poisons a successful run.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeAgentAdapter } from '../../src/adapter/index.js';
import { resolveAgent } from '../../src/runner/folder.js';
import { runAgent } from '../../src/runner/runner.js';
import { validSystemOutput } from '../helpers/fixtures.js';

let projectRoot: string;
let agentsDir: string;
let ledgerDir: string;
const ORIGINAL_ENV = { ...process.env };

function makeAgent(slug: string, opts: { schema?: object | null } = {}) {
  const dir = path.join(agentsDir, slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'prompt.md'),
    `---\ndescription: "Test agent"\n---\n\n# ${slug}\n\nDo the thing.`,
  );
  if (opts.schema !== null) {
    fs.writeFileSync(
      path.join(dir, 'output-schema.json'),
      JSON.stringify(
        opts.schema ?? {
          $schema: 'https://json-schema.org/draft/2020-12/schema',
          type: 'object',
          required: ['result'],
          properties: { result: { type: 'string' } },
        },
      ),
    );
  }
  const def = resolveAgent(slug, agentsDir);
  if (!def) throw new Error(`expected ${slug} to resolve`);
  return def;
}

function readLedger(slug: string): string {
  const f = path.join(ledgerDir, `${slug}.md`);
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf-8') : '';
}

beforeEach(() => {
  projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-harvest-'));
  agentsDir = path.join(projectRoot, 'agents');
  ledgerDir = path.join(projectRoot, 'docs', 'retros');
  fs.mkdirSync(agentsDir, { recursive: true });
  // Reset env between tests so MINIH_NO_AUTO_HARVEST / MINIH_PLAN_ID don't leak.
  process.env = { ...ORIGINAL_ENV };
  delete process.env.MINIH_NO_AUTO_HARVEST;
  delete process.env.MINIH_PLAN_ID;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  if (projectRoot && fs.existsSync(projectRoot)) {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

describe('runAgent auto-append (success paths)', () => {
  it('writes per-agent ledger entry on completed run with retrospective', async () => {
    const def = makeAgent('demo');
    const fake = new FakeAgentAdapter({
      output: validSystemOutput({ result: 'ok' }),
    });
    await runAgent(
      fake,
      def,
      { slug: 'demo', cwd: projectRoot },
      undefined,
      agentsDir,
    );
    const content = readLedger('demo');
    expect(content).toContain('demo');
    expect(content).toMatch(/runId: /);
    // The validSystemOutput fixture includes a magicWand in the retro.
    expect(content).toContain('magicWand');
  });

  it('also writes per-plan ledger when MINIH_PLAN_ID is set', async () => {
    process.env.MINIH_PLAN_ID = 'plan-test-1';
    const def = makeAgent('demo');
    const fake = new FakeAgentAdapter({ output: validSystemOutput() });
    await runAgent(
      fake,
      def,
      { slug: 'demo', cwd: projectRoot },
      undefined,
      agentsDir,
    );
    expect(readLedger('demo')).toContain('runId:');
    expect(
      fs.readFileSync(path.join(ledgerDir, 'plan-test-1.md'), 'utf-8'),
    ).toContain('runId:');
  });

  it('respects MINIH_NO_AUTO_HARVEST=1 and writes nothing', async () => {
    process.env.MINIH_NO_AUTO_HARVEST = '1';
    const def = makeAgent('demo');
    const fake = new FakeAgentAdapter({ output: validSystemOutput() });
    await runAgent(
      fake,
      def,
      { slug: 'demo', cwd: projectRoot },
      undefined,
      agentsDir,
    );
    expect(fs.existsSync(path.join(ledgerDir, 'demo.md'))).toBe(false);
  });

  it('does not interfere with completed.json contents', async () => {
    const def = makeAgent('demo');
    const fake = new FakeAgentAdapter({
      output: validSystemOutput({ result: 'ok' }),
    });
    const result = await runAgent(
      fake,
      def,
      { slug: 'demo', cwd: projectRoot },
      undefined,
      agentsDir,
    );
    const completed = JSON.parse(
      fs.readFileSync(path.join(result.runDir, 'completed.json'), 'utf-8'),
    );
    expect(completed.result).toBe('completed');
    expect(completed.runId).toBeTruthy();
  });
});

describe('runAgent auto-append (terminal-failure stubs)', () => {
  it('writes a stub when input validation fails (early-return path)', async () => {
    const def = makeAgent('demo');
    // Add an input schema requiring `topic`; pass empty params to fail it.
    fs.writeFileSync(
      path.join(agentsDir, 'demo', 'input-schema.json'),
      JSON.stringify({
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        required: ['topic'],
        properties: { topic: { type: 'string' } },
      }),
    );
    // resolveAgent caches; re-resolve.
    const def2 = resolveAgent('demo', agentsDir);
    if (!def2) throw new Error('demo should resolve');
    const fake = new FakeAgentAdapter({ output: validSystemOutput() });
    const result = await runAgent(
      fake,
      def2,
      { slug: 'demo', cwd: projectRoot, params: {} },
      undefined,
      agentsDir,
    );
    expect(result.metadata.result).toBe('failed');
    const content = readLedger('demo');
    expect(content).toContain('> ⚠️');
    expect(content).toContain('failed');
  });
});

describe('runAgent auto-append (env + cwd edge cases)', () => {
  it('skips silently when cwd has no docs/ directory and is not writable for it (read-only-ish)', async () => {
    const def = makeAgent('demo');
    const fake = new FakeAgentAdapter({
      output: validSystemOutput({ result: 'ok' }),
    });
    const ro = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-ro-'));
    try {
      fs.chmodSync(ro, 0o555);
      const result = await runAgent(
        fake,
        def,
        { slug: 'demo', cwd: ro },
        undefined,
        agentsDir,
      );
      expect(result.metadata.result).toBe('completed');
    } finally {
      fs.chmodSync(ro, 0o755);
      fs.rmSync(ro, { recursive: true, force: true });
    }
  });

  it('writes successfully when cwd is os.tmpdir()-rooted (sandbox-like)', async () => {
    const def = makeAgent('demo');
    const fake = new FakeAgentAdapter({
      output: validSystemOutput({ result: 'ok' }),
    });
    const result = await runAgent(
      fake,
      def,
      { slug: 'demo', cwd: projectRoot },
      undefined,
      agentsDir,
    );
    expect(result.metadata.result).toBe('completed');
    expect(fs.existsSync(path.join(ledgerDir, 'demo.md'))).toBe(true);
  });

  it('creates the ledger directory if it does not already exist', async () => {
    const def = makeAgent('demo');
    const fake = new FakeAgentAdapter({
      output: validSystemOutput({ result: 'ok' }),
    });
    expect(fs.existsSync(ledgerDir)).toBe(false);
    await runAgent(
      fake,
      def,
      { slug: 'demo', cwd: projectRoot },
      undefined,
      agentsDir,
    );
    expect(fs.existsSync(ledgerDir)).toBe(true);
    expect(fs.existsSync(path.join(ledgerDir, 'demo.md'))).toBe(true);
  });
});

describe('runAgent auto-append (idempotency)', () => {
  it('produces only one entry for one run (no double-write at success terminal)', async () => {
    const def = makeAgent('demo');
    const fake = new FakeAgentAdapter({
      output: validSystemOutput({ result: 'ok' }),
    });
    const result = await runAgent(
      fake,
      def,
      { slug: 'demo', cwd: projectRoot },
      undefined,
      agentsDir,
    );
    const content = readLedger('demo');
    const matches =
      content.match(new RegExp(`runId: ${result.metadata.runId}`, 'g')) ?? [];
    expect(matches).toHaveLength(1);
  });

  it('writes a fresh entry per distinct run', async () => {
    const def = makeAgent('demo');
    const fake1 = new FakeAgentAdapter({
      output: validSystemOutput({ result: 'ok' }),
    });
    const r1 = await runAgent(
      fake1,
      def,
      { slug: 'demo', cwd: projectRoot },
      undefined,
      agentsDir,
    );
    await new Promise((r) => setTimeout(r, 5));
    const fake2 = new FakeAgentAdapter({
      output: validSystemOutput({ result: 'ok' }),
    });
    const r2 = await runAgent(
      fake2,
      def,
      { slug: 'demo', cwd: projectRoot },
      undefined,
      agentsDir,
    );
    const content = readLedger('demo');
    expect(content).toContain(r1.metadata.runId);
    expect(content).toContain(r2.metadata.runId);
  });
});
