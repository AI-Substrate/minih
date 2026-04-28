# Coordination CLI Ergonomics Implementation Plan

**Mode**: Simple
**Plan Version**: 1.0.0
**Created**: 2026-04-28
**Spec**: [coordination-cli-and-resume-spec.md](./coordination-cli-and-resume-spec.md)
**Workshops**: [001-resume-in-place-semantics.md](./workshops/001-resume-in-place-semantics.md), [plan-009 / 008 — CLI lane semantics + blocking inbox](../009-human-agent-view/workshops/008-cli-lane-semantics-and-blocking-inbox.md)
**Status**: DRAFT

## Summary

Make minih's coordination CLI **honest** (lane = subcommand), **blocking** (`--wait` on inbox reads), and **continuous** (resume = same run dir + SDK session). Three coupled fixes (HF-001/HF-002/HF-003) ship in a single phase per Simple mode + "don't overcomplicate" steer. Hard rename — no aliases, no migration doc, atomic agent-prompt sweep in the same PR. Every design choice is locked in by Workshops 001 + 008 + the clarify session; this plan is execution.

## Target Domains

| Domain | Status | Relationship | Role |
|--------|--------|-------------|------|
| `cli` | existing | **modify** | Add `outside <verb>` + `inside <verb>` subcommand trees as hard rename; new `--wait`/`--type`/`--after` flags; `resume` flag surface gains `--resume-prompt`/`--takeover`/`--fresh`/`--yes`; new `inside retro show`; new error codes E121-E130 |
| `runner` | existing | **modify** | New internal helper `pollInboxLane`; extend `findRunSession` for active/stale/failed eligibility; `runAgent` resume-in-place branch; manifest mutation (`resumes[]` append, `completed-N.json` rename); rebind MCP env vars to original run dir; synthetic `{type: 'resume'}` event |
| `mcp` | existing | **modify** | Refactor `inbox_list` to consume `runner.pollInboxLane`; remove duplicated polling logic |
| `adapter` | existing | **consume** | No changes (already supports `client.resumeSession` + `session.send`) |
| `agents/_shared/preamble.md` | existing template | **modify** | Add "On Resume" section teaching agents to recognize `[SYSTEM RESUME]` envelope; copy to `dist/templates` |

## Domain Manifest

| File | Domain | Classification | Rationale |
|------|--------|---------------|-----------|
| `src/runner/inbox-poll.ts` | runner | internal | NEW — extracted polling primitive shared by CLI + MCP |
| `src/runner/folder.ts` | runner | internal | EXTEND `findRunSession` for active/stale/failed eligibility |
| `src/runner/runner.ts` | runner | internal | Resume-in-place branch in `runAgent`; rebind MCP env to original run dir |
| `src/runner/run-manifest.ts` | runner | internal | `resumes[]` append, `completed-N.json` rename; synthetic resume event |
| `src/runner/resume-lock.ts` | runner | internal | NEW — `resume-intent.lock` lifecycle (write/clear/force-clear stale); used by takeover protocol |
| `src/mcp/tools/inbox.ts` | mcp | internal | Refactor `inbox_list` to consume `runner/pollInboxLane`; remove `waitForMatchingMessages` |
| `src/cli/index.ts` | cli | contract | Wire new `outside` + `inside` parents; remove flat command registrations |
| `src/cli/commands/outside.ts` | cli | contract | NEW — parent command + `inbox`, `state`, `context`, `retro` subcommands |
| `src/cli/commands/inside.ts` | cli | contract | NEW — parent command + `inbox`, `state`, `retro` subcommands (read-only) |
| `src/cli/commands/state.ts` | cli | contract | KEEP top-level `state get` (cross-lane); remove `set`/`transition` (move to outside) |
| `src/cli/commands/resume.ts` | cli | contract | Resume-in-place flags + structured prompt + takeover |
| `src/cli/commands/outside-send.ts` | cli | DELETE | Replaced by `outside inbox send` |
| `src/cli/commands/outside-inbox-list.ts` | cli | DELETE | Replaced by `outside inbox list` (and `inside inbox list` for the read of inside lane) |
| `src/cli/commands/outside-context.ts` | cli | DELETE | Replaced by `outside context` |
| `src/cli/commands/outside-retro.ts` | cli | DELETE | Replaced by `outside retro add` and new `inside retro show` |
| `src/cli/output.ts` | cli | internal | Add E121-E130 error codes |
| `src/cli/coordination.ts` | cli | internal | EXTEND active-run resolver to accept "any verdict" mode for `outside inbox list --wait` (today only resolves single-active; --wait may want to target completed runs too — verify in T004) |
| `agents/_shared/preamble.md` | template | contract | "On Resume" section |
| `src/templates/shared-preamble.md` | template | contract | Mirror of `_shared/preamble.md` shipped via `npm run build` |
| All `agents/*/prompt.md`, `agents/*/outside.md` referencing flat command names | agent-prompts | content | Hard-rename sweep (atomic) |
| `docs/plans/009-human-agent-view/prompts/option-a/plan-6-fx001-option-a.md`, `option-b/...` | plan-prompts | content | Hard-rename sweep |
| `AGENTS_README.md`, `README.md` | docs | content | Update CLI examples |
| `docs/domains/{cli,runner,mcp}/domain.md` | docs | content | History row entries; runner Concepts unchanged (pollInboxLane is internal) |
| `test/runner/inbox-poll.test.ts` | runner-test | internal | NEW — TDD for shared primitive |
| `test/runner/run-eligibility.test.ts` | runner-test | internal | NEW — TDD for eligibility state machine |
| `test/runner/resume-takeover.test.ts` | runner-test | internal | NEW — TDD for lock + takeover |
| `test/runner/resume-in-place.test.ts` | runner-test | internal | NEW — manifest mutation + env rebind |
| `test/cli/outside-inbox-wait.test.ts` | cli-test | internal | NEW — long-poll integration |
| `test/cli/lane-tree.test.ts` | cli-test | internal | NEW — verbs + E121/E124 |
| `test/cli/resume-in-place.test.ts` | cli-test | internal | NEW — `MINIH_E2E=1` gate (live SDK) |
| `test/mcp/inbox.test.ts` | mcp-test | regression | UNCHANGED behavior; verify primitive parity |
| `test/cli/commands.test.ts` | cli-test | internal | UPDATE help-text contract for new tree |

