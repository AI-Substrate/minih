# Execution Log — Phase 1: Run-discovery fail-open (A/B/C)

**Plan**: companion-mode-reliability (028) · **Branch**: `028-companion-mode-reliability` · **Mode**: Full TDD · **Companion**: `code-review-companion`

---

## T000 — Harness pre-flight (pre-implement seam)

- **Seam fired**: `/eng-harness-flow --event pre-implement` → routed to boot validation (`harness boot --json`).
- **Boot verdict**: `status: error` — **but the sole failing sensor is `lint` (`npx biome check .`) and biome is not installed** (doctor's `toolchain` layer flags the same). Substantive sensors: `typecheck` **pass (clean)**, `build+test` (`just check`) **pass (clean)**, `minih-doctor` warn, `audit` warn (1 critical / 5 high).
- **Decision (override logged)**: proceed. The governance doc states "day-one degraded is honest, not broken" and `just check` runs no biome; the real readiness gates (typecheck + build+test) are green, so the TDD baseline is sound. Failure is the documented biome gap, not a real break.
- **Friction captured** (retro): `DL-001` — boot's single overall verdict can't distinguish a missing optional tool (biome) from a real break; `INS-001` — live defect-D sighting (companion runId `2026-06-16T13-50-25-287Z` vs real UTC `03:52` — local-time-as-Z, the exact bug Phase 2 fixes).
- **⚠️ Correction (companion finding F001)**: the T000 diagnosis above was **wrong**. `biome` is missing only from `$PATH` (doctor's "missing tools"); `npx biome check .` runs fine and the lint failure included **real format violations in my own new/edited files** — not a benign "biome absent" state. The correct action was to run the format gate (`just fft` per governance) **before** committing, which I skipped. Fixed at phase end: `npx biome format --write` on the 6 changed files (the-flow.json, run-inventory.ts/.test.ts formatted), re-check clean, suites re-run green. Lesson: run the format gate before each commit.

## Companion boot (C0/C0a)

- **Booted**: `minih run code-review-companion` (background) → `verdict: active`, `runId: 2026-06-16T13-50-25-287Z-8a55`.
- **Briefed**: one `--type briefing` message sent (plan/spec/phase/tasks paths, protocol, hazards F03/F04/F05 + the no-mask-stale guard, domain context). Companion confirmed `listening` (mid-poll).

---

## Tasks

### T001 — Investigate defect C (spike) ✅

**Method**: grepped `selfReportedState`/`currentlyRunningTool`/`runId` co-occurrence across `src/`; read `peer-activity.ts`, `coordination-status.ts`, `history.ts`, `last-run.ts`, `folder.ts` (`resolveAgent`/`listAgents`).

**Findings**:
1. `selfReportedState`/`currentlyRunningTool` appear **only** in `src/runner/peer-activity.ts`, which never references `runId`.
2. No `runId: null` (or `runId:undefined`) co-serialization exists anywhere in `src/`.
3. `coordination-status.ts` (the MCP boot-detection surface) takes `context.runId` as an *input* (`:82`) but its result shape (`agentSlug`, `coordinationMode`, `ledger`, `draftFarewell`, `idleBudgetSec`, `allowedStates`) emits **no** top-level `runId` and **no** peer fields.
4. `resolveAgent(slug, agentsDir)` (`folder.ts:733-739`) is literally `listAgents(agentsDir).find(a => a.slug === slug) ?? null`. `history.ts:32` and `last-run.ts:31` both call it → **they already resolve exactly what `minih list` resolves**. `E121 AGENT_NOT_FOUND` only fires for an agent that is genuinely unlistable (no `prompt.md`, empty `description`, `_`-prefixed, or invalid slug).

**Decision (AC-C fallback, per Finding 05)**: the literal defect-C symptom is **not reproducible against current core** — it is external/older-build. C is satisfied by (a) a **characterization test** locking `history`/`last-run` ↔ `list` resolution consistency (no future divergence), and (b) this documented finding. **No core production edit** for the C symptom. (Note: `history.ts:53` / `last-run.ts:58` sort run dirs by `.name` — that's defect D, owned by Phase 2 task 2.4, not touched here.)

### T002/T003 — Defect A: live-pid fail-open ✅ (commit pending)

**RED**: added a 4-case block to `test/cli/status-verdict.test.ts`. `npx vitest run -t "defect A"` → 3 fail (`expected 'unknown' to be 'active'`/`'stale'`), 1 pass (tie-break guard). The pid probe set the diagnostic fields then fell through to the events.ndjson path, hitting `unknown` at `status.ts:216`.

**GREEN**: in `computeStatusVerdict`, after the pid-alive gate, added an `ACTIVE_STATUSES` fail-open branch keyed on `manifest.updatedAt` freshness (mirrors `run-inventory.ts:204`):
- fresh `updatedAt` (`now()-updated < 60s`) → `active` (defect A, even with no events.ndjson);
- stale `updatedAt` + no events.ndjson → `stale` (was `unknown`);
- stale `updatedAt` + events.ndjson present → fall through to the existing mtime tie-break (so a fresh events log still wins).
Added a local `ACTIVE_STATUSES = {starting, active, completing}` (mirrors the two existing private copies in `run-inventory.ts:16` / `run-resolver.ts:38`; `idle` excluded).
**Result**: `npx vitest run test/cli/status-verdict.test.ts` → **31/31 green**, no regressions. AC-A satisfied at the unit level.

**Debt note** (retro candidate): `ACTIVE_STATUSES` now exists in **three** private copies (run-inventory, run-resolver, status). Consistent with the existing pattern, but a future refactor could hoist one shared exported constant.

### T004/T005 — Defect B (list): `--all` was a silent no-op ✅ (commit pending)

**RED**: `input.all` was declared on `ListRunInventoryInput` (line 26) and plumbed from `runs.ts:58`, but never read — default and `--all` returned the same set. Added a 2-case block to `test/runner/run-inventory.test.ts`; RED shown as `expected 4 to be greater than 4`.

**GREEN**: restructured `listRunInventory`'s per-slug loop. New contract:
- `--active`: live attention set only (unchanged).
- **default**: "active or recent" — every live row + each agent's **single newest terminal row** (`selectActiveOrRecent` + `isLiveRow` helpers).
- **`--all`**: full terminal history, bounded by `--limit`.
`runs.ts` already passed `all:` through, so no CLI change was needed — the reader was the whole gap.
**Result**: `run-inventory.test.ts` 11/11 (incl. the pre-existing default-limit test); `cli/runs.test.ts` + `run-resolver.test.ts` 20/20. Only `runs.ts` consumes `listRunInventory`, so no other surface shifted. AC-B (`--all` broadens) met.

### T006/T007 — Defect B (heal): best-effort heal-on-read ✅ (commit pending)

**Decision: D2-B (full heal), not the D2-A fallback** — lock-safety was tractable. `run-resolver.ts` already *skips* dead-pid orphans (`:308`), so resolution never mislabels a live run today; the heal adds **persistence** (the orphan stops masquerading as live on disk).

**RED**: 2-case block in `test/runner/run-inventory.test.ts`. (a) heal-happens: RED shown as orphan staying `active` (expected `crashed`). (b) swallow: a throwing `healOrphan` seam.

**GREEN**: `listRunInventory` collects dead-pid `active` orphans during enumeration, then heals each after projection via `healDeadPidOrphan`:
- re-reads + re-probes the pid immediately before the write (TOCTOU-minimal, mirrors `reconcile.ts:101`), under `withReconcileLock`;
- writes `status:'crashed'` + `terminalReason:'pid-vanished'` (preserve-if-unset);
- the **caller wraps each heal in a blanket try/catch** → a held lock (`ReconcileLockHeldError`) or any write error is swallowed, the read returns; **no lock is taken on the orphan-free common path**.
Added an injectable `healOrphan` seam (mirrors the existing `isProcessAlive`/`now` seams) for the swallow test. No import cycle (imports `reconcile-lock.ts`/`run-manifest.ts`, never `reconcile.ts`).
**Result**: 13/13 inventory + `tsc --noEmit` clean. No-regression: the live run (pid alive) is never an orphan target, so it always resolves `active`.

**Scope note**: heal-on-read landed in `listRunInventory` only (where the read enumerates all runs + where the test targets it); `run-resolver`'s existing orphan-skip already prevents mislabeling, so no resolver edit was needed.

### T008 — Defect C: resolution-parity characterization ✅ (commit pending)

Per the T001 decision (AC-C fallback). Added 2 characterization tests to `test/runner/folder.test.ts` (`resolveAgent ↔ listAgents parity`): every listed agent resolves (no spurious `E121`), and `resolveAgent` excludes exactly what `listAgents` excludes (no-description / `_`-prefixed). **Passes immediately** — that's the point: T001 found no core defect, so AC-C is met by locking the already-correct parity against regression + the documented finding (the literal `{runId:null,…}` symptom is emitted by no core surface). No production edit.

---

## Phase 1 complete ✅

**All tasks [x].** Full suite: **1396 passed, 16 skipped, 0 failed** (131 files, `npm test`). `tsc --noEmit` clean.

**Acceptance criteria**:
- **AC-A** ✅ — `computeStatusVerdict` fails open for a live-pid run (fresh `updatedAt`, no `events.ndjson`) → `active` + live runId.
- **AC-B** ✅ — `runs list`/`--active` surface a live run; `--all` measurably broadens (was a no-op); dead-pid orphans heal-on-read to `crashed` without dropping the live run (best-effort, swallowed).
- **AC-C** ✅ (fallback) — `history`/`last-run` ↔ `list` resolution parity pinned; literal symptom documented as external/older-build (no core emitter).

**Production files**: `src/cli/commands/status.ts` (A), `src/runner/run-inventory.ts` (B-list + B-heal). **Tests**: `status-verdict.test.ts` (+4), `run-inventory.test.ts` (+4), `folder.test.ts` (+2). No `run-resolver`/`history`/`last-run`/`peer-activity`/`coordination-status` production edits (defect C is the fallback; resolver already skips orphans).

**Retro candidates**: `DL-001` (boot biome verdict), `DL-002` (`ACTIVE_STATUSES` triplication), `INS-001` (live defect-D sighting). Drained at the phase-end seam.

## Companion debrief (Power-Off)

The `code-review-companion` ran the full phase (briefed once, pinged at all 5 commit boundaries, fire-and-forget), then was stopped with `control:stop` and **farewelled cleanly** (run ended; 168 tool calls, 9850 events, ~32 min). It sent **0 inline inbox findings** (it accumulated internally and emitted the verdict only at the farewell) — a real "survival vs engagement" data point for Phase 5 (it stayed alive and *did* review, but never used the inbox reply channel or set `selfReportedState`).

- **Verdict**: `REQUEST_CHANGES` — "code changes for A/B/C looked sound and targeted tests passed", but **F001** kept it from APPROVE.
- **F001** (addressed ✅): the new files weren't Biome-formatted **and** the phase evidence misdiagnosed the lint failure (claimed biome was uninstalled; in fact `npx biome check .` ran and found real format violations). **Resolution**: ran the format gate on the changed files (re-check clean, suites green) and corrected the T000 evidence above. The companion was right.
- **magicWand** (→ follow-up): *"a lane-agnostic `minih companion open-findings <slug> --run <runId>` that lists unresolved findings and whether later commits addressed them, so final drain reviews don't rely on the companion remembering prior inbox messages."* Strongly overlaps **Phase 3** (the findings read-path, F) — captured as a retro for Phase 3 to consider.
- **Companion self-nit**: its own run validated `degraded` (`/findings/0 must have required property 'id'`) — its output schema wants an `id` on each finding; minor, the companion-agent's own concern, logged for its maintainer.
