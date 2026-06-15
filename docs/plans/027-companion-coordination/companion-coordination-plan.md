# Companion & Coordination Reliability Implementation Plan

**Plan Version**: 1.0.0
**Created**: 2026-06-14
**Spec**: [companion-coordination-spec.md](./companion-coordination-spec.md)
**Mode**: Full
**Status**: READY

## Gate Matrix

| Gate | Check | Status | Notes |
|------|-------|--------|-------|
| G1 | Clarify | PASS | No `[NEEDS CLARIFICATION]` markers; spec § Clarifications (2026-06-14) resolves Mode/Testing/Mocks/Docs. |
| G2 | Constitution | N/A | No `docs/project-rules/constitution.md` (only `harness.md`). |
| G3 | Architecture | N/A | No `docs/project-rules/architecture.md`. |
| G4 | ADR Compliance | N/A | No `docs/adr/` ADRs present. |
| G5 | Structure | PASS | All Output-Contract sections present and populated. |
| G6 | Testing Alignment | PASS | Full TDD; every phase tables a RED test before impl; ACs measurable. |
| G7 | Domain Completeness | PASS | All five spec domains exist in `registry.md`; no NEW domains; manifest covers every referenced file; pack is non-domain (DB-08). |

## Summary

Reconcile **one** companion-coordination contract and make it reliable and self-describing across eight GitHub issues (#40, #32, #35, #36, #25, #29, #31, #27). The fixes are logic-heavy and correctness-critical — `wait_for_any` queued-message delivery (#40), ledger derivation over the durable lanes (#36), idle policy + a shutdown-window drain (#35), state-vocabulary coherence (#27/#31), runtime self-discovery (#29) — plus two verify-and-close edges (#25, and, per research, much of #27/#31) whose fixes already partly exist in the tree. No transport change (file lanes stay), no breaking envelope reshape (additive only). The plan is dependency-ordered (one phase per issue cluster) and front-loaded with an **optional Phase 0** that builds the two deterministic sensors the post-spec backpressure survey recommended, so the hardest live-behaviour claims become provable rather than eyeballed.

## Target Domains

| Domain | Status | Relationship | Role |
|--------|--------|-------------|------|
| runner | existing | **modify** | `event-wait` unread/ack unification (#40); `deriveCompanionLedger` over lanes (#36); idle policy + stop-window drain (#35); permission-precondition doc (#25) |
| mcp | existing | **modify** | `wait_for_any` parity surface (#40); new `coordination_status` self-discovery tool (#36/#29); state-schema resolution (verify, #27/#31) |
| cli | existing | **modify** | `minih companion status` verb (#36); contract-phrase + state-vocab doctor checks (#27/#31, #32); registry housekeeping (#29) |
| adapter | existing | **modify** *(Phase 0 only — optional)* | `MINIH_FAKE_ADAPTER` scripted-adapter seam extending `src/adapter/fake.ts` (backpressure enabler). Otherwise consumed unchanged. |
| measurement | existing | **consume** | No contract change; lifecycle counters are not surfaced as metrics in this plan. |

### Non-domain artifact (governed by convention, not the domain registry — DB-08)

- **`agents/code-review-companion/` pack** — **modify**: per-pack state schema (relocate + correct), prompt vocabulary/idle wording, and wake-filter usage change **in lockstep** with the contract decisions. `minih doctor` is the coherence sensor enforcing the lockstep.

## Domain Manifest

| File | Domain | Classification | Rationale |
|------|--------|---------------|-----------|
| `src/adapter/fake.ts` | adapter | internal | Phase 0: extend with a scripted variant that drives inbox/state/wait over real lanes |
| `src/adapter/index.ts` | adapter | contract | Phase 0: `MINIH_FAKE_ADAPTER` env selection at adapter construction |
| `src/cli/commands/doctor.ts` | cli | internal | Phase 0 contract-phrase drift check; Phase 3 verify state-vocab drift; Phase 6 registry/tool-count check |
| `src/runner/coord-write-precondition.ts` | runner | internal | Phase 1 (#25): verify E205 boot gate kills the write-deny repro |
| `docs/how/companion-mode.md` | cli (docs) | cross-domain | Phase 1 doc-correction (E205 fires at boot, not as inbox msg); Phase 6 reconciliation |
| `src/runner/event-wait.ts` | runner | internal | Phase 2 (#40): unify `inbox.message` branch on unread/ack; single-settle cleanup re-entry guard |
| `src/runner/inbox-poll.ts` | runner | contract | Phase 2: **export** the private `listVisible`/unacked helper so `event-wait` reuses one consumed-model |
| `src/mcp/tools/wait.ts` | mcp | internal | Phase 2: tool delegates to `runner.waitForAny`; wildcard (no-filter) wake documented |
| `agents/code-review-companion/state/inside-state.schema.json` | pack | cross-domain | Phase 3: relocate from legacy root path to preferred `state/`; correct stale "not enforced" description |
| `agents/code-review-companion/inside-state.schema.json` | pack | cross-domain | Phase 3: legacy file removed after relocation (kept resolving today) |
| `src/mcp/tools/state.ts` | mcp | internal | Phase 3: verify 3-level resolution accepts the full companion enum (no change expected) |
| `src/runner/types.ts` | runner | contract | Phase 4: add `CompanionLedger` type |
| `src/runner/companion-ledger.ts` | runner | contract | Phase 4 (#36): NEW pure `deriveCompanionLedger(location)` over lanes (reuses `folder.ts` path helpers) |
| `src/cli/commands/companion.ts` | cli | internal | Phase 4: NEW `minih companion status [--json]` verb over the deriver |
| `src/cli/index.ts` | cli | internal | Phase 4: register `registerCompanionCommand(program)` |
| `src/mcp/tools/coordination-status.ts` | mcp | internal | Phase 4 (#36/#29): NEW inside tool (ledger summary + draft farewell + self-discovery trio), mirrors `permission-status.ts` |
| `src/mcp/types.ts` | mcp | contract | Phase 4: add `coordination_status` to `MCP_TOOL_NAMES` + `TOOL_CONTRACTS` (8 → 9) |
| `src/mcp/server.ts` | mcp | internal | Phase 4: dispatch case for `coordination_status` |
| `src/mcp/index.ts` | mcp | contract | Phase 4: export the new tool |
| `src/schemas/system-output.json` | runner | contract | Phase 4: verify draft farewell validates; add a strict draft sub-check (additionalProperties gap) |
| `src/runner/runner.ts` | runner | internal | Phase 5 (#35): idle policy reads ledger; final inbox drain before `output/report.json` write |
| `agents/code-review-companion/prompt.md` | pack | cross-domain | Phase 5: idle wording → ledger-driven; Phase 6: findings-home + exit-reason vocabulary |
| `AGENTS_README.md` | cli (docs) | cross-domain | Phase 6 (#32): reconcile Companion mode / Output Contract / Permissions to the singular contract |
| `docs/domains/registry.md` | cli (docs) | cross-domain | Phase 6 (#29 housekeeping): correct MCP tool count ("six" → real count) + new verbs |
| `docs/domains/mcp/domain.md` | mcp (docs) | internal | Phase 6: tool count + `coordination_status` contract entry |
| `docs/domains/runner/domain.md` | runner (docs) | internal | Phase 4/6: add `CompanionLedger`/`deriveCompanionLedger` concept |
| `docs/domains/cli/domain.md` | cli (docs) | internal | Phase 4/6: `minih companion` verb + doctor checks |

Classification: `contract` (public interface), `internal` (domain-internal), `cross-domain` (editing another domain's / the pack's files).

## Key Findings

| # | Impact | Finding | Action |
|---|--------|---------|--------|
| 01 | **Critical** | **#27/#31 is already partly fixed.** `agents/code-review-companion/inside-state.schema.json` **exists today** (legacy root path) with the exact enum `[idle,reading,reviewing,reporting,blocked,stopping]`, matching the prompt's state table + transition calls. The 3-level resolver (`state.ts:182-192`, `doctor.ts:575-577`) resolves it. Workshop 002's premise ("ships neither") was factually off — its *decision* (per-pack schema + doctor lockstep) is still correct. | Phase 3 becomes **verify + relocate (root → preferred `state/`) + correct the schema's stale "validation not yet enforced" description + pin with tests** — not a build. Mirrors #25's verify-and-close shape. |
| 02 | **Critical** | **#40 root cause confirmed.** `event-wait.ts:78-80` snapshots inbox IDs at entry; `:193-197` suppresses anything in the snapshot. `inbox-poll.ts` uses a durable unread/ack model (`listVisible`+`acknowledged` set, `:135-151`) but `listVisible` is **private**. `src/mcp/tools/wait.ts` delegates straight to `runner.waitForAny` — it does **not** inherit `pollInboxLane`. | Phase 2: **export** a shared unacked-set helper from `inbox-poll.ts`; rewrite the `event-wait` `inbox.message` immediate-pass + watcher test to use it; keep `state.*` snapshot-at-entry. |
| 03 | **High** | **Single-settle teardown has a cleanup re-entry edge.** `event-wait.ts:87-107` guards the `settled` flag but `cleanup()` itself isn't guarded against re-entry; AC-15 tests use `FakeNativeWatcher`, not real `fs.watch` under concurrent timeout+fire. | Phase 2: add a `splice`-and-close guard in `cleanup()` and a real-`fs.watch` race test (timeout vs fire) that asserts close-count is exactly N. Preserve the plan-014 invariant. |
| 04 | **High** | **Report draft validation gap.** `system-output.json` is `additionalProperties: true` and `validator.ts` validates **after** `report.json` is written. A malformed draft farewell (Phase 4) would persist unchecked. | Phase 4: validate the draft envelope against a **strict** bundled sub-schema in the deriver/tool *before* it is offered, and a `parseReport` that returns safe-null on corrupt data. |
| 05 | **High** | **Ledger field availability + snapshot ordering.** All #36 fields (acked task-ids via `ackOf`, finding/summary counts, `ts` for `idleElapsedMs`, unresolved requests) are derivable from the lanes (`types.ts:305-341`, `folder.ts` path helpers). But `snapshotCoordinationFiles` runs **after** report write and only on `agentSucceeded` (`runner.ts`), so ledger reads must happen against the live lanes before teardown. | Phase 4 first enumerates required fields against real lane contents (gap → minimal additive persistence, flagged). Phase 5 orders the drain/ledger read **before** report write and teardown. |
| 06 | **High** | **Stop-window drain ordering is ambiguous.** `report.json` is written, the MCP session is torn down, and `drainTrackedManifestUpdates` drains *manifest* (not inbox) — there is no guaranteed hook that re-reads the inbox after the last `inbox_send` but before report write. | Phase 5 defines "drain" precisely: a `drainAndReadInbox(location)` step at the pre-report-write point; test injects a late append and asserts it is not stranded (AC-13). |
| 07 | **Medium/High** | **MCP tool count drift.** `TOOL_CONTRACTS` has **8** tools today; `registry.md` + `mcp/domain.md` still say "**six**". Adding `coordination_status` makes **9**. | Phase 6 housekeeping (AC-16): correct the docs to the real post-plan count and list the new tool/verbs. |
| 08 | **Medium** | **Doctor drift check is one-directional.** `checkPromptStateVocabularyDrift` (`doctor.ts:640-687`) flags prompt-values-not-in-enum but not the reverse; the contract-phrase class (#32 docs) has no sensor at all. | Phase 0 adds a contract-phrase drift check (mirrors the existing check); Phase 3 keeps the per-pack enum exactly the published set so it stays green both ways. |

## Phases

### Phase Index

| Phase | Title | Primary Domain | Objective (1 line) | Depends On |
|-------|-------|---------------|-------------------|------------|
| 0 | ~~Establish Backpressure~~ **DROPPED** (2026-06-14) | — | Sensor A unachievable as a fake-agent adapter (validate-v2); Sensor B folded into Phase 6 | — |
| 1 | Verify-and-close permission edge (#25) | runner + docs | Prove the farewell-write block is dead; correct the E205 doc; record the close disposition | None |
| 2 | Inbox delivery parity (#40) | runner + mcp | `wait_for_any` returns already-queued unacked matches with `inbox_list` parity; wildcard wake | None *(Phase 0 enables live proof)* |
| 3 | State-vocabulary coherence (#27/#31) | pack + cli + mcp | Verify/relocate the per-pack schema; pin doctor = no drift | None |
| 4 | Ledger-derived lifecycle primitive (#36 + #32 contract) | runner + cli + mcp | `deriveCompanionLedger` + `companion status` CLI + `coordination_status` tool + draft farewell | Phase 2 (parity), Phase 3 (vocab) |
| 5 | Idle-budget policy + shutdown drain (#35) | runner + pack | Idle decisions read the ledger; final inbox drain before report write | **Phase 4** |
| 6 | Runtime self-discovery + docs reconciliation (#29 + #32 docs) | mcp + cli + docs | Self-discovery trio surfaced; docs reconciled to the singular contract; registry housekeeping | **Phase 3, Phase 5** |

> #32 is cross-cutting: its findings-home contract is realized in Phase 4 (ledger) and its docs reconciliation completes in Phase 6. Phase 0 is **optional** — Phases 1–6 build on existing unit seams and do not hard-block on it; it upgrades the *live* end-to-end rows from inferential to computational.

---

#### Phase 0: Establish Backpressure *(optional/advisory — from `backpressure-coverage.md`)*

> **🚫 DROPPED (2026-06-14, after the stage-5 tasks expansion + validate-v2).** Sensor A (the `MINIH_FAKE_ADAPTER` fake-adapter) **cannot** prove live #40/#35 delivery: `wait_for_any`/`event-wait` runs in a spawned inside-MCP subprocess that only the real `SdkCopilotAdapter` connects to, so a same-process `FakeAgentAdapter` never invokes it — it can only write lanes directly, bypassing the `event-wait.ts:78-80` snapshot bug. Phase 0 is optional and AC-3/4/5/11/13 are unit-provable without it, so the phase is dropped. **Sensor B (the `contract-phrase` doctor check) is sound and folded into Phase 6** (where the docs it guards are reconciled), including its warn→fail promotion. See the dropped dossier at `tasks/phase-0-establish-backpressure/tasks.md` (§ Validation Findings) for the full evidence. The earlier phases' "contract-phrase check passes" criteria are no-ops until Phase 6 stands the check up.

**Objective**: Stand up the two deterministic sensors the post-spec survey recommended, so the hardest live-behaviour and docs claims are provable, not eyeballed.
**Domain**: adapter + cli
**Delivers**:
- `MINIH_FAKE_ADAPTER` scripted-adapter seam (extends `src/adapter/fake.ts`) letting a built-CLI subprocess drive a full coordinated run (outside ping → inside wake → finding → farewell) over real lanes without `GH_TOKEN`/Copilot.
- A `contract-phrase` drift check in `minih doctor` for the known #32 phrases (findings-home wording, exit-reason vocab incl. `no_engagement`, state vocabulary, MCP tool count).
**Depends on**: None.
**Key risks**: The fake-adapter is the larger build. Honest descope consequence: AC-3/4/5 stay unit-provable on existing seams unconditionally; **AC-11/13 stay unit-provable only because Phases 4–5 make idle/drain ledger-driven** (a wrong impl that left them prompt-only would make AC-11/13 inferential — the plan's design choice is what keeps them computational). What the fake-adapter uniquely buys is the **live end-to-end** rows (#40 delivery and #35 idle/drain under a real clock), which stay inferential/dogfood-only if Phase 0 is skipped. Call that out; never silently downgrade a proof tier. Phase 0 is advisory, **never a gate** (harness "never gate" invariant) — descope is a recorded choice, not a blocked one.

| # | Task | Domain | Success Criteria | Notes |
|---|------|--------|-----------------|-------|
| 0.0 | **Harness pre-flight** — `/eng-harness-flow --event pre-implement --phase "Phase 0: Establish Backpressure" --plan-dir docs/plans/027-companion-coordination` | — | Router envelope handled; boot verdict narrated verbatim before any code | _Harness seam_ |
| 0.1 | RED: a subprocess test asserting a scripted run reaches a terminal `output/report.json` when `MINIH_FAKE_ADAPTER` is set (fails today — no seam) | adapter | Test red for the right reason (env var unrecognised) | Per finding 02/05 |
| 0.2 | Extend `src/adapter/fake.ts` + `src/adapter/index.ts` env selection so a scripted adapter drives inbox/state/wait over real lanes | adapter | Test 0.1 green; real `sdk-copilot` path untouched | Plan 026 SUGG-001 |
| 0.3 | RED: a doctor test asserting `contract-phrase` drift is detected for a seeded stale phrase | cli | Test red (no such check) | Mirrors `prompt-state-vocabulary-drift` |
| 0.4 | Add `checkContractPhraseDrift` to `doctor.ts` (push into the `checks[]` array ~`:182`) for the known contract phrases | cli | Test 0.3 green; `minih doctor` still passes clean on current tree (or warns only on real drift) | Per finding 08 |
| 0.z | **Harness phase-end** — `/eng-harness-flow --event phase-end --plan-dir docs/plans/027-companion-coordination` | — | Router envelope handled at phase end | _Harness seam_ |

**CS**: 3.

---

#### Phase 1: Verify-and-close permission edge (#25)

**Objective**: Prove the #25 farewell-write block is dead and correct the doc that mis-describes the E205 signal.
**Domain**: runner + docs
**Delivers**: a regression test pinning the current E205 boot-gate behaviour; a corrected `companion-mode.md`; a recorded disposition for the #25 close comment.
**Depends on**: None.
**Key risks**: If the repro still reproduces, Phase 1 becomes a real build — escalate and note it (spec risk row).

| # | Task | Domain | Success Criteria | Notes |
|---|------|--------|-----------------|-------|
| 1.0 | **Harness pre-flight** — `/eng-harness-flow --event pre-implement --phase "Phase 1: Verify-and-close permission edge (#25)" --plan-dir docs/plans/027-companion-coordination` | — | Router envelope handled | _Harness seam_ |
| 1.1 | RED/characterisation: a coordinated companion on the release-default flow either writes `output/report.json` or the E205 boot gate fires loudly with an actionable message — no silent missing envelope | runner | Test asserts the *current* intended disposition; reproduces nothing silent (AC-1) | `coord-write-precondition.ts:156-198` |
| 1.2 | Correct `docs/how/companion-mode.md`: E205 fires at **boot** (before the inbox exists), not as an inbox message | docs | Doc states the verified signal; old phrasing gone (contract-phrase check from 0.4 passes) | AC-2 |
| 1.3 | Record the verified disposition for the #25 close comment | docs | A short note in the execution log captures the repro-is-dead evidence | AC-2 |
| 1.z | **Harness phase-end** — `/eng-harness-flow --event phase-end --plan-dir docs/plans/027-companion-coordination` | — | Router envelope handled | _Harness seam_ |

**CS**: 1.

---

#### Phase 2: Inbox delivery parity (#40)

**Objective**: A companion that calls the wake primitive receives messages queued before the call, with `inbox_list` parity for the same filter.
**Domain**: runner (event-wait) + mcp
**Delivers**: a shared exported unacked-set helper; a unified `wait_for_any` `inbox.message` branch; a documented wildcard wake; a cleanup re-entry guard; regression + parity + loop + wildcard + state-entry tests.
**Depends on**: None (Phase 0 enables the *live* e2e proof; the unit tests stand alone).
**Key risks**: changing delivery is strictly *more* delivery — audit consumers; an un-acking companion now re-receives (correct, documented). Preserve single-settle teardown (finding 03).

| # | Task | Domain | Success Criteria | Notes |
|---|------|--------|-----------------|-------|
| 2.0 | **Harness pre-flight** — `/eng-harness-flow --event pre-implement --phase "Phase 2: Inbox delivery parity (#40)" --plan-dir docs/plans/027-companion-coordination` | — | Router envelope handled | _Harness seam_ |
| 2.1 | RED: regression test — a message queued **before** the call is returned by `wait_for_any` (a snapshot-at-entry impl fails it) | runner | Test red against current `event-wait.ts` | AC-3; per finding 02 |
| 2.2 | Export a shared unacked-set helper from `inbox-poll.ts` (extract the private `listVisible`/`acknowledged` logic as a named export, e.g. `listUnackedVisible(location, lane, filter)`) | runner | New exported fn with a stable signature `event-wait` can call; `pollInboxLane` still green | Single consumed-model — name it so Phase-4/5 reuse is unambiguous |
| 2.3 | Rewrite `event-wait.ts` `inbox.message` branch: immediate-pass returns unacked matches, watcher filters by unacked (not entry-snapshot); `state.*` keeps snapshot-at-entry | runner | Tests 2.1 + parity test green; state-entry test unchanged | Workshop 001 Option A |
| 2.4 | RED→GREEN parity test: same filter → `wait_for_any` and `inbox_list` surface the same unacked set | runner | AC-4 green | |
| 2.5 | Loop test (ack between waits → no re-delivery; no ack → re-delivery) + wildcard test (no-filter wakes on a new/unknown `type`) | runner + mcp | AC-5 green; `wait.ts`/prompt use the no-filter form | Workshop 001 §wildcard |
| 2.6 | Add `cleanup()` re-entry guard (`splice`-and-close) + real-`fs.watch` timeout-vs-fire race test asserting exact close-count | runner | Single-settle invariant pinned | Per finding 03 |
| 2.z | **Harness phase-end** — `/eng-harness-flow --event phase-end --plan-dir docs/plans/027-companion-coordination` | — | Router envelope handled | _Harness seam_ |

**CS**: 3.

---

#### Phase 3: State-vocabulary coherence (#27/#31)

**Objective**: Every status the companion prompt publishes is accepted by the schema it validates against, and `minih doctor` proves no drift.
**Domain**: pack + cli (doctor) + mcp
**Delivers**: the per-pack schema relocated to the preferred `state/` path with a corrected description; a transition-acceptance test; a doctor-pass test.
**Depends on**: None. *(Per finding 01 this is verify/relocate/pin, not a build.)*
**Key risks**: keep the per-pack enum exactly the published set so the doctor stays green in both directions (finding 08); do not touch the global default.

| # | Task | Domain | Success Criteria | Notes |
|---|------|--------|-----------------|-------|
| 3.0 | **Harness pre-flight** — `/eng-harness-flow --event pre-implement --phase "Phase 3: State-vocabulary coherence (#27/#31)" --plan-dir docs/plans/027-companion-coordination` | — | Router envelope handled | _Harness seam_ |
| 3.1 | RED: a test exercising every companion `state_transition` target (`reading/reviewing/reporting/blocked/stopping/idle`) against the **resolved** schema, all accepted | mcp | Confirms current resolution accepts the enum (likely green — pins it) | AC-6; per finding 01 |
| 3.2 | Relocate `agents/code-review-companion/inside-state.schema.json` → `state/inside-state.schema.json` (preferred convention); **remove the legacy file** | pack | Exactly **one** schema resolves (no ambiguous dual-path); global `src/schemas/inside-state.json` byte-unchanged; no behaviour change | Workshop 002 target path |
| 3.3 | Correct the schema's stale `description` ("inside-state validation is not yet enforced") to match reality | pack | Description accurate; contract-phrase check (0.4) passes | Doc-drift |
| 3.4 | Pin `minih doctor` = no `prompt-state-vocabulary-drift` for the companion pack | cli | AC-7 test green | `doctor.ts:640-687` |
| 3.z | **Harness phase-end** — `/eng-harness-flow --event phase-end --plan-dir docs/plans/027-companion-coordination` | — | Router envelope handled | _Harness seam_ |

**CS**: 2.

---

#### Phase 4: Ledger-derived lifecycle primitive (#36 + #32 findings home)

**Objective**: A pure runner deriver computes lifecycle state from the lanes and assembles a schema-valid draft farewell; one CLI surface (outside) and one MCP tool (inside) read it; findings have one declared home.
**Domain**: runner + cli + mcp
**Delivers**: `CompanionLedger` type + `deriveCompanionLedger`; `minih companion status [--json]`; `coordination_status` MCP tool; a strict draft-validation step; the singular findings contract.
**Depends on**: Phase 2 (parity), Phase 3 (vocab).
**Key risks**: report `additionalProperties:true` means the draft must be strictly validated separately (finding 04); confirm every field is lane-derivable before assuming (finding 05).

| # | Task | Domain | Success Criteria | Notes |
|---|------|--------|-----------------|-------|
| 4.0 | **Harness pre-flight** — `/eng-harness-flow --event pre-implement --phase "Phase 4: Ledger-derived lifecycle primitive (#36 + #32 findings home)" --plan-dir docs/plans/027-companion-coordination` | — | Router envelope handled | _Harness seam_ |
| 4.1 | Enumerate required ledger fields against real lane contents; flag any not derivable (gap → minimal additive persistence) | runner | Field map recorded; gaps flagged in execution log | Per finding 05 |
| 4.2 | RED→GREEN: `deriveCompanionLedger(location)` over seeded lane fixtures returns reviewed/acked ids, finding/summary counts, ackOf chains, unresolved requests, idle streak, last-task-id | runner | AC-8 green (pure fn, no SDK/spawn) | Workshop 003; `companion-ledger.ts` (NEW) + `CompanionLedger` type |
| 4.3 | RED→GREEN: assemble a draft farewell envelope and validate it against `system-output.json` **and** a strict draft sub-schema **before it is offered or written** | runner | AC-9 green; a test injects a malformed draft and asserts it is **safe-nulled and never reaches `report.json`** (closes the `additionalProperties:true` write-before-validate gap) | Per finding 04 |
| 4.4 | NEW `coordination_status` MCP tool (mirror `permission-status.ts`): ledger summary + draft envelope **+ pin the `coordinationMode` value set** (sourced from coordination frontmatter; define its enum here so Phase 6 doesn't invent it); register in `types.ts`/`server.ts`/`index.ts` (8 → 9 tools) | mcp | Tool test green; contract test updated; `coordinationMode` enum fixed | Workshop 003 — this tool is the single self-discovery surface (the trio in one call), per WS3 |
| 4.5 | NEW `minih companion status [--json]` verb over the same deriver; register in `index.ts`; `MinihEnvelope` output | cli | CLI test asserts a conforming envelope | Workshop 003; cli→runner is legal |
| 4.6 | Settle #32 findings home: findings sent live via `inbox_send type:'finding'`; `report.findings[]` **derived** from the ledger; prompt + schema + docs agree (drift check) | mcp + pack | AC-10 green (structural); doc agreement via contract-phrase check | Workshop 003 |
| 4.z | **Harness phase-end** — `/eng-harness-flow --event phase-end --plan-dir docs/plans/027-companion-coordination` | — | Router envelope handled | _Harness seam_ |

**CS**: 4.

---

#### Phase 5: Idle-budget policy + shutdown drain (#35)

**Objective**: Idle decisions read durable ledger state (not prompt-counted polls), the configured budget is discoverable, and the stop/report window drains a late ping so it is not stranded.
**Domain**: runner + pack
**Delivers**: ledger-driven idle policy; a `drainAndReadInbox` step before report write; updated prompt idle wording; tests.
**Depends on**: **Phase 4** (idle policy reads its ledger).
**Sequencing contract** (pin this in code comments + the AC-13 test, so a future refactor can't silently reopen the race): the terminal order is **(1)** final `inbox_send` settles → **(2)** `drainAndReadInbox(location)` reads the live lanes → **(3)** `deriveCompanionLedger` computes findings/counts → **(4)** `report.json` written → **(5)** MCP session teardown → **(6)** `snapshotCoordinationFiles`. The drain reads (does not close) the lane; a message landing after step 2 but before teardown is caught by the re-entrant drain, not lost. AC-13's late-injection test asserts exactly this ordering.
**Key risks**: the drain must run before report write and before teardown without double-settle (findings 05/06); keep an absolute ceiling so a dead peer still terminates.

| # | Task | Domain | Success Criteria | Notes |
|---|------|--------|-----------------|-------|
| 5.0 | **Harness pre-flight** — `/eng-harness-flow --event pre-implement --phase "Phase 5: Idle-budget policy + shutdown drain (#35)" --plan-dir docs/plans/027-companion-coordination` | — | Router envelope handled | _Harness seam_ |
| 5.1 | RED→GREEN: idle/stand-down decisions driven by `idleElapsedMs` + `unresolvedPeerRequests` from the ledger; a mid-phase gap does **not** stand the companion down | runner | AC-11 green (ledger-driven, unit-testable) | Workshop 003 §#35 |
| 5.2 | Make the configured idle budget discoverable at runtime (field surfaced via the Phase 4 tool / run-metadata) | runner + pack | AC-12 green; prompt reads budget, not guesses | #35 ≥8-retro ask |
| 5.3 | RED→GREEN: define + add `drainAndReadInbox(location)` at the pre-report-write point; inject a late append and assert it is captured, not stranded | runner | AC-13 green; no double-settle; teardown invariant intact | Per finding 06 |
| 5.4 | Update `prompt.md` idle wording from integer poll-streak to ledger-driven posture | pack | Prompt matches runtime; contract-phrase check passes | |
| 5.z | **Harness phase-end** — `/eng-harness-flow --event phase-end --plan-dir docs/plans/027-companion-coordination` | — | Router envelope handled | _Harness seam_ |

**CS**: 3.

---

#### Phase 6: Runtime self-discovery + docs reconciliation (#29 + #32 docs)

**Objective**: The inside agent can read its own coordination metadata (allowed-state enum, mode, idle budget); all docs are reconciled to the singular contract; registry housekeeping done.
**Domain**: mcp + cli + docs
**Delivers**: the self-discovery trio on `coordination_status`; reconciled AGENTS_README + companion-mode.md; corrected registry tool count + new verbs; a doctor pass. **+ Sensor B (folded from dropped Phase 0)**: build `checkContractPhraseDrift` in `minih doctor` for the known #32 phrases (findings-home, exit-reason incl. `no_engagement`, state vocab, tool count) and — since the docs are reconciled *here* — promote it from `status: 'warning'` to `'fail'`. Mirror `checkPromptStateVocabularyDrift`; push into `checks[]` (~`doctor.ts:182`); return token is `'warning'`/`'fail'` (union `'pass'|'warning'|'fail'|'skip'`).
**Depends on**: **Phase 3** (vocabulary chosen) and **Phase 5** (idle budget exists).
**Key risks**: doc reconciliation is broad — the contract-phrase check (Phase 0) is the safety net for the known phrases; full prose reconciliation is `plan-7`/review territory.

| # | Task | Domain | Success Criteria | Notes |
|---|------|--------|-----------------|-------|
| 6.0 | **Harness pre-flight** — `/eng-harness-flow --event pre-implement --phase "Phase 6: Runtime self-discovery + docs reconciliation (#29 + #32 docs)" --plan-dir docs/plans/027-companion-coordination` | — | Router envelope handled | _Harness seam_ |
| 6.1 | RED→GREEN: `coordination_status` returns `allowedStates` (resolved per-pack), `coordinationMode`, `idleBudgetSec` | mcp | AC-14 green (asserts the returned shape) | Workshop 003 §trio |
| 6.2 | Reconcile `AGENTS_README.md` + `docs/how/companion-mode.md` to the singular contract: findings home, exit-reason vocab (incl. `no_engagement`), state vocabulary, idle-budget behaviour | docs | AC-15: contract-phrase check + `minih doctor` pass | #32 |
| 6.3 | Housekeeping: correct `docs/domains/registry.md` + `mcp/domain.md` MCP tool count to the real post-plan count; list new tools/verbs | docs | AC-16 green | Per finding 07 |
| 6.4 | Update domain docs (`runner`, `cli`, `mcp`) § Concepts/Composition for the new ledger/verb/tool | docs | Domain docs reflect the new contracts | plan-6 domain step |
| 6.z | **Harness phase-end** — `/eng-harness-flow --event phase-end --plan-dir docs/plans/027-companion-coordination` | — | Router envelope handled | _Harness seam_ |

**CS**: 3.

---

## Acceptance Criteria

*(AC numbers are stable and match `backpressure-coverage.md`; phase mapping in brackets.)*

- [ ] **AC-1** [P1] Coordinated companion on the release-default flow writes `output/report.json` **or** the E205 boot gate fires loudly with an actionable message — no silent missing envelope.
- [ ] **AC-2** [P1] The doc describing E205 as an inbox message is corrected to state it fires at boot; the verified disposition is recorded for the #25 close comment.
- [ ] **AC-3** [P2] Messages queued before the wake call are returned (subject to type filter) — proven by a regression test a snapshot-at-entry impl fails.
- [ ] **AC-4** [P2] Parity: same filter → wake primitive and `inbox_list` surface the same set; single-settle teardown preserved.
- [ ] **AC-5** [P2] The wake filter supports a documented "any outside message" form so a new `type` cannot make a companion deaf.
- [ ] **AC-6** [P3] Every status the companion prompt publishes is accepted by the schema it validates against — proven per-transition.
- [ ] **AC-7** [P3] `minih doctor` reports no prompt-vs-schema state-vocab drift for the pack; a test pins it.
- [ ] **AC-8** [P4] A primitive computes the lifecycle summary (reviewed/acked ids, finding/summary counts, ackOf chains, unresolved requests, idle streak, last-task-id) from lane fixtures.
- [ ] **AC-9** [P4] The primitive assembles a schema-valid draft farewell envelope (agent adds only the human retrospective); validated by test.
- [ ] **AC-10** [P4] The findings contract is singular and documented; prompt + report schema + orchestrator docs agree (drift check).
- [ ] **AC-11** [P5] Idle/stand-down decisions are ledger-driven; a mid-phase gap does not prematurely stand the companion down.
- [ ] **AC-12** [P5] The configured idle budget is discoverable at runtime.
- [ ] **AC-13** [P5] A ping arriving during the shutdown/report-write window is captured, not stranded — proven by a late-message injection test.
- [ ] **AC-14** [P6] The inside agent reads its own coordination metadata (allowed-state enum, mode, idle budget) through a dogfood-safe surface.
- [ ] **AC-15** [P6] AGENTS_README + companion-mode.md reconciled to the singular contract — verified by the doc-drift check and a doctor pass.
- [ ] **AC-16** [P6] Registry reflects the correct MCP tool count + any new tools/verbs.
- [ ] **AC-17** [whole-plan] `just fft` exits 0 with the new tests included; no regression in the existing coordination suite.

> **Proof-tier honesty** (matches `backpressure-coverage.md`): AC-1/3/4/5/6/7/8/9/11/12/13/14/16/17 are **computational** (a wrong impl fails a deterministic test). AC-2/10/15 are **mixed**: their structural half is computational (the contract-phrase check from Phase 0 catches *known* stale phrases — findings home, exit-reason vocab incl. `no_engagement`, state vocabulary, tool count) but full doc-prose reconciliation is **inferential**, routed to review. The *live* end-to-end behaviour behind AC-3/4/5/11/13 is computational only with the Phase-0 fake-adapter; without it, that residual is dogfood/`plan-7` territory. The plan does not pretend prose or live-timing rows are fully deterministic.
> **Self-describing surface** (#29): the single discoverable contract is the `coordination_status` MCP tool returning the trio (`allowedStates` + `coordinationMode` + `idleBudgetSec`) in **one call** — the workshop-003 decision (sibling to `permission_status`). No separate persisted contract file is introduced; the one tool *is* the legible surface.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Changing `wait_for_any` semantics breaks "changes-only" consumers | Low | Med | Phase 2 audits consumers; change is additive (more delivery); `state.*` unchanged; ADR only if the contract truly changes |
| Per-pack enum narrower than global silently rejects valid transitions | Low | Med | Keep the per-pack enum exactly the published set; doctor pins both directions (finding 08) |
| Stop-window drain disturbs plan-014 single-settle teardown | Med | High | Drain is a pre-write step, not a watcher change; cleanup re-entry guard + race test (findings 03/06) |
| #25 not actually fixed | Low | Med | Phase 1 starts with the repro/characterisation test; escalate scope if it still reproduces |
| Draft farewell persists unvalidated (report `additionalProperties:true`) | Med | Med | Strict draft sub-schema validated before offer; safe-null on corrupt (finding 04) |
| A #36 ledger field is not lane-derivable | Low | Med | Phase 4.1 enumerates fields against real lanes first; gap → minimal additive persistence, flagged |
| Fake-adapter seam (Phase 0) is heavier than expected | Med | Low | Phase 0 is optional; descope leaves AC-3/4/5/11/13 provable at unit level, live e2e stays inferential (called out) |

## Harness Seams

- **Entry point**: `/eng-harness-flow --event <seam> [--phase <id>] [--plan-dir <p>] --json` — the single door to the engineering harness; child skills are private and never named in this plan.
- **Backpressure** (post-spec seam): ran before this plan — see `backpressure-coverage.md` (Certainty: **Partial**). **Recommended Phase 0 folded in? yes** (optional Phase 0: `MINIH_FAKE_ADAPTER` seam + contract-phrase drift check).
- **Pre-implement** (`--event pre-implement`): fired by the implement verb at the start of each phase (the N.0 rows); verdicts narrated verbatim from the router's envelope (`healthy / SLOW / UNHEALTHY / UNAVAILABLE`). `UNAVAILABLE` is not an error — falls back to standard testing.
- **Phase end** (`--event phase-end`): fired by the implement verb at each phase seam (the N.z rows); `--event plan-complete` fires at merge.
- **Best-effort**: every item above is advisory and never blocks; the router decides what the harness does at each seam.
