# Canonical Coordination Loop Validator

**Mode**: Simple

## Research Context

📚 This specification incorporates findings from `research-dossier.md`.

Minih already has the coordination primitives needed for a manual outside/inside conversation loop: outside-facing commands, run-scoped inbox/state files, daemon-light forwarding into live runs, and inside-only MCP inbox/state tools. The missing product artifact is a canonical dogfooding harness and worked example that demonstrates how an outside agent and inside agent can run in parallel, how the inside agent may be started by the outside agent or by some other actor, how simulated work milestones become manual events, and how feedback/state evidence proves the loop is coherent.

The seed workshop in `workshops/001-manual-event-validation-agent-harness.md` is authoritative for the shape of the concept: this is a normal coordinated agent pattern, not a new minih framework-level agent type. The research also identified one critical constraint for the spec: workflow-specific phase names should be represented as data, while side `status` values must remain compatible with the existing coordination state schemas.

## Summary

Create `coordination-loop-validator` as the canonical dogfooding harness, concept demonstrator, and worked example for minih's outside/inside coordination model. The harness should show a user or outer coding agent how to coordinate with an inner validation agent running in parallel, manually fire milestone events as pretend work is completed, read feedback from the inner agent, and confirm that messages, acknowledgements, state, prompt guidance, and final reporting all work together.

This feature is about demonstrating and validating the coordination loop, not about judging real code quality. The inside agent should know it is participating in a harness. The outside contract should be clear enough that another agent can follow it as a script for a back-and-forth conversation.

## Goals

- Provide a canonical, reusable worked example for outside/inside agent conversation in minih.
- Demonstrate the "inside and outside agents run in parallel, then outside sends manual milestone events" workflow end to end.
- Show that the inside agent may be started by the outside agent, started manually, or already running before the outside agent begins.
- Use a canonical main runbook where the outside side starts the inside validator and drives exactly three simulated milestones.
- Give outer agents a clear outside contract that explains when to send messages, what state to publish, how to read feedback, and how to finish.
- Give the inside agent a clear validation role that covers readiness, milestone processing, acknowledgements, state checks, feedback, and final evidence.
- Produce human- and agent-readable evidence that the coordination loop worked for each milestone.
- Keep the implementation as a dogfooding harness that consumes existing coordination capabilities rather than expanding minih's runtime model.
- Preserve the existing `coordination-smoke-test` as the minimal primitive check, while making `coordination-loop-validator` the canonical richer worked example.

## Non-Goals

- Do not create a new framework-level "agent type".
- Do not add a real source-code event emitter, file-change event source, daemon supervisor, pidfile, IPC socket, or public MCP server.
- Do not build a real background code-review agent in this plan.
- Do not hide the simulation from the inside agent or evaluate whether it can infer a fake review scenario.
- Do not implement orchestration for one outside agent managing many inside agents in parallel; that multi-agent/differing-agent-types scenario is explicitly out of scope for this plan.
- Do not create a new runtime domain.
- Do not change the core coordination queue model.
- Do not make core runtime code depend on dogfood agent prompts, reports, or fixtures.
- Do not broaden generic system output validation only for this harness; the harness can define its own output expectations.

## Target Domains

| Domain | Status | Relationship | Role in This Feature |
|--------|--------|-------------|---------------------|
| cli | existing | **consume** | The outside peer uses the existing outside command surface to read the contract, send milestone messages, inspect replies, publish state, and record feedback. |
| runner | existing | **consume** | The harness relies on existing coordinated prompt assembly, run-scoped inbox/state handling, daemon-light forwarding, snapshots, and final report validation. |
| mcp | existing | **consume** | The inside agent uses the existing private six-tool inbox/state MCP surface during the run. |
| adapter | existing | **consume** | The live run relies indirectly on the existing event-driven session/send seam for forwarded outside updates. |

### New Domain Sketches

No new domain is proposed. `coordination-loop-validator` is a leaf dogfooding harness under `agents/` plus plan documentation. It consumes existing domain contracts and must not become a dependency of `cli`, `runner`, `mcp`, or `adapter`.

### Domain Review

Confirmed: this feature should consume existing domains only. No new runtime domain is needed, and no contract-breaking changes are expected. Small documentation, agent-asset, or validation-check additions may reference existing domain contracts, but the domain topology remains unchanged.

## Complexity

**Score**: CS-3 (medium)

**Breakdown**: S=1, I=1, D=1, N=1, F=1, T=2

