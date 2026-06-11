# Research Report: Dead-PID Liveness (Group 1 — issue #24, FX009/FX011/FX012)

**Generated**: 2026-06-11T08:30:00Z
**Research Query**: "Group 1 fix — issue #24: minih status reports verdict:active for dead pids. Reconcile the open FX009/FX011/FX012 dossiers (docs/plans/018-agent-permissions/fixes/) against current code — status.ts changed in plan 023 — scope which of the three ship now, and determine how to deterministically prove dead-pid detection in tests."
**Mode**: Plan-Associated (docs/plans/025-dead-pid-liveness/)
**FlowSpace**: Available (graph scanned)
**Harness**: session-start seam fired — boot verdict **degraded** (lint/typecheck/`just check` pass; known minih-doctor warnings + npm audit 1 critical/1 high). Ready to work with caveats.
**Findings**: 58 raw findings from 8 parallel subagents, synthesized below.

## Executive Summary

### What It Does
`minih status <slug>` answers "is this run alive?" for orchestrators. Today its verdict is computed from an `events.ndjson` mtime heuristic (`STALE_THRESHOLD_MS = 60_000`, `src/cli/commands/status.ts:26`, verdict chain at `status.ts:258-264`) — the recorded pid is never probed, so a crashed run reads `verdict: 'active'` for up to 60s (and `'stale'`, not dead, forever after).

