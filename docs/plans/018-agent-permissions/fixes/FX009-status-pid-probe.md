# FX009 — `minih status` pid-liveness probe

**Created**: 2026-05-04
**Status**: PROPOSED (post-R6 — implements today, ships behind FX009 dossier review)
**Plan**: 018-agent-permissions
**Source**: GitHub issue [#24](https://github.com/AI-Substrate/minih/issues/24) ("`minih status` reports `verdict: active` for a dead pid (config-only liveness check)") — converged with Chainglass agent 2026-05-04.
**Domain(s)**: cli (status command), runner (re-export `isProcessAliveDefault`)

---

## Problem

`minih status <slug>` reports `verdict: 'active'` for runs whose underlying CLI process has died because the liveness check uses an `events.ndjson` mtime heuristic (`STALE_THRESHOLD_MS = 60_000` at `src/cli/commands/status.ts:191`) instead of pid-probing the recorded `pid`. Operators who follow the documented Power-On-Mode pattern (`AGENTS_README.md`) — `minih status … | jq -r '.data | select(.verdict == "active") | .runId'` — get false-positive results during the 60-second mtime window for runs that died at boot.

Concrete repro from Chainglass (issue #24 commenter id 4368838748):

| Event | Timestamp |
|---|---|
| Companion booted (`run.json.updatedAt` frozen) | `05:57:08Z` |
| Stream truncated mid-token | `05:57:10Z` |
| Briefing sent into the void | `05:57:54Z` |
| Manual diagnosis: pid actually dead | `06:12:21Z` |

**~14 m 27 s** between sending the briefing and detecting nobody was home. The orchestrator selected a dead `runId`, sent a briefing, and proceeded to "work the phase" while the companion never reviewed anything.

The infrastructure to do this right already exists. FX009 (the prior FX, plan-016 era) added pid-probing for `attach` / `view` via `src/runner/run-resolver.ts:239` which uses `isProcessAliveDefault` (exported from `src/runner/run-eligibility.ts:37`). `status.ts` was missed.

## Proposed Fix

Lift `isProcessAliveDefault` into `src/cli/commands/status.ts`. After reading `run.json`, if `run.json.status === 'active'` AND `run.json.pid` is set AND `!fs.existsSync(completedPath)`, gate `verdict: 'active'` on `isProcessAliveDefault(pid)`. Dead pid → emit `verdict: 'dead'` with diagnostic fields (`exitDetectedAt`, `pidProbed: pid`).

**Read-only.** `status` does NOT mutate `run.json` — that's FX011 `minih reconcile` territory. Read commands stay pure; healing is opt-in via a separate command. Per Chainglass's preference (issue #24 commenter id 4368838748): "What would have helped me most in this exact run: an immediate `verdict: 'dead'` on the very next `minih status` after the truncation. ... The file healing was never on the critical path."

## Scope

### CLI surface (no breaking change)

```bash
minih status <slug> [--run <runId>] [--turns N]
```

JSON envelope adds new `verdict` value `'dead'` and these new diagnostic fields. **Field gating** (per AC-FX9.6):

- `pid` (top-level) — present whenever `run.json` has it, regardless of verdict (existing behavior).
- `pidProbed: true`, `pidAliveAfterProbe: false`, `exitDetectedAt`, `terminalReason` — added ONLY when `verdict === 'dead'`.

Sample envelope for verdict='dead':

```json
{
  "verdict": "dead",
  "runId": "2026-05-04T15-57-06-931Z-0a24",
  "pid": 55547,
  "pidProbed": true,
  "pidAliveAfterProbe": false,
  "exitDetectedAt": "2026-05-04T06:12:21Z",
  "terminalReason": "provider-stream-aborted",
  "elapsedMs": 905345,
  "events": 7,
  "toolCalls": 0
}
```

`terminalReason` passthrough — when `run.json.terminalReason` is set (e.g. by FX012's `provider_stream_aborted` event consumer or FX011's reconcile heal), `status` reads it from `run.json` and surfaces it in the envelope. This enables the cross-FX diagnostic pattern: `verdict: 'dead'` + `terminalReason: 'provider-stream-aborted'` distinguishes stream-truncation deaths from permission-deaths from clean crashes (see AC-FX9.9).

Verdict union becomes: `'active' | 'stale' | 'completed' | 'failed' | 'dead' | 'unknown'`.

### TTY display

`'dead'` renders with `chalk.red` and the `✗` icon (same as `'failed'`) plus a one-line hint pinned to **a constant string** (no runtime probing of `minih reconcile`):

```
Process pid <pid> has exited. Run `minih reconcile <slug>` to update run.json.
```

Hint text is a constant. If FX011 hasn't shipped yet when an operator runs `minih reconcile`, the command-not-found error message points back at the ship roadmap. **Drop the runtime `minih reconcile --help` exit-code probe** — too complex, latency-prone, and produces ambiguous failure modes (ENOENT vs help-text mismatch). The constant string is correct as a forward-going commitment; FX011 lands the command itself.

### Resolution semantics

The new check runs in this order (extending the existing if/else chain at `status.ts:175-194`):

```ts
if (fs.existsSync(completedPath)) {
  // existing: completed | failed
} else if (
  runJson?.status === 'active' &&
  runJson?.pid != null &&
  runJson.pid > 0 &&         // guard pid <= 0 (process.kill(0, 0) signals own group; negative pids signal whole group)
  !isProcessAlive(runJson.pid)
) {
  // NEW: dead
  verdict = 'dead';
  pidProbed = true;
  pidAliveAfterProbe = false;
  exitDetectedAt = new Date().toISOString();
  terminalReason = runJson.terminalReason;  // passthrough — undefined if not set
} else if (fs.existsSync(eventsPath)) {
  // existing: active | stale (mtime heuristic)
} else {
  // existing: unknown
}
```

Pid probe ONLY happens for runs where `run.json.status === 'active'` AND `pid > 0`. A `completed` run with a freed pid is normal and must continue to render `'completed'`. A run with `pid: 0`, `pid: null`, or negative pid falls through to the mtime heuristic (cannot probe a non-specific pid).

**`isProcessAliveDefault` error-handling spec** (apply at `src/runner/run-eligibility.ts:37` AND verify it handles each):
- `ESRCH` (no such process) → return `false` (probe says dead)
- `EPERM` (permission denied — e.g. cross-user pid) → return `true` (conservative — assume alive)
- `EINVAL` (invalid signal target — e.g. negative pid that escaped the guard) → return `false`
- Any other thrown error → propagate (bubble to caller; status falls through to unknown)

### Backward compat

Orchestrators that filter on `verdict == 'active'` will see DEAD runs flip to `'dead'` instead of staying `'active'` for 60 s — that's the intended behaviour change. Filters that explicitly check `verdict == 'dead'` work as expected.

Orchestrators that filter on `verdict in ('active', 'stale')` (less common) lose the 60-second inclusion of dead-pid-runs; they'd need to add `'dead'` to the inclusion set if they want the legacy behaviour. Document in CHANGELOG: "After FX009, `verdict: 'dead'` is reported for runs whose pid has exited. The 60 s `'active'` window for dead processes is removed."

### Why pid-probing is safe here

`process.kill(pid, 0)` returns `true` for any process the user can signal — including processes belonging to OTHER users on the system. False positives ("pid is alive but not OUR pid") are theoretically possible if the OS recycles pid numbers fast enough during the run. In practice:

- `run.json.pid` is captured at run boot (`runner.ts` records `process.pid` of the spawning shell). On Linux/macOS the kernel does not recycle pids until at least the configured `pid_max` (32k+ on most distros, 4M on modern Linux); on macOS the recycling cycle is process-group-dependent.
- A genuine recycle case (`run.json.pid` reassigned to another live process) would mis-report `'active'` rather than `'dead'`. That's a degraded-but-safe failure — operators see the same false-positive they have today, no worse.
- The probe is ONLY consulted when `run.json.status === 'active'` AND no `completedPath` exists. Once the run completes cleanly, this code path is bypassed.

This is the same trade-off `attach` and `view` already accept post-FX009-prior; we're consistent across the surface.

## Domain Impact

| Domain | Relationship | What Changes |
|--------|-------------|-------------|
| `cli/commands/status` | adds pid probe | `status.ts` imports `isProcessAliveDefault` and adds the new clause to the verdict resolution chain |
| `runner` | unchanged surface | `isProcessAliveDefault` already exported from `src/runner/index.ts:190` (FX009-prior) — no new export work needed |

**Import direction unchanged**: cli → runner.

**Domain contract change**: NONE on the export surface. The `verdict` union widens (`'dead'` added) — that's a wire-format additive change, documented in CHANGELOG.

## Tasks

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|--------|-----|------|--------|---------|-----------|-------|
| [ ] | FX009-1 | Import `isProcessAliveDefault` into `status.ts` and add new resolution clause. | cli | `src/cli/commands/status.ts` | New `else if` clause runs between `completedPath` and `eventsPath` checks; only fires when `runJson.status === 'active' && runJson.pid` is set; sets `verdict = 'dead'` + diagnostic fields | Reuse the existing import from `src/runner/index.ts:190`; no new exports |
| [ ] | FX009-2 | Inject `isProcessAlive` for testability. | cli | `src/cli/commands/status.ts` | Status accepts an optional `isProcessAlive` injection (test-only override); production path uses `isProcessAliveDefault`; matches the pattern in `run-resolver.ts:62` and `run-eligibility.ts:33` | Pure function injection; no globals |
| [ ] | FX009-3 | Render `'dead'` in TTY display + JSON envelope. | cli | `src/cli/commands/status.ts` | Red `✗` icon for `'dead'`; hint string is the **constant** `"Process pid <pid> has exited. Run \`minih reconcile <slug>\` to update run.json."`; JSON envelope has `pidProbed`, `pidAliveAfterProbe`, `exitDetectedAt`, `terminalReason` fields ONLY when verdict='dead' (gated; when verdict='active' these fields are absent — verified by FX009-4 case (a) negative assertion); `terminalReason` is read passthrough from `run.json.terminalReason` (undefined if not set, omitted from envelope) | No runtime probing of `minih reconcile` — drop the conditional logic; constant string is the forward-going commitment |
| [ ] | FX009-4 | Unit tests — 7 cases. | cli-tests | `test/cli/status-pid-probe.test.ts` (new) | (a) active + pid alive → `verdict: 'active'` AND envelope does NOT contain `pidProbed`/`pidAliveAfterProbe`/`exitDetectedAt`/`terminalReason`; (b) active + pid dead → `verdict: 'dead'`, all four diagnostic fields populated, `terminalReason` matches `run.json.terminalReason` if set or is absent if unset; (c) completed → `verdict: 'completed'` (probe NOT consulted); (d) active + no pid in run.json → falls through to mtime heuristic; (e) active + pid dead + injected probe always-true → `verdict: 'active'` (proves injection works); **(f) active + pid = 0 → falls through to mtime heuristic (probe NOT called); (g) active + pid < 0 → falls through to mtime heuristic; (h) active + pid where probe throws EPERM → verdict 'active' (conservative); (i) active + pid where probe throws EINVAL → verdict 'dead'** | Mirror `test/runner/run-resolver.test.ts` injection pattern; (f)-(i) close pid edge-case gaps |
| [ ] | FX009-5 | CHANGELOG entry + permissions.md note. | docs | `CHANGELOG.md`, `docs/how/permissions.md` (status section if exists; otherwise add cross-link in companion-mode.md § Polling) | CHANGELOG: "Added: `minih status` returns `verdict: 'dead'` for runs whose pid has exited. Removed: 60 s `'active'` window for dead-pid runs."; companion-mode.md polling section warns operators that `verdict: 'dead'` is now possible mid-run if the SDK subprocess truncates | Cross-reference issue #24 |

## Workshops Consumed

- None directly. References FX009-prior (plan-016 era — `run-resolver.ts:109` "FX009 — surface stale-active-skipped diagnostics to attach/view") which established the pid-probe pattern; this dossier extends to `status`.

## Acceptance

- **AC-FX9.1** (dead-pid detection): `minih status <slug>` returns `verdict: 'dead'` within ONE call after the run's pid has exited (no 60-second window). Demonstrated by FX009-4 case (b).
- **AC-FX9.2** (read-only): `run.json` is NOT modified by `status`. Verified by checksum-before/checksum-after assertion in FX009-4 case (b).
- **AC-FX9.3** (no false negatives on completed runs): completed runs continue to render `verdict: 'completed'` regardless of pid state. Demonstrated by FX009-4 case (c).
- **AC-FX9.4** (no false positives on missing pid): runs whose `run.json` has no `pid` field, or `pid: 0`, or negative pid fall through to the existing mtime heuristic. Demonstrated by FX009-4 cases (d), (f), (g).
- **AC-FX9.5** (injection works): test injection of `isProcessAlive` overrides the default probe — proves no hidden globals. Demonstrated by FX009-4 case (e).
- **AC-FX9.6** (JSON envelope shape): the JSON envelope includes `pidProbed`, `pidAliveAfterProbe`, `exitDetectedAt`, `terminalReason` ONLY when verdict is `'dead'`. `pid` is present whenever `run.json` has it, regardless of verdict. Other verdicts MUST NOT include the four `'dead'`-gated fields (negative assertion in FX009-4 case (a)).
- **AC-FX9.7** (TTY display): `'dead'` renders with red `✗` icon + the constant hint string `Process pid <pid> has exited. Run \`minih reconcile <slug>\` to update run.json.` (no runtime probing).
- **AC-FX9.8** (CHANGELOG): user-facing breaking change documented with rationale and orchestrator migration note.
- **AC-FX9.9** (terminalReason passthrough): when `run.json.terminalReason` is set (e.g. by FX012's adapter-side event consumer or FX011's reconcile heal), the value is surfaced in the JSON envelope under the `terminalReason` key. Enables cross-FX diagnostic pattern `verdict='dead' AND terminalReason='provider-stream-aborted'`. Demonstrated by FX009-4 case (b) when fixture's run.json includes a terminalReason.
- **AC-FX9.10** (pid probe error handling): `isProcessAliveDefault` returns false for ESRCH, true for EPERM (conservative), false for EINVAL; other errors propagate. Demonstrated by FX009-4 cases (h) and (i).

## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Orchestrators that filter `verdict in ('active', 'stale')` lose the 60-s dead-pid inclusion. | Low — uncommon filter. | Document in CHANGELOG; provide a one-line jq snippet showing how to opt back in (`select(.verdict == "active" or .verdict == "dead")`). |
| Pid recycling false-positive (recycled pid belongs to another live process). | Very low on modern OSes. | Same trade-off `attach`/`view` already accept; documented as the lesser failure mode (false `'active'` on dead run vs false `'dead'` on live run). |
| `process.kill(pid, 0)` requires permission to signal the target pid. If `run.json.pid` belongs to a different user (cross-user run dirs), the probe throws `EPERM` and we'd mis-report. | Low — minih runs default to single-user run dirs; cross-user is exotic. | `isProcessAliveDefault` already swallows EPERM and returns `true` (assumes "exists, just can't signal"). Verify in test FX009-4 case (f) — if EPERM bubbles, file as a fix on `run-eligibility.ts`. |
| FX011 (`minih reconcile`) not yet shipped when FX009 lands. | Medium — they're sister fixes filed together. | TTY hint conditionally links — if `minih reconcile` is unrecognised, say "coming soon" instead of misleading. Both fixes can ship in either order. |

## Out of scope

- **Healing `run.json.status` when pid is dead.** Read-only `status` per Chainglass agent's preference. Healing is FX011 `minih reconcile`.
- **Probing concurrent-status-call races.** `status` is read-only so concurrent invocations don't race. (FX011 has the writer-race concern.)
- **Synthetic events for dead-at-boot streams.** Different observability gap (FX012 `provider_stream_aborted`).
- **Cross-host pid probing.** Local-pid only; runs on remote hosts are out of scope (no current code path supports this anyway).

## Testing approach

- **Unit tests** (FX009-4): `status-pid-probe.test.ts` — 5 cases as enumerated; uses temp run dirs + injected `isProcessAlive`.
- **Snapshot test**: TTY display for `'dead'` verdict — capture rendered string, snapshot-match.
- **No SDK / adapter tests needed** — pid probe is a pure side-effect-free OS call (well, `process.kill(pid, 0)` is, in test it's a function injection).

## Discoveries & Learnings

_Populated during implementation by plan-6._

| Date | Task | Type | Discovery | Resolution |
|------|------|------|-----------|------------|

---

## Validation Record (2026-05-04)

| Agent | Lenses Covered | Issues | Verdict |
|-------|---------------|--------|---------|
| Source-Truth (Sonnet 4.6) | Factual Accuracy, Hidden Assumptions, Concept Documentation | 0 CRIT, 0 HIGH (FX009-specific), 0 MED, 0 LOW | ✅ |
| Cross-Reference (Sonnet 4.6) | Integration & Ripple, Hidden Assumptions | 0 CRIT, 1 HIGH (terminalReason passthrough — fixed inline) | ⚠️ → ✅ |
| Completeness (Sonnet 4.6) | Edge Cases, Technical Constraints, UX, Hidden Assumptions | 0 CRIT, 3 HIGH (pid <= 0 guard, EINVAL handling, runtime probe complexity), 1 MED (envelope field boundary) — all fixed inline | ⚠️ → ✅ |
| Forward-Compatibility (Opus 4.7) | Forward-Compatibility, Technical Constraints | 0 CRIT, 0 HIGH (FX009-specific), 0 MED, 1 LOW (hint runtime-probe vs constant — fixed) | ✅ |

### Forward-Compatibility Matrix

| Consumer | Requirement | Failure Mode | Verdict | Evidence |
|----------|-------------|--------------|---------|----------|
| plan-6 FX009 implementer | clear file paths + testable AC + injectable mock points | encapsulation-lockout | ✅ | `isProcessAliveDefault` re-export from runner/index.ts:190; FX009-2 makes probe injectable; 9 testable ACs |
| plan-6 FX011 implementer | FX009 hint string is constant (FX011 lands actual command) | shape-mismatch | ✅ | FX009-3 commits to constant `"Process pid <pid> has exited. Run \`minih reconcile <slug>\`..."` — no runtime probe |
| FX012 cross-FX integration | terminalReason surfaced in dead-verdict envelope | shape-mismatch | ✅ | AC-FX9.9 + FX009-3 task — passthrough from `run.json.terminalReason` |
| Issue #24 thread — read-only status | locked decision preserved | contract-drift | ✅ | AC-FX9.2 + checksum assertion |
| Issue #24 thread — minih reconcile separate | command name preserved | contract-drift | ✅ | FX011 standalone; FX009-3 hint links to it |

**Outcome alignment**: FX009 advances *"Safety-by-default for agents; trust ladder for installed packs; credible answer to 'what can this agent do to my machine?'"* by collapsing the 14-minute liveness lie into a single-call truthful answer — the credible "is this agent still alive" question now has an unambiguous instant answer that compounds with FX011/FX012 to give operators a complete diagnostic surface (verdict + terminalReason).

**Standalone?**: No — multiple downstream consumers named with concrete needs.

### Fixes applied (HIGH)
- XR-1 fixed: terminalReason passthrough into dead-verdict envelope (AC-FX9.6 + AC-FX9.9 + FX009-3 task)
- COMPL-1 fixed: pid <= 0 guard in resolution semantics; FX009-4 cases (f), (g) anchor
- COMPL-2 fixed: EINVAL/EPERM/ESRCH handling spec for `isProcessAliveDefault`; AC-FX9.10 + FX009-4 cases (h), (i)
- COMPL-3 fixed: runtime probe dropped — FX009-3 commits to constant hint string; AC-FX9.7 anchors
- COMPL-4 (MED) fixed: AC-FX9.6 enumerates each gated field explicitly; FX009-4 case (a) negative assertion

Overall: ⚠️ **VALIDATED WITH FIXES** — 4 HIGH + 1 MED resolved inline; ready for `/plan-6-v2-implement-phase --fix FX009`.
