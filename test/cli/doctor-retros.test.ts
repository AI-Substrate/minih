/**
 * T012 (Plan 011 HF-D) — `minih doctor` retro audit checks.
 *
 * Verifies that doctor reports unharvested retros and large-ledger warnings
 * via the JSON envelope. Runs the built CLI in a fresh tmp project root.
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
let retrosDir: string;

interface DoctorEnvelope {
  command: string;
  status: 'ok' | 'error' | 'degraded';
  data?: {
    retros?: Array<{ check: string; status: string; message?: string }>;
    summary?: {
      total: number;
      healthy: number;
      warnings: number;
      errors: number;
    };
  };
}

function run(): { stdout: string; stderr: string; status: number } {
  try {
    const stdout = execSync(`node ${cli} doctor`, {
      cwd: tmpProject,
      encoding: 'utf-8',
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

function makeAgent(slug: string) {
  const dir = path.join(agentsDir, slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'prompt.md'),
    `---\ndescription: "doctor retro test"\n---\n\n# ${slug}\n\nDo it.`,
  );
  fs.writeFileSync(
    path.join(dir, 'output-schema.json'),
    JSON.stringify({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {},
    }),
  );
}

function makeRunWithRetro(slug: string, runId: string, magicWand: string) {
  const runDir = path.join(agentsDir, slug, 'runs', runId);
  fs.mkdirSync(path.join(runDir, 'output'), { recursive: true });
  fs.writeFileSync(
    path.join(runDir, 'completed.json'),
    JSON.stringify({
      slug,
      runId,
      result: 'completed',
      completedAt: new Date().toISOString(),
    }),
  );
  fs.writeFileSync(
    path.join(runDir, 'output', 'report.json'),
    JSON.stringify({
      retrospective: { magicWand, magicWandTarget: 'project' },
    }),
  );
}

beforeEach(() => {
  tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-doctor-retro-'));
  agentsDir = path.join(tmpProject, 'agents');
  retrosDir = path.join(tmpProject, 'docs', 'retros');
  fs.mkdirSync(agentsDir, { recursive: true });
});

afterEach(() => {
  if (tmpProject && fs.existsSync(tmpProject)) {
    fs.rmSync(tmpProject, { recursive: true, force: true });
  }
});

describe('minih doctor — retro audit', () => {
  it('reports retros: pass when there are no runs at all', () => {
    makeAgent('demo'); // no runs
    const result = run();
    const env = JSON.parse(result.stdout) as DoctorEnvelope;
    expect(env.data?.retros).toBeTruthy();
    const passes =
      env.data?.retros?.filter(
        (r) => r.check === 'retros' && r.status === 'pass',
      ) ?? [];
    expect(passes).toHaveLength(1);
  });

  it('flags unharvested retros for runs whose runId is not in the ledger', () => {
    makeAgent('demo');
    makeRunWithRetro('demo', '2026-04-29T01-00-00-000Z-aaaa', 'do the thing');
    const result = run();
    const env = JSON.parse(result.stdout) as DoctorEnvelope;
    const unharvested =
      env.data?.retros?.filter((r) => r.check.startsWith('unharvested/')) ?? [];
    expect(unharvested.length).toBeGreaterThanOrEqual(1);
    expect(unharvested[0]?.message).toContain('minih harvest');
  });

  it('does NOT flag runs whose retro is already in the ledger', () => {
    makeAgent('demo');
    const runId = '2026-04-29T01-00-00-000Z-bbbb';
    makeRunWithRetro('demo', runId, 'already harvested');
    fs.mkdirSync(retrosDir, { recursive: true });
    fs.writeFileSync(
      path.join(retrosDir, 'demo.md'),
      `## entry\n\n- runId: ${runId}\n- magicWand: already harvested\n`,
    );
    const result = run();
    const env = JSON.parse(result.stdout) as DoctorEnvelope;
    const unharvested =
      env.data?.retros?.filter((r) => r.check.startsWith('unharvested/')) ?? [];
    expect(unharvested).toHaveLength(0);
  });

  it('warns when a ledger file exceeds the size threshold', () => {
    makeAgent('demo'); // no runs needed
    fs.mkdirSync(retrosDir, { recursive: true });
    // Create a ledger file > 1MB.
    const big = 'x'.repeat(1.1 * 1024 * 1024);
    fs.writeFileSync(path.join(retrosDir, 'demo.md'), big);
    const result = run();
    const env = JSON.parse(result.stdout) as DoctorEnvelope;
    const sizeWarn =
      env.data?.retros?.filter((r) => r.check.startsWith('ledger/')) ?? [];
    expect(sizeWarn.length).toBeGreaterThanOrEqual(1);
    expect(sizeWarn[0]?.message).toContain('rotating');
  });
});