- **S=1**: Multiple artifacts are expected across agent files, docs, and tests, but core runtime changes are not expected.
- **I=1**: The live worked example integrates with the existing coordinated run/session flow.
- **D=1**: The harness will define or consume agent-specific state/report schemas, but no migration is expected.
- **N=1**: The concept is clear, but canonical positioning and worked-example details need clarification.
- **F=1**: The harness must be reliable enough to teach agents and humans, with bounded waiting and clear failure reporting.
- **T=2**: Useful validation likely spans static checks, CLI-level checks, and an opt-in live/manual or e2e run.

**Confidence**: 0.84

**Assumptions**:

- The existing 007 coordination runtime is the foundation for this plan.
- The first version remains a normal coordinated agent folder and plan documentation.
- The worked example uses simulated milestone descriptions rather than real code diffs.
- Existing state schemas remain the source of truth for allowed side statuses.
- The canonical runbook uses the outside-starts-inside path, while still documenting already-running/manual-start as supported variations.
- The first version demonstrates one inside agent loop, even though a future outside agent may coordinate with many inside agents of differing types.

**Dependencies**:

- Existing outside command surface for context, messaging, inbox inspection, state, and retrospectives.
- Existing coordinated prompt assembly and daemon-light forwarding.
- Existing private inside MCP tool surface.
- Existing build/check/doctor/validation commands for agent authoring.
- Existing repository quality gates; no separate `docs/project-rules/harness.md` project harness is required for this feature.

**Risks**:

- The worked example may drift from the actual command/state contracts if prompt and docs are not checked together.
- The inside agent may exit too early unless the expected bounded wait behavior is clear.
- Custom workflow vocabulary may be confused with schema-valid `status` values unless the spec separates `status` from richer `data`.
- Live validation may be timing-sensitive and unsuitable for the default fast test loop.

**Phases**:

1. Specify the canonical harness behavior, boundaries, and evidence model.
2. Clarify canonical positioning and milestone/run expectations.
3. Plan agent files, documentation updates, and validation layers.
4. Implement the dogfooding harness and worked example.
5. Validate the worked example through static, CLI, and live/manual or opt-in e2e checks.

## Testing Strategy

**Approach**: Lightweight

**Rationale**: Simple mode keeps this plan as a single-phase worked example. Validation should focus on deterministic checks for the dogfooding harness assets, command guidance, schema compatibility, and a documented real manual live run rather than requiring a full multi-phase TDD process up front.

**Focus Areas**:

- Agent folder contract, frontmatter, outside contract, and schemas.
- Outside-facing command guidance for context, messaging, state, feedback, and completion.
- Report/evidence shape for milestone handling and coordination retrospective feedback.
- Documented real manual live validation of the parallel outside/inside loop.

**Excluded**:

- Default fast-loop live model e2e as a required gate.
- Opt-in automated e2e in the first implementation; defer until the worked example proves the shape.
- New mock-based tests for the dogfooding harness itself.
- Runtime refactors outside the dogfooding harness unless later planning discovers a necessary gap.

**Mock Usage**: Avoid new mocks for the worked-example harness. The plan should build and use a real coordinated agent, real agent files, real outside-facing CLI commands, and real run-scoped inbox/state artifacts. Existing lower-level test fakes can remain for existing runtime unit coverage, but the value of this feature comes from exercising the real coordination surface.

## Documentation Strategy

**Location**: Hybrid — README/AGENTS quick-start plus deeper docs/how guide.

**Rationale**: The harness is a concept demonstrator and worked example. It needs a short, discoverable entry point for users and coding agents, plus a deeper guide that can walk through the parallel outside/inside conversation without bloating top-level docs.

**Expected Coverage**:

- A concise quick-start pointer from the main project docs and agent authoring docs.
- A deeper how-to guide that shows the real-agent runbook, supported startup variations, message/state beats, and expected evidence.
- References from the agent files back to the deeper guide where useful.

## Acceptance Criteria