### Key Insights
1. **Status is the LAST liveness path not probing the pid.** The runner already has a single source of truth — `isProcessAliveDefault` (`src/runner/run-eligibility.ts:37-45`, exported via `runner/index.ts:235`) — and it is already used by `run-resolver.ts:305` (plan-016's *earlier, shipped* FX009: "stale-active resolver pid check") and by plan 023's `run-inventory.ts:191-192` (`minih runs list` correctly demotes dead pids). `status.ts` imports the resolver but ignores its liveness and recomputes verdict by mtime (`status.ts:13-16` vs `258-264`). The 018-FX009 fix is a small, well-scoped *assembly* job in the CLI.
2. **The proof question is already answered by repo precedent.** `test/runner/run-resolver.test.ts:204-252` ("FX009 — PID-liveness filter") proves dead-pid detection deterministically via an injected predicate (`isProcessAlive: (pid) => pid === FAKE_LIVE_PID`) over tmpdir fixtures — zero real processes, zero flake. The 018-FX009 dossier (FX009-4) specs 9 unit cases mirroring exactly that pattern. See **Proof Strategy** below.
3. **All three dossiers survive drift almost untouched — none is implemented.** Plan 023 changed run-targeting in status.ts but did NOT touch the verdict chain (confirmed via `git show e468ff0`). FX009/FX011/FX012 designs hold; plan 023 even pre-built FX011's `--all` discovery walker (`run-inventory.ts:213-244`).

### Quick Stats
- **Scope of FX009 core change**: 1 import + 1 verdict gate + envelope field gating + TTY render + 1 new test file. `isProcessAliveDefault` needs an error-discrimination upgrade (see CF-03).
- **Dependencies**: FX011 depends on FX009 + FX012's terminalReason value; FX012 needs a `terminalReason` type widening first.
- **Prior learnings**: 10 directly relevant (two prior FX efforts on this exact problem).
- **Domains**: cli (FX009, FX011 shell), runner (FX011 core, FX012 mapping), adapter (FX012 emit). No boundary violations; import direction holds throughout.

## How It Currently Works

1. **Verdict chain** (`src/cli/commands/status.ts:258-264`): `completed.json` exists → `completed`/`failed`; else `events.ndjson` exists → `active` if mtime age < 60s else `stale`; else `unknown`. Pid never consulted.
2. **Pid is always recorded** at spawn (`src/runner/runner.ts:434`, overwritten on resume-in-place at `:478`); `LiveRunManifest.pid: number` is non-optional.
3. **Crash never flips status** (`runner.ts` manifest writes only on explicit events — session_start sets `active` at `:979`; terminal writes at `:523/:534/...`). SIGKILL/OOM/provider-death leave `run.json.status: 'active'` and a frozen `updatedAt` forever.
4. **Two parallel liveness systems already probe pids**: `run-resolver.collectActiveRuns` (`run-resolver.ts:304-312`, skips dead-pid candidates with a diagnostic) and `run-inventory.computeLiveness` (`run-inventory.ts:177-200`, demotes dead → `'stale'`). The resolver's by-id/latest-any `computeLiveness` (`run-resolver.ts:407-427`) does NOT probe — status's resolution path carries no pid truth either way; status then recomputes verdict from mtime regardless (`status.ts:185 → 258`).

## Critical Discoveries

### 🚨 CF-01: Three liveness vocabularies, one concept — unify or document
- status verdict: `'active'|'stale'|'completed'|'failed'|'unknown'` (`status.ts:240`) → FX009 adds `'dead'`.
- `RunLiveness` (inventory/resolver): same 5 values; dead pid currently maps to **`'stale'`** (`run-inventory.ts:191-192`) — NOT `'dead'`.
- `peer-activity.ts:143-225` has an unrelated verdict system that already uses `'dead'` (inbox-polling liveness) — naming collision is cosmetic (different envelopes) but docs must not conflate them.
**Action**: spec must decide whether `runs list` liveness also gains `'dead'` (consistency) or stays `'stale'` (FX009 dossier treats them as complementary: inventory = cross-run list view, status = single-run deep inspection). ⚠️ Open question for /plan-1b.

### 🚨 CF-02: Verdict change is a documented breaking change for jq filters
`select(.verdict == "active")` is load-bearing in 3+ documented places: `AGENTS.md:161` (Power-On-Mode boot), `AGENTS_README.md:1116,1140-1153` (monitoring/polling loops), `agents/code-review-companion/outside.md`. Dead-pid runs will (correctly) vanish from those filters; polling loops keyed on `completed|failed` exit conditions must learn `dead` is also terminal. CHANGELOG + doc updates are first-class tasks, not afterthoughts. (FX009 AC-FX9.8 already anticipates this.)

### 🚨 CF-03: `isProcessAliveDefault` does not yet meet the FX009 error spec
Current impl (`run-eligibility.ts:37-45`, verified directly) returns `false` on ANY `process.kill(pid,0)` throw. FX009 spec: ESRCH→false, **EPERM→true (conservative alive)**, EINVAL→false, other→propagate. FX009-3 upgrade is real outstanding work, and it subtly changes behavior for the two existing callers (resolver, inventory) — for the better (no false-dead on permission-restricted probes), but tests must cover it. (One subagent mis-reported this as already implemented; settled by direct read.)

### 🚨 CF-04: status.ts has no injection seam; CLI tests are subprocess-based
Runner layer has `isProcessAlive?:` injection throughout (`run-eligibility.ts:31-34`, resolver, inventory). `status.ts`'s action handler reads globals only, and all existing CLI tests exec the built CLI (`execFileSync('node', [cliPath,...])` — `test/cli/runs.test.ts:26-45`). FX009-2 (add injection) implies either a direct-handler test export (new pattern for test/cli/) or real-pid subprocess tests. See Proof Strategy.

### 🚨 CF-05: terminalReason is the cross-FX integration spine
`LiveRunManifest.terminalReason?: 'permission-denied'` today (`types.ts:420`). FX012 adds `'provider-stream-aborted'` (adapter detects truncated stream, runner maps to run.json); FX011 adds `'pid-vanished'` (healer fallback) with a **preservation invariant** — never overwrite an existing value (AC-FX11.9). FX009 just passes it through (already does, `status.ts:354`). Type widening in `types.ts` is the shared prerequisite.

## FX Reconciliation Verdicts (drift vs 2026-05 dossiers)

| FX | Implemented today | Design survives? | Blockers | Notes |
|----|------------------|------------------|----------|-------|
| **FX009** status pid probe | 0% (no `'dead'` verdict, no probe in status.ts, no envelope fields, no tests) | **YES — fully** (validated dossier, 10 ACs, 0 CRIT) | None | Infrastructure (probe fn, export, injection pattern) already shipped by plan-016 FX009-prior + plan 023. Pure CLI assembly + FX009-3 probe upgrade. |
| **FX011** `minih reconcile` healer | 0% (no reconcile.ts/reconcile-lock.ts/command) | YES, with a gift | FX009 (pattern) + FX012 (terminalReason value) for full ACs | Plan 023 already built the `--all` discovery walker (`run-inventory.ts:213-244` — slug locale-sort, runId sort); reuse it. Lock mirrors existing `resume-lock.ts`. `LiveRunStatus` gains `'crashed'` (additive). |
| **FX012** `provider_stream_aborted` event | 0% (no event type in `AgentEvent` union `events.ts:235-247`, no adapter tracking) | YES | `terminalReason` type widening | Synthetic-event precedent exists: `AgentPermissionDeniedEvent` (runner-generated, `events.ts:201-233`). Adapter owns emit (`sdk-copilot.ts` settlement observation); runner maps event → run.json. |

**Recommended ship order** (from dossier cross-references + dependency analysis): **FX009 → FX012 → FX011** (FX011 last; it explicitly preserves FX012's terminalReason — test case b2). FX009 alone closes the headline lie; it can ship independently if scope is cut.

## Proof Strategy (the user's open question — answered)

**PRIMARY — unit + injection (zero flake, strong precedent)**
Mirror `test/runner/run-resolver.test.ts:204-252` and `run-eligibility.test.ts:88-159`: tmpdir fixture run dirs (`makeManifest`/`writeManifest` builders, plan-023 pattern), `run.json` with `status:'active'`, `pid: FAKE_DEAD_PID`, an `events.ndjson` stub (so the mtime path is reachable and precedence is provable), then call the verdict logic with an injected `isProcessAlive` predicate. FX009-4 already enumerates 9 cases (alive / dead / completed-skips-probe / no-pid-falls-through / injection-override / pid 0 / pid<0 / EPERM→active / EINVAL→dead). Requires FX009-2: an injection seam on the status handler — either export a testable verdict function or accept an optional deps param (new-but-clean pattern for test/cli/, which is subprocess-only today).

**SECONDARY — integration smoke with a real reaped process (bounded flake)**
Spawn `node -e "process.exit(0)"`, capture `child.pid`, await exit, write it into a fixture `run.json`, run the **built CLI** via the existing `execFileSync` pattern → assert `verdict: 'dead'` end-to-end with the REAL `process.kill(pid,0)` probe. Alive-case twin: use the test runner's own live `process.pid` (precedent: `run-target-ambiguity.test.ts` fixtures already use `pid: process.pid`, which is why its 3 verdict assertions keep passing post-fix). Pid-reuse risk in the <100ms test window is negligible but nonzero — keep 1-2 of these as smoke, not the matrix. Spawn precedent: `test/mcp/leak-regression.test.ts`.

**REJECTED — prober scenario matrix**: `agents/permission-prober/scenarios.json` is permission-focused, not wired into CI for liveness, and FX004 (its extension dossier) is deferred. High flake, wrong layer for proof; fine for post-ship acceptance someday.

**Backpressure note**: both approaches are deterministic sensors — the post-spec backpressure survey should rate this AC as provable (EXISTS/BUILDABLE), not eyeball-only.

## Blast Radius (what must move together)

- **Code**: `status.ts` (probe + verdict + envelope gating + TTY `'dead'` render); `run-eligibility.ts` (error discrimination); later `types.ts` (terminalReason, `'crashed'`), `reconcile*.ts`, `events.ts` + `sdk-copilot.ts` + `runner.ts` (FX012).
- **Tests**: new `test/cli/status-pid-probe.test.ts`; existing verdict assertions (`run-target-ambiguity.test.ts:121,147,158`) keep passing (live-pid fixtures).
- **Docs**: AGENTS_README.md (×3 spots), AGENTS.md:161 docstring, `agents/code-review-companion/outside.md`, README CLI reference, CHANGELOG (breaking-change note + jq migration snippet — FX009 dossier has one ready).
- **No JSON-schema updates**: run.json and events are TypeScript-typed, not AJV-validated (`types.ts:265-268` records this as deliberate). inside/outside-state schemas are independent — the #27/#31 vocabulary-drift failure mode does not apply here, but the CHANGELOG must carry the vocabulary.
- **No domain-map edge changes**; History rows needed for cli + runner (+ adapter if FX012 ships) — exactly the F004/F005-style currency the 024 review dinged us on. Don't repeat it.

## Prior Learnings (institutional knowledge — 10 found, top 5 shown)

| ID | Source | Insight | Action |
|----|--------|---------|--------|
| PL-01 | plan-016 FX009-prior dossier | The probe existed but wasn't wired ("the resolver just doesn't reuse it") — same asymmetry now lives in status.ts | Reuse, never re-invent the probe |
| PL-02 | FX009-prior log (live demo) | Real incident: dead-pid run caused spurious E170 ambiguity for `attach` | Validates urgency; status is the remaining liar |
| PL-08 | FX009-prior validation M1 | Hardcoded fake pids (99999999) are brittle — systems may have them live; injection is the fix | Inject predicates in ALL liveness tests |
| PL-07 | FX011 dossier AC-FX11.9 | terminalReason preservation invariant protects FX012's diagnosis from the healer | Encode in `reconcileRunDir` core, test case b2 |
| PL-05 | FX012 dossier (Chainglass incident) | Real failure signature: 159 text_deltas then mid-token silence, no streaming_complete, frozen updatedAt, pid gone | FX012's trigger condition matches the signature exactly |

Others: PL-03 (events mtime is the only last-activity signal once pid vanishes — precedence: event ts > exitDetectedAt > mtime), PL-04 (atomic tmp+rename for run.json writes), PL-06 (FX012 tracks only latest in-flight messageId — intentional v1), PL-09 (surface lower-layer diagnostics at CLI or they're lost), PL-10 (lock TTL + steal prevents healer deadlock). Scan coverage: 26 execution logs, 4 FX dossiers deep, 3 retro ledgers (447 keyword hits), 5 Discoveries tables.

## Domain Context

| Fix | Placement | Boundary check |
|-----|-----------|----------------|
| FX009 | all in `cli/commands/status.ts`, importing `isProcessAliveDefault` from runner | ✅ cli→runner direction; export exists |
| FX011 | `runner/reconcile.ts` + `runner/reconcile-lock.ts` (core, owns run.json writes) + `cli/commands/reconcile.ts` (thin shell) | ✅ runner owns artifact writes; mirrors `resume-lock.ts` |
| FX012 | `adapter/sdk-copilot.ts` (tracking+emit) + `adapter/events.ts` (type) + `runner/runner.ts` (map → terminalReason) | ✅ adapter→runner flow; `AgentPermissionDeniedEvent` precedent |

mcp domain: untouched (coordination state schemas independent of run liveness).

## Open Questions for /plan-1b (clarify)

1. **Scope**: FX009 only, or FX009+FX012+FX011 staged in one plan? (All are "Group 1"; FX009 alone kills the headline lie; the trio closes detection+diagnosis+healing.)
2. **Vocabulary unification** (CF-01): should `runs list` liveness also say `'dead'`, or keep demoting to `'stale'`?
3. **Injection seam shape** (CF-04): testable exported verdict function vs handler deps param — affects test architecture.
4. **`isProcessAliveDefault` EPERM change** (CF-03) ripples to resolver/inventory behavior — accept globally (recommended) or fork a status-only probe (not recommended)?

## External Research Opportunities

None — every question is answerable from this repo. No external standards, APIs, or best-practice gaps identified.

## Next Steps

Run `/plan-1b-v3-specify-and-clarify` — the clarify session should resolve the 4 open questions above. The three FX dossiers + this reconciliation give the spec near-complete raw material.

---
**Research Complete**: 2026-06-11T08:30:00Z · **Report**: docs/plans/025-dead-pid-liveness/research-dossier.md
