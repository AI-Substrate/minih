import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * Plan 028 Phase 3 (defect #50 F) — T001. `minih companion findings <slug>`
 * surfaces a companion's structured findings AND summary over the SAME
 * lane-agnostic `deriveCompanionLedger` deriver `companion status` uses, so an
 * operator reads findings with one documented command regardless of which inbox
 * lane carried them. Integration test runs against the built `dist/` (PIC-F).
 *
 * Mirrors test/cli/companion-status.test.ts. NOTE the finding seed is a
 * *parseable* HIGH (labelled body — the real companion shape, F004), NOT the
 * bare `body:'b'` the status test uses: `toFinding` (companion-ledger.ts:221)
 * drops a finding when severity/file/category/recommendation are all absent, so
 * a bare clone would assert `findings` vacuously (findingsCount:1, findings:[]).
 */

const cliPath = path.resolve('dist/cli/index.js');

let tmpDir: string;
let agentsDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'minih-companion-findings-cli-'),
  );
  agentsDir = path.join(tmpDir, 'agents');
  fs.mkdirSync(agentsDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function run(args: string[]): {
  exitCode: number;
  stdout: string;
  stderr: string;
} {
  try {
    const stdout = execFileSync('node', [cliPath, ...args], {
      env: { ...process.env, FORCE_COLOR: undefined, NO_COLOR: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { exitCode: 0, stdout: stdout.toString('utf8'), stderr: '' };
  } catch (err) {
    const e = err as { stdout?: Buffer; stderr?: Buffer; status?: number };
    return {
      exitCode: e.status ?? 1,
      stdout: e.stdout?.toString('utf8') ?? '',
      stderr: e.stderr?.toString('utf8') ?? '',
    };
  }
}

function append(file: string, obj: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(obj)}\n`);
}

/**
 * Seed a run whose INSIDE lane carries a PARSEABLE HIGH finding (labelled body)
 * plus a completion `summary`; the OUTSIDE lane carries the reviewed task. The
 * HIGH finding lives in the inside lane on purpose — the bug (#50 F) is that the
 * documented operator read-path pointed at the OTHER (outside) lane.
 */
function seedRun(slug: string, runId: string): void {
  const runDir = path.join(agentsDir, slug, 'runs', runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(
    path.join(runDir, 'prompt.md'),
    '---\ndescription: "companion"\ncoordination: enabled\n---\nbody\n',
  );
  const outside = path.join(runDir, 'inbox', 'outside', 'messages.ndjson');
  const inside = path.join(runDir, 'inbox', 'inside', 'messages.ndjson');
  append(outside, {
    id: 'm1',
    sender: 'outside',
    type: 'task',
    subject: 'review-request: T002 abc123',
    body: 'Diff: git show abc123',
    ts: '2026-06-15T10:00:00.000Z',
  });
  // Inside-lane HIGH finding, labelled body → toFinding parses it (NOT dropped).
  append(inside, {
    id: 'f1',
    sender: 'inside',
    type: 'finding',
    subject: 'review-finding',
    body: 'severity: HIGH\nfile: src/cli/commands/companion.ts\ncategory: bug\nissue: missing null guard on runId\nrecommendation: guard the runId before deref',
    ts: '2026-06-15T10:02:00.000Z',
  });
  // Completion summary acking the task — marks the review done; lifts summariesCount.
  append(inside, {
    id: 's1',
    sender: 'inside',
    type: 'summary',
    subject: 'review-complete',
    body: 'Reviewed T002; one HIGH finding raised on the new subcommand.',
    ts: '2026-06-15T10:03:00.000Z',
    ackOf: 'm1',
  });
}

describe('minih companion findings', () => {
  it('surfaces an inside-lane HIGH finding AND the summary via the documented path', () => {
    const slug = 'code-review-companion';
    const runId = '2026-06-15T10-00-00-000Z-aa';
    seedRun(slug, runId);

    const res = run([
      'companion',
      'findings',
      slug,
      '--run',
      runId,
      '--agents-dir',
      agentsDir,
      '--json',
    ]);

    expect(res.exitCode).toBe(0);
    const env = JSON.parse(res.stdout.trim());
    expect(env.command).toBe('companion.findings');
    expect(env.status).toBe('ok');
    expect(typeof env.timestamp).toBe('string');
    expect(env.data.slug).toBe(slug);
    expect(env.data.runId).toBe(runId);

    // AC-F: a HIGH finding is visible regardless of lane (written to the INSIDE
    // lane here — the exact case the old outside-lane jq instruction missed).
    expect(Array.isArray(env.data.findings)).toBe(true);
    expect(env.data.findings).toHaveLength(1);
    expect(env.data.findings[0].severity).toBe('HIGH');
    expect(env.data.findings[0].file).toBe('src/cli/commands/companion.ts');

    // AC-F: the summary surface — the count metric AND the summary content, with
    // no new ledger API (summariesCount + buildDraftFarewell, mirroring status).
    expect(env.data.summariesCount).toBeGreaterThanOrEqual(1);
    expect(env.data.draftFarewell).not.toBeNull();
    expect(typeof env.data.draftFarewell.summary).toBe('string');
    expect(env.data.draftFarewell.summary.length).toBeGreaterThan(0);
  });

  it('defaults to the most recent run when --run is omitted', () => {
    const slug = 'code-review-companion';
    seedRun(slug, '2026-06-15T09-00-00-000Z-aa');
    seedRun(slug, '2026-06-15T11-00-00-000Z-bb'); // newer

    const res = run([
      'companion',
      'findings',
      slug,
      '--agents-dir',
      agentsDir,
      '--json',
    ]);

    expect(res.exitCode).toBe(0);
    const env = JSON.parse(res.stdout.trim());
    expect(env.data.runId).toBe('2026-06-15T11-00-00-000Z-bb');
  });

  it('errors RUN_NOT_FOUND (E171) for an unknown run', () => {
    const res = run([
      'companion',
      'findings',
      'nope',
      '--run',
      'missing',
      '--agents-dir',
      agentsDir,
      '--json',
    ]);

    expect(res.exitCode).toBe(1);
    const env = JSON.parse(res.stdout.trim());
    expect(env.status).toBe('error');
    expect(env.error.code).toBe('E171');
  });

  it('errors INBOX_CORRUPT (E148) when an inbox lane has a torn line', () => {
    const slug = 'code-review-companion';
    const runId = '2026-06-15T12-00-00-000Z-cc';
    const runDir = path.join(agentsDir, slug, 'runs', runId);
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(
      path.join(runDir, 'prompt.md'),
      '---\ndescription: "companion"\ncoordination: enabled\n---\nbody\n',
    );
    // Torn inside-lane line — not valid JSON → CompanionLedgerError → INBOX_CORRUPT.
    const inside = path.join(runDir, 'inbox', 'inside', 'messages.ndjson');
    fs.mkdirSync(path.dirname(inside), { recursive: true });
    fs.writeFileSync(inside, '{not valid json\n');

    const res = run([
      'companion',
      'findings',
      slug,
      '--run',
      runId,
      '--agents-dir',
      agentsDir,
      '--json',
    ]);

    expect(res.exitCode).toBe(1);
    const env = JSON.parse(res.stdout.trim());
    expect(env.status).toBe('error');
    expect(env.error.code).toBe('E148');
  });
});
