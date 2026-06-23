# Execution Log — Plan 029 Copilot Home Isolation (Simple build)

**Branch**: `029-copilot-home-isolation` · **Mode**: Simple · **Companion**: `code-review-companion` (run `2026-06-23T01-28-56-896Z-6c07`)

| Task | Commit | Status | Notes |
|------|--------|--------|-------|
| T001 | `d634e10` | ✅ | New `copilot-home.ts`: `resolveCopilotHome()` (env override + `mkdir -p`), `resolveCopilotLogLevel()` (validate vs SDK union → `info`). tsc clean. Pinged companion. |
| T002 | `0ceb2f7` | ✅ | Pure `buildCopilotClientOptions()` in `copilot-home.ts`; rewired `sdk-runtime.ts:105-118` to use it (OTel trace hook moved into the builder, import removed). `baseDirectory`/`gitHubToken`/`logLevel` set, `onGetTraceContext`+`telemetry` preserved. biome+tsc clean. Pinged companion. |
| T003 | `29261da` | ✅ | `warnIfHomeLogsLarge()` (shallow-sum `<home>/logs`, threshold `MINIH_COPILOT_HOME_WARN_MB` default 500, one stderr line) + call in `sdk-runtime.ts`. Threshold parse guards unset/0/NaN → 500. biome+tsc clean. Pinged companion. |
| T004 | `899669a` | ✅ | `.minih/` (directory-only) added to `.gitignore`. Oracle proven: `check-ignore .minih/copilot-home` exit 0; `.minih.json` still tracked; `git status` clean with home present. Pinged companion. |
| T005 | `a79450c` | ✅ | `docs/how/copilot-home.md` — isolation/auth behavior + 3 operator env vars (all named). Pinged companion. |
| T006 | `da6c833` | ✅ | `test/cli/copilot-home.test.ts` — 12 tests pass, real temp dirs, no mocks. Neg-controls: invalid `verbose`→info, missing-token→undefined. biome clean. Pinged companion. |
| T007 | — (manual) | ✅ | Ran `node dist/cli/index.js run hello-world` (the NEW build). Oracle: `~/.copilot/session-state` 1229→1229 (AC-01/02); store landed at `.minih/copilot-home/session-store.db` (180 KB) + `session-state/d60142c6…`; sessionId absent from `~/.copilot`; `result: completed` on a fresh home ⟹ token auth worked (AC-03). Full gate (build+typecheck+1468 tests) green. |

## Discoveries & Learnings

| # | Tag | Discovery |
|---|-----|-----------|
| D1 | Noteworthy | SDK `useLoggedInUser` **defaults to false when `gitHubToken` is provided** (`types.d.ts:198`) — so passing the token alone selects the token auth path; no need to set `useLoggedInUser` explicitly (confirms finding 02). |
| D2 | Noteworthy | Flight-plan build pip not rendered: `harness flow insert-node` returns `E309` (orphan `ehf-*` chore nodes have no edges) — a pre-existing chore-graph condition owned by eng-harness-flow, not hand-fixed. Authoritative progress is the task table + this log; cosmetic only. |
| D3 | Noteworthy | The F001 fix commit (`7f01f11`) landed **after** the companion's `control:stop`, so it wasn't companion-reviewed. It is test-only and directly implements the companion's own F001 recommendation — low risk. |

## Companion Debrief (code-review-companion, run `2026-06-23T01-28-56-896Z-6c07`)

**Verdict**: APPROVE_WITH_NOTES. Reviewed `d634e10^..da6c833` (T001–T006 + final range). Confirmed: `baseDirectory`/`gitHubToken`/`logLevel` passed together; `onGetTraceContext`+`telemetry` preserved; invalid `MINIH_COPILOT_LOG_LEVEL`→`info`; `.minih/` directory-only ignore; docs match behavior; no adapter-domain scope creep. Farewell: `stop_requested` (clean exit).

### Findings reconciliation

| ID | Sev | Finding | Disposition |
|----|-----|---------|-------------|
| F001 | MEDIUM | T006 large-logs tests don't prove `MINIH_COPILOT_HOME_WARN_MB='0'`/non-numeric → 500 fallback | **ADDRESSED INLINE** — `7f01f11` adds two neg-controls ('0' + non-numeric stay silent); 14 tests pass |

### magicWand (follow-up candidates — surfaced only, not filed)

- **Companion**: expose first-contact / post-task check-in thresholds in `coordination_status` alongside `idleBudgetSec`. (minih-targeted)
- **hello-world run (T007)**: add a `MINIH_STARTED_AT` env var (ISO run-start) so agents report timing without calling `date`. (minih-targeted)

## Phase Complete ✅

All 7 tasks `[x]`; all 7 ACs satisfied (AC-04/05/06/07 deterministic; AC-01/02/03 by the real-build T007 run + the `buildCopilotClientOptions` unit sensor). Full gate green (build · typecheck · 1468 tests). One MEDIUM companion finding addressed inline. No Deferred items.
