# Human Agent View Implementation Plan

**Plan Version**: 1.0.0
**Created**: 2026-04-28
**Spec**: [human-agent-view-spec.md](./human-agent-view-spec.md)
**Status**: DRAFT
**Mode**: Full

---

## Summary

Minih already records everything a human operator needs (events, completion metadata, inbox lanes, state files, history) but exposes it as separate machine-shaped commands. This plan introduces a single readable operator console: a runner-owned live run manifest plus a pure `HumanViewModel`, then a CLI-owned interactive console (`minih view <slug>` and `minih run <slug> --human`) that renders the model and supports outside-actor message send when the original runner is in the same process. The first product increment is honest-capability read-only attach + same-process send; a future cross-process control lane is explicitly deferred. The expected outcome is a coherent operator UI with truthful `input available` / `input read-only` / `completed` labels, scrollback, snapshot/non-TTY fallback, and stdout-clean stream discipline.

## Target Domains

| Domain | Status | Relationship | Role |
|--------|--------|-------------|------|
| runner | existing | **modify** | Owns live run manifest (`run.json`), shared run resolver, `HumanViewModel` projection from durable artifacts, file watchers, completion metadata. |
| cli | existing | **modify** | Owns the `view` command, `run --human` flag, interactive Ink renderer, snapshot/non-TTY fallback, footer outside-message send wiring, stdout/stderr discipline. |
| adapter | existing | **consume** | Provides `AgentEvent` and `SessionSender`; no new exports — runner threads `SessionSender` to a same-process input bridge. |
| mcp | existing | **consume** | Untouched. Stays private inside-only; not exposed as a public attach control plane. |

### New Domains
None. Feature lives entirely inside `runner` and `cli`.

## Domain Manifest

