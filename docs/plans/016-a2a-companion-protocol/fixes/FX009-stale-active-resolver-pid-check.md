# Fix FX009: `resolveLatestActive` — PID liveness check on stale-active manifests

**Created**: 2026-05-03
**Status**: Proposed
**Plan**: [Companion Experience](../companion-experience-plan.md)
**Source**: Live demo of FX008 — `minih attach demo-companion` returned E170 because a 2-day-old run with `manifest.status: "active"` and `pid: 38376` (long dead) was counted as a live candidate alongside the new run.
**Domain(s)**: `runner` (primary — `src/runner/run-resolver.ts`)

---

## Problem

`resolveLatestActive` (`src/runner/run-resolver.ts:140`) trusts `manifest.status` blindly:

```ts
if (ACTIVE_STATUSES.has(manifest.status)) {
  active.push({ runId: c.runId, runDir: c.runDir, manifest });
}
```

It never checks whether `manifest.pid` is still alive. If a `minih run` process crashes, gets `kill -9`'d, or exits without flipping the manifest to `completed`/`failed`/`stale`, the stale `run.json` keeps claiming `status: "active"` forever — and every subsequent `minih view` / `minih attach` (no `--run`) treats it as a live candidate.

**Asymmetry today**:

| Caller | Path | PID check? | Result on stale manifest |
|---|---|---|---|
| `minih status --run <id>` | `runner/run-eligibility.ts:117-119` (`detectRunState`) | ✅ Yes — `isAlive(pid)` | Correctly returns `stale` |
| `minih attach <slug>` | `runner/run-resolver.ts:140` (`resolveLatestActive`) | ❌ No — only `manifest.status` | Counted as active → E170 if a real active run also exists |
| `minih view <slug>` | Same resolver | ❌ No | Same bug |

`detectRunState` already implements the PID-liveness predicate. The resolver just doesn't reuse it. Filed previously as MW11 in the parent plan — this is the load-bearing fix and supersedes the magicWand entry.

**Reproduction**:

```bash
$ minih status demo-companion --run 2026-05-01T11-18-23-346Z-04bc 2>&1 | jq -r '.data.verdict'
stale          # status agrees: dead

$ minih attach demo-companion
{"command":"attach","status":"error","error":{"code":"E170","message":"Multiple active runs found...
$ # ↑ resolver disagrees: counts the dead run as a live candidate
```

## Proposed Fix

In `resolveLatestActive`, before pushing a candidate into `active[]`, check `isProcessAliveDefault(manifest.pid)`. If the manifest claims active but the PID is dead → record a diagnostic and skip the candidate. Both `view` and `attach` benefit instantly. No contract change — `resolveLatestActive` already returns `null | ResolvedRun | throws MultipleActiveRunsError`; this just makes the "active" filter accurate.

`isProcessAliveDefault` is already exported from `runner/index.ts:106` and used by `resume.ts`. Direct import — no boundary issues.

## Domain Impact

| Domain | Relationship | What Changes |
|--------|-------------|-------------|
| `runner` | Primary | `resolveLatestActive` filter gains PID-liveness check; `ResolverDiagnostic` may include a "stale-active" entry when a candidate is skipped |

**Risk**: low. Same predicate already running in `detectRunState` for over a year of releases. The ONLY behaviour change: stale manifests with dead PIDs are no longer counted as active. Exactly what we want.