1. A user can identify `coordination-loop-validator` as the canonical dogfooding harness, concept demonstrator, and worked example for manual outside/inside coordination.
2. A user or outer agent can read the outside contract and understand how to ensure an inside agent is running, when to send a milestone event, what information belongs in the message, how to publish state, how to read feedback, and how to complete the run.
3. The inside agent's role is explicit: it validates the harness conversation and does not pretend to be an unbiased real code reviewer.
4. The worked example covers exactly three simulated milestones before completion in its canonical runbook.
5. For each simulated milestone, the final evidence shows an outside message, a compatible outside state publication, an inside acknowledgement or handling record, inside feedback, and an observable outside readback.
6. The final report distinguishes coordination validation from code-quality validation.
7. The final report includes a coordination-focused retrospective with actionable magic-wand feedback.
8. The worked example uses schema-compatible side statuses and stores workflow-specific milestone/phase vocabulary in data fields or message bodies.
9. The harness has bounded waiting behavior so a missing outside signal becomes an explicit blocked/partial outcome rather than an indefinite hang.
10. Existing minimal smoke-test behavior remains understandable; the new harness is documented as the richer canonical loop worked example.
11. The worked example can be validated without reading private run internals: outside-facing commands, final artifacts, and documented manual live-run evidence provide enough proof.
12. The feature does not introduce a new runtime domain, public MCP server, daemon supervisor, or core dependency on dogfood assets.
13. The specification clearly distinguishes the v1 single-inside-agent worked example from future orchestration where one outside agent may coordinate with many inside agents in parallel.

## Risks & Assumptions

- **Assumption**: The current coordination runtime can support the manual milestone loop without core changes.
- **Assumption**: A worked example is more valuable here than a generic template because the product goal is to teach the back-and-forth conversation.
- **Assumption**: The inside and outside agents run in parallel, and inside startup ownership can vary by scenario.
- **Risk**: If the outside contract is too vague, outer agents may forget to send both state and message updates.
- **Risk**: If the inside prompt is too reviewer-like, the harness may appear to validate code review quality rather than coordination quality.
- **Risk**: If the example requires live model behavior for all validation, it may be too slow or flaky for routine checks.
- **Risk**: If docs do not distinguish `coordination-smoke-test` from `coordination-loop-validator`, users may confuse the minimal primitive check with the richer worked example.
- **Risk**: If the manual live run is not documented with concrete evidence, the harness may read like a design sketch instead of a worked example.

## Clarifications

### Session 2026-04-27

- **Q1: Which workflow mode should this spec use?** Simple — single-phase plan with lightweight tasks.
- **Q2: What mock/stub policy should the implementation plan use for this worked example?** Avoid new mocks for the harness; build and use a real coordinated agent and validate it through real files, CLI commands, and manual or opt-in live runs. Existing lower-level fakes are not expanded for this feature.
- **Q3: Where should this worked example be documented when implemented?** Hybrid — README/AGENTS quick-start plus a deeper docs/how guide.
- **Q4: Domain review — should this feature only consume existing domains (`cli`, `runner`, `mcp`, `adapter`) and create no new runtime domain?** Yes — consume existing domains only; no contract-breaking changes expected.
- **Q5: Does the project need a separate `docs/project-rules/harness.md` phase?** No — continue without a separate project harness because this feature itself is the dogfooding harness, using existing minih checks and quality gates.
- **Q6: How should `coordination-loop-validator` be positioned relative to `coordination-smoke-test`?** Keep both: `coordination-smoke-test` remains the minimal primitive check, and `coordination-loop-validator` becomes the canonical richer worked example.
- **Q7: What should the canonical runbook demonstrate for startup and milestone count?** The main path should show the outside side starting the inside validator and should require exactly three simulated milestones. The already-running inside-agent path remains a supported variation in docs.
- **Q8: What validation depth should the first implementation require?** Static/CLI checks plus a documented real manual live run. Defer opt-in automated e2e until after the worked example proves the shape.

## Open Questions

No unresolved high-impact questions remain after the 2026-04-27 clarification session.

## Workshop Opportunities

| Topic | Type | Why Workshop | Key Questions |
|-------|------|--------------|---------------|
| Canonical example positioning | Other | The docs need a clear relationship between the minimal smoke test and the richer worked example. | Which artifact is "canonical" for which audience? Where should README/AGENTS docs point first? |
| State and evidence vocabulary | State Machine | The harness needs expressive workflow language without violating side status schemas. | Which status values are allowed? Which phase names live in data? What final evidence is required per milestone? |
| Worked example runbook | CLI Flow | The value of the feature depends on an outer agent being able to follow the loop correctly. | What are the exact user-visible beats? How many milestones? What does success/failure look like from outside commands alone? |
| Harness report contract | API Contract | The final report is the artifact that proves the loop worked and teaches future code-review agents. | What fields make evidence auditable? What should be pass/partial/fail? What retrospective feedback is required? |
| Future multi-inside orchestration boundary | Integration Pattern | The outside agent may eventually coordinate many inside agents in parallel, but that is out of scope for this worked example. | What should v1 say about many-inside-agent orchestration? What terminology avoids implying v1 is limited by the runtime model? |
