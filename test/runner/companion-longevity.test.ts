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
import { resolveEffectiveBudgets } from '../../src/cli/budget-flags.js';
import { resolveAgent } from '../../src/runner/folder.js';
import {
  evaluateIdlePolicy,
  isCleanTerminalReason,
} from '../../src/runner/index.js';
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
    await delay(300); // many ticks even on a slow/loaded CI runner
    stop();
    await delay(120); // let the last fire-and-forget async write settle

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
    // Generous quiet gap so slow/loaded CI timing can't blur the default-vs-
    // heartbeat distinction (the assertions key on halves of this window).
    const GAP_MS = 600;
    const defDefault = createAgent('sg-default');
    const adDefault = new SilentSnapshotAdapter(
      path.join(tmpDir, 'sg-default', 'runs'),
      GAP_MS,
    );
    await runAgent(
      adDefault,
      defDefault,
      { slug: 'sg-default', stallTimeout: 5, timeout: 10 },
      undefined,
      tmpDir,
    );
    // No survive-gaps → no heartbeat. updatedAt may take early startup writes,
    // but it STOPS advancing within the first half of the quiet gap.
    const defaultDelta =
      new Date(adDefault.capturedUpdatedAt as string).getTime() -
      new Date(adDefault.startedAt as string).getTime();
    expect(defaultDelta).toBeLessThan(GAP_MS / 2);

    const defOn = createAgent('sg-on');
    const adOn = new SilentSnapshotAdapter(
      path.join(tmpDir, 'sg-on', 'runs'),
      GAP_MS,
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
    // Survive-gaps → heartbeat kept advancing updatedAt well into the last 40%
    // of the same quiet gap, long after the default run froze.
    const onDelta =
      new Date(adOn.capturedUpdatedAt as string).getTime() -
      new Date(adOn.startedAt as string).getTime();
    expect(onDelta).toBeGreaterThan(GAP_MS * 0.6);
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

describe('stallTimeout frontmatter → config leg (plan 028 T003/T004)', () => {
  it('parseFrontmatter/resolveAgent reads stallTimeout + surviveGaps', () => {
    const slug = 'sg-frontmatter';
    const dir = path.join(tmpDir, slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'prompt.md'),
      `---\ndescription: "sg agent"\ntimeout: 7200\nstallTimeout: 0\nsurviveGaps: true\n---\n\n# ${slug}\n\nbody`,
    );
    const def = resolveAgent(slug, tmpDir);
    if (!def) throw new Error('expected agent to resolve');
    expect(def.stallTimeout).toBe(0);
    expect(def.surviveGaps).toBe(true);
    expect(def.timeout).toBe(7200);
  });

  it('resolveEffectiveBudgets uses the definition stallTimeout when no flag — and the flag still wins', () => {
    // frontmatter value reaches budgets.stallTimeoutSec (no flag):
    expect(resolveEffectiveBudgets('run', {}, 7200, 0).stallTimeout).toBe(0);
    // an explicit --stall-timeout flag overrides the frontmatter value:
    expect(
      resolveEffectiveBudgets('run', { stallTimeout: '5' }, 7200, 0)
        .stallTimeout,
    ).toBe(5);
    // no flag, no definition value → the shared default:
    expect(resolveEffectiveBudgets('run', {}, 7200).stallTimeout).toBe(300);
  });

  it('the real code-review-companion frontmatter carries the survive-gaps profile', () => {
    const def = resolveAgent('code-review-companion', path.resolve('agents'));
    if (!def) throw new Error('expected code-review-companion to resolve');
    expect(def.surviveGaps).toBe(true);
    expect(def.stallTimeout).toBe(0); // watchdog disabled — wall-clock backstops
  });

  it('a survive-gaps profile (stallTimeout 0) does NOT fire stalled-stream on a long silent pause — wall-clock backstops', async () => {
    const def = createAgent('sg-profile');
    const adapter = new SilentAdapter();
    const result = await runAgent(
      adapter,
      def,
      {
        slug: 'sg-profile',
        surviveGaps: true,
        heartbeatIntervalMs: 15,
        stallTimeout: 0, // the profile disables the watchdog
        timeout: 0.3, // wall-clock is the only backstop
      },
      undefined,
      tmpDir,
    );
    expect(result.metadata.result).toBe('timeout');
    expect(readManifest(result.runDir).terminalReason).toBe('timeout');
  });
});

/**
 * Plan 028 Phase 5b (workshop 003, Option C) — the typed survive-gaps posture on
 * `evaluateIdlePolicy`. When `surviveGaps === true` the companion is EXPECTING
 * work across a long human gap, so an idle stretch alone must not stand it down:
 * branch (b) (`effectiveIdleMs >= idleBudgetMs`) is suppressed and ONLY the
 * wall-clock backstop (a) terminates it. The never-spoke arm
 * (`idleElapsedMs === null` — the actual #50 incident) is a FIXED requirement,
 * not a tunable. `surviveGaps` falsy/unset is byte-for-byte the plan-027 #35
 * behaviour. `evaluateIdlePolicy` stays UNWIRED — #49 wires the trigger.
 */
