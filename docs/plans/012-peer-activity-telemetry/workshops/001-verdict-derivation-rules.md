# Workshop: Verdict Derivation Rules

**Type**: Decision Table (NOT a state machine — see § Framing)
**Plan**: 012-peer-activity-telemetry
**Spec**: [`peer-activity-telemetry-spec.md`](../peer-activity-telemetry-spec.md)
**Created**: 2026-04-29
**Status**: Draft

**Related Documents**:
- [Plan 011 / Workshop 001 — peer-activity-telemetry (authoritative design)](../../011-retro-harvest-loop/workshops/001-peer-activity-telemetry.md)
- [Plan 012 spec](../peer-activity-telemetry-spec.md)
- [Research dossier](../research-dossier.md)

**Domain Context**:
- **Primary**: `runner` (the pure-function `derivePeerActivity` lives here)
- **Related**: `cli` (consumes the verdict); `mcp` (observed only via events)

---

## Framing — minih is not the police

**This is NOT a state machine.** A state machine implies states the system *owns* and *transitions between*. minih owns nothing here:

- The agent owns its own state (`status: idle/reviewing/...`).
- The agent owns its own polling cadence and filter vocabulary.
- The runner owns nothing about the agent's behaviour — it just records what happened.

What we have is a **pure descriptive label** computed from observed facts at the moment a CLI command runs. The verdict is a **snapshot adjective** — "right now, this agent looks `deaf`" — not a state the runner is enforcing or transitioning through.

**Design principles** (in priority order):

1. **Super simple.** The whole rule set is a flat decision ladder you can read in 30 seconds. No layers, no events, no transitions, no graphs.
2. **Very easy to use.** A caller reads `peer.verdict === 'deaf'` and knows what to do. The reason string is human-readable.
3. **Observe, don't enforce.** We never block, refuse, or coerce. `--strict-peer` is opt-in; default is *visible-but-non-blocking*.
4. **Pure function.** `derivePeerActivity(inputs) → output`. No I/O outside the function call. No mutation. No state. Repeatable. Trivially testable.
5. **Degrade gracefully.** Missing/torn/empty files → `verdict: 'unknown'`, never throws.

If a future minih-style tool wants to build a real state machine on top of this, fine — they can. But minih itself is just calling a label.

---

## Purpose

Lock the precise rules that turn observed facts (last poll, filter, run status) into a single-word verdict, so that:
- The implementation is one small pure function with an obvious test matrix.
- Callers can rely on stable, documented rule precedence (which check fires first).
- The verdict vocabulary is finite, explicit, and stable.

## Key Questions Addressed

- What's the exact precedence when multiple rules could apply?
- What does each verdict actually mean in one sentence?
- What inputs does the rule function need (and what does it produce)?
- How do we handle "no signal" cases (run just started, never polled, missing files)?
- What's the smallest set of test fixtures that proves the rules right?

---

## The Verdict Vocabulary (7 values)

| Verdict | One-sentence meaning |
|---|---|
| `listening` | Agent is currently inside an active poll window AND its filter would match the message type. |
| `between-polls` | Agent is between polls but cadence is healthy AND last filter would match. Message will be picked up on next poll. |
| `deaf` | Agent is polling (now or recently) but its filter does NOT include the message type. |
| `silent` | Agent has not polled for an extended period — likely doing other work (e.g. inside a long tool call). Process is alive. |
| `dead` | Agent process is gone (run.json says completed/failed/stale) OR has been silent past the dead threshold. |
| `n/a` | Agent is not coordination-enabled (no `state/inside.json`). No verdict to compute. |
| `unknown` | Couldn't read the inputs (missing/torn/empty `events.ndjson`). Don't fail; just say so. |

`unknown` is **new** vs. workshop 001's 6-value vocabulary — added because torn-write tolerance (AC-14) needs an honest "we couldn't tell" label rather than a misleading inferred one.

---

## Inputs and Outputs

### Input shape (everything the function needs)

