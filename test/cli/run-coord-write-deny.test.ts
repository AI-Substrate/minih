/**
 * FX008-6: Regression test for the coordination-write precondition
 *           through the full CLI integration boundary.
 *
 * Scope: case (a) from the FX008 dossier task table. Cases (b)-(e)
 * (flag banner, coord-disabled bypass, write-allow path, env-var
 * kill-switch) are covered by the helper unit tests in
 * `test/runner/permissions/coord-write-precondition.test.ts` —
 * those cases verify behaviour that doesn't traverse the SDK boot
 * path. This test owns the SDK-boundary signal expectations: that
 * `minih run` against a coord-enabled write-deny agent produces the
 * full 5-signal denial across the CLI envelope, run.json, and
 * events.ndjson.
 *
 * Coverage map:
 *   (a) coord-enabled + read-only (write-deny) + no flag
 *       → CLI exit 1, error envelope code E205,
 *       run.json terminalReason: 'permission-denied' +
 *       permissionError.kind: 'coord-write-deny',
 *       events.ndjson contains permission_denied event,
 *       AgentRunResult.metadata.exitCode: 126.
 *
 * Mechanism: spawn the built CLI against a synthesised throwaway
 * agent dir with `coordination: enabled` + `permissions.preset:
 * read-only`. The precondition fires BEFORE any SDK boot — no
 * GH_TOKEN required, no real Copilot session.
 *
 * Source: github.com/AI-Substrate/minih issue #25 (Chainglass repro
 * `runs/2026-05-04T16-16-02-885Z-9355`); commenter id 4368841854.
 *
 * F004 (HIGH companion finding 2026-05-04) regression: when the
 * runner's signal-write paths fail, denialState.signalFailures
 * MUST record them rather than silent-swallowing. This test passes
 * a healthy filesystem so failures don't appear, but the structural
 * presence of `coordinationSignals` in run.json on signal-write
 * failure is documented in the helper unit tests.
 */

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const repoRoot = path.resolve('.');
const cliPath = path.join(repoRoot, 'dist/cli/index.js');

function run(
  args: string[],
  opts: { cwd?: string; env?: Record<string, string | undefined> } = {},
): { stdout: string; stderr: string; exitCode: number } {
  const { FORCE_COLOR: _fc, ...cleanEnv } = process.env;
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries({
    ...cleanEnv,
    NO_COLOR: '1',
    ...(opts.env ?? {}),
  })) {
    if (typeof v === 'string') env[k] = v;
  }
  const result = spawnSync('node', [cliPath, ...args], {
    cwd: opts.cwd ?? repoRoot,
    env,
    encoding: 'utf-8',
  });
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    exitCode: result.status ?? 1,
  };
}

let tmpDir: string;