| File | Domain | Classification | Rationale |
|------|--------|---------------|-----------|
| `/Users/jordanknight/substrate/minih/src/runner/run-manifest.ts` | runner | contract | New: `LiveRunManifest` type + atomic write helpers (Workshop 002 §1). |
| `/Users/jordanknight/substrate/minih/src/runner/run-resolver.ts` | runner | contract | New: shared `resolveRun({ mode })` for `by-id`/`latest-active`/`latest-completed`. |
| `/Users/jordanknight/substrate/minih/src/runner/human-view-model.ts` | runner | contract | New: pure `HumanViewModel` reducer (Workshop 004). |
| `/Users/jordanknight/substrate/minih/src/runner/human-view-fixtures.ts` | runner | internal | Test fixture builders for view model unit tests. |
| `/Users/jordanknight/substrate/minih/src/runner/runner.ts` | runner | internal | Wire manifest writes at run-folder create / `session_start` / event tick / completion / failure. |
| `/Users/jordanknight/substrate/minih/src/runner/index.ts` | runner | contract | Export `LiveRunManifest`, `resolveRun`, `buildHumanViewModel`. |
| `/Users/jordanknight/substrate/minih/src/runner/types.ts` | runner | contract | Add `LiveRunManifest` and `RunResolveMode` types. |
| `/Users/jordanknight/substrate/minih/src/cli/commands/view.ts` | cli | contract | New: `minih view <slug> [--run <id>] [--snapshot]` command. |
| `/Users/jordanknight/substrate/minih/src/cli/commands/run.ts` | cli | internal | Add `--human` flag that hands off to the same renderer with same-process `SessionSender`. |
| `/Users/jordanknight/substrate/minih/src/cli/human/app.tsx` | cli | internal | Ink root component; wires panes + key handling + lifecycle. |
| `/Users/jordanknight/substrate/minih/src/cli/human/panes/header.tsx` | cli | internal | Header pane (slug/runId/sessionId/status/capability/counts). |
| `/Users/jordanknight/substrate/minih/src/cli/human/panes/transcript.tsx` | cli | internal | Grouped transcript with outside actor / inside agent labels. |
| `/Users/jordanknight/substrate/minih/src/cli/human/panes/tools.tsx` | cli | internal | Tool call lifecycle rows. |
| `/Users/jordanknight/substrate/minih/src/cli/human/panes/workbench.tsx` | cli | internal | Coordination timeline + state + output panes. |
| `/Users/jordanknight/substrate/minih/src/cli/human/panes/footer.tsx` | cli | internal | Input footer with capability-aware enablement. |
| `/Users/jordanknight/substrate/minih/src/cli/human/snapshot.ts` | cli | contract | Pure stderr snapshot renderer for non-TTY / `--snapshot`. |
| `/Users/jordanknight/substrate/minih/src/cli/human/input-bridge.ts` | cli | internal | Adapter from footer submit → same-process `SessionSender.send` or read-only refusal. |
| `/Users/jordanknight/substrate/minih/src/cli/human/run-feed.ts` | cli | internal | File-watcher loop that re-derives `HumanViewModel` from artifacts. |
| `/Users/jordanknight/substrate/minih/src/cli/index.ts` | cli | internal | Register new `view` command and `--human` option. |
| `/Users/jordanknight/substrate/minih/test/runner/run-manifest.test.ts` | runner | internal | TDD: manifest write/read round-trip + atomic semantics. |
| `/Users/jordanknight/substrate/minih/test/runner/run-resolver.test.ts` | runner | internal | TDD: by-id, latest-active, latest-completed, ambiguity. |
| `/Users/jordanknight/substrate/minih/test/runner/human-view-model.test.ts` | runner | internal | TDD: delta coalescing, tool pairing, ack correlation, malformed input. |
| `/Users/jordanknight/substrate/minih/test/cli/view-command.test.ts` | cli | internal | CLI integration: snapshot, non-TTY fallback, ambiguous-run error, stdout-clean. |
| `/Users/jordanknight/substrate/minih/test/cli/human-snapshot.test.ts` | cli | internal | Snapshot renderer fixture-driven coverage. |
| `/Users/jordanknight/substrate/minih/test/cli/human-input-bridge.test.ts` | cli | internal | Input bridge: same-process send delivers, read-only refuses, completed refuses. |
| `/Users/jordanknight/substrate/minih/docs/how/human-view.md` | docs | contract | New how-to: outside/inside model, capability labels, attach behavior, troubleshooting. |
| `/Users/jordanknight/substrate/minih/README.md` | docs | internal | Quick-start for `run --human`, `view`, `view --snapshot`. |
| `/Users/jordanknight/substrate/minih/docs/domains/runner/domain.md` | runner | contract | History entry + Concepts row for live manifest, run resolver, human view model. |
| `/Users/jordanknight/substrate/minih/docs/domains/cli/domain.md` | cli | contract | History entry + Concepts row for human view command and renderer. |
| `/Users/jordanknight/substrate/minih/package.json` | — | internal | Add `ink` and `react` runtime deps; `@types/react` dev dep. |

## Key Findings