```ts
interface DerivePeerInputs {
  // From the run dir
  hasInsideState: boolean;             // <runDir>/state/inside.json exists
  runStatus: RunManifestStatus | null; // run.json `status`, or null if missing
  runAgeMs: number;                    // now - run.json.startedAt

  // From events.ndjson tail (last N tool_call events)
  lastPollAt: number | null;           // ms since epoch; null if none observed
  lastPollFilter: string[] | null;     // `waitForAny` from latest inbox_list; null = open filter
  lastPollWaitMs: number | null;       // `waitMs` from latest inbox_list; null = no long poll
  pollCadenceMs: number | null;        // median delta between recent inbox_list calls; null if <2 calls
  lastSendAt: number | null;           // ms since epoch; null if none
  lastAckOf: string | null;            // messageId acked

  // From state/inside.json (informational only — never drives verdict alone)
  selfReportedState: string | null;    // status field; e.g. 'idle', 'reviewing'
  selfReportedStateAge: number | null; // now - updatedAt

  // From the call site
  messageType: string | null;          // e.g. 'review-request'; null for non-send commands
  now: number;                         // ms since epoch (injectable for tests)

  // Tunables (with defaults)
  silentThresholdMs?: number;          // default: max(2 * pollCadenceMs, 5 * 60_000)
  deadThresholdMs?: number;            // default: 30 * 60_000
  newRunGracePeriodMs?: number;        // default: 60_000 (don't call dead until run is >1min old)
}
```

### Output shape (what callers see)

```ts
interface PeerActivity {
  verdict: 'listening' | 'between-polls' | 'deaf' | 'silent' | 'dead' | 'n/a' | 'unknown';
  reason: string;                      // human-readable; safe to print on stderr

  // Behavioural facts (objective; from telemetry)
  lastPollAt: string | null;           // ISO timestamp
  lastPollFilter: string[] | null;
  lastPollWaitMs: number | null;
  pollWindowEndsAt: string | null;
  currentlyPolling: boolean;
  willMatchType: boolean | null;       // null when messageType is null
  pollCadenceMs: number | null;
  idleSinceMs: number | null;
  lastSendAt: string | null;
  lastAckOf: string | null;

  // Self-reported state (informational, lower-trust)
  selfReportedState: string | null;
  selfReportedStateAge: number | null;
}
```

`reason` is the single most important field for humans. The verdict is the contract for tooling; the reason is the explanation a person reads.

---

## The Decision Ladder (precedence rules)

Read top to bottom. **First match wins.** This is the entire rule set.

