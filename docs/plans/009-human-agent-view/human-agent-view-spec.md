# Human Agent View

**Mode**: Full

## Research Context

📚 This specification incorporates findings from `research-dossier.md`.

Minih already captures the raw material needed for a human operator view: agent events, run metadata, tool activity, output validation status, outside/inside messages, and run state. The current problem is that these sources are exposed as separate, machine-shaped commands and event streams, making it hard for a human or supervising outside agent to quickly understand what a running agent is doing.

The research and workshops converged on a single operator-console experience with honest capability labels. Starting a run in human mode and attaching to an existing run should present the same panes and navigation, while clearly showing whether the current view can send outside-actor messages, is read-only, or is showing a completed run. The first scratch mock-up lives at `scratch/human-agent-view/` and demonstrates the desired layout before product implementation.

## Summary

Human Agent View provides a readable terminal operator console for minih agent runs. It lets an outside actor attach to an active or completed run and understand the inside agent's transcript, tool activity, message/activity timeline, state, output status, and available controls without juggling `tail`, `status`, inbox, and state commands separately.

The feature exists to make background and supervised agents easier to observe. It should reduce cognitive load, preserve minih's machine-readable command contract, and make the outside/inside boundary explicit: messages come from an outside actor, responses come from the inside agent, and activity/state remains visible beside the transcript.

## Goals

- Provide one readable console for both `run --human` start-and-view and `view` attach-to-run journeys.
- Show the inside agent transcript as grouped conversation blocks rather than token/event-line dumps.
- Label outside-actor messages distinctly from inside-agent responses.
- Show active and recent tool calls with useful status and compact summaries.
- Show outside/inside messages, acknowledgements, state transitions, and output/validation status in a separate workbench/activity area.
- Support scrollback and a UI-only pause/follow toggle that never implies the agent itself is paused.
- Allow outside-actor message sending when the active run has a valid delivery path, and disable input with clear explanation when it does not.
- Preserve stdout for machine-readable JSON envelopes; human interactive UI belongs on the human-facing terminal stream.
- Provide a deterministic non-interactive fallback or snapshot mode for scripts and CI.
- Keep completed runs inspectable as transcript/summary views without pretending they are controllable.

## Non-Goals

- Do not replace `tail`, `status`, `connect`, `outside-send`, `outside-inbox-list`, `state`, or `retros`; the console composes their concepts.
- Do not expose the private inside MCP server as a public control plane.
- Do not label scroll pause as "pause agent" or imply SDK/model execution is suspended.
- Do not add hard stop, kill, forwarder pause, or destructive controls in the first implementation.
- Do not make attach mode silently choose between multiple active runs.
- Do not render raw event lines directly as the primary human transcript.
- Do not corrupt stdout with terminal UI output.
- Do not require full-screen/alternate-screen behavior as a product assumption.

## Target Domains

| Domain | Status | Relationship | Role in This Feature |
|--------|--------|-------------|---------------------|
| cli | existing | **modify** | Owns the human-facing command surface, TUI/snapshot presentation, input footer behavior, capability labels, non-TTY fallback, and stdout/stderr discipline. |
| runner | existing | **modify** | Supplies run artifacts, live/completed run identity, event/state/inbox readers, semantic run view projection, and any durable run availability needed by attach mode. |
| adapter | existing | **consume** | Provides normalized event contracts and live session send capability; the feature should consume these contracts without exposing SDK internals. |
| mcp | existing | **consume** | Provides optional inside message/state tools for agents that use them; it remains private and is not a public attach/control API or product mode. |

### New Domain Sketches

No new domain is currently expected. The feature spans existing `cli` and `runner` responsibilities while consuming `adapter` and `mcp` contracts.

### Domain Review

Confirmed 2026-04-28: keep the boundary as-is. `cli` owns the human-facing command/UI surface, `runner` owns reusable run artifacts/readers/projection seams, `adapter` remains the SDK event/send boundary, and `mcp` stays private inside-only with no public attach/control role.

## Complexity

- **Score**: CS-4 (large)
- **Breakdown**: S=2, I=1, D=2, N=1, F=1, T=2
- **Confidence**: 0.78

### Assumptions

- The first product increment can be staged without delivering every future attach-control capability at once.
- Human Agent View presents one agent-run model across the product; current `coordination.enabled` wiring is an implementation detail, not a user-facing mode.
- Keep the internal coordination gate because it may be useful for CI or lightweight runs that should not carry outside-message/state wiring.
- Footer input is outside-actor messaging when input delivery is available; agents decide whether to use richer peer-message/state behavior.
- Users value truthful capability labels over a UI that appears symmetric but silently cannot control the target run.
- The scratch mock-up is directionally accepted as the visual baseline.

### Dependencies

- Existing run artifacts and event streams remain the source of truth for transcript/tool/status panes.
- A stable run-resolution story is needed for `latest active`, explicit run IDs, completed runs, stale runs, and ambiguity.
- The product dependency decision for the final interactive renderer remains downstream of the scratch mock-up.
- Attach sending behavior depends on whether the target run can accept outside-message delivery; that capability should be surfaced without exposing multiple agent modes. The existing internal gate can remain as one way to control that capability.

