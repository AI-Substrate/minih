# Phase 2 — Interactive Console & Commands (Human Agent View)

**Type**: Story
**Parent**: Human Agent View (Feature, plan 009)
**Phase**: 2 of 3
**Domain**: cli
**Complexity**: CS-4 (parent feature CS-4 overall)

## Objective

Ship `minih view <slug>` and `minih run <slug> --human` with an Ink-based renderer that consumes the Phase 1 view model. Same-process runs get an interactive footer that submits outside-actor messages via `SessionSender.send`; cross-process attach is `input read-only`; completed runs are inspect-only with no input. **Hard requirement**: every byte of human UI renders to `process.stderr`; `stdout` stays reserved for JSON envelopes (CLI convention, AC-13).

Phase 1 already shipped the foundations — `LiveRunManifest`, `resolveRun({ slug, mode })`, and the pure `buildHumanViewModel` reducer. Phase 2 is purely the renderer + input bridge + command wiring; no new domain concepts.

## Acceptance Criteria

1. `minih view <slug>` resolves the active run (errors with candidate list when ambiguous, AC-11), or by-id when `--run <id>` is passed.
2. `minih run <slug> --human` mounts the renderer after `onSessionReady` with the live `SessionSender`; footer becomes `input available`.
3. Header pane shows slug, run ID, session ID (when known), run status, capability label, event count, tool count (AC-1).
4. Transcript pane labels outside messages as `Outside actor` and inside responses as `Inside agent`; coalesces text deltas into one block (AC-2/4).
5. Tool pane renders each tool call/result as a compact lifecycle row (running / success / error) (AC-5).
6. Activity / workbench pane links acks to the messages they acknowledge (AC-6).
7. Footer input — submit from same-process run delivers as outside-actor message (AC-7); read-only attach surfaces `attached-read-only` reason (AC-8); completed run footer shows `completed` and disables input.
8. Pause toggle changes only scroll-follow behavior; copy reads `Pause scroll` / `Resume follow`; never implies agent stops (AC-9).
9. Split-layout keys produce three layouts: transcript-expanded, workbench-expanded, reset (AC-15).
10. **Stdout discipline**: Ink writes to `process.stderr`; an automated test asserts `stdout` contains zero terminal control bytes during a `view` invocation (AC-13).
11. `npm audit` stays clean after adding `ink` + `react`; or any new findings are explicitly triaged per repo policy.
12. `just fft` green; new tests live in `test/cli/`.

## Scope

- Tasks: 8 (T2.1 → T2.8)
- New files: `src/cli/commands/view.ts`, `src/cli/human/{app.tsx, run-feed.ts, input-bridge.ts, panes/header.tsx, panes/transcript.tsx, panes/tools.tsx, panes/workbench.tsx, panes/footer.tsx}`, `test/cli/human-input-bridge.test.ts`, `test/cli/view-command.test.ts`
- New deps: `ink`, `react` (deps), `@types/react` (devDeps)
- Renderer choice: Ink/React over hand-rolled — input handling, focus, controlled re-render, key bindings, resize already standardised.
- Visual baseline: parity with `scratch/human-agent-view/` (zero-dep mock with 4 fixture variants — `coordination-rich`, `token-deltas`, `attached-read-only`, `completed`).

## Non-Goals (This Phase)

- Cross-process input delivery (attach-control file lane). Cross-process attaches stay read-only — explicitly deferred from plan 009.
- Snapshot mode + non-TTY fallback — Phase 3 (T3.1).
- Terminal cleanup / SIGINT handling — Phase 3 (T3.2).
- Documentation (`docs/how/human-view.md`, README quickstart) — Phase 3 (T3.5/3.6).
- Domain history rows — Phase 3 (T3.7).
- Alternate-screen / full-screen mode — out of scope per spec.

## Cross-Domain Notes

- Renderer reads from `runner` domain contracts only (`LiveRunManifest`, `resolveRun`, `buildHumanViewModel`, `readRecentEventLines`-style helpers). No `runner` source files modified by this phase.
- Input bridge consumes the `adapter` domain's `SessionSender` (already exported via `runner` re-exports from plan 007 P2). No `adapter` changes.
- All file changes land in `cli/` per plan's domain manifest.

## Drift Watch (since Phase 1 shipped)

Phase 1 was implemented before plans 010-015. Before starting Phase 2, assess whether the spec needs refresh for:

- **Plans 010 + 011**: footer's outside-message send should use the current `outside inbox send` shape (post-rename from `outside-send`), and the harvest hint may belong somewhere in the UI.
- **Plan 012 (peer telemetry)**: footer / activity pane could surface `peer.verdict` (`listening` / `silent` / `deaf` / `dead`) returned from outside-send envelopes.
- **Plan 013 (reply chains)**: activity pane "links acks to messages" (AC-6) should also render `In reply to: <id>` for non-ack reply types.
- **Plan 014 (`wait_for_any`)**: tool-call pane has a new tool name; verify compact row renders sensibly.
- **Plan 015 + companion mode**: a long-lived companion run is a new view archetype the original spec didn't envision (many briefing/task/finding/summary cycles vs single-task trajectory). Decide whether companion-mode runs render the same as one-shot runs or get a tweaked layout.

If any of the above warrant spec changes, run `/plan-2-clarify` before starting Phase 2 implementation.

## Key Risks

- **Stdout corruption**: Ink default is `process.stdout`; must be explicitly configured to `process.stderr`. Test must assert no control bytes leak to stdout (mitigation: dedicated test in T2.7).
- **Audit hit on `ink`+`react`**: package-lock will resolve newer versions than when plan 009 was specced; `npm audit` may surface findings to triage (T2.1).
- **Pause label confusion**: users may read "pause" as agent-stop; mitigation locked in copy (`Pause scroll` / `Resume follow`).
- **Same-process vs cross-process**: input bridge must distinguish via `SessionSender` presence; no implicit fallthrough to a write that silently fails.
- **Capability gate leak**: spec is explicit — never expose `coordination.enabled` to the user; capability is derived (`input available` / `input read-only` / `completed`).

## Labels

`domain:cli`, `type:story`, `phase:2`, `complexity:cs-4`, `area:tui`, `parent:009-human-agent-view`

## References

- Spec: `docs/plans/009-human-agent-view/human-agent-view-spec.md`
- Plan: `docs/plans/009-human-agent-view/human-agent-view-plan.md`
- Phase 2 detail: plan §`Phase 2: Interactive Console & Commands` (line ~119)
- Visual baseline: `scratch/human-agent-view/` (run `node scratch/human-agent-view/src/app.mjs --fixture coordination-rich`)
- Workshops: `workshops/001` (layout), `workshops/003` (pause labels), `workshops/004` (reducer pipeline)
- Phase 1 contracts (consumed): `src/runner/{run-manifest.ts, run-resolver.ts, human-view-model.ts, human-view-fixtures.ts, human-view-errors.ts}`

---
*Generated from `human-agent-view-plan.md` § Phase 2. See referenced documents for task details.*
