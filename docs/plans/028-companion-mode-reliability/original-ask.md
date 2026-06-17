# Original ask — companion-mode-reliability
**Captured**: 2026-06-15T21:30:12Z  ·  **By**: /the-flow

> set up a new plan for them please

_"them" = the defects in GitHub issue #50, which were diagnosed (with file:line evidence) earlier in this session before the plan was set up. The verified root-cause map below is captured here so it survives a `/compact` and feeds the spec — it is context, not the spec itself._

## Captured context — verified root-cause map for issue #50 (minih v0.2.1)

Three parallel diagnostic passes + direct verification. **All defects below are LIVE in the v0.2.1 working tree** except the schema item, which is already fixed. The plan-027 release touched companion/coordination/MCP code, not the run-discovery read-paths.

| Defect | Root cause (verified) | Location | Status |
|---|---|---|---|
| **A** — `minih status` returns non-active for a live run | verdict is computed from a pid probe + `events.ndjson` file age (60s), never from `run.json.updatedAt`, so a just-booted run resolves to `unknown` and `select(.verdict=="active")` drops it | `src/cli/commands/status.ts:188-216` | LIVE |
| **B** — `--active`/default omit the live run; `liveness:"dead"` for a running pid | liveness = `process.kill(manifest.pid,0)`; a live run probes alive, so `dead` means a **stale prior `active` manifest** was selected (orphans reconcile only heals post-mortem) | `src/runner/run-inventory.ts:204-212`, `run-eligibility.ts:50-62` | LIVE |
| **C** — `history`/`last-run` throw `E121` transiently | `E121` fires only when `resolveAgent` returns null (reads `prompt.md`), which concurrent run writes don't touch — **not reproducible** from the cited core commands; the reporter's literal symptom came from a different (peer-activity) surface | `history.ts:32`, `last-run.ts:31`, `folder.ts:685-704` | LIVE (needs reframe) |
| **D** — timestamps: local time stamped `Z` | the **run-folder name / runId** is built from local `Date` getters (`getHours()`…) with a literal `"Z"` appended; `run.json`/CLI envelope use `.toISOString()` and are correct (the issue has the two files inverted) | `src/runner/folder.ts:752-759` | LIVE |
| **E** — child `MINIH_PROJECT_ROOT` = run dir | set to raw `config.cwd`, while `canonicalRoots` runs the same input through a git-root walk; only the env var stays pinned to the run folder | `src/runner/runner.ts:631` (correct path: `permissions/fs-guard.ts:100-138`) | LIVE |
| **F** — inside-lane findings invisible | the documented skim says `minih outside inbox list` (the outside lane = what *you* sent); the companion writes `finding`/`summary` to the inside lane; ledger exists, but there's no `companion findings` command | `agents/code-review-companion/outside.md:88-96` vs `companion-ledger.ts:287` | LIVE |
| **G** — clean run recorded `failed`/`degraded` | a schema-validation miss sets `result:"degraded"`, the manifest collapses everything ≠`completed` to `status:"failed"`, and `farewell` is never consulted; the `terminalReason` union has no clean member; idle-policy decision unwired (overlaps follow-up #49) | `runner.ts:1516-1594`, `types.ts:575-581` | LIVE |
| #5 — `state_transition {to:"reading"}` rejected | at v0.2.0 the per-agent state schema wasn't shipped, so validation fell back to a default enum lacking `reading` | `inside-state-schema.ts:39-49` | **FIXED in v0.2.1** — out of scope |

### Two framings in the issue that are wrong (confirmed)
1. **Defect D is in the opposite file.** The bug is in the run-folder name/runId (local-as-`Z`); `run.json` is actually correct UTC.
2. **The literal A/B/C symptoms aren't from the core CLI.** `selfReportedState`/`currentlyRunningTool` live only in `peer-activity.ts` (no `src/cli/` command emits them), and `--all` is a declared-but-never-read no-op in `run-inventory.ts` — so "default empty but `--all` shows it" is a timing race, not a filter bug. The underlying *fail-closed* behaviour is still real.

### Recommended scope for the spec
A, B, C, D, E, F, G (all live). Exclude #5 (fixed). Note G overlaps follow-up issue **#49** (wiring `evaluateIdlePolicy` into the runner loop).
