**Status**: SUPERSEDED by [FX008](FX008-minih-attach-cross-process-tui.md) (2026-05-02)

> FX001's scope (in-process `run --human` coordinated input routing) is fully covered by FX008's same-process leg. The shared `InputBridge` widening ships once with the cross-process attach path. No work is lost; the union is one fix dossier instead of two with overlapping code. See `FX008-minih-attach-cross-process-tui.md` § "Subsumes FX001" and the migration plan in workshop 005 § 12.

---

# Fix FX001: TUI footer input routes to coordinated inbox

**Created**: 2026-05-01
**Status**: Proposed
**Plan**: [Companion Experience](../companion-experience-plan.md)
**Source**: Live demo F4 — operator typed in TUI footer, message never reached the agent
**Domain(s)**: `cli` (primary — `src/cli/human/input-bridge.ts`), `runner` (secondary — `AgentRunConfig.onSessionReady` ctx must expose coordination flag)

---

## Problem

When a coordinated agent runs under `--human`, the operator can type into the TUI footer. That input currently flows through `SessionSender.send()` — the **SDK session's user-message channel** — which:

1. Bypasses the inbox completely (no `id`, no `type`, no `subject`, no `ackOf`).
2. Doesn't wake `wait_for_any`/`inbox_list` long-polls.
3. Looks identical to silence from the operator's POV — the message disappears.

Reproduction: `npx minih run demo-companion --human`, type a message in the footer, observe the agent never sees it as an inbox entry.

This is **silent** — no error, no warning, no log. The most natural user expectation ("the thing I typed in the chat went to the agent") is wrong.

## Proposed Fix

For coordinated runs, route footer input through `appendInboxMessage(... 'outside', ...)` — the same path `npx minih outside inbox send` uses. Wrap typed text into a `task`-typed inbox message (default; configurable via a one-letter prefix or a single-line CLI mode in the footer later).

For non-coordinated runs, **keep** the current `SessionSender.send` path — it's correct there.

The `InputBridge` becomes capability-aware on TWO axes: (write/read-only/completed) AND (coordinated/non-coordinated). Footer label updates to make routing visible — e.g., `input → inbox` vs `input → session`.

## Domain Impact

| Domain | Relationship | What Changes |
|--------|-------------|-------------|
| `cli` | Primary — owns the bridge | New routing logic in `createInputBridge`; footer label changes |
| `runner` | Secondary — owns `AgentRunConfig` | `onSessionReady` ctx must now expose `coordinated: boolean` + `runDir`/`agentSlug` (already partial) so the bridge can resolve the inbox path |
| `adapter` | None | `SessionSender.send` is still used for non-coordinated path |

**Risk**: contract-shaped change to `AgentRunConfig.onSessionReady` ctx — additive, shouldn't break `view`/`resume` paths. Verify no other consumers break.

## Tasks

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|--------|-----|------|--------|---------|-----------|-------|
| [ ] | FX001-1 | Extend `onSessionReady` ctx with `coordinated: boolean` and `agentSlug: string` (additive). Current ctx shape is `{ runDir: string; runId: string }` — `runDir` already present, `coordinated`/`agentSlug` are NEW. Source: `src/runner/types.ts:85-88` defines context shape; `src/runner/runner.ts` calls `config.onSessionReady?.(sender, { runDir, runId })`. | runner | `src/runner/types.ts`, `src/runner/runner.ts` | New fields present in `OnSessionReadyContext` type AND in the runtime call site; existing tests still pass | Additive change; no callsite breakage expected. `coordinated` derived from `definition.coordination?.enabled === true`; `agentSlug` from `config.slug` |
| [ ] | FX001-2 | Refactor `InputBridgeInput` to accept new ctx fields `{ coordinated, runDir, agentSlug }` (treat as required when `attached: false`). Capability becomes `'input → inbox'` for coordinated + active + same-process, `'input → session'` for non-coordinated + active + same-process, plus existing `'input read-only'` / `'completed'`. | cli | `src/cli/human/input-bridge.ts` | Type checks; existing capability constants documented; failing fast when fields missing on a coordinated run | Keep `SessionSender` path for non-coordinated runs |
| [ ] | FX001-3 | Implement coordinated routing in `submit()`: synthesise subject from first 60 chars of body (or first line if multi-line), build a `task`-typed message via `buildOutsideMessage`, and call `appendInboxMessage(commandName, location, 'outside', message)` against the run's outside inbox. **`appendInboxMessage` is already cli-domain** (`src/cli/coordination.ts:92-117`) — direct import from `input-bridge.ts` is allowed and requires no re-export. | cli | `src/cli/human/input-bridge.ts` | Sending text in the footer of a coordinated run produces a new outside-lane inbox entry visible in `npx minih outside inbox list <slug> --run <id>` | Build `location` from `runDir` + `agentSlug` per existing helpers; commandName = `'human-tui.input'` for traceability |
| [ ] | FX001-4 | Update footer label rendering in `src/cli/human/panes/footer.tsx` (or wherever capability is shown) to show the new labels including a one-line hint about routing. | cli | `src/cli/human/panes/footer.tsx` | Label visible; matches new capability values | Use existing wrap/truncate patterns |
| [ ] | FX001-5 | Wire `run.ts` (and `resume.ts` if it also mounts the human app) to thread the new ctx fields through to `createInputBridge`. | cli | `src/cli/commands/run.ts`, `src/cli/commands/resume.ts` | Both commands compile and propagate ctx correctly | Mirror onSessionReady in both files (they're symmetric per existing convention) |
| [ ] | FX001-6 | Tests: extend `test/cli/human-input-bridge.test.ts` to cover both routing modes — coordinated submit appends an inbox entry; non-coordinated submit invokes the SessionSender. Use a tmpdir + filesystem assertions for the coordinated path; use a fake SessionSender for the non-coordinated path. | cli | `test/cli/human-input-bridge.test.ts` | New tests pass; existing 12 still pass | Lean on existing fake patterns |

## Workshops Consumed

- `workshops/001-companion-demo.md` — informs the routing requirement (the demo footer step needs this fix to work)

## Acceptance

- [ ] In a coordinated `--human` run, typing `hello world` in the footer creates an inbox message visible to `inbox_list`/`wait_for_any` inside the agent AND to `npx minih outside inbox list <slug>` outside.
- [ ] In a non-coordinated `--human` run (e.g. `smoke-test`), typing in the footer still routes to the SDK conversation (no regression).
- [ ] **`minih resume --human` exhibits the same routing behaviour** (resume.ts also mounts the human app — must not regress).
- [ ] Footer label clearly signals which routing mode is active.
- [ ] Existing input-bridge tests + 2 new tests covering both routing paths all pass.
- [ ] `just fft` clean.

## Discoveries & Learnings

_Populated during implementation._

| Date | Task | Type | Discovery | Resolution |
|------|------|------|-----------|------------|
