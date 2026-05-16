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
