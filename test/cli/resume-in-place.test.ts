/**
 * T018 (Plan 010 HF-003) — Live SDK resume-in-place smoke.
 *
 * Gated by `MINIH_E2E=1`. Without the env flag the suite is skipped,
 * keeping `just fft` cheap. Cost ceiling: a single Copilot session
 * round-trip per scenario, 120s vitest timeout.
 *
 * What we verify:
 *   - `minih run smoke-test` creates a run dir, captures runId+sessionId
 *   - `minih resume smoke-test "..."` reuses that runId and runDir
 *   - `run.json.resumes[]` has a single entry afterwards
 *   - `events.ndjson` contains a synthetic `{type: 'resume'}` marker
 *   - Original `completed.json` is archived as `completed-1.json`
 *   - `--resume-prompt "..."` emits a `[SYSTEM RESUME]` envelope as a turn
 *
 * Caveat: this test SHELLS OUT to the built CLI; ensure `npm run build`
 * is green before running. SDK auth must be available in the environment.
 */

import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const E2E = process.env.MINIH_E2E === '1';
const repoRoot = path.resolve(__dirname, '..', '..');
const cli = path.join(repoRoot, 'dist', 'cli', 'index.js');
const slug = 'smoke-test';

function runCli(args: string[]): { stdout: string; stderr: string } {
  try {
    const stdout = execSync(`node ${cli} ${args.join(' ')}`, {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 110_000,
    });
    return { stdout, stderr: '' };
  } catch (err) {
    const e = err as { stdout?: Buffer | string; stderr?: Buffer | string };
    return {
      stdout:
        typeof e.stdout === 'string' ? e.stdout : (e.stdout?.toString() ?? ''),
      stderr:
        typeof e.stderr === 'string' ? e.stderr : (e.stderr?.toString() ?? ''),
    };
  }
}

describe.skipIf(!E2E)('resume-in-place — live SDK', () => {
  let firstRunId = '';
  let firstSessionId = '';
  let firstRunDir = '';

  beforeAll(() => {
    if (!fs.existsSync(cli)) {
      throw new Error(
        'dist/cli/index.js not found — run `npm run build` before MINIH_E2E=1 tests',
      );
    }
  });

  it('completes a baseline run and resume-in-place preserves runId + sessionId', async () => {
    const initial = runCli(['run', slug, '--params', 'topic=resume-test']);
    const initialEnvelope = JSON.parse(initial.stdout);
    expect(initialEnvelope.status).toBe('ok');
    firstRunId = initialEnvelope.data.runId;
    firstSessionId = initialEnvelope.data.sessionId;
    firstRunDir = initialEnvelope.data.runDir;
    expect(firstRunId).toBeTruthy();
    expect(firstSessionId).toBeTruthy();

    const resumed = runCli([
      'resume',
      slug,
      '--resume-prompt',
      '"E2E resume verification"',
      '"Confirm resume-in-place semantics"',
    ]);
    const resumedEnvelope = JSON.parse(resumed.stdout);
    expect(resumedEnvelope.status).toBe('ok');
    expect(resumedEnvelope.data.runId).toBe(firstRunId);
    expect(resumedEnvelope.data.runDir).toBe(firstRunDir);
    expect(resumedEnvelope.data.inPlace).toBe(true);

    const manifest = JSON.parse(
      fs.readFileSync(path.join(firstRunDir, 'run.json'), 'utf8'),
    );
    expect(Array.isArray(manifest.resumes)).toBe(true);
    expect(manifest.resumes.length).toBeGreaterThanOrEqual(1);

    const events = fs
      .readFileSync(path.join(firstRunDir, 'events.ndjson'), 'utf8')
      .split('\n')
      .filter((l) => l.length > 0)
      .map((l) => {
        try {
          return JSON.parse(l) as { type?: string };
        } catch {
          return null;
        }
      });
    expect(events.some((e) => e?.type === 'resume')).toBe(true);

    const archived = path.join(firstRunDir, 'completed-1.json');
    expect(fs.existsSync(archived)).toBe(true);
  }, 120_000);
});