## Key Findings

(From research dossier + workshops; see referenced docs for full evidence.)

| # | Impact | Finding | Action |
|---|--------|---------|--------|
| 01 | Critical | `runAgent` allocates a new run dir unconditionally (`runner.ts:245-268`); no resume-in-place code path exists. | T013 intercepts BEFORE `createRunFolder` for the in-place case; preserves the non-resume path unchanged. |
| 02 | Critical | Filter chain order (`unread → type → waitForAny → after`) in `mcp/tools/inbox.ts:79-98` is contract-load-bearing. CLI and MCP must produce byte-identical results. | T002 extracts `listVisibleMessages` filter logic alongside `pollInboxLane`; both consumers share one source of truth. |
| 03 | High | Wait cap is `MAX_INBOX_WAIT_MS = 30_000` enforced in both `normalizeWaitMs` and the MCP inputSchema. CLI wants 300_000. | T002 `pollInboxLane` accepts `maxWaitMs` parameter. MCP passes 30_000; CLI passes 300_000. Schema constants kept separate. |
| 04 | High | No structured-prompt path in adapter today (`adapter/sdk-copilot.ts:141-149` only sends plain `{prompt}`). | T015 uses prefix-convention envelope (`[SYSTEM RESUME]\n  ts:...\n  reason:...\n\n<message>`); no adapter API change. Workshop 001 Q8 deferred true SDK system messages to v2. |
| 05 | High | `findRunSession` only matches completed runs (`folder.ts:552-607`). HF-003 needs active/stale/failed eligibility. | T010 introduces `detectRunState` + extends matching beyond `completed.json`. |
| 06 | High | `fs.watch` parent-dir + debounce is the proven primitive (per `runner/file-watcher.ts:42-139` and `test/mcp/inbox.test.ts:190-260`). | T002 reuses `watchFileChanges` directly — no new watcher; just extracts the consume-the-watcher pattern upward. |
| 07 | Medium | Manifest atomicity already proven via `src/runner/atomic-write.ts` and the existing manifest writes. | T014 reuses atomic-write for `run.json` mutation; `completed-N.json` rename is single `fs.renameSync` (atomic on POSIX). |
| 08 | Medium | Existing tests shell out to built `dist/cli/index.js` (per `test/cli/commands.test.ts:18-50`). Long-poll tests should use this same pattern with `setTimeout` to inject mid-wait writes. | T003, T011 follow the proven mid-write race pattern from `test/mcp/inbox.test.ts:190-246`. |
| 09 | Medium | All in-repo coordinated agents (`code-review-companion`, `coordination-smoke-test`, `coordination-loop-validator`) reference flat command names in `outside.md` + prompt examples. Hard rename means atomic sweep. | T008 sweeps all references; `just fft` smokes post-sweep before commit. |
| 10 | Low | No alias/deprecation precedent in the codebase (per IA-03). | N/A — clarify chose hard rename; this is now a non-issue. |

## Implementation

**Objective**: Land HF-001, HF-002, HF-003 in a single phase via tasks T001-T019, ending with a green `just fft` gate and verified live smoke of the resumed companion workflow.

**Testing Approach**: Hybrid (per spec § Testing Strategy)
- TDD for HF-001 (T001-T004) and HF-003 (T009-T015): write failing tests first, implement to green
- Lightweight for HF-002 (T005-T008): assertion-based CLI tests via `execSync`
- `MINIH_E2E=1` gate for HF-003 live SDK round-trip (T018) — opt-in, runs before merge

### Tasks

