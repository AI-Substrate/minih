# Execution Log — Plan 021 Coordinated Install Resilience

**Plan**: [coordinated-install-resilience-plan.md](./coordinated-install-resilience-plan.md)
**Spec**: [coordinated-install-resilience-spec.md](./coordinated-install-resilience-spec.md)
**Workshop**: [workshops/001-mcp-error-watchdog-state-machine.md](./workshops/001-mcp-error-watchdog-state-machine.md)
**Branch**: `020-minih-harness-measurement` (user decision — see clarification 2026-05-16)
**Companion run**: `2026-05-16T12-51-35-391Z-c8e3`

---

## T000 — Pre-implementation companion-mode gate

**Status**: ✅ Complete
**Started**: 2026-05-16 02:51 UTC
**Completed**: 2026-05-16 02:52 UTC
**Evidence**:
- Companion booted via `minih run code-review-companion &` with `GH_TOKEN=$(gh auth token)` exported.
- `minih status code-review-companion` reports `verdict: 'active'`, runId `2026-05-16T12-51-35-391Z-c8e3`.
- Briefing sent via `minih outside inbox send --type briefing` with subject "Plan 021-coordinated-install-resilience — Power On Mode start" and full plan/spec/workshop paths, hazards (C2 default-on flip, C3 resume bug, C5 doctor copy, Q7 frontmatter reversal, recursion note), and protocol (review-request per commit, fire-and-forget).
- Peer verdict after briefing: `listening`, `selfReportedState: idle`, `currentlyRunningTool: view` (reading the briefing).

