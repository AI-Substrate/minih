import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeManifest } from '../../src/runner/human-view-fixtures.js';
import {
  __resetThrottleStateForTest,
  ManifestSchemaVersionError,
  readManifest,
  updateManifest,
  writeManifest,
} from '../../src/runner/run-manifest.js';

let runDir: string;

beforeEach(() => {
  runDir = mkdtempSync(path.join(tmpdir(), 'minih-run-manifest-test-'));
});

afterEach(() => {
  __resetThrottleStateForTest();
  rmSync(runDir, { recursive: true, force: true });
  vi.useRealTimers();
});

describe('writeManifest / readManifest', () => {
  it('round-trips an initial manifest with schemaVersion: 1', async () => {
    const manifest = makeManifest({ runDir, status: 'starting' });
    await writeManifest(runDir, manifest);
    const read = await readManifest(runDir);
    expect(read).not.toBeNull();
    expect(read?.schemaVersion).toBe(1);
    expect(read?.status).toBe('starting');
    expect(read?.runDir).toBe(runDir);
  });

  it('returns null when run.json is missing', async () => {
    const read = await readManifest(runDir);
    expect(read).toBeNull();
  });

  it('returns null on torn / malformed JSON', async () => {
    writeFileSync(path.join(runDir, 'run.json'), '{not-json');
    const read = await readManifest(runDir);
    expect(read).toBeNull();
  });

  it('throws ManifestSchemaVersionError on unsupported schemaVersion', async () => {
    writeFileSync(
      path.join(runDir, 'run.json'),
      JSON.stringify({ schemaVersion: 99, slug: 'x', runId: 'x' }),
    );
    await expect(readManifest(runDir)).rejects.toBeInstanceOf(
      ManifestSchemaVersionError,
    );
  });

  it('uses atomic write (no torn read for a partial concurrent reader)', async () => {
    const m1 = makeManifest({ runDir, status: 'starting' });
    await writeManifest(runDir, m1);
    // overwrite many times in rapid succession
    for (let i = 0; i < 25; i++) {
      const m = makeManifest({
        runDir,
        status: 'active',
        counters: { events: i, toolCalls: 0, messages: 0, errors: 0 },
      });
      await writeManifest(runDir, m);
      const read = await readManifest(runDir);
      expect(read).not.toBeNull();
      expect(read?.status).toBe('active');
    }
  });
});

describe('updateManifest progression', () => {
  it('progresses status starting → active → completing → completed', async () => {
    const m0 = makeManifest({ runDir, status: 'starting' });
    await writeManifest(runDir, m0);

    await updateManifest(runDir, { status: 'active', sessionId: 'sess-1' });
    let read = await readManifest(runDir);
    expect(read?.status).toBe('active');
    expect(read?.sessionId).toBe('sess-1');

    await updateManifest(runDir, { status: 'completing' });
    read = await readManifest(runDir);
    expect(read?.status).toBe('completing');

    await updateManifest(runDir, { status: 'completed' });
    read = await readManifest(runDir);
    expect(read?.status).toBe('completed');
  });

  it('crash-survival: a stranded active manifest remains readable (does not corrupt completed.json)', async () => {
    const m = makeManifest({ runDir, status: 'active', sessionId: 'sess-x' });
    await writeManifest(runDir, m);
    // simulate process exit by NOT calling completed.json write — only the
    // manifest exists. The next reader must still find a valid manifest.
    const read = await readManifest(runDir);
    expect(read?.status).toBe('active');
    expect(read?.sessionId).toBe('sess-x');
  });
});

describe('updateManifest throttling', () => {
  it('coalesces counter-only patches inside the throttle window (no dup writes)', async () => {
    vi.useFakeTimers();
    const m0 = makeManifest({ runDir, status: 'active' });
    await writeManifest(runDir, m0);

    const before = readFileSync(path.join(runDir, 'run.json'), 'utf8');

    // Three rapid counter patches inside the throttle window.
    await updateManifest(
      runDir,
      { counters: { events: 1, toolCalls: 0, messages: 0, errors: 0 } },
      { throttleMs: 250 },
    );
    await updateManifest(
      runDir,
      { counters: { events: 2, toolCalls: 0, messages: 0, errors: 0 } },
      { throttleMs: 250 },
    );
    await updateManifest(
      runDir,
      { counters: { events: 3, toolCalls: 0, messages: 0, errors: 0 } },
      { throttleMs: 250 },
    );

    const afterThrottle = readFileSync(path.join(runDir, 'run.json'), 'utf8');
    // counters only update on flush — so disk content remains the pre-throttle snapshot
    expect(afterThrottle).toBe(before);

    // A subsequent immediate-priority patch (status) flushes the pending counters
    // and applies the status change — disk must now reflect coalesced events: 3.
    await updateManifest(runDir, { status: 'completing' });
    const flushed = await readManifest(runDir);
    expect(flushed?.counters.events).toBe(3);
    expect(flushed?.status).toBe('completing');
  });

  it('status patches bypass throttle and write immediately', async () => {
    vi.useFakeTimers();
    const m0 = makeManifest({ runDir, status: 'starting' });
    await writeManifest(runDir, m0);

    // Counter patch enters throttle.
    await updateManifest(
      runDir,
      { counters: { events: 1, toolCalls: 0, messages: 0, errors: 0 } },
      { throttleMs: 250 },
    );

    // Status patch must write immediately, not wait for throttle window.
    await updateManifest(runDir, { status: 'active' });
    const read = await readManifest(runDir);
    expect(read?.status).toBe('active');
  });

  it('sessionId patches bypass throttle and write immediately', async () => {
    vi.useFakeTimers();
    const m0 = makeManifest({ runDir, status: 'active', sessionId: null });
    await writeManifest(runDir, m0);

    await updateManifest(
      runDir,
      { counters: { events: 1, toolCalls: 0, messages: 0, errors: 0 } },
      { throttleMs: 250 },
    );

    await updateManifest(runDir, { sessionId: 'sess-immediate' });
    const read = await readManifest(runDir);
    expect(read?.sessionId).toBe('sess-immediate');
  });

  it('serializes overlapping immediate patches without dropping fields', async () => {
    const m0 = makeManifest({ runDir, status: 'active', sessionId: null });
    await writeManifest(runDir, m0);

    await Promise.all([
      updateManifest(runDir, { sessionId: 'sess-overlap' }),
      updateManifest(runDir, { status: 'completing' }),
      updateManifest(runDir, {
        control: {
          available: true,
          kind: 'file-command-lane',
          commandLanePath: 'commands.ndjson',
        },
      }),
    ]);

    const read = await readManifest(runDir);
    expect(read?.sessionId).toBe('sess-overlap');
    expect(read?.status).toBe('completing');
    expect(read?.control.available).toBe(true);
    expect(read?.control.kind).toBe('file-command-lane');
    expect(read?.control.commandLanePath).toBe('commands.ndjson');
  });
});