function writeAgent(slug: string, frontmatter: string): string {
  const dir = path.join(tmpDir, 'agents', slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'prompt.md'),
    `---\n${frontmatter}\n---\n\n# ${slug}\n`,
  );
  return dir;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fx008-coord-write-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('FX008 — coord write-deny precondition (CLI regression)', () => {
  it('case (a): coord-enabled + read-only + no flag → E205 envelope + 5-signal coverage', () => {
    writeAgent(
      'coord-deny',
      [
        'description: "FX008-6 case (a) — boot precondition fires"',
        'coordination: enabled',
        'permissions:',
        '  preset: read-only',
        '  overrides:',
        '    shell: allow',
        '    network: allow',
      ].join('\n'),
    );

    // GH_TOKEN passed as fake — the precondition fires BEFORE any SDK
    // boot, so the test should work without a real Copilot session.
    const result = run(['run', 'coord-deny'], {
      cwd: tmpDir,
      env: { GH_TOKEN: 'fake-token-not-needed' },
    });

    // === CLI envelope shape ===
    expect(result.exitCode).toBe(1);
    const env = JSON.parse(result.stdout);
    expect(env.status).toBe('error');
    expect(env.error.code).toBe('E205');
    expect(env.error.message).toContain('E205 COORDINATION_WRITE_DENIED');
    expect(env.error.message).toContain("Coordinated agent 'coord-deny'");
    expect(env.error.message).toContain("'read-only'");
    expect(env.error.message).toContain('Resolved from: frontmatter');

    // All three remediation paths in the message body.
    expect(env.error.message).toContain('write: allow');
    expect(env.error.message).toContain('--allow-coord-write-deny');
    expect(env.error.message).toContain('trusted');

    // Cite both the workshop + companion-mode docs for traceability.
    expect(env.error.message).toContain('workshop 002 § Q1');
    expect(env.error.message).toContain('companion-mode.md');

    // === Run dir was created with full 5-signal coverage ===
    const runDir = env.error.details.runDir;
    expect(runDir).toBeTruthy();
    expect(fs.existsSync(runDir)).toBe(true);

    // Signal 1 — events.ndjson with synthesised permission_denied event
    // (the SDK adapter never starts so the runner writes this itself;
    // F004 regression: a write failure here is recorded in
    // denialState.signalFailures rather than swallowed).
    const eventsPath = path.join(runDir, 'events.ndjson');
    expect(fs.existsSync(eventsPath)).toBe(true);
    const lines = fs.readFileSync(eventsPath, 'utf-8').trim().split('\n');
    const events = lines.map((l) => JSON.parse(l));
    const denialEvent = events.find((e) => e.type === 'permission_denied');
    expect(denialEvent).toBeDefined();
    expect(denialEvent.data.kind).toBe('coord-write-deny');
    expect(denialEvent.data.decision).toBe('deny');
    expect(denialEvent.data.message).toContain(
      'E205 COORDINATION_WRITE_DENIED',
    );

    // Signal 2 — run.json terminalReason + permissionError snapshot.
    // F002 regression: terminalReason stays 'permission-denied' (closed
    // LiveRunManifest union); kind is on permissionError.kind.
    const runJson = JSON.parse(
      fs.readFileSync(path.join(runDir, 'run.json'), 'utf-8'),
    );
    expect(runJson.status).toBe('failed');
    expect(runJson.terminalReason).toBe('permission-denied');
    expect(runJson.permissionError).toBeDefined();
    expect(runJson.permissionError.kind).toBe('coord-write-deny');
    expect(runJson.permissionError.decision).toBe('deny');
    expect(runJson.permissionError.message).toContain('E205');
    expect(runJson.permissionError.policyDigest.presetName).toBe('read-only');

    // Permissions snapshot includes the new presetSource field.
    expect(runJson.permissions.preset).toBe('read-only');
    expect(runJson.permissions.presetSource).toBe('frontmatter');
    expect(runJson.permissions.decisions.write).toBe('deny');

    // Signal 3 — inside-state. Coordinated agents only; this fixture
    // is `coordination: enabled` so the runner writes the state file.
    // F004 (MEDIUM companion finding 2026-05-04): the original landing
    // commit only asserted signals 1, 2, 5 — leaving signals 3 and 4
    // (the coordinated surfaces FX008 is meant to protect) unverified.
    const insideStatePath = path.join(runDir, 'state', 'inside.json');
    expect(fs.existsSync(insideStatePath)).toBe(true);
    const insideState = JSON.parse(fs.readFileSync(insideStatePath, 'utf-8'));
    expect(insideState.status).toBe('error');
    expect(insideState.data.permissionError).toBeDefined();
    expect(insideState.data.permissionError.kind).toBe('coord-write-deny');
    expect(insideState.data.permissionError.message).toContain('E205');

    // Signal 4 — inside-inbox `permission-error` typed message (the
    // outside lane's view of what the inside is reporting).
    // `fireTerminalDenial` writes here so observers polling the inbox
    // (humans via `minih outside inbox list`, orchestrators) see the
    // denial without grepping events.ndjson.
    const insideInboxPath = path.join(
      runDir,
      'inbox',
      'inside',
      'messages.ndjson',
    );
    expect(fs.existsSync(insideInboxPath)).toBe(true);
    const inboundLines = fs
      .readFileSync(insideInboxPath, 'utf-8')
      .trim()
      .split('\n')
      .filter((l) => l.length > 0);
    const permError = inboundLines
      .map((l) => JSON.parse(l))
      .find((m) => m.type === 'permission-error');
    expect(permError).toBeDefined();
    expect(permError.subject).toContain('coord-write-deny');
    expect(permError.body).toContain('E205');
    expect(permError.meta.payload.kind).toBe('coord-write-deny');

    // Signal 5 — exit code 126 (POSIX permission-denied) on the metadata.
    expect(env.error.details.metadata.exitCode).toBe(126);
    expect(env.error.details.metadata.result).toBe('failed');
    expect(env.error.details.metadata.permissionError).toBeDefined();
    expect(env.error.details.metadata.permissionError.kind).toBe(
      'coord-write-deny',
    );
  }, 15_000);

  it('AC-FX8.6 — coord-disabled + read-only + no flag → precondition does NOT fire', () => {
    // Coordination omitted from frontmatter = disabled. The precondition
    // is coord-only, so the run should NOT be refused with E205.
    writeAgent(
      'no-coord',
      [
        'description: "FX008-6 AC-FX8.6 regression"',
        '# coordination: enabled deliberately omitted',
        'permissions:',
        '  preset: read-only',
        '  overrides:',
        '    shell: allow',
        '    network: allow',
      ].join('\n'),
    );

    // F003 HIGH (companion finding 2026-05-04): explicitly scrub GH_TOKEN
    // so the run cannot boot a real SDK session — otherwise this case
    // becomes non-deterministic depending on whether the parent shell
    // exports GH_TOKEN. With GH_TOKEN absent, the SDK boot fails fast
    // with E122 (missing token), proving the precondition didn't fire.
    const result = run(['run', 'no-coord'], {
      cwd: tmpDir,
      env: { GH_TOKEN: undefined },
    });

    if (result.exitCode !== 0) {
      const env = JSON.parse(result.stdout);
      // Must NOT be E205. Likely E122 (missing GH_TOKEN) — that's the
      // expected sentinel proving the run progressed past the FX008
      // precondition into normal SDK boot.
      expect(env.error?.code).not.toBe('E205');
    }
  });
});