| # | Impact | Finding | Action |
|---|--------|---------|--------|
| 01 | Critical | Live `sessionId` is captured on `session_start` but only persisted in `completed.json`; attach-by-id and "what is my session ID" both fail before completion. (Dossier Critical Finding 02; Workshop 002 §1.) | Phase 1 introduces `runs/<runId>/run.json` written at folder-create, `session_start`, event tick, completion. |
| 02 | Critical | `tail`/`status`/`connect` each interpret "latest" differently; the human view needs one shared resolver. (Dossier Critical Finding 03.) | Phase 1 ships `resolveRun({ mode })` with `by-id`, `latest-active`, `latest-completed`, ambiguity-error contract. |
| 03 | Critical | Cross-process attach-control needs a durable command lane that does not exist yet. (Dossier Critical Finding 01; Workshop 002 Recommended Path Phase 3.) | Plan ships `attached-read-only` for cross-process attach + same-process send only; file command lane is **explicitly deferred** with a follow-up note. |
| 04 | High | Raw event/file rendering will recreate today's unreadable token-dump UX. (Dossier Critical Finding 04; PL-02.) | Phase 1 builds the pure `HumanViewModel` reducer with delta coalescing, tool pairing, ack correlation, diagnostic surfacing — TDD-first, no React import. |
| 05 | High | The TUI must keep stdout clean for JSON envelopes; CLI convention is stderr/raw-TTY for human UI. (PL-04; cli domain doc.) | Phase 2 renderer uses stderr/raw-TTY, snapshot mode writes human text to stderr, `view` JSON envelope (if any) stays on stdout. |
| 06 | High | "Pause" must never imply agent execution stops; only UI follow pauses in MVP (Workshop 003). | Footer pause label is `Follow paused` only; spec acceptance criterion 9 is enforced in Phase 2 footer copy and in Phase 3 docs. |
| 07 | High | The internal `coordination.enabled` gate stays for CI/lightweight runs, but Human View must hide it behind capability labels (`input available` / `input read-only` / `completed`). (Spec Clarifications 2026-04-28.) | Renderer derives capability from manifest + delivery availability; never displays `coordination.enabled`. |
| 08 | Medium | `findRunSession()` in `src/runner/folder.ts` only recognises completed sessions; reusing it for active runs would miss live runs. | Phase 1 resolver uses live manifest first; falls back to `findRunSession()` for completed-only flows. |
| 09 | Medium | `readRecentEventLines()` in `src/cli/commands/tail.ts` already has bounded suffix reads with torn-line handling; the human view should reuse, not re-implement. | Phase 1 extracts (or wraps) it into a shared `runner` helper consumed by `run-feed.ts`. |
| 10 | Medium | Adding `ink`+`react` to runtime deps changes install footprint; install must remain a `prepare`-driven build. | Phase 2 adds deps and confirms `just fft` (incl. `npm audit`) stays green; Phase 3 documents footprint in how-to. |

## Harness Strategy

Harness: **Not applicable** — user override (spec §Harness Readiness: "continue without a new harness doc"). Existing minih dogfood agents, scratch mock-up at `scratch/human-agent-view/`, Vitest, and `just fft` are the validation surfaces. Pre-phase validation per phase: `just fft` green + relevant test additions.

## Phases

### Phase Index

| Phase | Title | Primary Domain | Objective (1 line) | Depends On |
|-------|-------|---------------|-------------------|------------|
| 1 | Run Contract & View Model | runner | Make live run identity, run resolution, and the pure `HumanViewModel` real and tested. | None |
| 2 | Interactive Console & Commands | cli | Ship `minih view <slug>` and `minih run <slug> --human` rendering the view model with honest capability labels. | Phase 1 |
| 3 | Hardening, Snapshot & Docs | cli + runner | Snapshot/non-TTY fallback, stdout-clean discipline, terminal cleanup, README + `docs/how/human-view.md`, acceptance-criteria sweep. | Phase 2 |

---

### Phase 1: Run Contract & View Model

**Objective**: Persist live run identity and project a pure, testable `HumanViewModel` from durable artifacts so the renderer in Phase 2 has a stable contract.
**Domain**: runner (modify)
**Delivers**:
- `runs/<runId>/run.json` live manifest written at run-folder create, `session_start`, event tick, terminal condition, completion/failure.
- `resolveRun({ mode })` shared resolver with `by-id` / `latest-active` / `latest-completed` and explicit ambiguity error.
- `buildHumanViewModel(sources)` pure reducer producing `HumanHeaderView`, `TranscriptEntry[]`, `ToolCallView[]`, `CoordinationTimelineEntry[]`, `StatePaneView`, `OutputPaneView`, `InputFooterView`, `ViewDiagnostic[]` (Workshop 004 contracts).
- Runner exports the new contracts via `src/runner/index.ts`.
- TDD-level tests for manifest, resolver, and reducer.

**Depends on**: None
**Key risks**: Manifest write churn under high event volume — mitigate with throttled `updatedAt` write (e.g., coalesce updates ≥250 ms) and atomic write helpers; reuse `src/runner/atomic-write.ts`.