**Discoveries**:
- D1: Earlier validation pass attempted 4 plan edits in one `edit` call; one failed on whitespace mismatch, which aborted all 4 atomically. Only T014 was re-fixed individually; the other 3 (summary "20-task"→"24-task", T022 issue-#30 follow-up, AC14 commitment language, R5 timer threshold) silently never landed. Caught during T000 pre-flight when re-reading the plan and reconciled before sending the companion briefing — the companion would otherwise have seen a plan whose Validation Record claimed fixes that weren't applied.
  - **Lesson**: when a multi-edit call fails atomically, audit every other edit in the same call. Don't trust "re-fixed the one that erred" alone.
- D2: `ctx_ls` initial read returned stale/cached directory listing missing `src/`, `test/`, `dist/`, `coordination-loop-validator`, etc. `ctx_shell ls` returned the real layout. Reaching for `ctx_shell` for ground-truth filesystem checks is the safer pattern when something looks wrong.

---

## T001 — FX003b authoring (in progress)

**Started**: 2026-05-16 02:54 UTC
**Status**: 🚫 Blocked then resolved via FX001 → resuming

### Initial attempt + wall

- 02:54: authored `agents/code-review-companion/state/outside-state.schema.json` (1505 B), `agents/code-review-companion/outside.md` (10687 B), bumped `agents/code-review-companion/agent.json` to `version: '0.2.0'` with 7 files.
- 02:58: ran `npx vitest run test/runner/agent-pack/companion-manifest.test.ts` → **5 of 9 tests failed** with `manifest invalid`.
- Root cause: `validateManifest()` in `src/runner/agent-pack/manifest.ts:18` rejects any manifest path whose first segment is in `RUNTIME_DIR_NAMES = ['runs', 'inbox', 'state', '.git']` (path-traversal hardening from plan 017). The spec assumed `state/` was a valid install destination because the runtime's `state.ts` 3-level fallback calls it "preferred," but "preferred" there means **lookup precedence**, not **install destination**. Two concerns never reconciled.

### FX001 dossier authored + validated

- 03:15: filed `docs/plans/021-coordinated-install-resilience/fixes/FX001-schema-location-pivot.md` capturing the decision (option 2: schemas at agent root) + re-scoped T001/T002/T003 + spec AC text-edits + deferred follow-ups (MW-001 consolidation, MW-002 demo-companion migration, MW-003 doctor copy mentions both locations).
- 03:50: ran `validate-v2` against the dossier (single-validator, no `task` tool — self-validation bias declared). Findings: 0 HIGH/CRITICAL, 3 MEDIUM fixed in place (demo-companion explicit assertion in § 4, doctor-vocabulary test enumeration in § 4, docs drift grep audit in § 5 step 7a), 2 LOW fixed (T003 "legacy" wording flip captured in § 5).
- 03:54: user signed off; sent FX001-supersedes-T001 briefing update to companion run `2026-05-16T12-51-35-391Z-c8e3` → **companion was already dead** (verdict `completed`, terminalReason via briefing-only-no-task farewell). Magic wand harvested from that run: "Add an explicit briefing-only idle threshold or a distinct 'briefing_received_no_task' exit path to the companion coordination contract." Filing as MW-OH-001 (orchestrator follow-up).
- 03:55: booted fresh companion run `2026-05-16T13-55-15-751Z-4e3a`; sent FX001 + plan briefing; verdict `listening`.

### FX001 execution (steps 1-7a)

- 03:56: `git mv state/inside-state.schema.json inside-state.schema.json`; `mv state/outside-state.schema.json outside-state.schema.json`; `rmdir state/`. State dir gone.
- 03:56: updated `agent.json` to list 7 root-level paths (no count change; semantics in descriptions updated to explain FX001 root-location rationale).
- 03:56: re-ran `npx vitest run test/runner/agent-pack/companion-manifest.test.ts` → **8 of 9 pass**; only failure is the `expected '0.2.0' to be '0.1.0'` version assertion which is explicit T002 work. `validateManifest()` now accepts the manifest. **FX001 manifest-shape goal met.**
- 03:57: updated spec ACs 1, 4, 6, 12 with root-path text + FX001 cross-references.
- 03:57: updated plan T001 (paths + Done When), T003 (collapsed to docs-only with semantic-flip note: root is canonical, `state/` is back-compat), T004 (fixture paths), T005 (MW-003 — mention BOTH valid locations). T002 unchanged (file-count assertion + version bump still apply).
- 03:58: ran docs-drift grep audit per FX001 § 4 / § 5 step 7a. Results:
  - Archive plan dirs (`docs/plans/009-human-agent-view/`, `docs/plans/016-a2a-companion-protocol/`): 22 hits. **All historical records of decisions made at the time**; NOT operational docs. Decision: do not rewrite plan history.
  - Operational docs (`docs/how/`, `AGENTS.md`, `AGENTS_README.md`): **0 hits** on the precise schema-path pattern `state/inside-state\.schema\|state/outside-state\.schema`.
  - `src/templates/shared-preamble.md:221` + `agents/_shared/preamble.md:221`: **1 operational hit each** (load-bearing twin files per `code-review-companion/prompt.md § 6a`). Author guidance said "ship a per-agent `state/inside-state.schema.json`" — post-FX001 this is incomplete. Updated both to explain both valid locations + install-manifest constraint + per-agent rule.
- Final on-disk shape of `agents/code-review-companion/`: 7 files at root (agent.json, prompt.md, instructions.md, outside.md, input-schema.json, output-schema.json, inside-state.schema.json, outside-state.schema.json) plus runtime `runs/` dir. **No `state/` directory.**

### Discoveries (FX001-related)

- **D3 (architecture)**: `state/` is a runtime directory at the package contract level, not a definition directory. Several agents (code-review-companion previously, demo-companion currently) treated it as both — a deliberate ambiguity created by plan 009's FX001 (`state/inside-state.schema.json` as "preferred" location for the schema lookup). The denylist enforced one interpretation (runtime-only); the runtime lookup accepted the other (definition-allowed). FX001 (mine) reconciles the package contract: schemas ship at root; `state/` lookup remains as back-compat for in-tree agents. A future plan (MW-001) may consolidate definition files under `schemas/` to eliminate the ambiguity entirely.
- **D4 (companion lifecycle)**: A 62-minute validation cycle exceeded the previous companion's `firstContactPollThreshold` (default ~10min). The companion exited gracefully with `no_engagement` and a useful magic-wand. **Lesson**: when implementing a plan with long thinking/validation cycles between commits, either (a) commit early stubs to keep the companion engaged, (b) configure the companion with longer thresholds at boot, or (c) accept that companion rebooting is part of the workflow. Filing as MW-OH-001.

## T001 — FX003b authoring

---

## T002 — Tests for FX003b

**Status**: ✅ Completed at commit `1cd056e`

- companion-manifest.test.ts: version assertion `0.1.0` → `0.2.0`; added 7-file sorted-path enumeration.
- install.test.ts: regression test for 0.1.0 → 0.2.0 upgrade-detection per spec AC4 (asserts 3 new files in `changedFiles[]`, 4 unchanged absent).
- Full agent-pack: 183/183 green.

## T003 — CANONICAL_AGENT_FILES verify (FX001 collapse)

**Status**: ✅ No-op per FX001 — `CANONICAL_AGENT_FILES` at `src/runner/agent-pack/manifest.ts:33-37` already lists root-level schema paths.

## T004 — Implicit-manifest fixture (spec AC6)

**Status**: ✅ Completed at commit `748f330`

- New test in `install.test.ts`: implicit-manifest synthesis with root-level inside/outside-state schemas; sidecar fileChecksums asserts SHA256 for both.

## 2026-05-16 — SCOPE REDUCTION (`git reset --hard 748f330`)

After landing T007-T011 (watchdog state machine subsystem), user halted scope creep with the verdict: *"considering how simple the original fix was, it feels like we have A LOT of tasks to do here and its taking long time. why is it so bloody complex this plan?"*

**Honest answer**: the original bug is ~3 JSON edits. W1 alone (FX001 + T002) unblocks pij. W3+W4+T005 grew because workshop 001 ratified a defense-in-depth watchdog subsystem and the live #30 dialogue identified diagnostic gaps — both worthy, both wrong for this PR.

**Reset operation**:
- `git reset --hard 748f330` — drops 6 commits (`0a25434` mcp-error-signal.ts, `3f82b8f` watchdog.ts, `dac8cf6` parser knob, `cb7bea7` AgentEvent union, `59c1917` types widening, `efbafb1` doctor copy).
- Reverted commits remain in reflog ~30-90 days if recovery becomes useful.
- Plan documents kept and updated to mark scope-reduced state.

**Post-reset tree state** (HEAD = `748f330`):
- Plan + execution log (`397a56b`)
- FX001 schema location pivot + 0.2.0 manifest (`ddf09fd`)
- T002 manifest + upgrade-detection tests (`1cd056e`)
- T004 implicit-manifest regression test (`748f330`)

**Build/test verification post-reset**: `npm run build` clean; `vitest run test/runner/agent-pack/ test/runner/folder.test.ts` → 235/235 green.

**Companion review of reset state**: pending — fresh briefing being sent to existing run.

### Discoveries

- **D5 (process)**: Workshop-Contract-Ready status is a great gate for keeping design tight within a workshop, but it doesn't gate whether the implementation belongs in THIS PR. Workshop 001 was perfectly designed; it just shouldn't have been implemented now. Lesson: separate "is this design good?" from "is this PR's job?" — the architect skill should flag scope-relative scoping risks distinct from technical-readiness scoping.
- **D6 (orchestrator-side)**: I confused `minih outside inbox list` (outgoing lane) with `minih inside inbox list` (companion replies). The companion was firing findings on every commit; I was reading the wrong file and assuming silence = approve. Real fire-and-forget protocol requires reading the *correct* lane between tasks. Filing as MW-OH-002.

