# Execution Log — FX009: `resolveLatestActive` PID-liveness check

**Fix**: [FX009 dossier](./FX009-stale-active-resolver-pid-check.md)
**Started**: 2026-05-03

## Pre-flight context

- Reproduction: `minih attach demo-companion` (live demo of FX008) returned E170 because of a stale May 1 run with manifest `{ status: "active", pid: 38376 }`. PID 38376 is dead.
- Domain: `runner` only — `src/runner/run-resolver.ts:140`.
- Test approach: regression test in `test/runner/run-resolver.test.ts` using guaranteed-dead PID (`99999999`) + live PID (`process.pid`).

## Tasks

### FX009-1/2/3/4/5/6 — All landed (DONE 2026-05-03)

Bundled into one execution pass — surgical change with tight typecheck coupling.

**Diff summary**:
- `src/runner/run-resolver.ts`: import `isProcessAliveDefault` from `./run-eligibility.js`. Add optional `isProcessAlive?: (pid: number) => boolean` to `ResolveRunInput` (matches existing `now`/`agentsDir` pattern). Inside `resolveLatestActive`'s candidate loop: after `ACTIVE_STATUSES.has(manifest.status)`, also require `manifest.pid != null && isAlive(manifest.pid)`. On mismatch, push `ResolverDiagnostic({ runId, message: 'manifest.status="<status>" but pid <pid> is dead — treating as stale' })` and `continue`.
- `src/cli/commands/attach.ts`: write `resolved.diagnostics` to stderr as `[skipped run <runId>: <message>]` lines BEFORE mounting the TUI.
- `src/cli/commands/view.ts`: same diagnostics surface.
- `test/runner/run-resolver.test.ts`: 9 pre-existing tests migrated to opt into `isProcessAlive: () => true` (they test other resolver concerns). 3 new FX009 regression tests covering: (a) live-vs-dead-PID resolution returns live + records diagnostic; (b) all-stale-PIDs returns null instead of E170; (c) `pid: null` (freshly-booting) is NOT filtered.
- `companion-experience-plan.md`: MW11 marked RESOLVED with cross-link to FX009.
- `FX008.log.md`: open-follow-ups list gains the resolver-vs-detector-asymmetry resolution note.

**Evidence**:
- `npx tsc --noEmit` — 0 errors.
- `npx vitest run test/runner/run-resolver.test.ts` — 12/12 passed (was 9; +3 FX009 regression).
- `just fft` — 719 passed | 10 skipped, 0 vulns, SDK 0.3.0 latest.
- **Live demo verification (FX009-6)**: with the stale `2026-05-01T11-18-23-346Z-04bc` (status:active, pid:38376 dead) + a fresh `2026-05-03T10-00-30-083Z-eb77` (live), `minih attach demo-companion` (no `--run`):
  - Stderr line one: `[skipped run 2026-05-01T11-18-23-346Z-04bc: manifest.status="active" but pid 38376 is dead — treating as stale]`
  - No E170. Resolver picked the live run.
  - The Ink "raw mode not supported" follow-on error is a non-TTY shell artifact unrelated to FX009.

**Discoveries**:
- `resolveLatestActive` returns `null` when `active.length === 0` WITHOUT carrying forward `diagnostics[]`. So when ALL candidates are stale-active (zero live runs), the operator sees "No active run found" but loses the per-stale-skip detail. Acceptable for v1 — the load-bearing case is "1 live + N stale" and that path surfaces diagnostics correctly. Filed as a future polish if needed.
- Existing test fixtures at `test/runner/run-resolver.test.ts` synthesised manifest PIDs (e.g. small numbers) that were never alive in the test process — they happened to keep working only because nobody had wired the PID check. Migrating them to `isProcessAlive: () => true` makes the intent explicit (these tests cover other concerns; they're not blanket regressions of the new filter).