| # | Task | Domain | Success Criteria | Notes |
|---|------|--------|-----------------|-------|
| 1.1 | Add `LiveRunManifest` and `RunResolveMode` types in `src/runner/types.ts`; export from `src/runner/index.ts`. | runner | Types compile; consumers can import; no circular import. | Per finding 01. Type-first so failing tests in 1.2/1.4/1.5 can compile. |
| 1.2 | Add fixture builders + write **failing** tests in `test/runner/run-manifest.test.ts`, `test/runner/run-resolver.test.ts`, `test/runner/human-view-model.test.ts` covering: manifest round-trip + atomic writes; resolver by-id / latest-active / latest-completed / ambiguity; reducer delta coalescing, tool call/result pairing, outside/inside ack correlation, output-pane projection, malformed-line diagnostics. | runner | Tests exist and fail with "not implemented"; cover acceptance criteria 2, 3/4, 5, 6, 11, 14. | TDD-first per spec; drives 1.3/1.5/1.6. |
| 1.3 | Implement `src/runner/run-manifest.ts` with atomic write/read + throttled `updateManifest()` helper. | runner | Manifest tests from 1.2 turn green; reuses `atomic-write.ts`. | Per finding 01. |
| 1.4 | Wire manifest writes in `src/runner/runner.ts` at: run-folder created (`status: starting`), `session_start` (set `sessionId`, `status: active`), event tick (counter update), terminal condition (`status: completing`), completion/failure (`status: completed`/`failed`). | runner | Live test under `FakeAgentAdapter` shows manifest progresses through all states. | Per finding 01; Workshop 002 §Write points. |
| 1.5 | Implement `src/runner/run-resolver.ts` with `resolveRun({ slug, mode })`. Returns `ResolvedRun` or throws `MultipleActiveRunsError` listing candidates. | runner | Resolver tests from 1.2 turn green; ambiguous-active test returns candidate list (AC11). | Per finding 02 / 08. |
| 1.6 | Implement `src/runner/human-view-model.ts` with `buildHumanViewModel({ events, manifest, completed, inbox, state, history, output, validation })`. Pure function, no I/O. Inputs cover all sources from Workshop 004 §Source Artifacts so panes promised in the top-level model (`OutputPaneView`, `ViewDiagnostic[]`) can be populated without a follow-up shape change. | runner | Reducer tests from 1.2 turn green; tests cover output-pane projection and diagnostics for malformed sources. | Per finding 04; Workshop 004 reducer pipeline. |
| 1.7 | Run `just fft`. | runner | Pipeline green; no new lint/audit findings owned by this change. | Pre-Phase-2 gate. |

---

### Phase 2: Interactive Console & Commands

**Objective**: Deliver the `minih view <slug>` command and `minih run <slug> --human` flag with an Ink-based renderer that consumes the Phase 1 view model and supports same-process outside-message send. **Hard requirement**: all human UI renders to `process.stderr`; `stdout` remains reserved for JSON envelopes (per CLI convention and AC13).

**Renderer choice rationale (per finding 10)**: The scratch mock-up at `scratch/human-agent-view/` is zero-dep and was useful for layout iteration, but a hand-rolled product renderer would re-invent input handling, focus management, controlled re-render, key bindings, and resize handling — work Ink/React already standardize. Adding `ink`+`react` is justified by (a) interactive footer/input flow with capability state, (b) split-pane resize and focus across header/transcript/tools/workbench/footer, (c) testability of pane components against fixtures, and (d) stable Node TTY support. Ink is configured to write to `process.stderr` so the CLI stdout convention is preserved.

**Domain**: cli (modify)
**Delivers**:
- `ink` and `react` added as runtime deps; `@types/react` as dev dep.
- `src/cli/commands/view.ts` registered in `src/cli/index.ts`.
- `--human` option on `run` that hands off to the same renderer with the same-process `SessionSender`.
- `src/cli/human/app.tsx` Ink root with header / transcript / tools / workbench / footer panes (Workshop 001 layout).
- File-watch run feed that re-projects the view model (reusing `readRecentEventLines` semantics — finding 09).
- Footer input bridge: same-process send via `SessionSender.send`; cross-process attach is `input read-only` with explicit reason; completed run is `completed` label with no input.
- Capability-aware footer labels (`input available`, `input read-only`, `completed`); pause copy is `Pause scroll` / `Resume follow` (per Workshop 003) and never implies the agent is paused (finding 06).
- Ambiguous-run error path mirrors Phase 1 resolver contract (acceptance criterion 11).