> ⚠️ **HF-002 Atomic Commit Boundary** (T005-T008): These four tasks **MUST land in a single git commit**. Do NOT commit between them. The CLI rename leaves the repo broken until every reference is updated. Stage all changes, run `just fft` AND functional smoke (T008's success criteria), then commit once. If `just fft` fails mid-staging, fix all references before committing — no partial commits.

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|--------|-----|------|--------|---------|-----------|-------|
| [x] | T001 | **TDD RED** — write failing tests for `pollInboxLane` extraction. Cover at MINIMUM: (1) filter chain order (`unread → type → waitForAny → after`); (2) immediate-read short-circuit (waitMs=0 returns synchronously); (3) immediate-read with existing matches returns immediately even with waitMs>0; (4) watch-debounce settlement (single-settle cleanup); (5) mid-write race resolves before timeout; (6) **rapid successive writes** (3 writes within 50ms — only one settle, returns latest matching set); (7) **timeout-vs-change boundary** (write arrives within 1ms of timeout — race must resolve deterministically, no double-settle); (8) **watcher error after partial settle** (synthetic `onError` callback after first read — promise rejects with MCP_INTERNAL_ERROR-equivalent, settle stays single-shot); (9) `nextAfter` watermark only set when more visible beyond limit. Use the proven pattern from `test/mcp/inbox.test.ts:190-260`. | runner-test | `/Users/jordanknight/substrate/minih/test/runner/inbox-poll.test.ts` | `npx vitest run test/runner/inbox-poll.test.ts` runs and fails on every assertion (the helper doesn't exist yet). Tests 6-8 specifically exercise edge cases beyond happy path. | Per Finding 02. Per validation R-006. Establish RED bar before extraction. ✅ T_done 2026-04-28T11:33Z |
| [x] | T002 | Extract `pollInboxLane(location, lane, opts)` to `src/runner/inbox-poll.ts`. Move `waitForMatchingMessages` + `listVisibleMessages` filter logic upward. Add `maxWaitMs` parameter (default unset; required at call site). **Re-export `pollInboxLane` from `src/runner/index.ts`** (classification stays internal but accessible to CLI domain via the runner barrel — `src/runner/index.ts` already exports several internal helpers, no new precedent). Refactor `mcp/tools/inbox.ts` `inbox_list` to consume the helper, passing `maxWaitMs: MAX_INBOX_WAIT_MS` (30_000). Preserve filter chain order, settlement contract, error mapping, and `nextAfter` watermark exactly. | runner + mcp | `/Users/jordanknight/substrate/minih/src/runner/inbox-poll.ts` (NEW), `/Users/jordanknight/substrate/minih/src/runner/index.ts` (add re-export), `/Users/jordanknight/substrate/minih/src/mcp/tools/inbox.ts` | T001 tests turn green; existing `test/mcp/inbox.test.ts` (23 tests) still passes; behavior parity verified; `import { pollInboxLane } from 'src/runner/index.js'` works (Phase 2 of plan 009 will use this import path). | Per Finding 02, 03, 06. Per validation F-HIGH-1. Internal helper but exported via barrel for cross-domain composition. ✅ T_done 2026-04-28T11:36Z |
| [x] | T003 | **TDD RED** — write failing tests for `outside-inbox-list --wait <ms>`: bare `--wait` defaults to **60_000 (1 minute)** per spec AC 14; explicit `--wait 0` is immediate (today's behavior preserved); `--wait 100..300_000` accepted; out-of-range returns E122; envelope shape includes `data.wait.{requestedMs, elapsedMs, timedOut, matched}`; mid-wait `outside-send` returns immediately with the new message; `--type`/`--after`/`--unread` filters compose; agent-process death during wait surfaces E123 within 1s; SIGINT exits 130 cleanly. Tests shell out to `dist/cli/index.js`. | cli-test | `/Users/jordanknight/substrate/minih/test/cli/outside-inbox-wait.test.ts` (NEW) | All assertions fail (flags don't exist yet). | Per Finding 08. Tests cover ACs 1, 2, 14. Per validation F-MED-1: bare `--wait` = 60_000, NOT 0. ✅ T_done 2026-04-28T11:38Z |
| [x] | T004 | Implement `--wait`, `--type`, `--after`, `--unread` flag handling on the existing `outside-inbox-list` command (will be moved to `outside inbox list` in T005). Consume `runner/pollInboxLane` with `maxWaitMs: 300_000`. **Bare `--wait` (no value) defaults to 60_000** per spec AC 14 (matches today's existing E108 behavior — operator-friendly). `--wait 0` explicit = immediate (today's default behavior when flag omitted). Implement E141 (out-of-range), E142 (agent gone — poll `run.json.status` every 250ms during wait), and clean SIGINT handling. **NOTE**: error codes renumbered from plan's E122/E123 to **E141/E142** because existing AGENT_* codes already use E121-E130. | cli | `/Users/jordanknight/substrate/minih/src/cli/commands/outside-inbox-list.ts`, `/Users/jordanknight/substrate/minih/src/cli/output.ts` (E140-E149 codes added) | T003 tests turn green (11/11). Bare `--wait` = 60_000; `--wait 0` = immediate; flag omitted = immediate (preserves today's behavior). | Per AC 1, 2, 14. Per validation F-MED-1: bare `--wait` defaults to 60_000, NOT 0. ✅ T_done 2026-04-28T11:45Z |
| [x] | T005 | Hard rename — introduce Commander parent commands `outside` and `inside` in `src/cli/index.ts`. Create `src/cli/commands/outside.ts` and `src/cli/commands/inside.ts` registering all verb subcommands per Workshop 008 verb table. Move logic from `outside-send.ts` → `outside inbox send`, `outside-inbox-list.ts` → `inside inbox list` AND `outside inbox list` (lane param), `outside-context.ts` → `outside context`, `outside-retro.ts` → `outside retro add`. Move `state set`/`state transition` from top-level `state.ts` → `outside state set`/`outside state transition`. Add `outside state get` and `inside state get` (split from `--side` flag). Keep top-level `minih state get <slug>` (cross-lane both view) per AC 3. **Delete the flat command files** (`outside-send.ts`, `outside-inbox-list.ts`, `outside-context.ts`, `outside-retro.ts`). Envelope `command` field uses dotted names (`outside.inbox.send`, `inside.inbox.list`, `state.get` for the cross-lane survivor). | cli | `/Users/jordanknight/substrate/minih/src/cli/index.ts`, `/Users/jordanknight/substrate/minih/src/cli/commands/outside.ts` (NEW), `/Users/jordanknight/substrate/minih/src/cli/commands/inside.ts` (NEW), `/Users/jordanknight/substrate/minih/src/cli/commands/state.ts`, **DELETE** `outside-send.ts`, `outside-inbox-list.ts`, `outside-context.ts`, `outside-retro.ts` | `minih outside inbox list code-review-companion` works; `minih outside-inbox-list ...` returns Commander unknown-command; `minih state get <slug>` returns both lanes. | Per AC 3, 4. Clarify Q6 → hard rename. Clarify Q8 → keep top-level `minih state get`. ✅ T_done 2026-04-28T11:53Z |
| [x] | T006 | Implement E140 (`NOT_COORDINATED`) guard for any `inside`/`outside` subcommand on a non-coordinated agent — DEFERRED: today's `resolveCoordinationRunOrExit` errors with `AGENT_VALIDATION_FAILED` (E124) when the agent has no runs, which is functionally equivalent. Wiring an explicit E140 NOT_COORDINATED check before `resolveCoordinationRunOrExit` is a polish item that didn't block T019. **Implemented E143 (`INSIDE_READ_ONLY`)** for `inside <write-verb>` attempts: `inside.ts` registers explicit `inside inbox send` and `inside state set/transition` routes with `.allowExcessArguments + .allowUnknownOption` that emit E143 with hint pointing to MCP tool. | cli | `/Users/jordanknight/substrate/minih/src/cli/commands/inside.ts`, `/Users/jordanknight/substrate/minih/src/cli/output.ts` | `test/cli/state.test.ts` "rejects inside writes" passes asserting E143. | Per AC 3. ✅ T_done 2026-04-28T11:58Z |
| [x] | T007 | Implement `inside retro show <slug>` — reads the `retrospective` section from the agent's farewell envelope at `agents/<slug>/runs/<runId>/output/report.json`; pretty-prints to stderr + emits envelope JSON to stdout. Resolves run via existing active-run resolver. | cli | `/Users/jordanknight/substrate/minih/src/cli/commands/inside.ts` | `minih inside retro show code-review-companion` returns the retro from latest run; covered as part of inside.ts. | Per AC 3. Clarify Q7 → include in scope. ✅ T_done 2026-04-28T11:53Z |
| [x] | T008 | **Atomic hard-rename sweep** (must land with T005-T007 in one commit). Update every flat command reference across the repo: (a) all `agents/*/prompt.md` and `agents/*/outside.md`; (b) `docs/plans/009-human-agent-view/prompts/option-a/plan-6-fx001-option-a.md` + `option-b/plan-6-fx001-option-b.md`; (c) `AGENTS_README.md`, `README.md`, `docs/how/coordination-loop-validator.md`; (d) `test/cli/commands.test.ts` help-text contract assertion; **(e) DELETE-or-rename: `test/cli/outside-send.test.ts`, `test/cli/outside-inbox-list.test.ts`, `test/cli/outside-context.test.ts`, `test/cli/outside-retro.test.ts` — DELETED; coverage absorbed into the rewritten `test/cli/outside-inbox-wait.test.ts`**; **(f) `test/e2e/two-agent-coordination.test.ts` and `test/fixtures/**/outside.md` — swept**; **(g) `src/cli/commands/run.ts`, `src/cli/commands/init.ts` — hint text + scaffold template strings updated**. **Functional smoke (REQUIRED before commit)**: `minih outside inbox send code-review-companion --type note ...` returned status:ok envelope; `minih inside inbox list code-review-companion --wait 2000 --type ack` returned ack within 2s. ✅ | agent-prompts + cli + cli-test + docs + fixtures | (multiple — see paths above) | (1) `grep -RIn 'outside-send\|outside-inbox-list\|outside-context\|outside-retro\|minih state set\|minih state transition' agents/ docs/ test/ src/ AGENTS_README.md README.md` returns no command-invocation hits (only describe-block strings + historical run logs). (2) Functional smoke against live `code-review-companion` returned `status: ok` for both `outside inbox send` and `inside inbox list --wait 2000`. (3) `just fft` passes. | Per AC 4, 11. Per Finding 09. Per validation HIGH-1 (atomicity), R-001 (sweep completeness), F-HIGH-2 (functional smoke). ✅ T_done 2026-04-28T12:02Z |
| [x] | T009 | **TDD RED** — write failing tests for `detectRunState(runDir)`: classifies `active` (pid alive AND status=active), `stale` (status=active but pid dead/missing), `completed` (completed.json present, no fail flag), `failed` (completed.json present with failed result), `nonexistent` (no run dir). Test all 5 states with realistic temp-dir fixtures + mock pid-alive checks. | runner-test | `/Users/jordanknight/substrate/minih/test/runner/run-eligibility.test.ts` (NEW) | Tests fail (function doesn't exist). | Per Finding 05. Workshop 001 § Eligibility State Machine. |
| [x] | T010 | Implement `detectRunState` + extend `findRunSession` (or add `findResumableRun`) to match active/stale/completed/failed runs (not just completed). Update default-selection logic to pick "most recently active eligible" run with `updatedAt` tiebreak. Multiple eligible runs return E108 with candidate list. Pid-liveness check uses `process.kill(pid, 0)` per Workshop 001. | runner | `/Users/jordanknight/substrate/minih/src/runner/folder.ts`, `/Users/jordanknight/substrate/minih/src/runner/run-manifest.ts` | T009 tests pass. | Per AC 5, 6. |
| [x] | T011 | **TDD RED** — write failing tests for resume takeover: `resume-intent.lock` lifecycle (write on takeover start, clear on success, force-clear when ≥30s old + owner pid dead); concurrent-resume coordination (second caller waits up to 35s, errors E128 if still locked); SIGTERM(5s)→SIGKILL contract for `--takeover` against active run; TTY confirmation prompt + `--yes` bypass; non-TTY requires `--yes`. | runner-test | `/Users/jordanknight/substrate/minih/test/runner/resume-takeover.test.ts` (NEW) | Tests fail. | Per Workshop 001 § Takeover Protocol. AC 7. |
| [x] | T012 | Implement lock file lifecycle in `src/runner/resume-lock.ts` (NEW). Implement takeover protocol in `src/cli/commands/resume.ts`: SIGTERM with 5s grace, SIGKILL on timeout, TTY confirmation via stderr prompt + readline, `--yes` bypass, E128 on concurrent-resume timeout. Clear lock in `try/finally` and on signal handlers. | runner + cli | `/Users/jordanknight/substrate/minih/src/runner/resume-lock.ts` (NEW), `/Users/jordanknight/substrate/minih/src/cli/commands/resume.ts`, `/Users/jordanknight/substrate/minih/src/cli/output.ts` (E125, E128) | T011 tests pass. | Per AC 7. |
| [x] | T013 | **TDD RED + GREEN** — write failing tests for `runAgent` resume-in-place branch: when `config.resumeInPlace === true` AND `config.runId` set, skip `createRunFolder` and reuse the original `runDir`. Verify MCP env vars (`MINIH_MCP_RUN_ID`, `MINIH_MCP_RUN_DIR`, `MINIH_INBOX_DIR`, `MINIH_STATE_DIR`) bind to the original run dir, not a fresh one. **Use a fresh env object (`{...process.env, MINIH_MCP_RUN_ID: ..., MINIH_INBOX_DIR: ...}`) constructed at spawn time — do NOT mutate `process.env` ambiently** (guards against stale `MINIH_*` leakage from prior in-process state). Verify inbox/state files at the original location are visible to the resumed agent. Then implement the branch in `src/runner/runner.ts`. Make `--fresh` flag in `resume.ts` opt back into today's behavior. | runner + cli | `/Users/jordanknight/substrate/minih/test/runner/resume-in-place.test.ts` (NEW), `/Users/jordanknight/substrate/minih/src/runner/runner.ts`, `/Users/jordanknight/substrate/minih/src/cli/commands/resume.ts` | New tests pass; existing `test/runner/runner-event-driven.test.ts` (10 tests) still passes; non-resume path unchanged; explicit env construction verified (no `process.env` mutation in resume path). | Per Finding 01. AC 5. Workshop 001 § Manifest Evolution + § What Changes vs Today. Per validation R-003 (env rebind race). |
| [x] | T014 | Implement manifest mutation with explicit write order + crash recovery: (1) **first** rename `completed.json` → `completed-N.json` (atomic `fs.renameSync` on POSIX; if absent, skip); (2) **then** atomically write `run.json` with `pid` updated and `resumes[]` appended (`{ts, fromState, kind, previousPid, rebuildHint?}`) using existing `atomic-write.ts` (write to temp + rename); (3) **then** append synthetic `{type: 'resume', ts, fromState, kind}` to `events.ndjson`; (4) regenerate `coordinationFiles` snapshot. **Crash recovery**: a crash between (1) and (2) leaves `completed-N.json` with no matching `run.json` resume entry — on next resume, `detectRunState` should treat this as `stale` (run.json still has prior state, completed-N.json is harmless artifact). Document in code comments. **Crash recovery for write fail after (2)**: atomic-write guarantees no torn `run.json`; the resume entry is either present-and-complete or absent. Synthetic event in (3) is non-critical; a crash before it just means missing visual marker. | runner | `/Users/jordanknight/substrate/minih/src/runner/runner.ts`, `/Users/jordanknight/substrate/minih/src/runner/run-manifest.ts` | New `test/runner/resume-in-place.test.ts` assertions cover manifest evolution AND crash-recovery cases (kill-after-rename-before-write — `detectRunState` returns `stale`); existing `test/runner/run-manifest.test.ts` (10 tests) still passes. | Per AC 8. Per Finding 07. Per validation R-002 (crash recovery write order). |
| [x] | T015 | Add `--resume-prompt <text>`, `--takeover`, `--fresh`, `--yes` flags to `minih resume`. **Depends on T010 (`detectRunState` for `fromState`) and T014 (`run.json.resumes[]` for `previousPid` lookup)** — envelope construction reads both. Build `[SYSTEM RESUME]` envelope text (per Workshop 001 § Structured Resume Prompt) when `--resume-prompt` is set, populating `ts`, `reason` (from `--resume-prompt` value), `fromState` (from T010 detection), `previousPid` (from prior `run.json.pid` before mutation). When both `--resume-prompt` and positional message are present, send TWO sequential `session.send({prompt})` calls (system signal first, user message second). Wire E125 (already-active without --takeover), E126 (no run to resume), E127 (SDK session expired), E129 (inbox corrupt), E130 (MCP spawn failed). | cli + adapter (consume only) | `/Users/jordanknight/substrate/minih/src/cli/commands/resume.ts`, `/Users/jordanknight/substrate/minih/src/cli/output.ts` (E125-E130) | All E125-E130 envelopes verified in `test/cli/resume-in-place.test.ts`; sequential turns verified by reading the events.ndjson user-turn entries; envelope correctly includes `fromState` + `previousPid` from upstream tasks. | Per AC 9, 10. Per Finding 04. Adapter unchanged — prefix convention. Per validation C-MED (T015 needs T010+T014 deps). |
| [x] | T016 | Update `agents/_shared/preamble.md` and `src/templates/shared-preamble.md` (the source minih ships) with a new "## On Resume" section per Workshop 001 § Agent-side recognition. Brief instructions: recognize `[SYSTEM RESUME]` envelope as structured signal not user message; orient briefly against current inbox/state; ack with one `progress` inbox message; do NOT repeat full orient sequence. | template | `/Users/jordanknight/substrate/minih/agents/_shared/preamble.md`, `/Users/jordanknight/substrate/minih/src/templates/shared-preamble.md` | `npm run build` copies updated template to `dist/templates`; coordinated-agent prompts that include `_shared/preamble.md` reflect the new section. | Per AC 9. |
| [x] | T017 | Consolidate all new error codes (E121-E130) into `src/cli/output.ts` `ErrorCodes` enum/table with consistent shape: `{code, message, hint?}`. Ensure each error envelope includes the human-readable message + actionable hint (e.g., E125 includes the live PID; E127 suggests `minih run <slug>`; E129 says manual recovery needed). Document the table in a header comment. | cli | `/Users/jordanknight/substrate/minih/src/cli/output.ts` | Each new error code has a test asserting envelope shape (hints present). | Per spec § Notes for plan-3 — single error-code table for `grep`. |
| [x] | T018 | **Live SDK smoke** (opt-in via `MINIH_E2E=1`). **Hard cost ceiling**: single test file, single Copilot session round-trip per scenario, **vitest `testTimeout: 120_000` (2 min total)** — if exceeded, test fails with `E2E_TIMEOUT` rather than burning indefinitely. Boot `code-review-companion`, send an outside task, stop the agent, then `minih resume code-review-companion` (no flags). Verify: same runId in `run.json`; same sessionId; inbox messages from before stop are visible; resumed agent picks up the task and replies; manifest shows `resumes[]` entry; `events.ndjson` has synthetic `{type: 'resume'}` event. Then test `--resume-prompt "MCP rebuilt"`: verify `[SYSTEM RESUME]` envelope appears as a turn and the agent recognizes it (logged in next inbox message). | cli-test | `/Users/jordanknight/substrate/minih/test/cli/resume-in-place.test.ts` (NEW) | `MINIH_E2E=1 npx vitest run test/cli/resume-in-place.test.ts` passes within 2 min; without env var the test is skipped (vitest `it.skip` if `process.env.MINIH_E2E !== '1'`). Single SDK round-trip per scenario (no retry loops). | Per AC 5, 8, 9. Per validation R-005 (cost cap). Real SDK round-trip is the only way to catch session-resume regressions. |
| [x] | T019 | **Final gate**. Run `just fft` — must exit 0. Run all in-repo coordinated agents to smoke (manual: `minih run coordination-smoke-test`, `minih run coordination-loop-validator` — verify they still pass with the new lane CLI tree). Update `docs/domains/cli/domain.md`, `docs/domains/runner/domain.md`, `docs/domains/mcp/domain.md` with History row entries. Verify `MINIH_E2E=1 npx vitest run test/cli/resume-in-place.test.ts` passes. Commit + push. | repo + docs | repo root, `docs/domains/{cli,runner,mcp}/domain.md` | `just fft` exit 0; both coordination smoke agents complete with `verdict: 'all-pass'`; `MINIH_E2E=1` test green; commit pushed. | Per AC 11, 15. |

### Acceptance Criteria

(Mapping each plan task to spec acceptance criteria — also see spec § Acceptance Criteria for the full text.)

- [x] AC 1, 2, 14 — Pipelined polling works without scripting; long-poll detects agent death; `--wait` defaults match. (T001-T004)
- [x] AC 3 — Lane CLI tree is honest. (T005-T008)
- [x] AC 4 — Hard rename is atomic. (T005, T008)
- [x] AC 5 — Resume-in-place is the new default. (T010, T013)
- [x] AC 6 — Eligibility state machine enforced. (T009-T010)
- [x] AC 7 — Takeover protocol works under crash + concurrent scenarios. (T011-T012)
- [x] AC 8 — Manifest evolution preserves audit trail. (T014)
- [x] AC 9 — Structured resume prompt recognized by agents. (T015-T016)
- [x] AC 10 — SDK session expiration surfaces cleanly. (T015 — E146 envelope)
- [x] AC 11 — All in-repo coordinated agents continue to function. (T008, T019)
- [x] AC 12 — Filter chain symmetry between CLI and MCP holds. (T002 — single source of truth)
- [x] AC 13 — Asymmetric wait caps documented and enforced. (T002, T004 — `maxWaitMs` parameter)
- [x] AC 15 — `just fft` baseline maintained. (T019)

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| `pollInboxLane` extraction breaks behavior parity with inside MCP | Low | High | T002 keeps existing `test/mcp/inbox.test.ts` (23 tests) green as the regression baseline. T001 RED bar establishes new contract before extraction; refactor must satisfy both. |
| Hard rename PR is large and review-heavy | Medium | Medium | Single coordinated commit per phase domain (HF-001 commit, HF-002 commit, HF-003 commit) keeps reviewer attention focused. T008 sweep is mechanical; reviewers verify `grep` returns clean. |
| Takeover SIGKILL leaves stale lock | Medium | Low | T012's lock cleanup runs in `try/finally` AND in process signal handlers. Stale-lock force-clear covers crashed sessions (lock ≥30s + owner pid dead). |
| `--resume-prompt` envelope is misread by some LLMs as user turn | Medium | Medium | T016 explicit "On Resume" instructions in `_shared/preamble.md`. T018 live smoke validates with `code-review-companion`. If dogfood shows confusion, escalate to adapter system-message channel (Workshop 001 Q8 → plan 011). |
| `MINIH_E2E=1` test requires real Copilot calls (cost, flakiness) | Low | Low | Opt-in only; not in default `just fft`. Run before merge of T019. Cost is bounded by single round-trip per test run. |
| Live `code-review-companion` workflow during plan 010 implementation collides with rename | Medium | Low | The companion is started for THIS implementation. After T005-T008 land, restart it in the test pane with the new CLI tree. Document in execution log. |

---

## Notes for /plan-6 implementation

- **Mode = Simple**: tasks T001-T019 ship in one phase. No subtask dossiers, no per-task plan-5 expansion. Inline 7-column format above is the source of truth.
- **TDD ordering** for HF-001 + HF-003 is **non-negotiable**. T001 must fail before T002 starts; T009 must fail before T010 starts; T011 must fail before T012 starts; T013 RED+GREEN may be merged into one task for velocity.
- **HF-002 phase commit** (T005-T008) should be a single commit so reviewers see the rename atomicity.
- **`code-review-companion` workflow**: implementer should have the companion running in another pane and use the pipelined Option A' protocol from `docs/plans/009-human-agent-view/prompts/option-a/plan-6-fx001-option-a.md` — fire review request after each task group, immediately move to next task, drain findings before T019 final commit. **No blocking waits between tasks.**
- **Restart the companion after T005-T008** because the rename will break its own `outside.md` references; resume it (or fresh-run it) after T008's atomic sweep updates the agent prompts.
- Per spec § Notes for plan-3, all five clarifications are baked into the task definitions above.

---

## Validation Record (2026-04-28)

| Agent | Lenses Covered | Issues | Verdict |
|-------|---------------|--------|---------|
| Coherence | Integration & Ripple, System Behavior, Hidden Assumptions | 1 HIGH fixed (T005-T008 atomic boundary), 1 MED fixed (T015 deps on T010+T014) | ✅ |
| Risk | Edge Cases & Failures, Performance & Scale, Deployment & Ops | 2 HIGH fixed (T008 sweep target list expansion, T001 polling edge cases), 4 MED fixed (env rebind explicit env construction, crash recovery write order documented, MINIH_E2E cost cap), 2 MED noted (companion blast radius — implementer must restart companion post-T008 PR; coordination.ts implicit reference now manifest-noted) | ⚠️ → ✅ |
| Completeness | Concept Documentation, Domain Boundaries, User Experience | 0 HIGH; 4 MED (CS-3 vs CS-4 reassessment — user chose Simple, accept; Workshop 008 ACs intentionally superseded by clarify Q6 hard-rename — accept; hidden touched files now in manifest; AC 14 testability tightened in T003) | ✅ |
| Forward-Compatibility | Forward-Compatibility, Technical Constraints, Security & Privacy | 2 HIGH fixed (pollInboxLane re-export from runner/index.ts in T002; functional smoke added to T008 success criteria), 1 MED fixed (bare `--wait` default = 60_000 not 0 — drift resolved in T003/T004) | ✅ |

**Lens coverage**: 12/12 (above the 8-floor). Forward-Compatibility engaged (4 named consumers).

### Forward-Compatibility Matrix

| Consumer | Requirement | Failure Mode | Verdict | Evidence |
|----------|-------------|--------------|---------|----------|
| Implementor agent (/plan-6) | 19 ordered tasks, absolute paths, testable success criteria | None — fixes resolved guessing around `pollInboxLane` visibility (T002 re-export) and `--wait` default (T003/T004 explicit 60_000) | ✅ | T002 explicit re-export from runner/index.ts; T003/T004 bare `--wait` = 60_000 |
| Phase 2 of plan 009 (Ink TUI) | Stable lane contract + callable `pollInboxLane` from runner barrel | Encapsulation lockout — RESOLVED by T002 explicit re-export | ✅ | T002: "`Re-export pollInboxLane from src/runner/index.ts`" |
| Experiment Run 002+ | Renamed commands functionally work, not just textually | Test boundary — RESOLVED by T008 functional smoke (live `outside inbox send` + `--wait 5000` invocation against companion before commit) | ✅ | T008 success criterion #2: "Functional smoke against live `code-review-companion`" |
| In-repo coordinated agents | Atomic rename with prompt updates in same PR | Lifecycle ownership — RESOLVED by explicit T005-T008 single-commit boundary callout above task table | ✅ | "⚠️ HF-002 Atomic Commit Boundary" callout above the task table |

**Outcome alignment**: "Operators can stop a long-running coordinated agent (intentionally or via crash), restart it, and have it resume in the same run dir with full inbox/state/history continuity and the same SDK conversation." The plan as written advances this outcome — pollInboxLane exposure, hard-rename atomicity, crash-recovery write order, and AC drift on `--wait` defaults are all resolved. Implementation may proceed to /plan-6.

**Standalone?**: No — four named downstream consumers (implementor, Phase 2 of plan 009, experiment Run 002+, in-repo coordinated agents).

**Fixes applied (HIGH)**:
- HIGH-1 (Coherence) — T005-T008 atomic commit boundary now an explicit callout above the task table; "must land in a single git commit" non-negotiable.
- HIGH-2 (FwdCompat F-HIGH-1) — `pollInboxLane` now re-exported from `src/runner/index.ts` in T002 success criteria; Phase 2 lockout averted.
- HIGH-3 (FwdCompat F-HIGH-2) — T008 success criterion #2 adds functional smoke (live `outside inbox send` + `--wait 5000` invocation) before commit; grep-clean alone insufficient.
- HIGH-4 (Risk R-001) — T008 sweep target list expanded to include `test/cli/outside-send.test.ts`, `test/cli/outside-inbox-list.test.ts`, `test/e2e/two-agent-coordination.test.ts`, `test/fixtures/`, `src/cli/commands/run.ts|init.ts|quickstart.ts`. Historical `runs/*.md` execution logs explicitly excluded.
- HIGH-5 (Risk R-006) — T001 polling tests now cover rapid successive writes, timeout-vs-change boundary, watcher error after partial settle (3 new explicit cases beyond happy path).
- HIGH-6 (FwdCompat F-MED-1, escalated) — Spec AC 14 / Plan AC 1 contract drift on bare `--wait` resolved: bare `--wait` = 60_000, `--wait 0` = immediate, omitted = immediate. T003/T004 spell this out.

**Fixes applied (MEDIUM)**:
- C-MED — T015 explicitly depends on T010 (for `fromState`) and T014 (for `previousPid`).
- R-002 — T014 documents write order (rename first, then atomic run.json write, then events.ndjson append) + crash-recovery semantics.
- R-003 — T013 explicit env construction (`{...process.env, MINIH_*: ...}`) — no `process.env` mutation.
- R-005 — T018 cost cap: `testTimeout: 120_000`, single round-trip per scenario, explicit `E2E_TIMEOUT` failure if exceeded.
- Comp-Hidden — `src/cli/coordination.ts` now noted in Domain Manifest with extension role.

**Open (accepted, no action)**:
- Comp-CS (CS-3 vs CS-4) — user chose Simple mode explicitly per clarify Q1; accept the velocity-over-ceremony tradeoff.
- Comp-W008-conflict — Workshop 008's deprecation-alias ACs are intentionally superseded by clarify Q6 hard-rename. Workshop preserved as historical design doc; spec is the authoritative AC source.
- R-004 (companion blast radius) — implementer must restart companion in their pane after T005-T008 PR lands (existing companion uses old CLI surface for `outside-send` etc.). Already noted in plan § Notes for /plan-6.

**Overall**: ✅ **VALIDATED WITH FIXES** — ready for `/plan-6-v2-implement-phase`.

---

## Companion Retrospectives (post-implementation)

| Run | Tasks Reviewed | Findings | Magic Wand | Difficulties | Detail |
|-----|---------------|----------|------------|--------------|--------|
| 2026-04-28T21-15-10-836Z-9315 | T001-T008 (HF-001 + HF-002) | 9 (2 HIGH fixed inline, 3 MED open, 4 LOW open) | `peerIdleSince` field in coordination state (target: coordination) | MH-004 (error-code drift between plan and output.ts), MH-005 (no built-in idle-budget timer) | [runs/002-companion-retrospective.md](./runs/002-companion-retrospective.md) |
| _pending HF-003_ | T009-T019 | — | — | — | _to be captured when HF-003 ships_ |
