# Execution Log — 025-dead-pid-liveness (Implementation)

**Plan**: [dead-pid-liveness-plan.md](./dead-pid-liveness-plan.md) · **Mode**: Simple · **Started**: 2026-06-11

## T000 — Harness pre-flight (pre-implement seam)

- Router probe: installed (`~/.agents/skills/eng-harness-flow/SKILL.md`). Seam fired: `--event pre-implement --phase "Implementation" --plan-dir docs/plans/025-dead-pid-liveness` → routed to boot validation (`harness boot`).
- First boot: **error** — `boot failed: lint`. Cause: `docs/plans/025-dead-pid-liveness/the-flow.json` (the-flow bookkeeping artifact) violated biome's JSON formatting (single-line `artifacts` arrays). Not product code; fixed with `npx biome check --write` on that one file.
- Re-run boot envelope (verbatim): **status: degraded** — sensors: lint **pass**, typecheck **pass**, build+test **pass**, minih-doctor **warn** (known warnings), audit **warn** (1 critical, 1 high — known, pre-existing). `next_action` from first envelope honored; degraded = session baseline from the post-spec seam. Proceeding with note.
- **Discovery**: boot's lint sensor covers `docs/**` JSON too — the-flow's hand-cranked JSON must be biome-formatted or it breaks the repo gate. (Logged for retro.)

## T001 — Probe error spec + kill seam (TDD)

- RED: 5 new cases failed as expected (EPERM→true direct; EPERM→active via `detectRunState`, `resolveRun`, `listRunInventory`; uncoded-error case passed incidentally pre-change but the EPERM ones were genuinely red).
- Implemented: `isProcessAliveDefault(pid, deps?)` with `ProcessProbeDeps { kill? }` (default wraps `process.kill`); catch discriminates `err.code === 'EPERM' → true`, everything else (ESRCH/EINVAL/uncoded) → false; non-positive/non-integer pid short-circuits before kill (spy-asserted). `ProcessProbeDeps` exported via `runner/index.ts`.
- GREEN: 37/37 across run-eligibility/run-resolver/run-inventory suites; `tsc --noEmit` clean. Existing callers unaffected — new signature is assignable to `(pid: number) => boolean`.
- Evidence: EPERM→alive exercised through **resolver** (`resolveRun latest-active`) AND **inventory** (`listRunInventory`) per Done-When.

## T002 — Extract `computeStatusVerdict` (characterization, no behavior change)

- New exported seam in `status.ts`: `computeStatusVerdict(runDir, deps?)` + `StatusVerdict`/`StatusVerdictDeps`/`StatusVerdictResult` types; action now destructures `{verdict, result, durationMs, sessionId}` from it. `deps.now` injectable for deterministic stale tests; `deps.isProcessAlive` reserved for T003.
- NEW `test/cli/status-verdict.test.ts` — first direct-import test in test/cli (everything else is subprocess): 7 characterization cases pin completed/degraded/failed/torn/active/stale/unknown.
- GREEN: 7/7 new + `run-target-ambiguity.test.ts` 9/9 (the live-pid regression net) after rebuild; tsc clean. Dropped the now-unused `completedPath` local from the action.

## T003 — Probe wiring: verdict `dead` (TDD)

- Matrix written first (11 cases: the 9 named + dead-beats-stale + terminal-manifest-skips-probe) — RED on the dead cases, then GREEN after wiring.
- `StatusVerdict` widened 5→6 (`'dead'`); probe block sits between completed.json precedence and mtime semantics: manifest status ∈ {starting, active, idle, completing} + numeric pid → probe (injected or `isProcessAliveDefault`); dead → `'dead'`. Torn run.json falls through (pre-change behavior). `'idle'` included deliberately — it claims a live process even though `run-inventory.ts` ACTIVE_STATUSES omits it.
- **Decision**: pid 0 / negative pids probe via the real default (deterministic — non-positive short-circuits to false) → verdict `'dead'`: a non-terminal manifest with an unusable pid cannot be a live run.
- GREEN: 27/27 (matrix + characterization + ambiguity net); tsc clean.