**Depends on**: Phase 1
**Key risks**: Ink rendering to stdout would corrupt JSON envelopes (finding 05); mitigate by configuring Ink `stdout: process.stderr` and explicitly not printing envelopes from the interactive command.

| # | Task | Domain | Success Criteria | Notes |
|---|------|--------|-----------------|-------|
| 2.1 | Add `ink`, `react` to `dependencies` and `@types/react` to `devDependencies`; `npm install`; verify `npm run build` clean. | cli | Build passes; `npm audit` clean (or new findings explicitly triaged per repo policy). | Per finding 10. |
| 2.2 | Implement `src/cli/human/run-feed.ts` — file-watcher loop that loads events, manifest, inbox, state, history, completed; re-runs `buildHumanViewModel`; emits view-model snapshots. | cli | Unit test with fixture run folder shows live updates; reuses or wraps `readRecentEventLines`. | Per finding 09. |
| 2.3 | Implement `src/cli/human/input-bridge.ts` — accepts `SessionSender` when same-process; otherwise records `input read-only` with reason; refuses on completed runs. | cli | Same-process test delivers via fake adapter; cross-process test refuses with `attached-read-only` reason; completed-run test refuses with `completed` reason. | Per spec acceptance 7/8. |
| 2.4 | Implement Ink panes (`header.tsx`, `transcript.tsx`, `tools.tsx`, `workbench.tsx`, `footer.tsx`) and root `app.tsx`. Render to `process.stderr`. Footer pause copy uses `Pause scroll` / `Resume follow` (Workshop 003); transcript labels rows as `Outside actor` / `Inside agent`. Implement split-layout key handling: transcript-expanded, workbench-expanded, and reset (acceptance criterion 15). | cli | Manual scratch parity check vs `scratch/human-agent-view/`; pause label reads `Pause scroll`/`Resume follow`; outside actor / inside agent labels in transcript; split-layout keys produce three layouts. | Workshop 001 layout; Workshop 003 pause labels; finding 05/06/07. |
| 2.5 | Implement `src/cli/commands/view.ts` (`minih view <slug> [--run <id>] [--snapshot]`); register in `src/cli/index.ts`. | cli | `view <slug>` resolves via Phase 1 resolver; ambiguity error lists candidates; `--run` forces by-id. | Per acceptance 11; finding 02. |
| 2.6 | Add `--human` flag to `src/cli/commands/run.ts` that, after `runAgent` starts and `onSessionReady` fires, mounts the same renderer with the live `SessionSender`. | cli | Integration test under `FakeAgentAdapter` shows footer becomes `input available` after `session_start`. | Spec goals §1; acceptance 7. |
| 2.7 | Add `test/cli/human-input-bridge.test.ts` and `test/cli/view-command.test.ts` covering ambiguity, by-id, capability labels, stdout-clean. | cli | Vitest green; stdout assertion proves no terminal control bytes leak to stdout. | Per finding 05. |
| 2.8 | Run `just fft`. | cli | Pipeline green. | Pre-Phase-3 gate. |

---

### Phase 3: Hardening, Snapshot & Docs

**Objective**: Make the experience honest in non-TTY environments, clean up terminal state on exit, document the feature, and sweep all spec acceptance criteria.
**Domain**: cli (modify) + runner (modify, doc-only)
**Delivers**:
- `src/cli/human/snapshot.ts` deterministic stderr text renderer (no Ink runtime).
- Non-TTY detection in `view`/`run --human`: when `!process.stderr.isTTY`, print snapshot once and exit (acceptance 12).
- `--snapshot` flag forces snapshot path even on TTY.
- `Ctrl+C` / `SIGTERM` cleanup: Ink unmount, restore TTY raw mode, flush stderr, exit cleanly.
- README quick-start additions and new `docs/how/human-view.md`.
- `runner/domain.md` and `cli/domain.md` History/Concepts updates (incremental, not restructured).
- Acceptance-criteria checklist reviewed against spec §Acceptance Criteria.

