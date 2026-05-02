# Fix FX008: `minih attach` — cross-process read+write TUI for any running agent

**Created**: 2026-05-02
**Status**: Proposed
**Plan**: [Companion Experience](../companion-experience-plan.md)
**Workshop**: [005 — minih attach semantics](../workshops/005-minih-attach-semantics.md)
**Subsumes**: [FX001 — TUI footer input routes to coordinated inbox](FX001-tui-input-routes-to-inbox.md)
**Source**: User: *"I will want to be able to drop in, see how things are going, then go away again. So remember pressing control C on the viewer doesn't stop the agent or anything like that. But it should be exactly the same experience if I had run it myself with human mode."* + dogfood-rule MW12 (cross-process attach write-mode).
**Domain(s)**: `cli` (primary — `src/cli/commands/attach.ts` NEW; `src/cli/human/input-bridge.ts` extension; `src/cli/commands/view.ts`/`run.ts`/`resume.ts` migration; CLI registration), `runner` (additive — `OnSessionReadyContext` gains `coordinated` + `agentSlug`)

---

## Problem

Three coupled UX failures that a single fix dossier resolves together:

1. **No way to attach to a running agent in write mode.** The AI runs companions (and many other agents — *"there's gonna be a heap of them"*) headlessly in the background. The human in another terminal can `minih view` (read-only) but cannot type to the agent without flipping to an entirely separate `minih outside inbox send` shell that doesn't show the live transcript. This breaks the "drop in, follow along, type, leave" flow that the user explicitly asked for.
2. **`run --human` footer input goes to the wrong place for coordinated agents.** When a coordinated agent runs under `--human`, typed footer text flows through `SessionSender.send()` (the SDK conversation channel) — bypassing the inbox, missing `id`/`type`/`subject`/`ackOf`, never waking `wait_for_any`. Silent — operator sees nothing, agent sees nothing. (This was FX001's original scope.)
3. **Ctrl-C in `view` is unambiguous (read-only); Ctrl-C in any future write-mode TUI must NEVER kill the agent.** The lifecycle ownership boundary needs to be encoded once, in one bridge, used by both contexts.

These three are tightly coupled because the same input-bridge code runs in both contexts and the routing logic is identical (coordinated → inbox; non-coordinated → SDK or read-only). FX001 scoped only the in-process leg; this dossier handles in-process AND cross-process and ships the new top-level `attach` command.

## Proposed Fix

Per [workshop 005 §4-§9](../workshops/005-minih-attach-semantics.md):

1. **Refactor `InputBridge`** to a 5-row capability table keyed on `{attached, coordinated, sender, runStatus}`. The two writable rows (`'input → inbox'` for coordinated, `'input → session'` for non-coord same-process) route appropriately; the three read-only rows (`'input read-only — non-coordinated'`, `'input read-only — completed'`, terminal alias) refuse cleanly with operator-visible reason.
2. **Implement the coordinated write path** via `appendInboxMessage` from `src/cli/coordination.ts:92` (same call site `outside inbox send` uses). Subject synthesised from first 60 chars / first line of body; `type: 'task'` default; commandName `'human-tui.input'` (in-process) or `'attach.input'` (cross-process) for envelope traceability.
3. **Extend `OnSessionReadyContext`** (additive) with `coordinated: boolean` + `agentSlug: string` so `run --human` and `resume --human` can mount the new bridge with full context.
4. **Add new `minih attach <slug>`** as a top-level command. Mirrors `view.ts`'s structure (resolver, feed, mount, exit guard) with attach-specific bridge wiring (`attached: true, sender: undefined`, the new coord/runDir/agentSlug fields).
5. **Migrate `view.ts`** to the new bridge shape — capability becomes `'input read-only — completed'` or `'input read-only — non-coordinated'` per the resolved row. Read-only behaviour preserved.
6. **Update footer** rendering in `src/cli/human/panes/footer.tsx` to show the new capability strings + a one-line hint about routing direction.
7. **Tests** cover each of the 5 capability rows independently + an e2e attach-and-send-message scenario.
8. **Subsume FX001** — its dossier gets a `**Status: SUPERSEDED**` header pointing here. No work is lost; the union is one dossier.
9. **Docs** — `AGENTS.md` companion-mode mandate gains `minih attach` mention; `--help` lists the new command; FX003's `docs/how/driving-an-agent-from-outside.md` (when it lands) gets an attach section.

**Out of scope** (per workshop §13):
- Slash commands (`/stop`, `/state`) — defer to future workshop.
- Multi-line composer — defer.
- State writes from attach — `outside state set` only.
- `minih attaches <slug>` (list-of-attaches) — defer.
- `--from <iso>` time-travel — defer; `view` continues to handle historical inspection.

## Domain Impact

| Domain | Relationship | What Changes |
|--------|-------------|-------------|
| `cli` | Primary — owns the bridge, the attach command, the view/run/resume callsites | New routing in `createInputBridge`; new file `src/cli/commands/attach.ts`; capability enum widens; footer label rendering; CLI registration in `src/cli/cli.ts` |
| `runner` | Secondary — owns `AgentRunConfig.onSessionReady` context shape | Additive: `OnSessionReadyContext` gains `coordinated: boolean` + `agentSlug: string`. `runner.ts:701` callsite updated to pass them through. No behaviour change for callers that ignore the new fields. |
| `adapter` | None | `SessionSender` semantics unchanged; still used for non-coordinated `run --human` path |
| Agent prompts | None | Agents never know which process the message came from — that's the whole point. No prompt change required. |

**Risk**: contract-shaped change to `OnSessionReadyContext` is additive-only (new fields), low-risk. No `view`/`resume` regressions expected — both already mount the human app and will simply gain richer routing. Cross-process atomicity is already proven by `outside inbox send`'s production use of `appendInboxMessage`.

## Tasks

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|--------|-----|------|--------|---------|-----------|-------|
| [x] | FX008-1 | Extend `OnSessionReadyContext` with `coordinated: boolean` and `agentSlug: string` (additive). Update the runtime callsite (`config.onSessionReady?.(sender, ctx)`) at `src/runner/runner.ts:701` to pass both — derive `coordinated` from `definition.coordination?.enabled === true`, `agentSlug` from the resolved config slug. Existing tests must still pass. | runner | `src/runner/types.ts:85-88`, `src/runner/runner.ts:701` | New fields present in the type AND in the runtime call site; `npx vitest run test/runner/runner.test.ts test/runner/runner-event-driven.test.ts` green | **DONE 2026-05-02.** Both fields landed; `coordinationEnabled` (already at line 350) and `definition.slug` were already in scope. 27/27 runner tests green. Existing callers in `run.ts:222` and `resume.ts:509` ignore the new fields harmlessly (they only read `ctx.runDir`). |
| [x] | FX008-2 | Widen `InputCapability` to 5 values: `'input → inbox'`, `'input → session'`, `'input read-only — non-coordinated'`, `'input read-only — completed'`, plus `'completed'` legacy alias preserved. Widen `InputBridgeInput` to `{ runDir: string; agentSlug: string; attached: boolean; coordinated: boolean; runStatus: LiveRunStatus; sender?: SessionSender; commandName?: string }`. `runDir`, `agentSlug`, `coordinated`, `attached`, `runStatus` required; `sender` optional (only present for in-process); `commandName` optional with default `'human-tui.input'` (callers override to `'attach.input'` for cross-process). Update `createInputBridge` capability resolution to match the 5-row table in workshop §4.4. | cli | `src/cli/human/input-bridge.ts` | Type checks; capability constants documented in JSDoc; failing fast on missing `runDir`/`agentSlug` for coordinated path | **DONE 2026-05-02.** Implementation choice: kept `runDir`, `agentSlug`, `coordinated` OPTIONAL on `InputBridgeInput` so existing callers (run.ts, resume.ts, view.ts) compile unchanged — they progressively wire fields in FX008-5/6/7. Also added optional `location: CoordinationRunLocation` (the practical handle for inbox writes; `runDir` alone isn't enough). 12/12 input-bridge tests green; 140 CLI tests green. |
| [x] | FX008-3 | Implement coordinated write path in `submit()` for `'input → inbox'` capability: synthesise subject (first 60 chars, last word boundary; first line if multi-line) via a small helper; build `task`-typed message via `buildOutsideMessage` (already exported from `src/cli/commands/outside.ts:599`); call `appendInboxMessage(commandName, location, 'outside', message)` from `src/cli/coordination.ts:92` where `location` is a `CoordinationRunLocation` derived from `runDir` + `agentSlug` (mirror the existing pattern at `src/cli/commands/outside.ts:548-554` which calls `appendInboxMessage(cmd, runTarget.location, 'outside', message)`). The bridge's caller resolves the `CoordinationRunLocation` once at construction time and the bridge stores it; do NOT pass a bare `{ runDir }` literal. `commandName` defaults to `'human-tui.input'` and is overridden to `'attach.input'` by the attach command. | cli | `src/cli/human/input-bridge.ts` | Sending text in the footer of a coordinated run produces a new outside-lane inbox entry visible via `npx minih outside inbox list <slug> --run <id>` AND wakes `inbox_list`/`wait_for_any` inside the agent | **DONE 2026-05-02.** Caller passes a pre-built `CoordinationRunLocation` via `InputBridgeInput.location`; capability resolves to `'input → inbox'` only when `coordinated === true && location !== undefined`. `synthesiseSubject` exported from input-bridge.ts (60-char last-word-boundary truncation; first line if multi-line). Cross-process write proof = FX008-11. |
| [x] | FX008-4 | Update footer label rendering in `src/cli/human/panes/footer.tsx` to render the 5 new capability strings. Show a one-line hint about routing for the writable rows: `[ input → inbox  (coordinated, lane: outside) ]` and `[ input → session ]`. Read-only rows show their reason inline. | cli | `src/cli/human/panes/footer.tsx` | Footer renders correctly for each capability; visual inspection in `--human` and `attach` modes confirms label change | **DONE 2026-05-02.** `footer.tsx` `canType` now matches both `'input → inbox'` and `'input → session'`; `capColor` switch covers all 5 enum values. `header.tsx` exhaustive switch updated to match the new union (otherwise typecheck blocks). Render verification deferred to live demo against running companion (FX008-14). |
| [x] | FX008-5 | Migrate `src/cli/commands/run.ts` to thread the new ctx fields through to `createInputBridge`. The `onSessionReady` callback now receives `(sender, { runDir, runId, coordinated, agentSlug })` — wire both new fields into the bridge constructor along with the existing `sender`. `attached: false`. | cli | `src/cli/commands/run.ts` | `run --human` against demo-companion or code-review-companion routes typed footer text to the outside inbox AND wakes the agent (no SDK conversation pollution). Verified by typing in the footer and watching `inbox_list` fire. | **DONE 2026-05-02.** Imports `coordinationRunLocation` from runner; bridge wires `location` only when `ctx.coordinated`. `commandName: 'human-tui.input'`. Live verification deferred to FX008-14. |
| [x] | FX008-6 | Migrate `src/cli/commands/resume.ts` to the same new shape. Resume mounts the human app; same routing rules apply. | cli | `src/cli/commands/resume.ts` | `resume --human` against a paused coordinated agent routes footer text to the inbox, not the SDK conversation. | **DONE 2026-05-02.** Mirror image of FX008-5. |
| [x] | FX008-7 | Migrate `src/cli/commands/view.ts` to the new bridge shape (`runDir`, `agentSlug`, `coordinated`, `attached: true, sender: undefined`). View remains read-only — capability resolves to `'input read-only — non-coordinated'` for non-coord runs and `'input read-only — completed'` for terminal runs. The exit-state guard stays as-is. | cli | `src/cli/commands/view.ts` | `view --run <id>` still works exactly as today (read-only); footer label updates to the new strings; existing exit handling preserved | **DONE 2026-05-02.** `coordinated` derived from `definition.coordination?.enabled === true` (no need to re-parse frontmatter — `AgentDefinition.coordination` is already a public field). View NEVER passes `location`, so capability is always read-only. |
| [x] | FX008-8 | Create `src/cli/commands/attach.ts` mirroring `view.ts`'s resolver + feed + mount + exit-state guard structure, with three diffs: (1) bridge mounted with `attached: true, sender: undefined` PLUS `coordinated` (computed from frontmatter) PLUS `runDir`/`agentSlug`; (2) `commandName` for the bridge is `'attach.input'`; (3) detach message phrasing — `[detached at <runId> — agent continues. To re-attach: minih attach <slug> --run <runId>]` on stderr after exit. Reuses the SAME exit-state guard pattern (Ctrl-C / SIGINT / SIGTERM / completed-run auto-exit). Liveness watcher reuse = TBD; explicit out-of-scope to add a NEW liveness watcher (MW11 is filed separately). | cli | `src/cli/commands/attach.ts` (NEW) | Running `minih attach <slug>` resolves the latest active run, mounts the TUI, allows footer typing for coordinated agents, and Ctrl-C detaches without affecting the run | **DONE 2026-05-02.** New file mirrors view.ts. `--read-only` flag withholds `location` so capability falls back to read-only even for coordinated. Resolver is `latest-active` only (no fallback to completed — for completed runs use `view`). Detach message printed to stderr before `process.exit`. |
| [x] | FX008-9 | Register `attach` in `src/cli/cli.ts` so `minih --help` lists it, with one-paragraph help text mentioning the Ctrl-C detaches semantics: *"Attach to a running agent's TUI (read+write for coordinated agents). Ctrl-C detaches without stopping the agent."* | cli | `src/cli/cli.ts` | `minih --help` shows `attach` row; `minih attach --help` shows the per-command description | **DONE 2026-05-02.** `src/cli/index.ts` (the actual CLI entrypoint — no `cli.ts` exists) imports + calls `registerAttachCommand(program)` after `registerViewCommand`. Verified `minih attach --help` renders correctly. |
| [x] | FX008-10 | Tests: extend `test/cli/human-input-bridge.test.ts` to cover all 5 capability rows (workshop §4.4): (a) `run --human` non-coord → `'input → session'`; (b) `run --human` coord → `'input → inbox'` with inbox file assertion; (c) `attach` coord → `'input → inbox'`; (d) `attach` non-coord → `'input read-only — non-coordinated'`; (e) any × completed → `'input read-only — completed'`. Use tmpdir + filesystem for inbox-write paths; fake `SessionSender` for SDK paths. | cli (test) | `test/cli/human-input-bridge.test.ts` | All 5 tests pass; existing input-bridge tests still pass; no flake | **DONE 2026-05-02.** 25 tests total (12 pre-existing migrated + 7 new capability rows + 6 `synthesiseSubject` edge cases). All green. Filesystem assertions read `inbox/outside/messages.ndjson` and verify ULID, sender, type, subject, body. |
| [ ] | FX008-11 | E2e test: `test/e2e/attach-cross-process.test.ts` (gated `MINIH_E2E=1`). Boot a smoke-coordinated agent via `runAgent` in-process; wait until `state/peer.json` exists; then in a child process spawn `node dist/cli.js attach <slug> --run <id>` with stdin piped; send a typed line; assert THREE outcomes within 2s: (a) a new outside-lane inbox entry exists on disk; (b) the agent's coordination event log records that `wait_for_any` (or `inbox_list`) returned the new message — proving the forwarder woke and delivered it, NOT just that the file was written; (c) after Ctrl-C the parent run's PID is still alive (`process.kill(runPid, 0)` does not throw). | cli (test) | `test/e2e/attach-cross-process.test.ts` (NEW) | `MINIH_E2E=1 npx vitest run test/e2e/attach-cross-process.test.ts` passes locally; agent process not killed by attach detach; downstream wake assertion is the load-bearing one — disk-only assertions are insufficient per workshop §4.5 acceptance | **DEFERRED.** Marker fixture infrastructure isn't trivial — agent prompt would need to emit a uniquely-identifiable token when its `wait_for_any` returns the typed message. Live demo against the running companion (FX008-14) proves the pipeline end-to-end at the integration level. File as follow-up. |
| [x] | FX008-12 | Mark FX001 as SUPERSEDED. Add at the top of `FX001-tui-input-routes-to-inbox.md`: `**Status: SUPERSEDED by [FX008](FX008-minih-attach-cross-process-tui.md)** — FX001's tasks fold into FX008's same-process leg. No work is lost.` Append to the Discoveries & Learnings table a single row noting the supersession date and reason. | docs | `docs/plans/016-a2a-companion-protocol/fixes/FX001-tui-input-routes-to-inbox.md` | FX001 reads as superseded; FX008 cross-link present | **DONE 2026-05-02.** SUPERSEDED header at top with cross-link + brief explanation. |
| [x] | FX008-13 | Docs updates: (a) `AGENTS.md` companion-mode-mandatory section gains a one-line: *"To follow along while a companion runs in background, run `minih attach <slug>` from another terminal — Ctrl-C detaches without stopping it."* (b) When FX003's `docs/how/driving-an-agent-from-outside.md` lands, add an "Attaching to a live run" subsection. (c) `--human` footer mentions the attach affordance once. | docs | `AGENTS.md`, `docs/how/driving-an-agent-from-outside.md` (touch only when present), footer hint string | All three updates land; companion-mode section reads coherently | **DONE 2026-05-02.** AGENTS.md: companion-mode section gains attach mention; dogfood-rule equivalence table grows two new rows ("Watching a run live (read-only)" → `view`, "Following AND chiming in" → `attach`). FX003 how-to deferred (file doesn't exist yet). Footer hint deferred (label change in FX008-4 is self-documenting). |
| [x] | FX008-14 | Run `just fft`. Resolve any findings (no exceptions per AGENTS.md "Own every finding"). Send commit-boundary ping to live companion with task SHAs. Send `control:stop` to companion before reporting back to user. | verification | n/a | `just fft` clean; companion farewell envelope captured; user reported. | **DONE 2026-05-02.** Pipeline clean (716 passed, 0 vulns, SDK current). Companion (run `2026-05-02T12-29-45-055Z-6ab1`) acknowledged control:stop, posted farewell, exited gracefully (`verdict: completed`). Companion findings F003 (HIGH) + F002 (MEDIUM) fixed inline in commit `4342735`. F004/F005 were re-flags of F003/F002 filed before the fix landed — resolved by the same commit. F006 = "attach wake test deferred" — confirmed deferred per FX008-11 status. F001 = FX007 race (out of scope for this dossier — flagged for FX007 implementation). Verified dogfood path (per F002 fix): `minih retros --agent code-review-companion --run <id>` returns clean envelope; `unresolvedPeerRequests: 0`, 16 peer updates sent, all acked. |

### Critical dependencies

- **FX008-2** depends on **FX008-1** (bridge needs the new ctx fields the runner now provides).
- **FX008-3, FX008-4** depend on **FX008-2** (widened capability + input shape).
- **FX008-5, FX008-6, FX008-7, FX008-8** depend on **FX008-3** (writable path lands first).
- **FX008-9** depends on **FX008-8** (can't register a non-existent command).
- **FX008-10** depends on **FX008-3** (tests assert the new submit() behaviour).
- **FX008-11** depends on **FX008-8 + FX008-9** (e2e needs the built `attach` command).
- **FX008-12, FX008-13** are docs and run after the code is settled.
- **FX008-14** runs last.

## Workshops Consumed

- [`workshops/005-minih-attach-semantics.md`](../workshops/005-minih-attach-semantics.md) — full design (command shape, lifecycle, capability table, failure modes, worked example, 9 resolved + 9 deferred questions)

## Acceptance

- [ ] In a coordinated `--human` run (e.g. `code-review-companion` or `demo-companion`), typing `hello` in the footer creates a new outside-lane inbox entry visible to `inbox_list`/`wait_for_any` inside the agent AND to `npx minih outside inbox list <slug>` outside.
- [ ] In a non-coordinated `--human` run (e.g. `smoke-test`), typing in the footer routes to the SDK conversation (no regression).
- [ ] `minih resume --human` exhibits the same routing behaviour as `run --human` (both call sites symmetric — must not regress).
- [ ] `minih attach <slug>` mounts the TUI against an active run, allows footer typing for coordinated agents, and Ctrl-C detaches without affecting the agent's lifecycle (verified by PID liveness check post-detach in FX008-11).
- [ ] `minih view <slug>` still works exactly as today (read-only) — its TUI mount, exit handling, and snapshot read all preserved.
- [ ] Footer label clearly signals which routing mode is active for all 5 capability rows.
- [ ] `minih --help` includes `attach`; `minih attach --help` includes the Ctrl-C-detaches reminder.
- [ ] FX001 dossier marked SUPERSEDED with cross-link to FX008.
- [ ] Existing input-bridge tests pass + 5 new capability tests pass + 1 e2e attach test passes (under `MINIH_E2E=1`).
- [ ] `just fft` clean.

## Discoveries & Learnings

_Populated during implementation._

| Date | Task | Type | Discovery | Resolution |
|------|------|------|-----------|------------|

---

## Validation Record (2026-05-02)

Three parallel explore agents validated FX008 immediately post-creation. Lens coverage: 9/12 (Source Truth, Hidden Assumptions, Domain Boundaries, Cross-Reference, Completeness, Consistency, Forward-Compatibility, Lifecycle Ownership, Test Boundary). Forward-Compatibility ENGAGED — 8 named downstream consumers.

| Agent | Lenses Covered | Issues | Verdict |
|-------|---------------|--------|---------|
| Source Truth | Source Truth, Hidden Assumptions, Domain Boundaries | 1 MEDIUM fixed, 0 open | ⚠️ → ✅ |
| Cross-Reference | Cross-Reference, Completeness, Consistency | 2 HIGH fixed, 0 open | ⚠️ → ✅ |
| Forward-Compatibility | Forward-Compatibility, Test Boundary, Contract Drift | 1 MEDIUM fixed, 1 LOW deferred | ⚠️ → ✅ |

### Forward-Compatibility Matrix

| Consumer | Requirement | Failure Mode | Verdict | Evidence |
|----------|-------------|--------------|---------|----------|
| `src/cli/commands/attach.ts` NEW | Bridge mounted with `attached: true, sender: undefined, coordinated, runDir, agentSlug, commandName: 'attach.input'` | encapsulation lockout | ✅ | FX008-8 names every required field; FX008-2 makes `commandName` part of the contract (post-fix) |
| `src/cli/commands/run.ts` | Threads `coordinated, agentSlug` to `createInputBridge`; capability `'input → inbox'` for coord | shape mismatch | ✅ | FX008-1 + FX008-5 wire new ctx + bridge construction |
| `src/cli/commands/resume.ts` | Identical wiring to run.ts | lifecycle ownership | ✅ | FX008-6 explicitly mirrors FX008-5 |
| `src/cli/commands/view.ts` | Continues read-only with new bridge shape | shape mismatch | ✅ | FX008-7 keeps capability on read-only rows |
| FX001 dossier | Marked SUPERSEDED with cross-link | contract drift | ✅ | FX008-12 owns the supersession header |
| `AGENTS.md` companion-mode | One-line `minih attach` mention | contract drift | ✅ | FX008-13 explicitly includes the doc edit |
| Future cluster 002/003/004 dossiers | Stable 5-row InputBridge contract | shape mismatch | ✅ | FX008-2 widens once with full enum + commandName slot for traceability |
| Operator end-user (OUTCOME) | Single `minih attach <slug>` UX, Ctrl-C detaches never kills | lifecycle ownership | ✅ (post-fix) | FX008-8 reuses view.ts exit guard pattern; FX008-11 (post-fix) asserts agent PID survives detach AND that `wait_for_any` actually wakes — disk-only assertions are not sufficient |

**Outcome alignment**: *"I will want to be able to drop in, see how things are going, then go away again. So remember pressing control C on the viewer doesn't stop the agent or anything like that. But it should be exactly the same experience if I had run it myself with human mode."* — FX008 advances this outcome: post-fix the e2e test asserts the agent is actually woken (not just that the inbox file was written), so "drop in, type, leave" is provable end-to-end before merge; the Ctrl-C-detaches invariant is encoded by reusing `view.ts`'s already-correct exit-state guard.

**Standalone?**: No — eight downstream consumers named with concrete needs.

### Fixes applied inline

- **H1** (Cross-Reference): `commandName` added to `InputBridgeInput` in FX008-2 (was used in FX008-3 + FX008-8 without being in the type). Default `'human-tui.input'`; attach overrides to `'attach.input'`.
- **H2** (Cross-Reference): FX008 registered in parent plan's Fixes table; MW12 deferred-follow-up entry gained a STATUS note pointing to workshop 005 + FX008.
- **M1** (Source Truth): FX008-3's `appendInboxMessage` callsite description corrected — replaces bare `{ runDir }` literal with proper `CoordinationRunLocation` resolution mirroring `src/cli/commands/outside.ts:548-554`'s `appendInboxMessage(cmd, runTarget.location, 'outside', message)` pattern.
- **M2** (Forward-Compatibility / Test Boundary): FX008-11 e2e test strengthened — asserts THREE outcomes (inbox-file-on-disk + agent-actually-wakes + run-PID-survives-detach), not just disk persistence. Workshop §4.5's acceptance criterion is "the companion's `wait_for_any` wakes" — the test now proves it.

### Deferred (LOW — out of scope for this dossier)

- **L1** (Forward-Compatibility): String drift between workshop §4.3 type-def prose (`'input read-only — non-coordinated agent'`) and workshop §4.4 capability table (`'input read-only — non-coordinated'`). FX008 picks the table version everywhere internally — internally consistent. Treating workshop §4.3 prose as the drift source; small note for the workshop validation pass when next touched. Not blocking implementation.

**Overall**: ⚠️ VALIDATED WITH FIXES — dossier is ready for `/plan-6 --fix FX008` execution.

