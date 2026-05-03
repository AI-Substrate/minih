# Flight Plan: Fix FX009 — `resolveLatestActive` PID-liveness check

**Fix**: [FX009 dossier](./FX009-stale-active-resolver-pid-check.md)
**Status**: Landed

## What → Why

**Problem**: `resolveLatestActive` (run-resolver.ts:140) trusts `manifest.status` blindly. A 2-day-old crashed run with `status: "active"` + dead PID gets counted as a live candidate, breaking `minih attach`/`view` with spurious E170 errors. `detectRunState` (run-eligibility.ts:117-119) already does the right thing — the resolver just doesn't reuse it.

**Fix**: Add `isProcessAliveDefault(manifest.pid)` filter in the resolver's active-pushing loop. When the manifest claims active but the PID is dead, record a `ResolverDiagnostic` and skip. Direct import of the already-exported predicate. ~10 lines of code + 1 regression test.

## Domain Context

| Domain | Relationship | What Changes |
|--------|-------------|-------------|
| `runner` | Primary | `resolveLatestActive` filter; possibly one new `ResolverDiagnostic` shape (already structured for this) |

## Stages

- [x] **Stage 1: Injection point** — Add `isProcessAlive?` to `ResolveRunInput` (matches existing `now`/`agentsDir` injection pattern). (FX009-1)
- [x] **Stage 2: Resolver fix** — Add PID-liveness filter in `resolveLatestActive`; emit `ResolverDiagnostic` on skip. (FX009-2)
- [x] **Stage 3: Regression test** — Two-run fixture using injected predicate (no platform-PID assumptions). (FX009-3)
- [x] **Stage 4: Diagnostics surface** — `attach.ts` + `view.ts` write `resolved.diagnostics` to stderr. (FX009-4)
- [x] **Stage 5: Plan + log updates** — MW11 RESOLVED; FX008 log cross-link. (FX009-5)
- [x] **Stage 6: `just fft` + live demo** — Pipeline clean; reproduction works without `--run`. (FX009-6)

## Acceptance

- [x] Resolver filters out manifest-active-but-PID-dead candidates.
- [x] Reproduction case works: `minih attach demo-companion` with stale + live runs returns the live one.
- [x] MW11 marked RESOLVED.
- [x] `just fft` clean.
- [x] **Companion F001 fix (post-validation)**: diagnostics carried through null/fallback paths via new `resolveRunWithDiagnostics()` helper; `attach.ts` and `view.ts` consume it.
