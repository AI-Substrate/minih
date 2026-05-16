# Coordinated Install Resilience Implementation Plan

**Mode**: Simple
**Plan Version**: 1.1.0 — scope-reduced 2026-05-16 (see § Scope Reduction)
**Created**: 2026-05-15
**Spec**: [coordinated-install-resilience-spec.md](./coordinated-install-resilience-spec.md)
**Workshop**: [workshops/001-mcp-error-watchdog-state-machine.md](./workshops/001-mcp-error-watchdog-state-machine.md) (Contract Ready — **deferred to follow-up plan**)
**Status**: **W1 + partial W2 SHIPPED**; W3 + W4 + T005 + T021-T023 cross-cutting **DEFERRED** — see § Scope Reduction

## 🚧 Scope Reduction (2026-05-16)

The original 24-task plan grew well beyond the actual unblock-pij fix. After landing W1 + FX001 + 2 of 3 W2 tasks (8 commits / ~600 lines net), the user halted scope creep and required KISS execution:

**SHIPPED** (the actual fix for issue #30):
- Plan + execution log committed (`397a56b`)
- FX001 schema location pivot — schemas at agent root, `agent.json` 0.2.0 with 7 files, outside.md authored (`ddf09fd`)
- T002 tests for 0.2.0 manifest + upgrade-detection regression (`1cd056e`)
- T004 implicit-manifest fixture test (spec AC6) (`748f330`)

**DEFERRED to a future plan** (reset out of this PR 2026-05-16):
- **T005** — Doctor copy rewrite + schema description fix. (Tied forward-references to `mcpErrorTimeoutMs` knob that no longer ships in this PR; revert was cleanest.)
- **W3 (T006-T016)** — MCP-error watchdog state machine. Full subsystem (watchdog module + signal protocol + types + frontmatter knob + runner wiring + tests). Defensible defense-in-depth but NOT required to unblock pij. Workshop 001 stays Contract Ready for the follow-up plan to pick up directly.
- **W4 (T017-T020)** — Diagnostic CLI surfaces (`agent info --remote/--local/--diff`, `tail --since-tool/--around-error`). Genuinely useful for enforcing the dogfood rule but adjacent to the wedge fix.
- **Cross-cutting T021-T023** — New docs page, AGENTS.md cross-links, final `just fft` gate. Cross-links to non-existent (deferred) sections wouldn't make sense.

**Why reduce**: original bug is ~3 JSON edits in `agent.json`. The unblock-pij work is W1 alone. W3 birthed during workshop because the spec asked "how do we prevent this *class* of wedge?" — worthy question, wrong PR. W4 birthed from the live #30 dialogue identifying diagnostic gaps — also worthy, also wrong PR. Splitting them into a follow-up plan keeps the 0.2.0 ship atomic and reviewable.

**The following follow-up dossiers preserve the design work**:
- This plan + spec + workshop 001 are intact and Contract-Ready for a future plan to lift the W3 watchdog work.
- FX001 dossier captures the schema-location pivot decision permanently.
- The 6 reverted commits remain in git reflog (`0a25434..efbafb1`) for ~30-90 days if recovery becomes useful.

## Summary

A 24-task single-phase plan that ships `code-review-companion@0.2.0` with its missing coordination schemas (unbreaks every downstream install), closes the same hole on the implicit-manifest install path, adds a runner-level MCP-error watchdog that terminates zombie runs with `terminalReason: 'mcp_error'`, and surfaces two diagnostic CLI verbs (`agent info --remote/--local/--diff`, `tail --since-tool / --around-error`) the live dialogue on issue [#30](https://github.com/AI-Substrate/minih/issues/30) identified as the missing pieces to make the dogfood rule enforceable. Workstreams land in dependency order in a single PR per spec clarify Q5.

## Target Domains

| Domain | Status | Relationship | Role |
|--------|--------|-------------|------|
| runner | existing | **modify** | Agent data (`agents/code-review-companion/*`), agent-pack manifest (`CANONICAL_AGENT_FILES`), new `watchdog.ts` module, frontmatter parser extension, terminal-write reconciliation, resume-stale-field fix |
| cli | existing | **modify** | Doctor warning copy, `minih agent info --remote/--local/--diff`, `minih tail --since-tool / --around-error`, new exit code 125 |
| mcp | existing | **consume** | `state.ts`'s `state/inside-state.schema.json` resolution already supports the preferred location (FX001 of plan 009); no mcp changes |
| adapter | existing | **consume** | `AgentEvent` union extended with `mcp_error_watchdog_fired` — additive only; existing consumers treat unknown types as no-ops |
| measurement | existing | not involved | n/a |

## Domain Manifest

Every file this plan introduces or modifies, mapped to its domain. Paths absolute relative to `/Users/jordanknight/substrate/minih/`.

| File | Domain | Classification | Rationale |
|------|--------|---------------|-----------|
| `agents/code-review-companion/agent.json` | runner | contract (agent manifest) | Bump to 0.2.0; add 3 file entries (outside.md, 2 schemas) |
| `agents/code-review-companion/outside.md` | runner | internal (agent data) | **NEW**. Outside-side coordination contract per FX003b-1 |
| `agents/code-review-companion/inside-state.schema.json` | runner | internal (agent data) | EXISTS today (at root per FX001 — was incorrectly placed under `state/` before; `state/` is a runtime-dir denylisted by the install validator). Modify only: remove stale "validation is not yet enforced" description per spec AC12 |
| `agents/code-review-companion/outside-state.schema.json` | runner | internal (agent data) | **NEW**. Per FX003b-3, ships at agent root per FX001 |
| `src/runner/agent-pack/manifest.ts` | runner | internal | **Verify only per FX001** — `CANONICAL_AGENT_FILES` already lists `inside-state.schema.json` and `outside-state.schema.json` at root (lines 33-37). T003 collapses to docs-only |
| `src/runner/types.ts` | runner | contract | Widen `LiveRunManifest.terminalReason` union; add `mcpError` field; add `AgentDefinition.mcpErrorTimeoutMs`; widen `CompletedMetadata` |
| `src/runner/folder.ts` | runner | internal | Extend frontmatter parser to read `mcpErrorTimeoutMs` |
| `src/runner/runner.ts` | runner | internal | Wire watchdog into `handleEvent`; post-run reconciliation; **fix resumeInPlace clear-stale-terminal-fields (latent bug per workshop §Resume)** |
| `src/runner/watchdog.ts` | runner | internal | **NEW**. `createMcpErrorWatchdog({ timeoutMs, onFire })` per workshop §Decision Space option B |
| `src/runner/mcp-error-signal.ts` | runner | internal | **NEW**. Signal-3 (inside-state) + signal-4 (inside-inbox) helpers; mirrors `runner/permissions/error-signal.ts` |
| `src/adapter/events.ts` | adapter | contract | Add `mcp_error_watchdog_fired` to `AgentEvent` union (additive) |
| `src/templates/shared-preamble.md` | runner | internal | Document `mcpErrorTimeoutMs` knob for agent authors |
| `src/cli/commands/doctor.ts` | cli | internal | Rewrite vocabulary-drift warning copy per spec AC11 |
| `src/cli/commands/agent.ts` | cli | internal | Extend `agent info` with `--remote/--local/--diff` flags |
| `src/cli/commands/tail.ts` | cli | internal | Add `--since-tool <name>` and `--around-error [N]` flags |
| `src/cli/output/errors.ts` | cli | contract (error codes) | Add `MCP_ERROR_WATCHDOG_FIRED` (exit 125) |
| `src/runner/agent-pack/install.ts` | runner | internal | Extract "read remote manifest without installing" helper to support `agent info --remote` |
| `agents/coordination-loop-validator/prompt.md` | runner | internal (agent data) | Set `mcpErrorTimeoutMs: null` (its tests deliberately exercise `isError` paths — workshop §Frontmatter Contract) |
| `docs/how/companion-install-resilience.md` | cli (docs) | contract (operator-facing) | **NEW**. Hybrid docs per clarify Q3 |
| `AGENTS.md` | runner (docs) | contract | Cross-link to new resilience doc from § Companion mode |
| `docs/how/companion-mode.md` | runner (docs) | contract | Cross-link to new resilience doc from troubleshooting |
| `test/runner/agent-pack/companion-manifest.test.ts` | runner (test) | internal | Update to assert 7 files |
| `test/runner/agent-pack/install.test.ts` | runner (test) | internal | Add implicit-manifest fixture covering `state/` schemas |
| `test/cli/agent-list-baseline.test.ts` | cli (test) | internal | Update snapshot for 0.2.0 |
| `test/cli/doctor-state-vocabulary.test.ts` | cli (test) | internal | Update for new warning copy |
| `test/runner/watchdog.test.ts` | runner (test) | internal | **NEW**. Unit tests for state machine (Disarmed/Armed/Fired) |
| `test/runner/runner-watchdog.test.ts` | runner (test) | internal | **NEW**. Integration via FakeAgentAdapter; 7 scenarios from workshop |
| `test/cli/agent-info-remote.test.ts` | cli (test) | internal | **NEW**. `agent info --remote/--local/--diff` via `MINIH_AGENT_PACK_FETCHER=fake:...` |
| `test/cli/tail-filters.test.ts` | cli (test) | internal | **NEW**. `--since-tool` + `--around-error` |

## Key Findings

| # | Impact | Finding | Action |
|---|--------|---------|--------|
| C1 | Critical | **`installAgentPack` already computes `changedFiles[]` via per-file checksum diff** (`src/runner/agent-pack/install.ts:467-471` — `priorSidecar.fileChecksums` vs current). AC-COMPANION-UPGRADE-DETECTION works out of the box once `agent.json` lists the 3 new files. No upgrade-detection logic needs to change. | T001-T003 ship FX003b; AC verified by re-running install on a 0.1.0 install per spec AC4 |
| C2 | Critical | **5-signal terminal-write protocol exists** (`src/runner/permissions/error-signal.ts`, `runAgent.ts:751-805`). Watchdog mirrors structure: latch (`terminalFired`), payload, signals 3-4 fire from in-flight handler, signal 2 (run.json) writes post-run. Don't re-invent. | T008/T009/T010 mirror this file's shape verbatim |
| C3 | Critical | **`resumeInPlace` spreads stale `terminalReason` into the resumed `run.json`** (`runner.ts:444-482`). Latent today (no test covers resume-after-denial); widening `terminalReason` union to include `mcp_error` exacerbates it. Fix surgical (~3-line edit) — explicitly clear `terminalReason`/`permissionError`/`mcpError` on resume. | T011 (in scope per workshop §Resume) |
| C4 | Critical | **`AgentDefinition` already exposes `timeout`/`model`/`reasoning` at frontmatter root** (`src/runner/types.ts:17-25`). `mcpErrorTimeoutMs: number \| null` parses through the same path. Q7 clarify decision (flat root) lands trivially. | T005 + T007 |
| H1 | High | **`terminalReason: 'permission-denied'` is a literal type today** (`types.ts:396`). Every `=== 'permission-denied'` check site needs to be widened to a union. Grep audit before T005 — likely sites: `cli/commands/status.ts`, `runner/probe/aggregator.ts`, `permissions/error-signal.ts`. | T005 includes a grep audit; widen any narrowing checks |
| H2 | High | **Companion-mode mandatory per `AGENTS.md`** when editing source. Implementation gate: boot `code-review-companion` BEFORE T001 begins. Recursion noted: Phase 1 deliverable IS the companion's missing schemas; locally-checked-out copy will run fine (schemas live in source tree); only the install-payload is broken. | T000 (pre-implementation gate) |
| H3 | High | **`agent info --remote` needs a code path that doesn't exist in `installAgentPack`** — read remote manifest without installing. The fetcher → extractor → manifest-validate chain currently lands files. Need to extract a "stop after manifest-validate" mode. May force a small fetcher seam refactor; spec R2 flagged this. | T015 extracts the helper; if hairy, T016-T018 can demote `--remote` to a follow-up PR per spec R2 |
| H4 | High | **`AgentEvent` is a discriminated union narrowed by `event.type` switch statements** across `runner/pretty.ts`, `runner/human-view-model.ts`, `runner/peer-activity.ts`, `cli/commands/status.ts`. Adding `mcp_error_watchdog_fired` must not break exhaustiveness checks. Most paths already have `default: break` fall-through, but verify per consumer. | T006 grep audit before commit |

## Implementation

**Objective**: Land FX003b's deferred manifest fix, close the implicit-manifest hole on the install path, add a runner-level MCP-error watchdog that terminates zombie runs, and surface two diagnostic CLI verbs — in one PR, in workstream order so each commit can be reverted independently if CI catches a regression.

**Testing Approach**: Lightweight (Simple mode default; clarify Q2 = Targeted mocks). `FakeAgentAdapter` for watchdog tests; real fs + fixture dirs for install/CLI tests; `MINIH_AGENT_PACK_FETCHER=fake:...` env seam for `agent info --remote`; no real network, no real GPT-5.5.

**Pre-implementation gate (T000)**: Boot `code-review-companion` per AGENTS.md. Run pings at every commit boundary; final `control:stop` + retro harvest before final report.

### Tasks

#### Workstream 1 — FX003b: ship 0.2.0 (unblock pij)

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|--------|-----|------|--------|---------|-----------|-------|
| [x] | T000 | **Pre-implementation companion-mode gate.** Boot `code-review-companion` (`minih run code-review-companion &`); confirm `verdict: 'active'` via `minih status`; brief it with plan path + protocol (review-request at every commit, fire-and-forget). | runner | n/a (operator action) | Companion run active before T001 begins | AGENTS.md mandate; H2 finding |
| [x] | T001 | **FX003b authoring (post-FX001 path).** Verify `agents/code-review-companion/inside-state.schema.json` exists at agent root (it does today, moved from `state/` by FX001). Author `agents/code-review-companion/outside-state.schema.json` at agent root (mirror inside enum: `idle, in-progress, paused, done, error` — outside default vocabulary). Author `agents/code-review-companion/outside.md` (fresh prose per spec OQ4; reference `agents/coordination-loop-validator/outside.md` for shape, lift companion-mode protocol semantics from `docs/how/companion-mode.md`). Update `agents/code-review-companion/agent.json` to list 7 files at root paths; bump `version: '0.2.0'`. **Schemas ship at agent root because `state/` is in RUNTIME_DIR_NAMES denylist — see FX001 dossier for full rationale.** | runner | `/Users/jordanknight/substrate/minih/agents/code-review-companion/{agent.json,outside.md,inside-state.schema.json,outside-state.schema.json}` | All 4 files exist at expected root paths; `agent.json` parses via `validateManifest()`; 7-file count matches spec AC3 | Per FX003b dossier task FX003b-1/2/3/4 + FX001 path pivot |
| [x] | T002 | **Update tests for FX003b.** Update `test/runner/agent-pack/companion-manifest.test.ts` to assert 7 files. Update `test/cli/agent-list-baseline.test.ts` snapshot. Add a regression test verifying `0.1.0 → 0.2.0` upgrade reports `action: 'upgraded'` with the 3 new files in `changedFiles[]` (spec AC4). | runner (test) | `/Users/jordanknight/substrate/minih/test/runner/agent-pack/companion-manifest.test.ts`, `/Users/jordanknight/substrate/minih/test/cli/agent-list-baseline.test.ts`, new test file for upgrade-detection | `MINIH_REGRESSION=1 npm test` green; upgrade test green | C1 finding — no install logic changes needed |

#### Workstream 2 — Implicit-manifest + doc/copy fixes

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|--------|-----|------|--------|---------|-----------|-------|
| [x] | T003 | **Verify `CANONICAL_AGENT_FILES` (post-FX001 docs-only).** Per FX001, the canonical list at `src/runner/agent-pack/manifest.ts:33-37` already includes `inside-state.schema.json` and `outside-state.schema.json` at agent root — no code change needed. Verify the list against post-FX001 expectations; ensure `CANONICAL_FILE_DESCRIPTIONS` (lines 39-47) describes these accurately. **Semantic note (FX001 § 5 wording flip):** post-FX001 the root paths are the **canonical** install destination; the `state/` lookup in `state.ts` is the **back-compat** path (used today only by `demo-companion` via its source tree, not via install). Do NOT describe root entries as "legacy" — they are now the convention. | runner | `/Users/jordanknight/substrate/minih/src/runner/agent-pack/manifest.ts` (verify-only) | List unchanged; descriptions accurate; T003 collapses to docs-only per FX001 | Spec AC6; FX001 collapses original "patch the list" scope |
| [ ] | T004 | **Implicit-manifest fixture test (post-FX001 paths).** Add to `test/runner/agent-pack/install.test.ts`: a fresh local install of a fixture agent with `prompt.md` + `inside-state.schema.json` + `outside-state.schema.json` (all at agent root; no `agent.json`) succeeds, and the installed copy contains both schemas at root. | runner (test) | `/Users/jordanknight/substrate/minih/test/runner/agent-pack/install.test.ts` | Test green | Spec AC6 (post-FX001 paths) |
| [ ] | T005 | **Doctor warning copy rewrite + stale schema description fix (post-FX001 path).** In `src/cli/commands/doctor.ts:640`, replace "calls to these values will be silently rejected" with accurate text per spec AC11: name the runtime behaviour ("rejected at MCP `state_transition`"), DROP "silently rejected" phrase, reference `mcpErrorTimeoutMs` knob as safety net. **Per FX001 MW-003: the rewritten copy should mention BOTH valid schema locations (`<agentDir>/inside-state.schema.json` AND `<agentDir>/state/inside-state.schema.json`) so authors copying from `code-review-companion` or `demo-companion` both get accurate guidance.** Update `agents/code-review-companion/inside-state.schema.json` description field — remove "minih runtime currently validates output-schema.json and the shared outside-state.schema.json, but inside-state validation is not yet enforced" (per spec AC12). Update `test/cli/doctor-state-vocabulary.test.ts` to match new copy. Update `MINIH_REGRESSION=1` doctor baseline (R3 mitigation). | cli + runner (data) | `/Users/jordanknight/substrate/minih/src/cli/commands/doctor.ts`, `/Users/jordanknight/substrate/minih/agents/code-review-companion/inside-state.schema.json`, `/Users/jordanknight/substrate/minih/test/cli/doctor-state-vocabulary.test.ts` | `minih doctor` warning copy matches spec AC11 + mentions both schema locations; baseline test green | R3 mitigation + FX001 MW-003 |

#### Workstream 3 — MCP-error watchdog [DEFERRED 2026-05-16]

🚧 **Deferred to a follow-up plan.** Workshop 001 stays Contract Ready as the design contract for that plan to inherit. The 6 watchdog commits (T007-T011 + T005) were reset out of this branch 2026-05-16 per KISS scope reduction. T013 (resumeInPlace stale-terminal fix) is also deferred — it was only in scope because the watchdog widened the terminalReason union; without that widening, the latent bug stays latent until the watchdog ships.

| Status | ID | Task | Notes |
|--------|-----|------|-------|
| [DEFER] | T006-T016 | Full watchdog workstream (audit, types, events, parser knob, state machine, signal protocol, runner wiring, resume fix, tests, exit code, preamble docs) | Workshop 001 §State Machine + §Signal Protocol + §Frontmatter Contract describe the implementation precisely. Follow-up plan picks up at T006. |

#### Workstream 4 — Diagnostic CLI surfaces [DEFERRED 2026-05-16]

🚧 **Deferred to a follow-up plan.** `agent info --remote/--local/--diff` requires a fetcher seam refactor; `tail --since-tool / --around-error` is also new CLI surface. Useful, but adjacent to the wedge fix.

| Status | ID | Task | Notes |
|--------|-----|------|-------|
| [DEFER] | T017-T020 | Full CLI diagnostics workstream | Spec ACs 13-17 + dogfood-rule checklist live there. |

#### Cross-cutting [DEFERRED 2026-05-16]

🚧 **Deferred** — the new docs page would cross-link to non-existent (deferred) sections. Re-shape when W3+W4 ship in the follow-up plan.

| Status | ID | Task | Notes |
|--------|-----|------|-------|
| [DEFER] | T021 | Author docs/how/companion-install-resilience.md | Deferred with W3/W4 |
| [DEFER] | T022 | Cross-link AGENTS.md + companion-mode.md + post issue #30 follow-up | Issue #30 follow-up still needed once 0.2.0 publishes — will land in a small docs-only PR or alongside the W3 follow-up plan. |
| [DEFER] | T023 | Final just fft + companion control:stop + retro harvest | Shipping path will run `just fft` before commit per AGENTS.md; the formal T023 ceremony defers. |


**[DEFER 2026-05-16] Workstream 3 + 4 + Cross-cutting tasks deferred per scope reduction.** Original detail kept below for follow-up plan reference.

 Before widening `terminalReason` union, find every `=== 'permission-denied'` / `=== "permission-denied"` site and confirm widening is safe. Likely sites: `cli/commands/status.ts`, `runner/probe/aggregator.ts`, `permissions/error-signal.ts`. | runner | (audit, no edit) | List of sites collected; widening plan confirmed for T007 | H1 mitigation |
| [ ] | T007 | **Extend runner types.** Widen `LiveRunManifest.terminalReason: 'permission-denied' \| 'mcp_error'`. Add `mcpError?: { firstIsErrorAt, lastIsErrorAt, timeoutMs, terminatedToolName, streakLength }` field per workshop §Signal 2. Mirror `mcpError` in `CompletedMetadata`. Add `mcpErrorTimeoutMs?: number \| null` to `AgentDefinition`. Update any sites identified in T006. | runner | `/Users/jordanknight/substrate/minih/src/runner/types.ts` + sites from T006 | `npm run build` green | Workshop §Signal 2 / §Frontmatter Contract |
| [ ] | T008 | **Extend `AgentEvent` union.** Add `mcp_error_watchdog_fired` event type to `src/adapter/events.ts` per workshop §Signal 1. Grep-verify exhaustiveness in `runner/pretty.ts`, `runner/human-view-model.ts`, `runner/peer-activity.ts`, `cli/commands/status.ts` — most have `default: break`; confirm or add. | adapter + runner + cli | `/Users/jordanknight/substrate/minih/src/adapter/events.ts` (+ minor consumer touches) | `npm run build` green; no exhaustiveness errors | H4 mitigation |
| [ ] | T009 | **Frontmatter parser reads `mcpErrorTimeoutMs`.** Extend `parseFrontmatter` (in `src/runner/folder.ts`) or downstream `loadAgentDefinition` to thread `mcpErrorTimeoutMs: number \| null` into `AgentDefinition`. Resolution rule per workshop: `null` or `<=0` → opt-out; `undefined` → default 60000; integer > 0 → use as-is. | runner | `/Users/jordanknight/substrate/minih/src/runner/folder.ts` | Unit test: agent with `mcpErrorTimeoutMs: 5000` resolves to `5000`; with `null` resolves to `null` (disabled); absent resolves to `60000` | Workshop §Frontmatter Contract; clarify Q7 |
| [ ] | T010 | **Implement `src/runner/watchdog.ts`.** Per workshop §Decision Space option B: `createMcpErrorWatchdog({ timeoutMs, onFire }): { observeEvent, dispose, hasFired }`. State machine: Disarmed → Armed (on `tool_result.isError=true`) → Disarmed (on `tool_call` or `tool_result.isError=false`) → Armed (re-arm; reset timer) → Fired (timer expiry). Latch via `terminalFired`. `dispose()` clears pending timer. | runner | `/Users/jordanknight/substrate/minih/src/runner/watchdog.ts` (NEW) | Module exports the workshop's documented interface; unit tests T014 verify state transitions | Workshop §State Machine / §Decision Space |
| [ ] | T011 | **Implement signal helpers.** New `src/runner/mcp-error-signal.ts` mirroring `runner/permissions/error-signal.ts`. Functions: `buildMcpErrorPayload(...)`, `fireInsideStateSignal(...)`, `fireOutsideInboxSignal(...)`, `fireTerminalMcpError(...)`. Signal 3 writes inside-state with `status: 'error', data.mcpError: {...}`. Signal 4 appends typed `mcp-error` inbox message to inside lane (sender === lane invariant). Coordinated agents only; failures captured in `signalFailures[]`, never thrown. | runner | `/Users/jordanknight/substrate/minih/src/runner/mcp-error-signal.ts` (NEW) | All functions exported; coordinated test fixture validates signals 3-4 fire on Fired transition | C2 mirror; workshop §Signals 3-4 |
| [ ] | T012 | **Wire watchdog into `runAgent.handleEvent` + post-run reconciliation.** In `src/runner/runner.ts`: (a) resolve `mcpErrorTimeoutMs` from `definition` + default. (b) Construct watchdog via `createMcpErrorWatchdog({ timeoutMs, onFire })` where `onFire` synthesizes the `mcp_error_watchdog_fired` event (signal 1), latches `mcpErrorState.terminalFired = true`, populates payload, calls `adapter.terminate(activeSessionId)`. (c) Extend `handleEvent` to call `watchdog.observeEvent(event)`. (d) After main try block, mirror denialState reconciliation: if `mcpErrorState.terminalFired && !denialState.terminalFired`, write signal 2 (`run.json` with `terminalReason: 'mcp_error'`, `mcpError: payload`), fire signals 3-4 via T011 helpers, override agentResult to canonical mcp_error shape (exit 125). | runner | `/Users/jordanknight/substrate/minih/src/runner/runner.ts` | All 7 workshop test scenarios pass | Workshop §State Machine + §Precedence Ladder R1-R4 |
| [ ] | T013 | **Fix `resumeInPlace` clear-stale-terminal-fields (latent bug).** In `runner.ts:444-482`, the `updated` object explicitly sets `terminalReason: undefined, permissionError: undefined, mcpError: undefined` on resume. Add regression test (workshop §Scenario 6): resume an mcp_error'd run, confirm `terminalReason` is cleared. | runner + runner (test) | `/Users/jordanknight/substrate/minih/src/runner/runner.ts`, `/Users/jordanknight/substrate/minih/test/runner/runner-resume.test.ts` (extend) | Resume test green; no stale terminalReason propagates | C3 finding; workshop §Resume |
| [ ] | T014 | **Watchdog tests (unit + integration).** Two new files. `test/runner/watchdog.test.ts`: unit tests for state machine — Disarmed/Armed/Fired transitions, re-arm on second isError, disarm-on-tool_call, disarm-on-success-result, opt-out via `timeoutMs: null`. `test/runner/runner-watchdog.test.ts`: integration via `FakeAgentAdapter` — 7 scenarios from workshop (default-on fires, recovery cancels, opt-out, configurable threshold, precedence vs permission-denied, resume clears stale, coordinated signals 3-4). Use `mcpErrorTimeoutMs: 200` for integration tests (workshop's example uses 50ms; bumped to 200ms to leave headroom for CI scheduling jitter — R5 mitigation). Tests assert elapsed-since-arm comparisons rather than absolute wall-clock thresholds, to stay deterministic. | runner (test) | `/Users/jordanknight/substrate/minih/test/runner/watchdog.test.ts` (NEW), `/Users/jordanknight/substrate/minih/test/runner/runner-watchdog.test.ts` (NEW) | All 7 scenarios green; tests run in <3s combined; no flakes across 100 consecutive runs | Workshop §Test Scenarios; R5 mitigation tightened |
| [ ] | T015 | **Add exit code 125 + opt-out `coordination-loop-validator`.** In `src/cli/output/errors.ts`, add `MCP_ERROR_WATCHDOG_FIRED` error code mapping to exit 125. In `agents/coordination-loop-validator/prompt.md` frontmatter, add `mcpErrorTimeoutMs: null` (its tests deliberately exercise `isError` paths per workshop §Frontmatter Contract Required Updates). | cli + runner (data) | `/Users/jordanknight/substrate/minih/src/cli/output/errors.ts`, `/Users/jordanknight/substrate/minih/agents/coordination-loop-validator/prompt.md` | CLI maps exit 125 to the new code; validator's existing tests still pass | R1 mitigation; workshop §Q4 resolved |
| [ ] | T016 | **Document `mcpErrorTimeoutMs` in shared preamble.** Add one paragraph to `src/templates/shared-preamble.md` documenting the knob (default 60s, set to `null` to disable, watchdog applies to all runs). | runner (data) | `/Users/jordanknight/substrate/minih/src/templates/shared-preamble.md` | Shared preamble references the knob; doctor copy aligns | Agent-author discoverability |

#### Workstream 4 — Diagnostic CLI surfaces

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|--------|-----|------|--------|---------|-----------|-------|
| [ ] | T017 | **Extract "read remote manifest without installing" helper.** In `src/runner/agent-pack/install.ts`, factor out the fetch + extract + manifest-validate chain into a reusable function (e.g., `readRemoteManifest({ source, fetcher })`) that returns the parsed `AgentPackManifest` + `commitSha` without writing files. `installAgentPack` calls this then proceeds to copy; `agent info --remote` calls this and stops. | runner | `/Users/jordanknight/substrate/minih/src/runner/agent-pack/install.ts` (refactor) | New helper exported via `runner/agent-pack/index.ts`; existing install tests still green | H3 finding; needed by T018 |
| [ ] | T018 | **Implement `agent info --remote/--local/--diff`.** In `src/cli/commands/agent.ts:registerAgentCommand`, extend the `info` subcommand with three flags. `--remote <slug>`: resolves registry slug → URL via existing `resolveRegistrySlug`, calls T017 helper, prints manifest envelope to stdout. `--local <slug>`: reads installed sidecar + manifest, prints same envelope shape. `--diff <slug>`: runs both, diffs `files[]` by path + checksums, surfaces added/removed/changed. Surface resolved `(owner, repo, ref, subpath)` in `--remote` output per spec OQ2. | cli | `/Users/jordanknight/substrate/minih/src/cli/commands/agent.ts` | Three flags work; `agent info code-review-companion --remote` prints the new 7-file manifest; envelope shape stable | Spec AC13, AC14; OQ2 resolved (surface coords) |
| [ ] | T019 | **Implement `tail --since-tool <name>` + `--around-error [N]`.** In `src/cli/commands/tail.ts`, extend `registerTailCommand`. `--since-tool <name>`: in snapshot mode (R3 in spec — snapshot-only for v1, OQ3 resolved), find the most-recent `tool_call` where `event.data.toolName === <name>` OR `event.data.toolName.endsWith('-' + <name>)` (handle MCP-namespaced `minih-coordination-state_transition`); emit events from that index forward. `--around-error [N=10]`: thin wrapper — find last `tool_result` with `isError: true`, return ±N events. If no matching tool/error found, exit with error envelope (`E_NO_MATCH` / `E_NO_ERROR_EVENTS`) and non-zero exit code. Document in `--help` that filters are `--snapshot`-only for v1. | cli | `/Users/jordanknight/substrate/minih/src/cli/commands/tail.ts` | `minih tail <slug> --snapshot --since-tool state_transition --lines 200` returns the relevant tail; `--around-error` finds the wedge | Spec AC15, AC16; OQ3 resolved |
| [ ] | T020 | **CLI tests for agent info + tail.** New `test/cli/agent-info-remote.test.ts`: covers `--remote` (via `MINIH_AGENT_PACK_FETCHER=fake:...` env seam), `--local`, `--diff`. New `test/cli/tail-filters.test.ts`: covers `--since-tool` exact + namespaced match, `--around-error` happy + no-match paths. Both via `execFileSync` against the built CLI per existing convention. | cli (test) | `/Users/jordanknight/substrate/minih/test/cli/agent-info-remote.test.ts` (NEW), `/Users/jordanknight/substrate/minih/test/cli/tail-filters.test.ts` (NEW) | Tests green; covers all happy + error paths | — |

#### Cross-cutting — docs + release hygiene

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|--------|-----|------|--------|---------|-----------|-------|
| [ ] | T021 | **Author `docs/how/companion-install-resilience.md`.** Cover (a) the watchdog (knob, default 60s, opt-out via `mcpErrorTimeoutMs: null`, exit code 125, what `terminalReason: 'mcp_error'` means), (b) `minih agent info --remote/--local/--diff` (when to use each), (c) `minih tail --since-tool / --around-error` (the wedge-debug pattern), (d) dogfood-rule cross-reference. Match style of `docs/how/agent-pack.md`, `docs/how/companion-mode.md`. | cli (docs) | `/Users/jordanknight/substrate/minih/docs/how/companion-install-resilience.md` (NEW) | Page exists; covers all 4 sections | Clarify Q3 = Hybrid |
| [ ] | T022 | **Cross-link from `AGENTS.md` + `docs/how/companion-mode.md`. Also: post follow-up comment on issue [#30](https://github.com/AI-Substrate/minih/issues/30) noting the Q7 frontmatter reversal** — the spec-clarify Q7 resolution flipped the watchdog knob from the nested `coordination.mcpErrorTimeoutMs` form the pij agent assumed to a flat `mcpErrorTimeoutMs` at the root. AGENTS.md § Companion mode: add one-line reference to new resilience doc and the `mcpErrorTimeoutMs` knob. companion-mode.md troubleshooting section: add cross-link to resilience doc's wedge-debug pattern. | runner (docs) + cli (comms) | `/Users/jordanknight/substrate/minih/AGENTS.md`, `/Users/jordanknight/substrate/minih/docs/how/companion-mode.md`, GitHub issue #30 comment | Both files cross-link the new page; issue #30 comment acknowledges Q7 flat-form reversal so pij docs/agents don't drift | Clarify Q3 = Hybrid; M-4 (validation finding) |
| [ ] | T023 | **Final quality gate: `just fft` green.** Run the full pipeline (`lint → format → build → typecheck → test → audit`) plus `MINIH_REGRESSION=1 npm test` plus the opt-in MCP-leak / e2e gates if touched. Send `control:stop` to companion and harvest retro before reporting back. Conventional commit messages used throughout (`feat:`, `fix:`, `docs:`) so release-please picks up `0.2.0` cleanly. | runner + cli | n/a (operator action) | `just fft` green; companion retro harvested; commit log reviewable | Pre-merge gate per AGENTS.md |

### Acceptance Criteria

All 17 ACs from the spec, mapped to the tasks that satisfy them:

- [ ] AC-COMPANION-INSTALL-SHIPS-SCHEMA — T001, T002
- [ ] AC-COMPANION-INSTALL-OUTSIDE-MD — T001, T002
- [ ] AC-COMPANION-VERSION-BUMP — T001, T002
- [ ] AC-COMPANION-UPGRADE-DETECTION — T002 (verifies C1)
- [ ] AC-COMPANION-STATE-TRANSITION-OK — T001 + manual smoke against `2026-05-15T16-05-38-307Z-3761` trace shape on fresh install (T023 final gate)
- [ ] AC-IMPLICIT-MANIFEST-SHIPS-STATE-SCHEMAS — T003, T004
- [ ] AC-WATCHDOG-DEFAULT-ON — T012, T014 (Scenario 1)
- [ ] AC-WATCHDOG-CANCELED-BY-RECOVERY — T012, T014 (Scenario 2)
- [ ] AC-WATCHDOG-OPT-OUT — T009, T012, T014 (Scenario 3)
- [ ] AC-WATCHDOG-CONFIGURABLE — T009, T014 (Scenario 4, implicit)
- [ ] AC-DOCTOR-COPY-ACCURATE — T005
- [ ] AC-SCHEMA-DESCRIPTION-ACCURATE — T005
- [ ] AC-AGENT-INFO-REMOTE — T017, T018, T020
- [ ] AC-AGENT-INFO-DIFF — T018, T020. **In scope, not aspirational.** If T017 refactor turns out hairy (spec R2), demote T017+T018+T019+T020 to a follow-up PR — but then mark AC14 explicitly deferred in that PR's release notes; do NOT silently ship 0.2.0 with AC14 unmet.
- [ ] AC-TAIL-SINCE-TOOL — T019, T020
- [ ] AC-TAIL-AROUND-ERROR — T019, T020
- [ ] AC-DOGFOOD-RULE-ENFORCEABLE — T021 (checklist documented), T018 + T019 (surfaces shipped)

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Watchdog default-on flip breaks `coordination-loop-validator` or other deliberately-isError-exercising tests | Medium | Medium | T015 sets `mcpErrorTimeoutMs: null` on the validator; T006 audit catches other call sites; T014 Scenario 5 (precedence vs permission-denied) covers the most likely false-positive |
| T017 refactor of `installAgentPack` to support "read manifest without install" turns out hairy | Medium | Low | Demote `agent info --remote/--local/--diff` (T017-T020) to a follow-up PR per spec R2; Workstreams 1-3 + cross-cutting still ship `0.2.0` cleanly and unbreak pij |
| `MINIH_REGRESSION=1` doctor/list baselines break unexpectedly | Low | Low | T005 updates the baseline in the same commit as the copy change; T002 updates `agent-list-baseline.test.ts` snapshot for 0.2.0 |
| One PR for all 4 workstreams (clarify Q5) — failed CI gate on one workstream blocks everything | Medium | Medium | Commit in workstream order (1 → 2 → 3 → 4); each commit is revertable independently if CI catches a regression mid-PR. If watchdog (W3) is the failure, revert T006-T016; ship W1+W2 as `0.2.0` immediately |
| Timer-driven watchdog tests are flaky on CI under load | Low | Medium | Use `mcpErrorTimeoutMs: 200` for integration tests (workshop uses 50ms as example; 200ms leaves headroom for CI scheduling jitter); avoid wall-clock assertions, use elapsed-since-arm comparisons; `FakeAgentAdapter` controls event timing precisely |
| Companion-mode itself wedges during implementation due to its own missing schemas | Low | High | The locally-checked-out companion has `state/inside-state.schema.json` in the source tree (verified during diagnosis); the bug is install-payload only. Confirm at T000 by `minih status code-review-companion` showing `verdict: 'active'` after boot |

---

## ADR Ledger

No ADRs created for this plan. `docs/adr/` convention does not exist in this repo; introducing it for a single Simple-mode plan is over-investment. The two behavioural commitments that would normally warrant ADRs are captured authoritatively in:

- **Watchdog applies to all runs (not just coordinated)** — clarify Q6 in spec; § Goals + workshop §Open Q3 (resolved).
- **Frontmatter knob is flat at root (`mcpErrorTimeoutMs`, not `coordination.mcpErrorTimeoutMs`)** — clarify Q7 in spec; workshop §Frontmatter Contract.

If minih later adopts an ADR convention, these can be backfilled.

---

## Next Steps

- **Now**: Boot `code-review-companion` per T000; then start T001.
- **After landing**: Reply on issue [#30](https://github.com/AI-Substrate/minih/issues/30) confirming `0.2.0` shipped; ping pij agent for upgrade-path verification. Note the Q7 frontmatter reversal (flat vs nested) so their docs don't drift.
- **Auto-regenerate `fltplan.md`**: This plan triggers `/plan-5b-flightplan --plan` per the architect skill's tail step. The fltplan's `Phases Overview` will update from "TBD" to the 24-task Simple-mode roll-up.

---

## Validation Record (2026-05-15)

### Validation Thesis

**Raison d'être**: Translate the resolved spec + workshop into a concrete, ordered, executable 24-task table that an implementing agent (`/plan-6-v2-implement-phase-companion`) can work through without re-asking design questions — while preserving the priority order that unbreaks downstream pij first.

**Value claim**: Implementation becomes execution, not design. A coding agent can take this plan and ship it; a reviewer can check the PR diff against the plan; downstream pij gets `0.2.0` faster.

**Artifact promise**: Every spec AC maps to a task; every workshop decision is reflected in task descriptions; every clarify answer constrains the plan; risks have mitigations encoded in task ordering or specific tasks; critical-path workstream (FX003b) is independently revertable if later workstreams break CI.

**Intended beneficiaries**: Implementing agent (`/plan-6` companion variant), PR reviewer, downstream pij agent watching issue #30, `code-review-companion` running alongside implementation.

**Proof target**: Implementation

**Evidence standard**: Each task has Done When criterion; AC→task mapping explicit; absolute paths; CS scores assigned; risks have mitigations; key findings cite verifiable source code lines.

**Thesis source**: `coordinated-install-resilience-spec.md` + `workshops/001-mcp-error-watchdog-state-machine.md` + clarify session 2026-05-15 (not inferred).

**Thesis verdict**: **Partially advanced → Advanced after fixes.** Plan reaches Implementation proof level post-validation. Pre-fix gaps were numerical (task count discrepancy) and forward-coordination (Q7 communication to pij not concretized).

**Main thesis risk**: Watchdog default-on flip across all runs (clarify Q6) may surprise non-coordinated test agents whose authors aren't watching this PR. Mitigated by T006 audit + T015 explicit opt-out on `coordination-loop-validator`, but other test agents could still be in-tree.

---

| Agent | Lenses Covered | Thesis Axes Covered | Issues | Verdict |
|-------|---------------|---------------------|--------|---------|
| A. Coherence + Domain Compliance | Domain Boundaries, Concept Documentation, Hidden Assumptions, Integration & Ripple | Implementation Readiness, Downstream Usefulness | 1 HIGH fixed (task count), 1 LOW open (Domain Manifest header phrasing) | ⚠️ → ✅ |
| B. Risk + Completeness | Edge Cases & Failures, Deployment & Ops, Hidden Assumptions, Technical Constraints | Evidence Sufficiency, Safety to Change | 2 MEDIUM fixed (AC14 commitment, R5 timer threshold), 1 LOW open (T013/T014 redundant coverage) | ⚠️ → ✅ |
| C. Thesis Alignment | **Thesis Alignment**, Evidence Sufficiency, Proof-Level Fit | Thesis Alignment, Proof-Level Fit | 1 MEDIUM fixed (proof mismatch via task-count) | ⚠️ → ✅ |
| D. Forward-Compatibility | **Forward-Compatibility**, Integration & Ripple, Cross-Domain Coordination | Cross-Domain Coordination, Downstream Usefulness | 1 HIGH fixed (contract drift via task count), 1 MEDIUM fixed (pij Q7 communication concretized in T022) | ⚠️ → ✅ |

**Lens coverage**: 11/15 (mandatory: Thesis Alignment ✅, Forward-Compatibility ✅; plus 9 others). Above 9/15 floor.

### Forward-Compatibility Matrix

| Consumer | Requirement | Failure Mode | Verdict | Evidence |
|----------|-------------|--------------|---------|----------|
| `/plan-6-v2-implement-phase-companion` | 7-column inline task table with absolute paths + Done When | shape mismatch | ✅ | Table format conforms to Simple-mode spec; each task has Done When |
| `/plan-6-v2-implement-phase-companion` | Accurate task count for progress tracking | contract drift | ✅ (fixed) | Was: 20/23/24 inconsistent across summary/fltplan/reality. Now: 24 everywhere |
| PR reviewer | Domain Manifest covers every file | encapsulation lockout | ✅ | 28 files mapped to runner/cli/adapter |
| PR reviewer | Workstream-revertable commit shape (clarify Q5) | lifecycle ownership | ✅ | R4 mitigation describes commit order + per-workstream revertability |
| Downstream pij agent on issue #30 | Q7 frontmatter reversal (flat root) communicated to avoid doc drift | contract drift | ✅ (fixed) | T022 now explicitly includes posting a follow-up comment on issue #30 noting the nested→flat reversal |
| `workshops/001-mcp-error-watchdog-state-machine.md` | Every state-machine decision reflected in W3 tasks | shape mismatch | ✅ | T006–T016 align with workshop §State Machine + §Signal Protocol; all 7 scenarios in T014 |
| `code-review-companion` | T000 brief includes plan path + protocol | shape mismatch | ✅ | T000 description includes plan path + review-request protocol |
| CI runners | Watchdog tests reliable under scheduling jitter | test boundary | ✅ (fixed) | T014 mitigation bumped from 50ms to 200ms threshold + elapsed-since-arm semantics (not absolute wall-clock) |

**Thesis alignment**: Value claim advanced from Partially to Yes after fixes; proof level reaches Implementation; main thesis risk remains the watchdog default-on flip's blast radius on non-coordinated test agents.

**Outcome alignment**: The plan advances the spec's stated value ("we fix all three together so future install-time and MCP-error failure modes degrade gracefully instead of silently") with task-count consistency restored, the Q7 reversal communication concretized, and CI-flakiness mitigation tightened.

**Standalone?**: No — 5 named downstream consumers exist (plan-6 skill, PR reviewer, pij agent, companion, workshop). Forward-Compatibility engaged per Engagement Policy default.

**Overall**: ⚠️ **VALIDATED WITH FIXES** — 1 HIGH, 3 MEDIUM, 2 LOW found; 1 HIGH + 3 MEDIUM fixed mechanically. 2 LOW open (Domain Manifest header phrasing; T013/T014 test-coverage redundancy) — accepted, do not block plan-6.

### Honest Limitations of This Validation

- Ran as **single serial validator**, not parallel subagents. The harness lacks the `task` tool the skill assumes. Lost: diversity-of-perspective check. Mitigation attempted: spent extra effort cross-referencing source files (verified C1, C3 findings against actual `runner.ts` / `install.ts` code).
- **Self-validation bias**: I wrote this plan; I'm now reviewing it. The fixes landed are real (the task-count discrepancy was verifiable), but a fresh validator might catch class of issues I'm blind to. Recommend the implementing agent or PR reviewer pass this plan through a second human/agent review before plan-6.