describe('evaluateIdlePolicy survive-gaps posture (plan 028 5b — T005/T006)', () => {
  // effectiveIdleMs(=runElapsedMs for never-spoke) is 1500: past the 1000ms
  // budget (branch b would fire) but under the 2000ms wall-clock backstop.
  const underBackstopOverBudget = {
    idleBudgetMs: 1000,
    runElapsedMs: 1500,
    timeoutSec: 2,
  };
  const atBackstop = { idleBudgetMs: 1000, runElapsedMs: 2000, timeoutSec: 2 };

  it('never-spoke + surviveGaps: continues past the idle budget (the #50 incident)', () => {
    const neverSpoke = { idleElapsedMs: null, unresolvedPeerRequests: 0 };
    const d = evaluateIdlePolicy(neverSpoke, {
      ...underBackstopOverBudget,
      surviveGaps: true,
    });
    expect(d.standDown).toBe(false);
    expect(d.exitReason).toBeNull();
  });

  it('never-spoke + surviveGaps: still stands down at the wall-clock backstop (no_engagement)', () => {
    const neverSpoke = { idleElapsedMs: null, unresolvedPeerRequests: 0 };
    const d = evaluateIdlePolicy(neverSpoke, {
      ...atBackstop,
      surviveGaps: true,
    });
    expect(d.standDown).toBe(true);
    expect(d.exitReason).toBe('no_engagement');
  });

  it('spoke-then-idle + surviveGaps: continues past the budget, stands down only at the backstop (idle_budget)', () => {
    const spoke = { idleElapsedMs: 1500, unresolvedPeerRequests: 0 };
    expect(
      evaluateIdlePolicy(spoke, {
        ...underBackstopOverBudget,
        surviveGaps: true,
      }).standDown,
    ).toBe(false);
    const atCeiling = evaluateIdlePolicy(spoke, {
      ...atBackstop,
      surviveGaps: true,
    });
    expect(atCeiling.standDown).toBe(true);
    expect(atCeiling.exitReason).toBe('idle_budget');
  });

  it('surviveGaps does NOT override outstanding work — unresolved peer requests still continue', () => {
    const outstanding = { idleElapsedMs: 1500, unresolvedPeerRequests: 2 };
    const d = evaluateIdlePolicy(outstanding, {
      ...underBackstopOverBudget,
      surviveGaps: true,
    });
    expect(d.standDown).toBe(false);
  });

  it('default-unchanged guard: same fixture with surviveGaps unset stands down at the idle budget (plan 027 #35)', () => {
    const neverSpoke = { idleElapsedMs: null, unresolvedPeerRequests: 0 };
    const d = evaluateIdlePolicy(neverSpoke, underBackstopOverBudget);
    expect(d.standDown).toBe(true);
    expect(d.exitReason).toBe('no_engagement');

    const spoke = { idleElapsedMs: 1500, unresolvedPeerRequests: 0 };
    const d2 = evaluateIdlePolicy(spoke, underBackstopOverBudget);
    expect(d2.standDown).toBe(true);
    expect(d2.exitReason).toBe('idle_budget');
  });

  it('the underscore exitReasons map to clean hyphen terminalReason members (the #49 seam)', () => {
    // Drive the exitReasons from real policy output (not literals), then assert
    // the mechanical underscore→hyphen map #49 applies lands on Phase-4 CLEAN
    // terminal reasons — so a survive-gaps stand-down reconciles to `completed`.
    const noEngagement = evaluateIdlePolicy(
      { idleElapsedMs: null, unresolvedPeerRequests: 0 },
      { idleBudgetMs: 1, runElapsedMs: 10, timeoutSec: 0 },
    ).exitReason;
    const idleBudget = evaluateIdlePolicy(
      { idleElapsedMs: 5000, unresolvedPeerRequests: 0 },
      { idleBudgetMs: 1, runElapsedMs: 10, timeoutSec: 0 },
    ).exitReason;
    expect(noEngagement).toBe('no_engagement');
    expect(idleBudget).toBe('idle_budget');

    for (const exitReason of [noEngagement, idleBudget]) {
      const terminalReason = (exitReason as string).replace(/_/g, '-');
      expect(isCleanTerminalReason(terminalReason)).toBe(true);
    }
    expect(isCleanTerminalReason('idle-budget')).toBe(true);
    expect(isCleanTerminalReason('no-engagement')).toBe(true);
  });
});