| # | Verdict | Condition | Reason template |
|---|---|---|---|
| 1 | `unknown` | events.ndjson read failed (missing or all torn) | `"could not read events.ndjson"` |
| 2 | `n/a` | `!hasInsideState` (agent not coordination-enabled) | `"agent is not coordination-enabled"` |
| 3 | `dead` | `runStatus ∈ {completed, failed, stale}` | `"run.json status: <status>"` |
| 4 | `dead` | `lastPollAt === null && runAgeMs > newRunGracePeriodMs` | `"run is <age> old but no inbox_list calls observed"` |
| 5 | `dead` | `lastPollAt !== null && (now - lastPollAt) > deadThresholdMs` | `"last poll <age> ago (>30min)"` |
| 6 | `silent` | `lastPollAt === null` (run just started, in grace period) | `"no inbox_list calls observed yet (run just started)"` |
| 7 | `silent` | `!currentlyPolling && idleSinceMs > silentThresholdMs` | `"no poll for <age> (cadence <cadence>)"` |
| 8 | `deaf` | `messageType !== null && willMatchType === false` | `"lastPollFilter <filter> does not include type '<messageType>'"` |
| 9 | `listening` | `currentlyPolling` (and the deaf check above didn't fire) | `"inside active poll window (ends <time>)"` |
| 10 | `between-polls` | (default if nothing else matched) | `"last poll <age> ago, cadence <cadence>"` |

That's it. Ten lines.

### Why this order

- **`unknown` first** — never lie about what we don't know. If we can't read the file, we have no facts to evaluate further rules.
- **`n/a` second** — short-circuit non-coordinated agents before any other checks. Saves work and prevents misleading verdicts.
- **`dead` over `silent`** — if the process is gone, "silent" is misleadingly hopeful. Three ways to be dead: run.json says so, no polls ever (past grace), or last poll long ago.
- **`silent` over `deaf`** — if the agent isn't polling at all, it's pointless to evaluate filter match. We don't know what filter it'd use when it next polls. `silent` is more accurate than "deaf to a filter that may not be active anymore".
- **`deaf` over `listening`** — within the polling window, type-match is the dominant signal. A polling agent whose filter excludes the type is the worst-case bug we're catching; flag it loudly.
- **`listening` then `between-polls`** — both are healthy; the difference is whether the message lands now or on next poll.

### Worked precedence examples

| Scenario | Inputs | Verdict | Reason |
|---|---|---|---|
| Run just started, no polls yet | `runAgeMs: 5_000, lastPollAt: null` | `silent` (rule 6) | run is 5s old but no polls yet |
| Run started 90s ago, still no polls | `runAgeMs: 90_000, lastPollAt: null` | `dead` (rule 4) | past grace, no polls |
| Healthy poll, matching filter | polling now, filter has type | `listening` (rule 9) | inside active poll window |
| Healthy poll, filter excludes | polling now, filter excludes type | `deaf` (rule 8) | filter does not include type |
| Mid-bash, filter would match | not polling, idle 30s, cadence 30s | `between-polls` (rule 10) | last poll 30s ago |
| Mid-bash, filter would NOT match | not polling, idle 30s, cadence 30s, type excluded | `deaf` (rule 8) | filter doesn't include type — even though "between-polls" telemetry-wise, the type-mismatch is the dominant signal |
| Long bash, idle 8min, cadence 30s | not polling, idle 480_000ms | `silent` (rule 7) | exceeded silent threshold (5min default) |
| Long bash, filter excludes | not polling, idle 8min | `silent` (rule 7) | silent fires before deaf — we don't know what filter the agent would use after the bash finishes |
| Run.json says failed | `runStatus: 'failed'` | `dead` (rule 3) | run failed |
| Last poll 35min ago | `lastPollAt: now - 35*60_000` | `dead` (rule 5) | exceeds dead threshold |
| Read command (no messageType) | `messageType: null`, polling now | `listening` (rule 9) | type-match check skipped (rule 8 only fires when messageType !== null) |

The 6th and 7th row deserve attention — they show that **`deaf` and `silent` can both apply** depending on idle duration:
- Idle < silentThreshold → check filter → `deaf` if mismatch, `between-polls` otherwise.
- Idle > silentThreshold → `silent` (we no longer know what filter applies).

This is the right behaviour: filter-mismatch only matters for an agent that's actually polling-or-about-to-poll. A long-silent agent's filter is stale data.

---

## Cadence Math (the trickiest bit)

`pollCadenceMs` = median delta between consecutive `inbox_list` events in the tail window.

### Rules

- **At least 2 polls observed** → median of all consecutive deltas. (For 2 polls = 1 delta = the value itself.)
- **Fewer than 2 polls** → `pollCadenceMs: null`. Use default `30_000` as fallback for threshold math.
- **Outliers**: don't filter. The median naturally handles single outliers in a set of >3.
- **Use `data.input.waitMs` as a hint, not a substitute.** A poll's `waitMs: 30_000` says "I want a 30s long-poll" but the agent might re-poll immediately if it gets a hit — the actual cadence comes from observed deltas, not declared intent.

### `currentlyPolling`

```ts
currentlyPolling = lastPollAt + (lastPollWaitMs ?? 0) > now
```

Note `?? 0` — if `waitMs` was absent in the call, the poll is instantaneous (returned right away), so `currentlyPolling: false` even moments after.

### `willMatchType`

```ts
function computeWillMatch(lastPollFilter: string[] | null, messageType: string | null): boolean | null {
  if (messageType === null) return null;          // not a send command; type-match is irrelevant
  if (lastPollFilter === null) return true;       // open filter (waitForAny was unset/null)
  if (lastPollFilter.length === 0) return true;   // empty array also = open filter (defensive)
  return lastPollFilter.includes(messageType);
}
```

Defensive treatment of `null` and `[]` as "open" prevents false `deaf` verdicts when an older event format omits `waitForAny`.

---

## The Function

```ts
// src/runner/peer-activity.ts (full skeleton — implementation lives here)

export type PeerVerdict =
  | 'listening' | 'between-polls' | 'deaf'
  | 'silent' | 'dead' | 'n/a' | 'unknown';

export interface DerivePeerInputs { /* see § Inputs above */ }
export interface PeerActivity     { /* see § Outputs above */ }

const DEFAULTS = {
  silentThresholdFloorMs: 5 * 60_000,
  deadThresholdMs: 30 * 60_000,
  newRunGracePeriodMs: 60_000,
  defaultCadenceMs: 30_000,
};

export function derivePeerVerdict(input: DerivePeerInputs): { verdict: PeerVerdict; reason: string } {
  // Rule 1 — unknown
  if (input.eventsReadFailed) return { verdict: 'unknown', reason: 'could not read events.ndjson' };

  // Rule 2 — n/a
  if (!input.hasInsideState) return { verdict: 'n/a', reason: 'agent is not coordination-enabled' };

  // Rules 3-5 — dead
  if (input.runStatus && ['completed', 'failed', 'stale'].includes(input.runStatus)) {
    return { verdict: 'dead', reason: `run.json status: ${input.runStatus}` };
  }
  const grace = input.newRunGracePeriodMs ?? DEFAULTS.newRunGracePeriodMs;
  if (input.lastPollAt === null && input.runAgeMs > grace) {
    return { verdict: 'dead', reason: `run is ${fmtAge(input.runAgeMs)} old but no inbox_list calls observed` };
  }
  const deadMs = input.deadThresholdMs ?? DEFAULTS.deadThresholdMs;
  if (input.lastPollAt !== null && (input.now - input.lastPollAt) > deadMs) {
    return { verdict: 'dead', reason: `last poll ${fmtAge(input.now - input.lastPollAt)} ago` };
  }

  // Rule 6 — silent (run just started)
  if (input.lastPollAt === null) {
    return { verdict: 'silent', reason: 'no inbox_list calls observed yet (run just started)' };
  }

  // Rule 7 — silent (idle past threshold)
  const cadence = input.pollCadenceMs ?? DEFAULTS.defaultCadenceMs;
  const silentThreshold = input.silentThresholdMs ?? Math.max(2 * cadence, DEFAULTS.silentThresholdFloorMs);
  const idleSince = input.now - input.lastPollAt;
  const currentlyPolling = (input.lastPollAt + (input.lastPollWaitMs ?? 0)) > input.now;
  if (!currentlyPolling && idleSince > silentThreshold) {
    return { verdict: 'silent', reason: `no poll for ${fmtAge(idleSince)} (cadence ${fmtAge(cadence)})` };
  }

  // Rule 8 — deaf (filter mismatch)
  const willMatch = computeWillMatch(input.lastPollFilter, input.messageType);
  if (input.messageType !== null && willMatch === false) {
    return {
      verdict: 'deaf',
      reason: `lastPollFilter ${JSON.stringify(input.lastPollFilter)} does not include type '${input.messageType}'`,
    };
  }

  // Rule 9 — listening
  if (currentlyPolling) {
    return { verdict: 'listening', reason: `inside active poll window (ends ${fmtTime(input.lastPollAt + (input.lastPollWaitMs ?? 0))})` };
  }

  // Rule 10 — between-polls (default)
  return { verdict: 'between-polls', reason: `last poll ${fmtAge(idleSince)} ago, cadence ${fmtAge(cadence)}` };
}
```

The whole rule engine is **~40 lines of TypeScript**. Plus `computeWillMatch` (5 lines) and a tiny `fmtAge`/`fmtTime` helper. Embarrassingly simple. That's the goal.

The outer `derivePeerActivity(runDir, opts)` function does the I/O (reverse-tail events.ndjson, read state.json, read run.json) and assembles the `DerivePeerInputs`, then delegates to `derivePeerVerdict`. **The verdict logic is decoupled from the I/O** so unit tests can feed inputs directly.

---

## Test Matrix (12 cases — covers every rule)

The matrix below is the minimum set that exercises every rule path including precedence boundaries. Implement each as a fixture-driven unit test.

| # | Test name | Inputs (key fields) | Expected verdict | Rule fired |
|---|---|---|---|---|
| 1 | `unknown when events read fails` | `eventsReadFailed: true` | `unknown` | 1 |
| 2 | `n/a when no inside state` | `hasInsideState: false` | `n/a` | 2 |
| 3 | `dead when run.json says failed` | `runStatus: 'failed'` | `dead` | 3 |
| 4 | `dead when no polls past grace` | `runAgeMs: 90_000, lastPollAt: null` | `dead` | 4 |
| 5 | `dead when last poll >30min` | `lastPollAt: now - 35*60_000` | `dead` | 5 |
| 6 | `silent when run just started` | `runAgeMs: 5_000, lastPollAt: null` | `silent` | 6 |
| 7 | `silent when idle past threshold` | not polling, idle 8min | `silent` | 7 |
| 8 | `deaf when filter excludes type` | polling, filter=[a,b], type=c | `deaf` | 8 |
| 9 | `listening when polling and matches` | polling, filter=[a,b], type=a | `listening` | 9 |
| 10 | `between-polls when healthy and matches` | not polling, idle 30s, cadence 30s, type matches | `between-polls` | 10 |
| 11 | `silent over deaf when long-idle` | not polling, idle 8min, type excluded | `silent` | 7 (silent wins over 8) |
| 12 | `listening when no messageType (read cmd)` | polling, messageType: null | `listening` | 9 (rule 8 skipped) |

**Bonus edge-case tests** (recommended but not strictly required for rule coverage):
- `null filter treated as open` (defensive)
- `empty filter treated as open` (defensive)
- `single poll observed → cadence falls back to default`
- `lastPollWaitMs absent → currentlyPolling=false even immediately after`
- `runStatus 'idle' is alive` (idle ≠ dead — intentional!)
- `unknown does not throw on missing events.ndjson` (integration test)

---

## What This Workshop Does NOT Specify

Out of scope here (covered elsewhere or intentionally deferred):

| Concern | Where it lives |
|---|---|
| Reverse-tailing events.ndjson | Plan 012 implementation (~30 LOC inside or beside `peer-activity.ts`) |
| TTY rendering of the verdict | `outside.ts` per-command stderr blocks; not a verdict-rule concern |
| `--strict-peer` exit code | Plan 012 spec § Open Questions / clarify pass |
| Doctor's threshold for "extended period silent" | Workshop opp #2 (deferred) |
| Filter vocabulary contract | Workshop opp #3 (separate plan) |
| Inside-side reverse symmetry | Workshop opp #5 (deferred) |

---

## Open Questions

### Q1: Should `unknown` be visible to LLM orchestrators or hidden as `n/a`?

**RESOLVED — visible.** An LLM seeing `verdict: 'unknown'` with `reason: 'could not read events.ndjson'` can react meaningfully (retry? warn? proceed?). Lying via `n/a` would mask infrastructure issues.

### Q2: Should the `dead` rule fire when run.json has `status: 'idle'`?

**RESOLVED — no.** `idle` is a healthy state in the run-manifest enum (`types.ts:260-268`); it just means the SDK session is in an idle phase. Dead is reserved for `completed | failed | stale`. Update rule 3 accordingly.

### Q3: What if the agent is currently inside a long bash AND the filter would match?

**RESOLVED — `silent`.** The agent's filter is stale data while it's busy. We can't know what filter it'll re-arm with after the bash. Better to surface `silent` than promise `between-polls`.

This is row 11 of the matrix above. The trade-off: a caller sending right before the agent finishes its bash would get `silent` even though the message will land fine on the next poll. Acceptable — `silent` doesn't BLOCK anything; the send still proceeds. The verdict is just informational.

### Q4: Should `pollCadenceMs` weight recent polls more heavily?

**OPEN.** v1: simple median. If callers observe wonky cadences (e.g. agent had a long bash interleaved), revisit with EWMA or trimmed-mean. Defer optimization.

### Q5: Should the verdict change between two consecutive sends to the same agent in the same second?

**RESOLVED — yes, that's correct behaviour.** If the agent re-polls between the two sends with a different filter, the second send accurately reflects the new filter. Verdicts are snapshots; consecutive snapshots can differ. This is a feature, not a bug.

### Q6: Should `deaf` reason include a hint about which type WOULD work?

**OPEN — probably yes.** When `verdict: 'deaf'`, the reason could include `"...try one of: <list of types in the filter>"` to make the fix obvious. Cost: trivial. Useful especially in TTY output. Probably v1, but verify in plan-3 task design.

---

## Quick Reference

```ts
// Caller-side — minimal contract
const peer = derivePeerActivity({ runDir, messageType: 'review-request', now: () => Date.now() });
if (peer.verdict === 'deaf')   console.warn(`Filter mismatch: ${peer.reason}`);
if (peer.verdict === 'silent') console.warn(`Agent is busy: ${peer.reason}`);
if (peer.verdict === 'dead')   console.error(`Agent is gone: ${peer.reason}`);
// listening / between-polls / n/a / unknown — proceed normally
```

```bash
# TTY output — what humans see
$ minih outside inbox send code-review-companion --type review-request --body "..."

⚠ peer: deaf — lastPollFilter [task,question,directive,control] does not include type 'review-request'
✓ Message sent (id: 01KQBKZDS2216904GXBZTG2WYG)
```

```bash
# Strict mode — opt-in gate (plan 012 default is non-blocking)
$ minih outside inbox send <slug> --type X --strict-peer ...
✗ Refusing to send: peer verdict 'deaf' (use --force or change --type)
exit 1
```

---

## Why This Matters (one paragraph)

The plan 011 Power On Mode bug — the lived motivation for this whole feature — was a 5-second realization to humans once they saw the events.ndjson, but a 30-minute timeout for the orchestrator. The verdict rules above turn that 30-minute silent failure into a 0-millisecond visible signal **without minih owning any new state**. Ten rules. One pure function. Forty lines. Done.

That simplicity *is* the design. minih is the messenger, not the police.
