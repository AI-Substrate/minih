/**
 * T009 (Plan 011 HF-B) — Lightweight assertion-style tests for `minih harvest`.
 *
 * Tests the built CLI via execSync against `dist/cli/index.js`. Covers the
 * envelope shape, idempotency on re-run, MINIH_NO_AUTO_HARVEST opt-out being
 * IGNORED by the explicit verb, batch `--since` filter, and missing-slug
 * error. Real fs in tmp dirs.
 */

import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '..', '..');
const cli = path.join(repoRoot, 'dist', 'cli', 'index.js');

let tmpProject: string;
let agentsDir: string;
let ledgerDir: string;

interface HarvestEnvelope {
  command: string;
  status: 'ok' | 'error' | 'degraded';
  data?: {
    slug: string;
    ledgerDir: string;
    planId: string | null;
    harvested: Array<{ runId: string; kind: string; ledgerPaths: string[] }>;
    skipped: Array<{ runId: string; reason: string }>;
  };
  error?: { code: string; message: string };
}

function run(
  args: string[],
  env: Record<string, string> = {},
): { stdout: string; stderr: string; status: number } {
  try {
    const stdout = execSync(`node ${cli} ${args.join(' ')}`, {
      cwd: tmpProject,
      encoding: 'utf-8',
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { stdout, stderr: '', status: 0 };
  } catch (err) {
    const e = err as {
      stdout?: Buffer | string;
      stderr?: Buffer | string;
      status?: number;
    };
    return {
      stdout:
        typeof e.stdout === 'string' ? e.stdout : (e.stdout?.toString() ?? ''),
      stderr:
        typeof e.stderr === 'string' ? e.stderr : (e.stderr?.toString() ?? ''),
      status: e.status ?? 1,
    };
  }
}

function makeRun(
  slug: string,
  runId: string,
  opts: {
    completedAt?: string;
    result?: 'completed' | 'failed' | 'timeout' | 'degraded';
    retrospective?: object;
    stderrLog?: string;
  } = {},
): string {
  const runDir = path.join(agentsDir, slug, 'runs', runId);
  fs.mkdirSync(path.join(runDir, 'output'), { recursive: true });
  fs.writeFileSync(
    path.join(runDir, 'completed.json'),
    JSON.stringify({
      slug,
      runId,
      completedAt: opts.completedAt ?? new Date().toISOString(),
      result: opts.result ?? 'completed',
    }),
  );
  if (opts.retrospective !== undefined) {
    fs.writeFileSync(
      path.join(runDir, 'output', 'report.json'),
      JSON.stringify({ retrospective: opts.retrospective }),
    );
  }
  if (opts.stderrLog !== undefined) {
    fs.writeFileSync(path.join(runDir, 'stderr.log'), opts.stderrLog);
  }
  return runDir;
}

beforeEach(() => {
  tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-harvest-'));
  agentsDir = path.join(tmpProject, 'agents');
  ledgerDir = path.join(tmpProject, 'docs', 'retros');
  fs.mkdirSync(agentsDir, { recursive: true });
});

afterEach(() => {
  if (tmpProject && fs.existsSync(tmpProject)) {
    fs.rmSync(tmpProject, { recursive: true, force: true });
  }
});

describe('minih harvest', () => {
  it('harvests the latest run with a retrospective', () => {
    makeRun('demo', '2026-04-29T01-00-00-000Z-aaaa', {
      retrospective: {
        magicWand: 'do the thing',
        magicWandTarget: 'project',
      },
    });
    const result = run(['harvest', 'demo']);
    expect(result.status).toBe(0);
    const env = JSON.parse(result.stdout) as HarvestEnvelope;
    expect(env.status).toBe('ok');
    expect(env.data?.harvested).toHaveLength(1);
    expect(env.data?.harvested[0]?.kind).toBe('retro');
    const ledgerFile = path.join(ledgerDir, 'demo.md');
    expect(fs.existsSync(ledgerFile)).toBe(true);
    expect(fs.readFileSync(ledgerFile, 'utf-8')).toContain('do the thing');
  });

  it('is idempotent — re-running does not duplicate the entry', () => {
    makeRun('demo', '2026-04-29T01-00-00-000Z-aaaa', {
      retrospective: { magicWand: 'do the thing', magicWandTarget: 'project' },
    });
    run(['harvest', 'demo']);
    run(['harvest', 'demo']);
    const content = fs.readFileSync(path.join(ledgerDir, 'demo.md'), 'utf-8');
    const matches =
      content.match(/runId: 2026-04-29T01-00-00-000Z-aaaa/g) ?? [];
    expect(matches).toHaveLength(1);
  });

  it('IGNORES MINIH_NO_AUTO_HARVEST=1 — explicit harvest always writes', () => {
    makeRun('demo', '2026-04-29T01-00-00-000Z-aaaa', {
      retrospective: { magicWand: 'do the thing', magicWandTarget: 'project' },
    });
    const result = run(['harvest', 'demo'], { MINIH_NO_AUTO_HARVEST: '1' });
    expect(result.status).toBe(0);
    const env = JSON.parse(result.stdout) as HarvestEnvelope;
    expect(env.data?.harvested).toHaveLength(1);
    expect(fs.existsSync(path.join(ledgerDir, 'demo.md'))).toBe(true);
  });

  it('writes a stub when run terminated without a retrospective', () => {
    makeRun('demo', '2026-04-29T01-00-00-000Z-aaaa', {
      result: 'timeout',
      stderrLog: 'Agent timed out after 300s\n',
    });
    const result = run(['harvest', 'demo']);
    const env = JSON.parse(result.stdout) as HarvestEnvelope;
    expect(env.data?.harvested[0]?.kind).toBe('stub');
    const content = fs.readFileSync(path.join(ledgerDir, 'demo.md'), 'utf-8');
    expect(content).toContain('> ⚠️');
    expect(content).toContain('timeout');
    expect(content).toContain('Agent timed out after 300s');
  });

  it('--since filters by completed.json.completedAt', () => {
    makeRun('demo', 'old-run', {
      completedAt: '2026-04-01T00:00:00.000Z',
      retrospective: { magicWand: 'old', magicWandTarget: 'project' },
    });
    makeRun('demo', 'new-run', {
      completedAt: '2026-04-29T00:00:00.000Z',
      retrospective: { magicWand: 'new', magicWandTarget: 'project' },
    });
    const result = run(['harvest', 'demo', '--since', '2026-04-15']);
    expect(result.status).toBe(0);
    const env = JSON.parse(result.stdout) as HarvestEnvelope;
    expect(env.data?.harvested).toHaveLength(1);
    expect(env.data?.harvested[0]?.runId).toBe('new-run');
  });

  it('returns AGENT_VALIDATION_FAILED for missing slug', () => {
    const result = run(['harvest', 'nonexistent']);
    expect(result.status).not.toBe(0);
    const env = JSON.parse(result.stdout) as HarvestEnvelope;
    expect(env.status).toBe('error');
    expect(env.error?.code).toBe('E124');
  });

  it('returns INVALID_ARGS for malformed --since', () => {
    makeRun('demo', 'r1', {
      retrospective: { magicWand: 'x', magicWandTarget: 'project' },
    });
    const result = run(['harvest', 'demo', '--since', 'not-a-date']);
    expect(result.status).not.toBe(0);
    const env = JSON.parse(result.stdout) as HarvestEnvelope;
    expect(env.error?.code).toBe('E108');
  });

  it('writes per-plan ledger when MINIH_PLAN_ID is set', () => {
    makeRun('demo', 'r1', {
      retrospective: { magicWand: 'x', magicWandTarget: 'project' },
    });
    run(['harvest', 'demo'], { MINIH_PLAN_ID: '011-retro-harvest-loop' });
    expect(fs.existsSync(path.join(ledgerDir, 'demo.md'))).toBe(true);
    expect(
      fs.existsSync(path.join(ledgerDir, '011-retro-harvest-loop.md')),
    ).toBe(true);
  });
});