**Depends on**: Phase 2
**Key risks**: Snapshot drift vs interactive renderer — mitigate by deriving both from the same `HumanViewModel`; snapshot has its own thin formatter.

| # | Task | Domain | Success Criteria | Notes |
|---|------|--------|-----------------|-------|
| 3.1 | Implement `src/cli/human/snapshot.ts` and wire `--snapshot`/non-TTY detection into `view` and `run --human`. | cli | Snapshot test covers `coordination-rich`, `token-deltas`, `attached-read-only`, `completed`; stdout remains empty. | Per acceptance 12/13; mirror scratch mock-up. |
| 3.2 | Add terminal cleanup: register `SIGINT`/`SIGTERM` handlers, Ink `unmount()`, restore raw mode, drain stderr. | cli | Manual exit leaves cursor visible and prompt usable; no stuck raw mode. | Per spec non-goal "no full-screen alternate-screen requirement". |
| 3.3 | Add `test/cli/human-snapshot.test.ts` fixture coverage. | cli | Vitest green; assertion proves stdout is empty and stderr contains expected sections. | Per finding 05. |
| 3.4 | Verify all 15 acceptance criteria with explicit pointers to tests or manual verification. Add any missing tests. | cli + runner | Acceptance checklist below all `[x]`. | See Acceptance Criteria. |
| 3.5 | Write `docs/how/human-view.md` covering outside/inside model, capability labels, attach behavior, snapshot, troubleshooting. | docs | Doc reviewed; cross-links spec + workshops 001/002/003/004/006. | Per spec Documentation Strategy. |
| 3.6 | Add README quick-start for `run --human`, `view <slug>`, `view <slug> --run <id>`, `view <slug> --snapshot`. | docs | README diff small and targeted. | Per spec Documentation Strategy. |
| 3.7 | Append History entry + add `Concepts` row(s) in `docs/domains/runner/domain.md` (live manifest, run resolver, human view model) and `docs/domains/cli/domain.md` (human view command, renderer, snapshot). | runner + cli | Both domain docs reflect new contracts; matches existing P1/P2 incremental pattern. | Incremental only, not restructured. |
| 3.8 | Run `just fft`; capture any audit findings as own-it-or-defer. | cli + runner | Pipeline green; release notes ready. | Final gate. |

---

## Acceptance Criteria

