/**
 * Plan 028 Phase 5 (5a) — companion longevity through human gaps.
 *
 * The survival half of the #50 follow-up: an opt-in runner-side heartbeat keeps
 * a quietly-waiting survive-gaps companion reading `active` (Phase-1 predicate:
 * pid-alive ∧ updatedAt < 60s) across long human-in-the-loop gaps, WITHOUT
 * touching the event-based stall watchdog or default-run behaviour.
 *
 * T001 (RED) / T002 (GREEN): the heartbeat advances run.json.updatedAt with no
 * provider events; three named regressions guard the load-bearing invariants —
 *   (a) a run WITHOUT survive-gaps starts no heartbeat (updatedAt frozen through
 *       a silent gap → the strict Phase-1 staleness signal is preserved);
 *   (b) the heartbeat NEVER resets the stall deadline (a survive-gaps run with
 *       no events still fires stalled-stream at its stall budget);
 *   (c) the timer is cleared on stop/cleanup (no leaked interval).
 *
 * Sub-second budgets + tiny heartbeat intervals only — never the 20s default.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  AgentEvent,
  AgentResult,
  AgentRunOptions,
  IAgentAdapter,
} from '../../src/adapter/index.js';
import { resolveAgent } from '../../src/runner/folder.js';
import {
  __resetThrottleStateForTest,
  startManifestHeartbeat,
} from '../../src/runner/run-manifest.js';
import { runAgent } from '../../src/runner/runner.js';
import { validSystemOutput } from '../helpers/fixtures.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-longevity-'));
});

afterEach(() => {
  __resetThrottleStateForTest();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function createAgent(slug: string) {
  const agentDir = path.join(tmpDir, slug);
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(
    path.join(agentDir, 'prompt.md'),
    `---\ndescription: "Longevity test agent"\n---\n\n# ${slug}\n\nDo the thing.`,
  );
  const definition = resolveAgent(slug, tmpDir);
  if (!definition) throw new Error(`expected agent ${slug} to resolve`);
  return definition;
}

/** Write a minimal valid run.json directly (avoids the writeManifest type dance). */
function seedManifest(runDir: string, updatedAt: string): void {
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(
    path.join(runDir, 'run.json'),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        slug: 'seed',
        runId: 'seed-run',
        runDir,
        pid: process.pid,
        startedAt: updatedAt,
        updatedAt,
        status: 'active',
        sessionId: null,
        counters: { events: 0, toolCalls: 0, messages: 0, errors: 0 },
      },
      null,
      2,
    )}\n`,
  );
}

function readManifest(runDir: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(runDir, 'run.json'), 'utf-8'));
}

function updatedAtMs(runDir: string): number {
  return new Date(readManifest(runDir).updatedAt as string).getTime();
}

/** Silent, never-settling adapter (the #44 silent-stall shape). */
class SilentAdapter implements IAgentAdapter {
  readonly terminateHistory: string[] = [];
  run(): Promise<AgentResult> {
    return new Promise<never>(() => {});
  }
  async compact(sessionId: string): Promise<AgentResult> {
    return {
      output: '',
      sessionId,
      status: 'completed',
      exitCode: 0,
      tokens: null,
    };
  }
  async terminate(sessionId: string): Promise<AgentResult> {
    this.terminateHistory.push(sessionId);
    return {
      output: '',
      sessionId,
      status: 'killed',
      exitCode: 137,
      tokens: null,
    };
  }
}

/**
 * Emits no events; after a quiet gap it snapshots the live run.json.updatedAt
 * (found by globbing the single fresh run dir), then settles cleanly. Lets the
 * test observe whether updatedAt advanced DURING the gap — the only way to
 * prove the heartbeat is opt-in without a 60s wall-clock wait.
 */
class SilentSnapshotAdapter implements IAgentAdapter {
  capturedUpdatedAt: string | null = null;
  startedAt: string | null = null;
  readonly terminateHistory: string[] = [];

  constructor(
    private readonly runsDir: string,
    private readonly gapMs: number,
  ) {}

  async run(_options: AgentRunOptions): Promise<AgentResult> {
    await delay(this.gapMs);
    const ids = fs.readdirSync(this.runsDir);
    const runDir = path.join(this.runsDir, ids[0]);
    const m = readManifest(runDir);
    this.capturedUpdatedAt = m.updatedAt as string;
    this.startedAt = m.startedAt as string;
    return {
      output: validSystemOutput(),
      sessionId: 'snap-session',
      status: 'completed',
      exitCode: 0,
      tokens: null,
    };
  }
  async compact(sessionId: string): Promise<AgentResult> {
    return {
      output: '',
      sessionId,
      status: 'completed',
      exitCode: 0,
      tokens: null,
    };
  }
  async terminate(sessionId: string): Promise<AgentResult> {
    this.terminateHistory.push(sessionId);
    return {
      output: '',
      sessionId,
      status: 'killed',
      exitCode: 137,
      tokens: null,
    };
  }
}

describe('survive-gaps heartbeat factory (plan 028 T001/T002)', () => {
  it('advances run.json.updatedAt on the timer with no provider events', async () => {
    const runDir = path.join(tmpDir, 'hb-advance');
    const old = new Date(Date.now() - 5 * 60_000).toISOString();
    seedManifest(runDir, old);

    const stop = startManifestHeartbeat(runDir, 15);
    await delay(70); // ~4 ticks
    stop();

    expect(updatedAtMs(runDir)).toBeGreaterThan(new Date(old).getTime());
  });

  it('(c) stop() clears the timer — no further writes after cleanup', async () => {
    const runDir = path.join(tmpDir, 'hb-cleanup');
    seedManifest(runDir, new Date().toISOString());

    const stop = startManifestHeartbeat(runDir, 15);
    await delay(50);
    stop();
    // Let any write scheduled by the last pre-stop tick settle (updateManifest
    // is async + per-runDir serialized), then snapshot the stable value.
    await delay(40);
    const frozen = updatedAtMs(runDir);

    await delay(70); // would tick ~4 more times if the interval leaked
    expect(updatedAtMs(runDir)).toBe(frozen);
  });
});

describe('survive-gaps heartbeat — runner integration (plan 028 T002)', () => {
  it('(a) a default run starts NO heartbeat (updatedAt frozen through a silent gap); survive-gaps advances it', async () => {
    const defDefault = createAgent('sg-default');
    const adDefault = new SilentSnapshotAdapter(
      path.join(tmpDir, 'sg-default', 'runs'),
      120,
    );
    await runAgent(
      adDefault,
      defDefault,
      { slug: 'sg-default', stallTimeout: 5, timeout: 10 },
      undefined,
      tmpDir,
    );
    // No survive-gaps → no heartbeat. updatedAt may take one early startup
    // write, but it STOPS advancing well before the 120ms quiet gap ends.
    const defaultDelta =
      new Date(adDefault.capturedUpdatedAt as string).getTime() -
      new Date(adDefault.startedAt as string).getTime();
    expect(defaultDelta).toBeLessThan(60);

    const defOn = createAgent('sg-on');
    const adOn = new SilentSnapshotAdapter(
      path.join(tmpDir, 'sg-on', 'runs'),
      120,
    );
    await runAgent(
      adOn,
      defOn,
      {
        slug: 'sg-on',
        surviveGaps: true,
        heartbeatIntervalMs: 15,
        stallTimeout: 5,
        timeout: 10,
      },
      undefined,
      tmpDir,
    );
    // Survive-gaps → heartbeat kept advancing updatedAt deep into the same
    // 120ms quiet gap (past the 60s/3 boundary the default run froze before).
    const onDelta =
      new Date(adOn.capturedUpdatedAt as string).getTime() -
      new Date(adOn.startedAt as string).getTime();
    expect(onDelta).toBeGreaterThan(60);
  });

  it('(b) a survive-gaps run still fires stalled-stream — the heartbeat never resets the watchdog', async () => {
    const def = createAgent('sg-stall');
    const adapter = new SilentAdapter();

    const result = await runAgent(
      adapter,
      def,
      {
        slug: 'sg-stall',
        surviveGaps: true,
        heartbeatIntervalMs: 15, // ticks ~13x inside the 0.2s stall budget
        stallTimeout: 0.2,
        timeout: 10,
      },
      undefined,
      tmpDir,
    );

    expect(result.metadata.result).toBe('failed');
    expect(readManifest(result.runDir).terminalReason).toBe('stalled-stream');
    expect(adapter.terminateHistory.length).toBeGreaterThan(0);
  });
});