## Tasks

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|--------|-----|------|--------|---------|-----------|-------|
| [x] | FX009-1 | Add an `isProcessAlive?: (pid: number) => boolean` injection point to `ResolveRunInput` in `src/runner/run-resolver.ts:43-52`. Default to `isProcessAliveDefault` (already exported from `./run-eligibility.js`). Matches the existing `now`/`staleThresholdMs`/`agentsDir` injection pattern — purely additive, no caller breakage. | runner | `src/runner/run-resolver.ts` | Type checks; no caller in `src/cli/commands/{attach,view,run,resume}.ts` needs to change | Mirror the existing `now?: () => number` pattern; resolves the FX009 test brittleness (validator M1). |
| [x] | FX009-2 | Add PID-liveness filter inside `resolveLatestActive` (`src/runner/run-resolver.ts:140`). After the `ACTIVE_STATUSES.has(manifest.status)` check passes, also require `manifest.pid != null && isProcessAlive(manifest.pid)` (using the resolved injection from FX009-1, defaulting to `isProcessAliveDefault`). When the PID-check fails, push a `ResolverDiagnostic` (`{ runId, message: 'manifest.status="${manifest.status}" but pid ${pid} is dead — treating as stale' }`) and `continue` instead of pushing onto `active`. | runner | `src/runner/run-resolver.ts` | Stale runs (manifest active + dead PID) no longer appear in `active[]`; reproduction case (`minih attach demo-companion` with a stale `2026-05-01...` run alongside a live one) returns the live run, not E170 | `ResolverDiagnostic` already accepts a freeform `message: string` (verified by Source-Truth validator). |
| [x] | FX009-3 | Regression test in `test/runner/run-resolver.test.ts`: synthesise an agent fixture with TWO runs — one with `status: "active"` and a fake-dead PID, one with `status: "active"` and a fake-live PID. Use the `isProcessAlive` injection from FX009-1 (NOT a real PID — eliminates platform brittleness flagged by validator M1). Assert `resolveLatestActive` returns the live run AND records a diagnostic for the skipped one. | runner (test) | `test/runner/run-resolver.test.ts` | New regression test passes; existing run-resolver tests still pass | Inject `isProcessAlive: (pid) => pid === FAKE_LIVE_PID` so the test is deterministic and portable. |
| [x] | FX009-4 | Surface resolver diagnostics in `attach.ts` and `view.ts`. After `resolveRun(...)` succeeds, if `resolved.diagnostics.length > 0`, write each diagnostic to stderr as a single dimmed line (e.g. `[skipped run <runId>: <message>]`) BEFORE mounting the TUI. Operators see why other runs were skipped — addresses validator M2 (diagnostics dropped at CLI boundary). | cli | `src/cli/commands/attach.ts`, `src/cli/commands/view.ts` | Stale-active runs are skipped silently in the resolver but visible in the CLI's stderr line so operators learn about the skip without being blocked by it | Use `process.stderr.write` directly; do NOT use the JSON envelope (it's not an error). Single-line per diagnostic. |
| [x] | FX009-5 | Update parent plan: in `companion-experience-plan.md` § Deferred follow-ups, mark MW11 as RESOLVED by FX009 with a one-line cross-link. Append an entry to FX008's "Open follow-ups" log noting the resolver-vs-detector asymmetry was addressed in FX009. | docs | `docs/plans/016-a2a-companion-protocol/companion-experience-plan.md`, `docs/plans/016-a2a-companion-protocol/fixes/FX008-minih-attach-cross-process-tui.log.md` | MW11 reads RESOLVED; FX008 log notes the FX009 cross-link | Trivial. |
| [x] | FX009-6 | Run `just fft`. Resolve any findings. Verify the live-demo reproduction: with the existing stale demo-companion run on disk + the active run from this session, `minih attach demo-companion` mounts cleanly without `--run` AND prints a `[skipped run ...]` line to stderr noting the stale-active filter ran. | verification | n/a | `just fft` clean; `minih attach demo-companion` resolves to the live run + emits the diagnostic | No companion needed for this micro-fix; live demo IS the verification. |

### Critical dependencies

- **FX009-2** depends on **FX009-1** (uses the injected predicate).
- **FX009-3** depends on **FX009-1 + FX009-2** (test asserts new behaviour using injected predicate).
- **FX009-4** depends on **FX009-2** (consumes the new diagnostic).
- **FX009-5** runs after FX009-2 lands.
- **FX009-6** runs last.

## Workshops Consumed

None directly. MW11 in `companion-experience-plan.md § Deferred follow-ups` partially scoped the issue but underestimated it (claimed PID-liveness needed to be added; actually it just needed to be wired up).

## Acceptance

- [ ] `minih attach demo-companion` (or `minih view demo-companion`) with a stale-active run alongside the live one resolves to the live run — no E170.
- [ ] `resolveLatestActive` returns `ResolvedRun | null` (not throws) for the reproduction case.
- [ ] When skipping a stale-active candidate, a `ResolverDiagnostic` row is recorded AND surfaced to stderr by `attach.ts` / `view.ts` so operators can see WHY the run was skipped (forward-friendly debugging — addresses validator M2).
- [ ] Regression test uses the new `isProcessAlive` injection point — no real-PID platform assumptions (addresses validator M1).
- [ ] Existing run-resolver tests still pass + new regression test passes.
- [ ] MW11 marked RESOLVED in parent plan with FX009 cross-link.
- [ ] `just fft` clean.