### Risks

- Users may interpret "pause" as pausing the agent unless labels stay precise.
- Multiple active runs can make `latest` unsafe unless ambiguity is surfaced.
- Frequent token deltas can recreate the current unreadable output if not grouped.
- A TUI could accidentally violate stdout JSON-envelope expectations.
- Attach/input semantics can become confusing if outside messages, direct live delivery, and future command controls are not clearly distinguished.
- Overfitting to a specific terminal size could make the view less useful in everyday shells.

### Phases

Implementation planning should use **no more than three phases**:

1. Define the semantic run view model, run resolution behavior, and snapshot/non-interactive outcomes.
2. Implement the first interactive console with active, read-only, completed, and outside-message input behavior.
3. Harden the experience with tests, documentation, terminal cleanup, and any approved polish.

## Testing Strategy

**Approach**: Hybrid.

**Rationale**: The semantic run view model, run resolution rules, transcript grouping, tool lifecycle projection, coordination timeline, and malformed-source handling are complex enough to benefit from TDD. The terminal UI itself should use lighter interaction/integration checks focused on behavior and stream separation rather than brittle full-frame snapshots.

**Focus Areas**:

- Pure model tests for event parsing, delta coalescing, duplicate suppression, tool call/result pairing, outside/inside message correlation, state timeline projection, diagnostics, and capability derivation.
- Run resolution tests for explicit run IDs, latest active, completed fallback, stale manifests, and ambiguous active runs.
- CLI integration tests for stdout/stderr separation, non-TTY fallback, snapshot output, and command registration.
- Component or terminal interaction tests for input footer enablement, submit handling, split controls, and pause/follow labels.

**Excluded**:

- Large golden ANSI snapshots of the full terminal frame.
- Real SDK sessions for view-model or rendering tests.
- Actual agent pause/stop behavior in the first implementation.

**Mock Usage**: Targeted mocks only. Prefer real fixture files for run artifacts, event logs, inbox lanes, state files, and completed metadata. Use fakes or injected ports only for SDK/session boundaries, terminal streams, clocks, and file-watch timing that would otherwise make tests slow or flaky.

## Documentation Strategy

**Location**: Hybrid — README quick-start plus `docs/how/` guide.

**Rationale**: The command surface needs quick discoverability from the README, while the human view states, outside/inside terminology, attach capability labels, non-TTY behavior, and outside-message semantics need a deeper guide that users and agents can reference during dogfood.

**Expected Updates**:

- README: short command examples for starting in human mode, attaching to latest active, attaching to a run ID, and using snapshot/fallback mode.
- `docs/how/`: detailed guide for active/read-only/completed views, outside-actor messaging, scroll pause, split panes, and troubleshooting.
- Plan/workshop docs remain design references, not user-facing command documentation.

## Harness Readiness

No new `docs/project-rules/harness.md` phase is required for this feature. Planning should use the existing minih dogfood agents, scratch mock-up, unit tests, CLI integration tests, and manual operator-console review instead of creating a separate harness document.

## Acceptance Criteria

1. Given an active run with readable event artifacts, when an outside actor opens the human view, then the header shows slug, run ID, session identity when known, run status, capability mode, event count, and tool count.
2. Given a stream of text deltas and a final message for the same inside-agent response, when the transcript renders, then the response appears as one readable block and is not duplicated line-by-line.
3. Given an outside actor message delivered to an active run, when the view renders, then the transcript identifies it as `Outside actor` and the activity pane shows the corresponding outside message.
4. Given an inside agent response, when the view renders, then the transcript identifies it as `Inside agent`.
5. Given tool call and result events, when the view renders, then each tool appears as a compact lifecycle row with running, success, or error status.
6. Given outside messages, inside acknowledgements, feedback, and state transitions, when the view renders, then the activity pane links acknowledgements to the messages they acknowledge.
7. Given a run with input capability, when the outside actor submits a message from the footer, then the UI records it as an outside-actor message and shows delivery/pending status appropriate to the run capability.
8. Given a read-only attach or completed run, when the footer renders, then input is disabled and the reason is visible.
9. Given the outside actor toggles pause/follow, when new events arrive, then the run continues and the UI only changes scroll-follow behavior.
10. Given a completed run, when the outside actor opens the view, then the transcript and summary are inspectable and no live controls are implied.
11. Given multiple active candidate runs for the same agent, when `view` is requested without an explicit run ID, then the command reports ambiguity and lists candidates rather than attaching implicitly.
12. Given a non-TTY environment, when the human view is requested, then the command avoids interactive rendering and provides a deterministic fallback or snapshot outcome.
13. Given any human view mode, when command output is captured, then stdout remains reserved for machine-readable envelopes and the human UI does not corrupt it.
14. Given malformed or partial source data, when the view renders, then valid data remains visible and diagnostics explain degraded sources instead of crashing the view.
15. Given a terminal wide enough for split panes, when the outside actor changes the split, then transcript-expanded, workbench-expanded, and reset layouts are available.