- [ ] AC1 (header fields visible) — Phase 2 task 2.4 + 2.6 (header pane consumes `HumanHeaderView`).
- [ ] AC2 (delta grouping, no per-line dup) — Phase 1 task 1.2 (failing test for delta coalescing) + 1.6 (`buildHumanViewModel` impl). Proof: reducer test asserts a `text_delta` stream + final `message` collapse to one `TranscriptEntry`.
- [ ] AC3 (outside-actor labelling) — Phase 1 task 1.6 reducer + Phase 2 task 2.4 transcript pane + workbench coordination row.
- [ ] AC4 (inside-agent labelling) — Phase 1 task 1.6 reducer + Phase 2 task 2.4 transcript pane.
- [ ] AC5 (tool call lifecycle rows) — Phase 1 task 1.6 (`ToolCallView` projection) + Phase 2 task 2.4 tools pane.
- [ ] AC6 (ack ↔ message linkage) — Phase 1 task 1.6 (ack correlation) + Phase 2 task 2.4 workbench pane.
- [ ] AC7 (footer outside-actor send + delivery status) — Phase 2 task 2.3/2.6.
- [ ] AC8 (read-only/completed disabled with reason) — Phase 2 task 2.3.
- [ ] AC9 (pause = follow only, run continues) — Phase 2 task 2.4 (`Pause scroll` / `Resume follow` copy per Workshop 003).
- [ ] AC10 (completed run inspectable, no live controls implied) — Phase 2 task 2.3 + Phase 3 task 3.1 `completed` snapshot fixture.
- [ ] AC11 (ambiguous active runs error with candidates) — Phase 1 task 1.5 (`MultipleActiveRunsError`) + Phase 2 task 2.5.
- [ ] AC12 (non-TTY deterministic fallback) — Phase 3 task 3.1.
- [ ] AC13 (stdout reserved for JSON envelopes) — Phase 2 task 2.4/2.7 + Phase 3 task 3.3 (stdout-empty assertion).
- [ ] AC14 (malformed sources → diagnostics, no crash) — Phase 1 task 1.2/1.6 reducer diagnostics + Phase 2 task 2.2 run-feed degraded-source handling.
- [ ] AC15 (split layout transcript-expanded / workbench-expanded / reset) — Phase 2 task 2.4 explicit split-layout key handling; Phase 3 task 3.4 sweep verifies all three layouts render.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Manifest write churn at high event rates | Medium | Medium | Throttle `updatedAt` writes (~250 ms coalesce); reuse `atomic-write.ts`; counters update in-memory between writes. |
| Ink rendering leaks to stdout | Medium | High | Configure Ink `stdout: process.stderr`; assert in CLI test that stdout is empty after render. |
| Ambiguous "latest" resolution surprises existing `tail`/`status`/`connect` | Low | Medium | New resolver lives alongside existing helpers; Phase 1 does **not** rewrite existing commands. Future migration is out of scope. |
| Cross-process attach users expect to send messages | Medium | Medium | Honest `attached-read-only` label with reason text; document deferral in `docs/how/human-view.md`; track future control-lane plan separately. |
| Pause label re-introduces "pause agent" confusion | Low | Medium | Use Workshop 003 vocabulary in footer copy (`Pause scroll` / `Resume follow`); add doc sweep in Phase 3. |
| Adding `ink`+`react` deps surfaces audit findings | Medium | Low | Phase 2 task 2.1 runs `just fft`; any new findings are owned per repo policy or explicitly deferred with user sign-off. |
| Reducer drift between snapshot and interactive renderer | Low | Medium | Both consume `HumanViewModel`; snapshot is a thin pure formatter; shared fixtures cover both. |

## Deferred / Out of Scope

The following are explicitly out of this 3-phase plan and recorded for a future plan:

- Cross-process file command lane (`runs/<runId>/control/`) for attach-mode `send_message` / `request_agent_pause`. (Workshop 002 Recommended Path Phases 3–4; spec acceptance 7 satisfied by same-process send only in this plan.)
- Real agent pause / interrupt / kill controls. (Workshop 003.)
- Migrating `tail` / `status` / `connect` to the shared resolver.
- Public/JSON output mode for `view` (`--json`).
- Alternate-screen full-screen rendering.

---

**Next step**: Run `/plan-4-complete-the-plan` to validate readiness. Then `/plan-5-v2-phase-tasks-and-brief --plan "/Users/jordanknight/substrate/minih/docs/plans/009-human-agent-view/human-agent-view-plan.md" --phase 1` to generate Phase 1's task dossier.

## Subtasks

| ID | Created | Summary | Parent | Status | Path |
|----|---------|---------|--------|--------|------|
| FX001 | 2026-04-28 | Build coordinated `code-review-companion` exemplar agent (Workshop 007). Produces a real working pair-programming agent we can dogfood Phase 2's `view` command against. | Phase 1 / T007 | Complete | [tasks/phase-1-…/001-subtask-build-code-review-companion-agent.md](./tasks/phase-1-run-contract-and-view-model/001-subtask-build-code-review-companion-agent.md) |

## Fixes

| ID | Created | Summary | Domain(s) | Status | Source |
|----|---------|---------|-----------|--------|--------|
| FX001 | 2026-04-28 | Coordination tool-surface bugs surfaced by companion smoke: MCP `state` tool resolves only root `inside-state.schema.json` (not `state/`); `inbox_send` lacks `ackOf` parameter so reply-correlation contract is unenforceable. Adds the magic-wand end-to-end coordination contract test. | mcp (modify), runner (consume) | Complete | [fixes/FX001-coordination-tool-surface.md](./fixes/FX001-coordination-tool-surface.md) |