## Discoveries & Learnings

_Populated during implementation._

| Date | Task | Type | Discovery | Resolution |
|------|------|------|-----------|------------|

---

## Validation Record (2026-05-03)

Three parallel explore agents validated FX009 immediately post-creation. Lens coverage: 9/12 (Source Truth, Hidden Assumptions, Domain Boundaries, Cross-Reference, Completeness, Consistency, Forward-Compatibility, Test Boundary, Shape Mismatch). Forward-Compatibility ENGAGED — 6 named downstream consumers.

| Agent | Lenses Covered | Issues | Verdict |
|-------|---------------|--------|---------|
| Source Truth | Source Truth, Hidden Assumptions, Domain Boundaries | 1 MEDIUM fixed | ⚠️ → ✅ |
| Cross-Reference | Cross-Reference, Completeness, Consistency | 0 | ✅ |
| Forward-Compatibility | Forward-Compatibility, Test Boundary, Shape Mismatch | 2 MEDIUM fixed (one overlaps Source-Truth M1) | ⚠️ → ✅ |

### Forward-Compatibility Matrix

| Consumer | Requirement | Failure Mode | Verdict | Evidence |
|----------|-------------|--------------|---------|----------|
| `src/cli/commands/attach.ts` (FX008-8) | `latest-active` skips stale-active candidates AND operator sees skip reason | Resolver silent skips would hide useful debug info | ✅ (post-fix) | FX009-4 surfaces `resolved.diagnostics` to stderr |
| `src/cli/commands/view.ts` | Same as attach + fallback to completed preserved | Same diagnostics drop pre-fix | ✅ (post-fix) | FX009-4 covers both files |
| `resolveLatestAny` (`run-resolver.ts:76-80`) | Falls through to latest-active then latest-completed; benefits transitively | None — additive filter | ✅ | latest-any flow unchanged |
| `test/runner/run-resolver.test.ts` | Existing tests pass; stale-active regression covered safely | Brittle real-PID assumption was originally proposed | ✅ (post-fix) | FX009-1 adds `isProcessAlive` injection; FX009-3 uses it |
| Future MW11 readers | Parent plan marks MW11 RESOLVED with cross-link | Breadcrumb might be missed | ✅ | FX009-5 explicitly requires the cross-link |
| Operator (OUTCOME consumer) | `minih attach demo-companion` works without `--run` despite old crashed runs | Operator gets the right run AND learns about stale runs | ✅ (post-fix) | FX009-2 fixes the resolver; FX009-4 prints the skip reason |

**Outcome alignment**: *"I will want to be able to drop in, see how things are going, then go away again."* — FX009 advances this outcome end-to-end: the resolver no longer requires the operator to know about stale runs cluttering disk (load-bearing fix in FX009-2), AND the new stale-skip diagnostic is surfaced to stderr (FX009-4) so operators learn about the skip without being blocked by it. "Drop in" UX is real, not theoretical.

**Standalone?**: No — six downstream consumers named with concrete needs.

### Fixes applied inline

- **M1** (Source-Truth + Forward-Compat overlap): brittle real-PID test assumption (`99999999`/`Number.MAX_SAFE_INTEGER`) replaced by injection point. Added `isProcessAlive?: (pid: number) => boolean` to `ResolveRunInput` (matches existing `now`/`staleThresholdMs`/`agentsDir` pattern). FX009-3 uses `isProcessAlive: (pid) => pid === FAKE_LIVE_PID` for deterministic tests.
- **M2** (Forward-Compat): diagnostics dropped at CLI boundary. Added FX009-4 — `attach.ts` and `view.ts` now write `resolved.diagnostics` to stderr as dimmed single-line notes BEFORE mounting the TUI. Operators see the skip reason without it being a blocking error envelope.

**Overall**: ⚠️ VALIDATED WITH FIXES — dossier is ready for implementation.