## Risks & Assumptions

- The outside/inside language is intentional: the outside actor may be a human, CI process, or supervising agent.
- Human Agent View has one agent-run model. Do not expose "coordinated" and "non-coordinated" as product modes; show input capability and activity instead.
- Current `coordination.enabled` behavior should remain as an implementation detail because the gate can be useful for CI/lightweight runs. The product should still present one agent-run model and show input capability rather than asking users to reason about modes.
- The final interactive renderer should be chosen after the scratch mock-up proves layout and controls, not before.
- The UI should be tolerant of stale, missing, or completed run metadata.

## Open Questions

1. [NEEDS CLARIFICATION: Should `view <slug>` fall back to the latest completed run when there is no active run, or should completed view require an explicit flag/run ID?]
2. [NEEDS CLARIFICATION: What are the final preferred keybindings for split resizing, scrollback, pane focus, and submit?]
3. [NEEDS CLARIFICATION: Should the first product implementation include only normal terminal scrollback, or also offer an alternate-screen/full-screen mode later?]
4. [NEEDS CLARIFICATION: What exact label should replace "Workbench" if user testing finds it too vague: Activity, Context, Run Context, or something else?]

## Clarifications

### Session 2026-04-28

- **Q: Which workflow mode should this feature use?**  
  **A:** Full mode — multi-phase plan, dossiers, and validation gates are required because the feature is assessed as CS-4 and spans CLI, runner, coordination artifacts, attach semantics, and terminal UX.
- **Q: How many implementation phases should the architecture plan use?**  
  **A:** No more than three phases.
- **Q: What testing strategy should Human Agent View use?**  
  **A:** Hybrid — TDD for the pure view model/run resolution and lightweight UI/CLI integration checks for terminal behavior.
- **Q: What mock/stub policy should this feature use?**  
  **A:** Targeted mocks only — real file fixtures for artifacts, fakes for SDK/TTY/clocks/watchers where needed.
- **Q: What documentation strategy should Human Agent View use?**  
  **A:** Hybrid — README quick-start plus a `docs/how/` guide for modes, attach behavior, outside/inside terminology, and coordination semantics.
- **Q: Does the Target Domains boundary look right?**  
  **A:** Confirmed as-is. No new domain is needed; avoid making MCP a public control plane and avoid exposing adapter SDK internals.
- **Q: Should planning include harness work?**  
  **A:** Continue without a new harness doc. Use existing minih dogfood agents/tests plus targeted Human Agent View validation.
- **Q: Should Human Agent View expose coordinated versus non-coordinated agent modes?**  
  **A:** No. Use one agent-run model across the product. The UI should show outside actor, inside agent, input capability, messages/activity, and state. Agents decide whether to use richer peer messaging; current `coordination.enabled` wiring is an implementation detail, not a user-facing mode.
- **Q: Should the internal coordination gate remain?**  
  **A:** Yes. Keep the gate because it may be useful for CI and lightweight runs. Human Agent View should hide the gate in product language and show capabilities instead.

## Workshop Opportunities

| Topic | Type | Why Workshop | Key Questions |
|-------|------|--------------|---------------|
| Product shape and pane model | CLI Flow | Existing workshop defines the baseline console layout and pane responsibilities. | Which panes are mandatory? How should capability modes be labeled? How should split panes behave? |
| Attach and control channel | Integration Pattern | Existing workshop defines staged attach behavior and now needs the outside-actor message clarification carried forward. | When can attach send? What requires a future control lane? How are stale/missing controls shown? |
| Pause semantics | State Machine | Existing workshop prevents misleading "pause agent" language. | What does pause affect? Which pause types are explicitly out of scope? |
| View model and timeline | Data Model | Existing workshop defines the semantic model behind transcript, tools, coordination, state, output, input, and diagnostics. | How are deltas coalesced? How are acks linked? How are malformed sources surfaced? |
| Prototype and layout dogfood | Other | Existing scratch mock-up gives fast feedback before product dependencies or command registration. | Is the split layout right? Is the right pane too busy? Are outside/inside labels clear? |
| One agent mode and message semantics | Integration Pattern | Workshop 006 resolves that Human Agent View should not expose coordinated/non-coordinated agent modes. | How does outside-actor input flow? What labels should replace implementation flags? Which capabilities are run states rather than modes? |
| Outside-actor send semantics | Integration Pattern | The user clarified that outside messages may originate from humans or other agents and should not be modeled as human-only chat. | How should footer input create outside messages? What delivery states should be visible? How do agents opt into richer peer behavior? |
| Non-TTY and snapshot behavior | CLI Flow | Interactive terminal UI must not break CI or machine consumers. | What exact fallback envelope/snapshot should appear? Which command flags are needed? |