---

## Validation Record (2026-04-28)

| Agent | Lenses Covered | Issues | Verdict |
|-------|---------------|--------|---------|
| Coherence | System Behavior, Hidden Assumptions, Domain Boundaries | 0 | ✅ |
| Risk | Edge Cases & Failures, Security & Privacy, Deployment & Ops | 1 MEDIUM open | ⚠️ |
| Completeness | Technical Constraints, Integration & Ripple, Concept Documentation, Performance & Scale | 1 HIGH fixed, 3 MEDIUM open | ⚠️ → ✅ (HIGH only) |
| Forward-Compatibility | Forward-Compatibility, User Experience | 1 HIGH fixed, 1 LOW fixed | ✅ |

**Lens coverage**: 11/12 (above the 8-floor). Forward-Compatibility engaged (downstream Phase 1/2/3 dossiers, fltplan, plan-6 implementor).

### Forward-Compatibility Matrix

| Consumer | Requirement | Failure Mode | Verdict | Evidence |
|----------|-------------|--------------|---------|----------|
| Phase 1 tasks dossier | Concrete tasks, success criteria, file paths for `run-manifest.ts`, `run-resolver.ts`, `human-view-model.ts`; AC mapping | Shape mismatch | ✅ | Phase 1 task table + AC mapping renumbered for new test-first ordering. |
| Phase 2 tasks dossier | Stable `HumanViewModel` shape (incl. `output`/`diagnostics`); `LiveRunManifest` + resolver export; `SessionSender` access | Encapsulation lockout | ✅ | Task 1.6 reducer inputs now include `output`/`validation`; runner exports `LiveRunManifest`, `resolveRun`, `buildHumanViewModel`. |
| Phase 3 tasks dossier | `HumanViewModel` for snapshot path; capability-aware footer; AC checklist | Test boundary | ✅ | Snapshot derives from same view model; AC15 sweep added to task 3.4. |
| `human-agent-view.fltplan.md` | Phase count, task count per phase, CS scores | N/A | ✅ | Fltplan shows 3 phases, 7/8/8 tasks, CS-3/CS-4/CS-3. |
| Future plan-6 implementor | Domain manifest with absolute paths; classifications; explicit deferral list | Contract drift | ✅ | Manifest + Deferred/Out-of-Scope section retained. |

**Outcome alignment**: "Plan advances outcome by sequencing the smallest honest increment (P1 model + resolver, P2 console + same-process send, P3 hardening/snapshot/docs)" — yes, as shipped, the plan advances the spec's promise of a readable terminal operator console without juggling separate `tail`/`status`/inbox/state commands.

**Standalone?**: No — five named downstream consumers with concrete needs.

**Fixes applied (HIGH + LOW)**:
- Forward-Compat HIGH: Task 1.6 reducer inputs now include `output`/`validation`; matching test added to task 1.2.
- Completeness HIGH: AC2/AC15 mappings tightened; explicit split-layout success criterion added to task 2.4; AC checklist renumbered to match TDD-first task ordering.
- UX LOW: Pause copy changed to `Pause scroll`/`Resume follow` per Workshop 003.

**Open (MEDIUM — user decision)**:
- Risk MED: Add explicit deployment task + risk row for `npm install`/`npm publish`/`prepare` clean-checkout verification and Windows TTY smoke test for `view`/`run --human` (Phase 2 or Phase 3).
- Completeness MED: Phase 2 may be CS-5 once Ink learning curve + lifecycle cleanup are counted; consider raising or splitting.
- Completeness MED: Phase 3 task 3.7 should enumerate exact Concepts-table rows (capability labels, split-pane, snapshot mode) for `runner/domain.md` and `cli/domain.md`.
- Completeness MED: Add a regression task (Phase 3) running targeted `tail`/`status`/`connect` regressions after resolver/manifest changes land.

**Overall**: ⚠️ VALIDATED WITH FIXES — HIGH/LOW issues fixed; 4 MEDIUM open for user decision before `/plan-5`.