## T004 — Envelope diagnostics + TTY arms (TDD)

- `StatusVerdictResult` gains `pid`/`pidAlive`/`lastEventAt` (present only when the probe was consulted; `lastEventAt` = events.ndjson mtime ISO, `null` when no events file). Envelope spreads them gated on `pidAlive !== undefined`.
- **Upgrade over the plan's ask**: instead of adding explicit `'dead'` arms to the ternary chains, replaced both chains with exported `Record<StatusVerdict, …>` maps (`STATUS_VERDICT_COLORS`/`STATUS_VERDICT_ICONS`) — now tsc itself fails if a future verdict value lacks an arm, closing the exact no-exhaustiveness gap the validator flagged. Dead renders red `☠ dead` + a one-line explanation on TTY.
- terminalReason passthrough for all three values: deferred to the T006 subprocess smokes (the passthrough lives in the action's envelope, not in `computeStatusVerdict`) — noted here so the Done-When stays traceable.
- GREEN: 35/35; tsc + biome clean.

## T005 — Vocabulary unify: `dead` in RunLiveness + inventory + runs (TDD)

- `RunLiveness` 5→6 values (`types.ts`); `computeLiveness` dead branch returns `'dead'`; `runs list` renders it verbatim (the table already prints `row.liveness` raw — no rendering change needed beyond help text).
- **Decision**: `'dead'` rows stay in the `--active` filter (`['active','stale','dead']`) — they surfaced as `'stale'` there before this plan, and they're exactly the rows needing attention; silently dropping them from `runs list --active` would hide dead runs from the operators most likely to be polling. Help text updated; to be documented in run-liveness.md (T013).
- Subprocess dead-row test uses pid `99_999_999` (exceeds PID_MAX on macOS 99998 / Linux 4194304 → real probe deterministically reports gone) — no spawn burned, preserving T006's ≤2-spawn budget.
- GREEN: 22/22 across inventory/runs/ambiguity suites after rebuild; tsc clean.

## T006 — Reaped-pid smokes (confirmatory)

- NEW `test/cli/status-dead-smoke.test.ts`: (a) real corpse — spawn `node -e "process.exit(0)"`, await reap, fixture run.json gets the corpse pid, built CLI `status --run` → `verdict: 'dead'` + `pid`/`pidAlive:false`/`lastEventAt`; (b) live twin `process.pid` → `'active'`. Exactly 2 spawn tests (budget held). Plus the T004 terminalReason passthrough loop (3 values, spawn-free via pid 99 999 999, all → envelope verbatim + verdict dead).
- GREEN on first run (3/3) — expected: smokes are confirmatory; T003/T004 carry the proof.
- **DISCOVERY (logged for plan-7 / T013)**: plain `minih status <slug>` on a slug whose ONLY run is a dead-pid active manifest returns **E171 "No runs found"** — pre-existing: the resolver's active-collection filters dead pids (plan 016) and the latest-completed fallback (`findRunSession`) requires completed.json. NOT a verdict lie (it never says active), and deliberately out of scope (resolver asymmetry, T005 note) — but T013's polling-loop migration must tell host agents to target dead runs via `--run <runId>` (they hold it from the `minih run` envelope) or via `runs list` (which now reports `dead`). Candidate follow-up for the plan-7 fix loop.

## T007 — Type widenings (contract sensor: tsc)

- `terminalReason` 1→3 values with preservation-invariant note; `LiveRunStatus` +`'crashed'` (documented as reconcile's healed-terminal state); `AgentProviderStreamAbortedEvent` (`{messageId?, reason}`) + `AgentEvent` union entry, mirroring the `permission_denied` precedent.
- `npx tsc --noEmit` green across all consumers — no existing switch/Record over these unions forced further changes (the status TTY Records are over `StatusVerdict`, untouched).

## T008 — Adapter abort detection (TDD)

- RED first (2 cases), then GREEN 35/35 across test/adapter.
- `sdk-copilot.run()`: tracks the latest in-flight message (`assistant.message_delta` sets `{messageId}`; consolidated `assistant.message` — both the dup-suppressed and normal branches — and `session_idle` clear it). Catch block emits `provider_stream_aborted` **once** (flag-guarded), *before* the generic `session_error`, only when a message was genuinely unsettled — so pre-stream failures (existing session-error tests) emit nothing new.
- **Gotcha**: the trackers must be declared OUTSIDE the `try` (catch reads them), and TS's control-flow analysis narrows a closure-mutated `let` to its initializer inside `catch` → snapshot-cast required (commented in code).
- `FakeAgentAdapter.setQueuedRun(turns, {suppressFinalIdle})` — earlier turns keep auto-idle; the final turn's idle is suppressible so abort scenarios (which never settle) are simulatable. Default behavior unchanged.

## T009 — Runner mapping (TDD)

- RED (mapping case), then GREEN 12/12. The NDJSON half was already free — `handleEvent` persists every event verbatim (:987); the new `provider_stream_aborted` case just flags `streamAborted`.
- Post-run block (mirrors the :1206 denial precedent): `updateManifest(runDir, {status:'failed', terminalReason:'provider-stream-aborted'})` via the atomic writer, **gated on `!denialState.terminalFired`** — the permission-denial diagnosis is more specific and must not be overwritten (the preservation invariant applied to the runner side too). Clean-settle twin test pins terminalReason stays unset.

## T010 — Reconcile core (TDD)

- `listAgentSlugs`/`listRunDirs` exported from run-inventory (were private — validator catch). NEW `src/runner/reconcile.ts`: `reconcileRuns({agentsDir, slug?, runId?, isProcessAlive?})` → `ReconcileReport {scanned, healed[], skipped{terminal,alive,noPid,torn}}`. Heal = `updateManifest` (atomic) with `status:'crashed'` + `terminalReason:'pid-vanished'` only when unset. Probe runs immediately before the write (minimal TOCTOU). Core is lock-free by design — locking composes in at the CLI shell (T011/T012). Exported via runner/index.ts.
- 8 healer tests incl. case b2 (existing `provider-stream-aborted` survives heal), idempotence, throwing-probe proof for completed runs, no-pid skip (no proof of death → no heal), slug/runId scoping, field preservation.
- **Decisions beyond the letter of the plan** (inventory mapping of 'crashed' was unpinned): (1) `computeStatusVerdict` returns `'dead'` for healed manifests WITHOUT re-probing — a recycled pid must not flip a crashed run back to alive; (2) inventory `computeLiveness` maps `'crashed'` → `'dead'` (vocabulary stays unified) but healed rows DROP OUT of `runs list --active` — the heal is what removes a run from the attention queue (filter keys on `manifestStatus !== 'crashed'`). Both for run-liveness.md (T013).
- GREEN: 43/43 (reconcile + status matrix incl. healed case + inventory); tsc clean.

## T011 — Reconcile lock

- NEW `src/runner/reconcile-lock.ts` mirroring `run-lock.ts`: `'wx'` first-write-wins on `<agentsDir>/.reconcile.lock` (agents-dir scoped — reconcile is a cross-slug pass, unlike the per-slug run lock); `acquireReconcileLock`/`withReconcileLock`/`reconcileLockPath` + `ReconcileLockHeldError` (code RECONCILE_LOCK_HELD).
- Steal paths: age (`staleAfterMs`) AND dead owner — the recorded pid failing the T001 probe is definitive (holder can't release), stolen regardless of age. Torn lock file → conservative hold (mirrors run-lock).
- GREEN: 6/6 (contention, age steal, dead-owner steal, live-owner hold, idempotent release + ownership respect, withReconcileLock release-on-throw); tsc clean.

## T012 — CLI `minih reconcile`

- NEW `src/cli/commands/reconcile.ts` (registered after `status` in index.ts): `minih reconcile [slug] [--run <id>] [--all]`; no slug + no `--all` → E108 (the cross-agent pass is a deliberate opt-in); `--run` without slug → E108. Lock wraps the core (`withReconcileLock`, staleAfterMs 10 min + dead-owner steal); contention → **E190 RECONCILE_IN_PROGRESS** (new code registered in output.ts incl. header table). Envelope: `{filters, scanned, healed[], healedCount, skipped}`. TTY: `☠ slug/runId pid N gone → crashed` rows.
- `withReconcileLock`/`ReconcileLockHeldError`/`RECONCILE_LOCK_HELD` + lock types exported via runner/index.ts (cli imports only the public runner surface).
- GREEN: 4/4 subprocess (heal→flip→idempotent re-run, --all across slugs, E190 with live-owner lock fixture, E108 no-args) after rebuild.

## Checkpoint — full gate

- `just check` after T012: **1253 passed / 0 failed** across 115 files — no regressions in any consuming surface (view/attach/resume/connect/doctor).

## T013 — Docs migration (breaking change)

- CHANGELOG: new top block "Plan 025 — dead-pid liveness" with ⚠ BREAKING CHANGES + the before/after jq snippet (`case … completed|failed|dead) break`).
- AGENTS_README.md: verdict list gains **dead** (+ envelope fields note); machine-readable snippet gains the dead arm + reconcile pointer; breaking-change callout; polling loop rewritten to `case`-with-dead + heal guidance + the **poll-by-runId tip** (covers the pre-existing E171 resolver gap found in T006). Rebuilt → dist/AGENTS_README.md re-bundled (copy-schemas.js:43).
- AGENTS.md: load-bearing-filter note (:118) extended with dead/reconcile + run-liveness.md link. Companion outside.md: dead note added — **first attempt blew doctor's 8192-byte outside.md hard cap (8284 → `outside.md-size fail`, broke coordination-loop-validator's doctor test)**; trimmed to a 64-char note → 8181 bytes. The file was already at 98.9% of budget pre-plan — flagged for plan-7 (needs a diet).
- README: runs-list prose gains dead; NEW `### minih reconcile [slug]` section. NEW `docs/how/run-liveness.md`: full vocabulary table, decision order, probe error spec, healing, migration (incl. E171 targeting note), peer-activity `'dead'` disambiguation, deliberate resolver mtime-only asymmetry.

## T014 — Vocabulary guard

- NEW `test/cli/docs-vocabulary.test.ts` (precedent: doctor-state-vocabulary): 7 guards — AGENTS_README dead+polling-arm+breaking-callout, AGENTS.md filter note, companion outside.md (incl. ≤8192-byte budget guard so the next editor hits a test, not doctor), CHANGELOG snippet+E190, run-liveness.md disambiguation+asymmetry, README reconcile section, and **dist/AGENTS_README.md byte-equality** (stale-bundle guard). 7/7 green.

## T015 — Domain currency

- History rows appended to cli/runner/adapter domain.md (house 2-column format, full detail). Composition updates: cli gains `reconcile.ts` row + status.ts purpose now names the exported verdict seam; adapter `events.ts` row corrected to "13 types incl. permission_denied, provider_stream_aborted"; runner's new `reconcile.ts` (contract) / `reconcile-lock.ts` (internal) named in its History row.

## T016 — Harness phase-end seam

- Fired `--event phase-end --plan-dir docs/plans/025-dead-pid-liveness` → buffer non-empty (3 entries) → **drain** (router rule: drain before harvest). Captured via `harness observe`: DL-001 (boot lint vs hand-cranked the-flow.json), SUGG-001 (outside.md near-cap warning band), INS-001 (Record<union,T> exhaustiveness idiom). Materialized with default `[a]` into `.harness/records/retro/2026-06-11/002-025-dead-pid-liveness.md`; buffer cleared (3 cleared, 0 malformed).

## Phase complete — Implementation (T000–T016)

- **All 17 tasks [x]; all 13 ACs checked with named proof artifacts.** Final gate: `just fft` green — lint/format/build/typecheck pass, **1260 tests passed / 0 failed** (116 files; 7 new test files, ~60 new cases), audit + sdk-check show only the pre-existing boot caveats (1 critical / 1 high npm advisories; SDK 1.0.1 available).
- Shipped: FX009 (status probes pids → verdict `dead` + diagnostics, exported verdict seam, Record TTY arms), FX012 (`provider_stream_aborted` adapter event → runner `terminalReason` mapping, fake abort seam), FX011 (`minih reconcile` + reconcile core/lock, E190), vocabulary unify (`RunLiveness`/`runs list`), breaking-change docs migration (CHANGELOG jq snippet, AGENTS_README/AGENTS.md/companion/README/run-liveness.md) + vocabulary guard test, domain currency.
- Not committed — awaiting user instruction. Suggested commit message in the phase report.

## Review fix pass (post stage-7 APPROVE, 2026-06-11)

Review (`reviews/review.md`) returned APPROVE — 4 MEDIUM + 2 LOW findings, no fix-tasks file. User accepted a fix pass; all code/doc findings addressed TDD red→green:

- **F001** (`src/cli/commands/reconcile.ts`): `--all` + slug/`--run` now rejected with E108 ("--all reconciles every agent; do not combine…"); `--all` help text updated; README flag row + CHANGELOG line escort the contract. Red test first: `reconcile-command.test.ts` new case asserts both combos fail AND the seeded manifest stays untouched (no sneaky scoped pass).
- **F002** (`src/runner/reconcile-lock.ts`): steal window hardened — competitor's unlink (ENOENT) tolerated; competitor's completed steal (EEXIST on our rewrite) translated to `ReconcileLockHeldError` so the CLI's E190 surface holds. `isAlreadyExists` generalized to `hasErrorCode(error, code)`. Two new tests: unlink-race in `reconcile-lock.test.ts` (**no mocks** — the injected `isProcessAlive` probe fires exactly between the stealability read and the unlink, so its side effect simulates the competitor; D8) and write-race in NEW `reconcile-lock-race.test.ts` (`vi.mock('node:fs')` with passthrough default, isolated in its own file; asserts the competitor's lock survives intact).
- **F003** (AC-10 evidence): NEW `test/cli/status-tty-render.test.ts` — a wrapper FILE forces `process.stderr.isTTY = true` then imports the built CLI, so the real TTY branch renders into the captured pipe. Gotcha (D7): the first attempt used `node -e`, but **commander v13 detects the eval context via `process.execArgv` and slices argv differently**, parsing the CLI path as an unknown command — hence the wrapper file. Covers both routes into the dead arm: unhealed dead-pid (probe) and healed `crashed` with a LIVE pid (proves no-re-probe holds in the human path). AC-10 evidence line corrected: the `status` envelope deliberately has no `manifestStatus`; the crashed-vs-unhealed machine surface is `runs`.
- **F004/F005** (docs): runner `domain.md` — Composition rows for `reconcile.ts`/`reconcile-lock.ts` (lock reclassified internal→**contract**), Contracts rows (`reconcileRuns`/lock symbols/probe), Concepts rows (dead-pid liveness, reconcile healing); 025 History row corrected. `domain-map.md` — cli→runner edge + prose name the reconcile/probe contracts. Plan Domain Manifest row updated to match.
- **F006**: deferred to commit time — plan-022 close-out artifacts go in their own commit.

Evidence: 4 targeted test files 15/15 green post-fix (red confirmed pre-fix for F001/F002); full `just fft` re-run below.
