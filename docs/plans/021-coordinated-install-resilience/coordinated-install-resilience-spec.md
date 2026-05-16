# Coordinated Install Resilience

**Mode**: Simple

## Research Context

ℹ️ No `/plan-1a-explore` was run — but this spec is grounded in a concrete external bug report and a recorded dialogue with the downstream agent that filed it. Key artifacts:

- **Origin issue**: [`AI-Substrate/minih#30`](https://github.com/AI-Substrate/minih/issues/30) — "Companion runs wedge (zombie) after state-schema rejection (0.1.6) — escalation of #27"
- **Cross-agent dialogue** (3 comments on #30, 2026-05-15): minih-side diagnosis → pij-side confirmation of root cause → minih-side scoped fix proposal. Confirmed end-to-end with a one-file workaround applied in `AI-Substrate/pij`.
- **Pre-existing dossier**: [`docs/plans/017-agent-pack-install/fixes/FX003-postmerge-followups.md`](../017-agent-pack-install/fixes/FX003-postmerge-followups.md) — FX003b (filed 2026-05-03, status `Proposed (deferred)`, never landed) already scopes the manifest portion of this work.
- **Adjacent prior**: [`docs/plans/016-a2a-companion-protocol/fixes/FX002-companion-state-transitions.log.md`](../016-a2a-companion-protocol/fixes/FX002-companion-state-transitions.log.md) — same class of bug for `demo-companion`; established the "ship a per-agent schema whose enum matches prompt vocabulary" pattern.

**Root cause** (confirmed against `main` and reproduced downstream): `agents/code-review-companion/agent.json` lists only 4 files. The per-agent `state/inside-state.schema.json` exists in the source tree but is **not in the install manifest**, so `installAgentPack` never copies it to downstream installs. Adopters fall back to minih's default global enum (`idle | in-progress | paused | reviewing | complete | error`), which rejects the prompt's `'reading'` vocabulary at `state_transition` time. The model, mid-`orient → publish state → long-poll` sequence, interprets the resulting `isError: true` as a hard precondition failure for the whole orientation phase and goes silent. minih's runner has no termination signal for "agent has stopped emitting after an MCP error," so the run sits at `status: "active"` until idle-budget reclamation (~30 min) — a zombie.

## Summary

A downstream adopter installing the canonical `code-review-companion` agent gets a broken payload that wedges the inside model on the first `state_transition` call. The problem has three layers — a one-step manifest gap, a defense-in-depth runner gap, and a diagnostic-surface gap — and we fix all three together so future install-time and MCP-error failure modes degrade gracefully instead of silently.

This is a small, well-scoped feature with a known fix dossier for its biggest piece. The remaining pieces close adjacent gaps surfaced during the live dialogue with the downstream agent, so we don't leave the same class of bug latent for the next adopter.

## Goals

- **Unblock every existing and future downstream install of `code-review-companion`** by completing the deferred FX003b manifest fix (ship `state/inside-state.schema.json` and the outside-state schema + outside contract; bump `agent.json` to `0.2.0`; verify `0.1.0 → 0.2.0` upgrade detection reports the new files in `changedFiles[]`).
- **Close the implicit-manifest hole** so coordinated agents without an explicit `agent.json` also pick up their `state/` schemas at install time (current `CANONICAL_AGENT_FILES` list points at the legacy root location, not `state/inside-state.schema.json`).
- **Terminate zombie runs cleanly.** **Any** run (coordinated or non-coordinated) that has been silent for a configurable threshold after a `tool_result` with `isError: true` exits with `terminalReason: 'mcp_error'` instead of sitting at `status: "active"` until idle-budget reclamation. Default-on at 60s; opt-out via `mcpErrorTimeoutMs: null` at prompt frontmatter root.
- **Stop misleading operators.** Rewrite `minih doctor`'s vocabulary-drift warning to reflect actual runtime behaviour (rejected loudly at runtime, wedges the run unless `mcpErrorTimeoutMs` is set); fix the stale "validation is not yet enforced" doc string still living in the bundled `inside-state.schema.json`.
- **Make the dogfood rule enforceable.** Add the minimum CLI diagnostic surfaces the downstream dialogue identified: `minih agent info <slug> --remote` (and the `--local` / `--diff` follow-ups) so operators can see install-delta without `cat`-ing sidecars, and `minih tail --since-tool <name>` (with the `--around-error` wrapper) so operators can find the wedge-relevant turns without `grep`/`jq` on `events.ndjson`.

## Non-Goals

- Investigating why GPT-5.5 (or any specific model) goes silent after an `isError: true` tool result. The hypothesis is "the model interprets the failure as a hard precondition," but the watchdog renders that root cause moot — the harness terminates regardless of model behaviour. We do not attempt a model-side fix.
- Hardening other agents' install manifests beyond `code-review-companion`. `coordination-loop-validator`, `demo-companion`, etc. ship their own correct manifests; if they later break the same way, the implicit-manifest fix and the watchdog catch them, and they get their own FX dossier.
- Auditing or rewriting the inside-state schema validation logic in `src/mcp/tools/state.ts`. That code is correct (loud rejection, isolated mutation). The work is to ship the right schema, not to change how schemas are checked.
- Reshaping the entire `minih agent` verb tree. `info --remote/--local/--diff` is in scope as a single coherent verb; broader UX refactors (`install --dry-run`, `upgrade --interactive`, etc.) are explicit non-goals and stay as deferred follow-ups if they recur.
- Changing the default model, the default permissions, or any other companion-mode contract beyond what's necessary to unbreak `state_transition`.

## Target Domains

| Domain | Status | Relationship | Role in This Feature |
|--------|--------|-------------|---------------------|
| runner | existing | **modify** | Owns agent-pack install (`installAgentPack`, `CANONICAL_AGENT_FILES`), agent data under `agents/`, and run-orchestration / terminal-condition logic. The watchdog is a new runner concept. FX003b's manifest + schema authoring lands here. Frontmatter parsing for the opt-out lives here. |
| cli | existing | **modify** | Owns user-facing surfaces. Doctor warning rewrite, `minih agent info <slug> --remote` (+ `--local` / `--diff`), and `minih tail --since-tool` (+ `--around-error`) all land here. |
| mcp | existing | **consume** | `src/mcp/tools/state.ts` already supports the `state/` schema location with three-level fallback. No mcp-domain changes needed. |
| adapter | existing | **consume** | Tool-result events flow through unchanged. The watchdog observes them via the event pipeline; no adapter changes. |
| measurement | existing | not involved | No measurement contracts affected. |

## Complexity

- **Score**: CS-3 (medium)
- **Breakdown**: S=2, I=0, D=1, N=0, F=1, T=1 (total P=5 → CS-3)
- **Confidence**: 0.75 — high confidence on FX003b (dossier exists, scope nailed) and on doc/copy fixes; medium confidence on the watchdog because the default-on policy flip and the timer-based test shape are the biggest unknowns; medium-low confidence on CLI surfaces because `agent info --remote` requires the fetcher composition root to support a "read manifest without installing" code path that doesn't exist yet.
- **Assumptions**:
  - The schema file `agents/code-review-companion/state/inside-state.schema.json` already exists in the source tree (verified during diagnosis). Authoring effort is the `outside.md` + `outside-state.schema.json` only.
  - `installAgentPack`'s existing per-file checksum upgrade detection (`fileChecksums` in the sidecar) automatically reports the 3 new files as `changedFiles[]` on a `0.1.0 → 0.2.0` re-install. FX003b's task FX003b-6 says this; we verify rather than reimplement.
  - **Phase 3 watchdog applies to all runs** (per Q6 resolution). The behavioural change extends to non-coordinated agents too. `coordination-loop-validator` and any other agent that legitimately exercises `isError` paths need `mcpErrorTimeoutMs: null` or a high value (default 60s is generous for normal use).
- **Dependencies**:
  - **External**: none. No new npm deps. No new SDK calls.
  - **Internal**: FX003b dossier ([`017-agent-pack-install/fixes/FX003-postmerge-followups.md`](../017-agent-pack-install/fixes/FX003-postmerge-followups.md)) is the contract for the Phase 1 deliverable. Plan 017 must remain `Landed`.
  - **Cross-repo**: downstream `AI-Substrate/pij` is waiting on `0.2.0` to drop the workaround; they will verify the upgrade path post-merge.
- **Risks**:
  - **R1 (medium)**: The watchdog's default-on flip could surprise any agent (coordinated or not, per Q6 resolution) that legitimately pauses after an error — most notably `coordination-loop-validator` whose tests assert isError paths. Mitigation: opt-out is a frontmatter knob (`mcpErrorTimeoutMs: null` at root, per Q7); validators get the knob set; regression suite covers both default-on and opt-out paths.
  - **R2 (medium)**: `agent info --remote` requires fetching a remote `agent.json` without installing — a code path adjacent to but distinct from `installFromUrl`. Implementing it cleanly may require a small refactor of the fetcher / extractor seam. If that turns hairy, demoting `--remote` to Phase 4 follow-up (separate PR) is acceptable; Phase 1+2+3 are the unbreak-pij critical path.
  - **R3 (low)**: The `--since-tool` filter in `tail` interacts with the `--follow` mode (default). If the followed stream emits a matching `tool_call` mid-stream, do we replay from there or apply only to historical events? Spec assumes "apply to historical only; live mode keeps current behaviour." Clarify question logged.
  - **R4 (low)**: Doctor copy rewrite must not break the existing `MINIH_REGRESSION=1` doctor/list baseline test. Mitigation: update the baseline alongside the copy change in the same commit.
- **Phases** (suggested):
  - **Single phase (Simple mode)** — ordered work-stream, not separate phase dossiers:
    1. **FX003b — ship 0.2.0** (the unblock gate). Author the missing schemas + `outside.md`; update `agent.json` to 7 files; bump `manifestVersion: '0.2.0'`; verify upgrade path. Land first; downstream pij is waiting.
    2. **Implicit-manifest + doc/copy fixes.** Patch `CANONICAL_AGENT_FILES` to point at `state/`-prefixed schema paths (keep root entry as legacy back-compat); rewrite the doctor warning copy; fix the stale `description` in the bundled `inside-state.schema.json`.
    3. **MCP-error watchdog.** New runner module that observes `tool_result` events and arms a timer when `isError: true` is seen; cancels on any subsequent `tool_call`; fires `terminalReason: 'mcp_error'` and exits the run on expiry. Default 60s; frontmatter opt-out via `coordination.mcpErrorTimeoutMs: null | <ms>`. Tests with `FakeAgentAdapter`.
    4. **Diagnostic CLI surfaces.** `minih agent info <slug> --remote` (preview install manifest without installing); follow-up `--local` (current sidecar contents in machine-readable form); `--diff` (delta between the two). `minih tail --since-tool <name>` (filter snapshot events from most-recent matching `tool_call`); `--around-error [N=10]` thin wrapper finds last `isError` and back-fills context.

## Acceptance Criteria

1. **AC-COMPANION-INSTALL-SHIPS-SCHEMA**: After `minih agent install code-review-companion` against `main`, the installed agent directory contains `inside-state.schema.json` (at agent root) with the enum `[idle, reading, reviewing, reporting, blocked, stopping]` and `outside-state.schema.json` (at agent root) with the outside enum. The sidecar's `fileChecksums` includes both files. **(Note: per FX001, schemas ship at agent root because `state/` is a runtime directory denied by the install manifest validator. The MCP state.ts resolver's 3-level fallback still finds root-level schemas.)**
2. **AC-COMPANION-INSTALL-OUTSIDE-MD**: After install, the directory contains a non-empty `outside.md` that documents the companion-mode protocol from the outside actor's perspective (briefing, task, review-request, control:stop semantics). Quality bar: matches `agents/coordination-loop-validator/outside.md` in shape.
3. **AC-COMPANION-VERSION-BUMP**: `agents/code-review-companion/agent.json` reports `version: '0.2.0'` and `files: [...]` lists 7 entries. `validateManifest()` accepts the manifest.
4. **AC-COMPANION-UPGRADE-DETECTION**: Re-installing the canonical companion on an existing `0.1.0` install reports `action: 'upgraded'` and lists the 3 new files (`outside.md`, `inside-state.schema.json`, `outside-state.schema.json` — all at agent root per FX001) in `changedFiles[]`.
5. **AC-COMPANION-STATE-TRANSITION-OK**: A fresh run of the post-`0.2.0` companion executes `state_transition({ to: 'reading' })` during boot orientation and receives a non-error result; the run proceeds to `inbox_list` / `wait_for_any` without wedging. Verified against `2026-05-15T16-05-38-307Z-3761`'s reproduced trace shape on a fresh install.
6. **AC-IMPLICIT-MANIFEST-SHIPS-STATE-SCHEMAS**: An agent source folder with `prompt.md` + `inside-state.schema.json` + `outside-state.schema.json` (all at agent root) but no explicit `agent.json` installs successfully via `installAgentPack`, and the installed copy contains both schema files at root. Verified end-to-end against a fixture in `test/runner/agent-pack/install.test.ts`. **(Per FX001: `CANONICAL_AGENT_FILES` in `src/runner/agent-pack/manifest.ts:33-37` already lists root-level schema paths; the implicit-manifest gap is in test-fixture coverage, not in the canonical list.)**
7. **AC-WATCHDOG-DEFAULT-ON**: A run (coordinated or non-coordinated) whose session emits a `tool_result` with `isError: true` from any tool (MCP, bash, write, custom) and then emits no subsequent `tool_call` event for ≥60 seconds (default) terminates with `terminalReason: 'mcp_error'`, `run.json` `status: 'failed'`, and a non-zero exit code. Verified against a `FakeAgentAdapter` scenario for both a coordinated agent and a non-coordinated agent.
8. **AC-WATCHDOG-CANCELED-BY-RECOVERY**: A run whose session emits `tool_result {isError: true}` followed within the threshold by any new `tool_call` does **not** terminate via the watchdog. The threshold timer disarms on each new `tool_call`.
9. **AC-WATCHDOG-OPT-OUT**: An agent whose `prompt.md` frontmatter declares `mcpErrorTimeoutMs: null` (at the root, alongside `model`/`timeout`/`reasoning`) is exempt from the watchdog: no termination occurs regardless of post-`isError` silence duration. Verified against a fixture agent.
10. **AC-WATCHDOG-CONFIGURABLE**: An agent whose frontmatter declares `mcpErrorTimeoutMs: 5000` terminates after 5 seconds of post-`isError` silence (not 60). Used by the regression test suite to keep timer-driven tests fast.
11. **AC-DOCTOR-COPY-ACCURATE**: `minih doctor` on a coordination-enabled agent whose `prompt.md` references a state value outside the per-agent schema enum emits a warning whose body text (a) does NOT contain the phrase "silently rejected," (b) DOES name the runtime behaviour ("rejected at MCP `state_transition`"), and (c) references the `mcpErrorTimeoutMs` knob (at frontmatter root) as the safety net. `MINIH_REGRESSION=1` doctor baseline updated to match.
12. **AC-SCHEMA-DESCRIPTION-ACCURATE**: The bundled `agents/code-review-companion/inside-state.schema.json`'s `properties.status.description` field accurately reflects that runtime validation IS enforced (the stale "not yet enforced" text is removed). **(File location updated per FX001 from `state/inside-state.schema.json` to root.)**
13. **AC-AGENT-INFO-REMOTE**: `minih agent info code-review-companion --remote` prints a JSON envelope on stdout containing the remote-side manifest (`name`, `version`, `files[]` with paths + descriptions) without installing or modifying any local state. Output is reproducible across runs (modulo `commitSha`/`fetchedAt` fields).
14. **AC-AGENT-INFO-DIFF** *(if --diff lands in P4)*: `minih agent info code-review-companion --diff` against a local `0.1.0` install reports the same 3 added files as AC-COMPANION-UPGRADE-DETECTION, plus any `commitSha` delta. Symmetric with `installAgentPack`'s `changedFiles[]` output.
15. **AC-TAIL-SINCE-TOOL**: `minih tail <slug> --run <runId> --snapshot --since-tool state_transition --lines 200` returns the snapshot window starting from the most-recent `tool_call` whose `toolName` matches `state_transition` (or its MCP-namespaced form, e.g. `minih-coordination-state_transition`). Earlier events are excluded; later events through the end of the snapshot window are included.
16. **AC-TAIL-AROUND-ERROR**: `minih tail <slug> --run <runId> --snapshot --around-error` finds the most-recent `tool_result` with `isError: true` and returns ±10 events around it. If no `isError` event exists, exits with a clear error envelope (`E_NO_ERROR_EVENTS` or similar) and a non-zero exit code; does not return a generic empty snapshot.
17. **AC-DOGFOOD-RULE-ENFORCEABLE**: All four diagnostic operations the downstream pij agent reported needing during the issue #30 investigation (manifest drift inspection; rejected tool-call input retrieval; surrounding-events context for an isError; install delta preview) are achievable via `minih`-prefixed commands without falling back to `cat`/`grep`/`jq` on run-dir files. Captured as a documented checklist in `AGENTS.md` or a successor file.

## Risks & Assumptions

**Risks** are enumerated in § Complexity (R1–R4). Summary: the watchdog default-on flip is the riskiest behavioural change; `agent info --remote` may force a small fetcher refactor; `--since-tool` interaction with `--follow` needs a clarify call; doctor copy rewrite touches the regression baseline.

**Assumptions** beyond § Complexity:
- The downstream pij agent will re-validate end-to-end on a fresh install once `0.2.0` is published. We treat their workaround as a confirmed fix-proof; the PR's only obligation is to reproduce the same `state_transition → "reading"` clean trace they captured (`2026-05-15T16-05-38-307Z-3761`).
- The watchdog's "60s default" is informed by the downstream agent's recommendation ("ship default-on at 60s for the first release, drop to 30s in a follow-up if safe"). We adopt it verbatim; if the regression suite or real-world adoption shows 60s is too aggressive, the knob exists.
- `minih tail --snapshot`'s rendering and event-line shape are stable enough to filter on `tool_call.data.toolName` without further normalization. Confirmed during dialogue: the compact `🔧 minih-coordination-state_transition {...}` rendering exposes the needed fields.
- `minih agent install`'s manifest-version field (`agent.json#version`) is the canonical bump signal for upgrade detection in operator-facing tooling; the **per-file checksum** path is the authoritative upgrade-action signal in `installAgentPack`. Both can be true simultaneously.

## Clarifications

### Session 2026-05-15

- **Q1 — Workflow Mode**: **Simple**. User chose to keep the plan single-phase. The 4 phases sketched in § Complexity collapse into one ordered work-stream (FX003b first as the unblock gate, then implicit-manifest + doc/copy, then watchdog, then CLI diagnostics). Testing defaults to **Lightweight** per Simple-mode convention; `plan-4`/`plan-5` are optional.
- **Q2 — Mock Usage**: **Targeted**. Watchdog tests use `FakeAgentAdapter` (existing runner convention); install/CLI tests use real fs + fixture dirs. No mocking of internal modules; SDK is the only external system that gets a fake. Matches existing test style in `test/runner/` and `test/cli/`.
- **Q3 — Documentation Strategy**: **Hybrid**. Add `docs/how/companion-install-resilience.md` covering the watchdog (knob, default, opt-out) + `agent info --remote` + `tail --since-tool / --around-error`. Cross-link from `AGENTS.md` § Companion mode and from `docs/how/companion-mode.md`. Matches the existing `docs/how/` pattern (`agent-pack.md`, `companion-mode.md`).
- **Q4 — Domain Review**: **Confirmed as drafted**. runner (modify) + cli (modify) + mcp/adapter (consume) + measurement (not involved). No new domains, no boundary shifts. Watchdog stays in `runner/` proper (not a new sub-module) until file count justifies one — the spec’s sketch is one new file plus extensions to existing run-orchestration code.
- **Q5 — Rollout shape**: **One PR, all 4 workstreams**. Single coherent landing with one changelog entry. Trade-off accepted: higher review burden, but one PR makes the `0.2.0` story atomic (manifest fix + safety net + diagnostics ship together). If CI catches a watchdog-specific issue, we revert that workstream’s commits before merge rather than ship a partial release.
- **Q6 — Watchdog scope**: **All runs (coordinated + non-coordinated)**. Wider safety net. Every agent benefits from clean termination after an MCP error, not just coordinated ones. Frontmatter opt-out lives at the root (Q7), not under `coordination`, because the knob applies regardless of coordination mode. **Scope expansion vs original spec** — update Goals/ACs/Non-Goals to drop the coordinated-only qualifier; spec Q5 now resolved (no longer open).
- **Q7 — Watchdog frontmatter knob**: **Flat `mcpErrorTimeoutMs` at frontmatter root**. Matches existing minih convention (sits alongside `model`, `timeout`, `reasoning`, `coordination`). `null` disables; integer is timeout in ms; absent defaults to 60000 (60s). **Reverses pij agent’s assumed nested form** — the consistency win matters more than the conceptual grouping. Spec Q2 now resolved (no longer open).

## Documentation Strategy

- **Location**: Hybrid — new `docs/how/companion-install-resilience.md` + targeted edits in `AGENTS.md` (§ Companion mode reminder block) and `docs/how/companion-mode.md` (link to the new page from the troubleshooting section).
- **Rationale**: The new frontmatter knob (`coordination.mcpErrorTimeoutMs`) and the four new CLI flags need a discoverable home; `--help` text alone won't make the dogfood rule enforceable. The pij agent explicitly called this out: "with `--since-tool` in place, the rule 'no `grep`/`jq` on `events.ndjson`' becomes actually-enforceable." Hybrid keeps the deep content in one `docs/how/` page (single source of truth) while ensuring discoverability from the agent-facing AGENTS.md.
- **Out of scope**: Per-surface pages (`mcp-error-watchdog.md`, `agent-info-remote.md`, `tail-filters.md`) — over-structured for the surface area; one consolidated page is easier to keep current.

## Testing Strategy

- **Approach**: Lightweight (Simple-mode default).
- **Rationale**: Most workstreams are well-scoped contract changes (manifest, doc copy, frontmatter flag) where unit + integration coverage suffices. The watchdog is the one piece that warrants tighter coverage (timer behaviour + terminal-reason wiring), and even there `FakeAgentAdapter` keeps tests fast.
- **Focus Areas**:
  - Manifest upgrade detection (`0.1.0 → 0.2.0` reports correct `changedFiles[]`) — integration test against built CLI
  - Watchdog state machine (arm-on-isError, disarm-on-tool-call, fire-on-timer, opt-out via frontmatter) — unit with fake adapter + configurable threshold per AC-WATCHDOG-CONFIGURABLE
  - `agent info --remote` round-trip via `MINIH_AGENT_PACK_FETCHER=fake:...` env seam (no real network)
  - Doctor warning copy regression via `MINIH_REGRESSION=1` baseline update
- **Excluded**: Real-network fetching, real GPT-5.5 model behaviour, cross-OS file-watcher edge cases (out of scope per Non-Goals).
- **Mock Usage**: Targeted — `FakeAgentAdapter` for the SDK seam, real fs + fixture dirs everywhere else.

## Open Questions

*(Q2 ‘frontmatter shape’ and Q5 ‘watchdog scope’ resolved in clarify Session 2026-05-15; renumbered.)*

1. **Q1 (watchdog interaction with `coordination-loop-validator` and other validator-class agents)**: The validator's tests deliberately exercise `isError: true` paths to confirm rejection behaviour. Does the validator need `mcpErrorTimeoutMs: null` set, a high value, or does the test harness short-circuit the watchdog? Now broader scope (per Q6): any agent test that asserts post-`isError` silence is affected. [NEEDS CLARIFICATION at `/plan-3-v2-architect` time: walk `agents/coordination-loop-validator/prompt.md` + all `test/runner/permissions/` tests that assert isError behaviour.]
2. **Q2 (`agent info --remote` source resolution)**: `code-review-companion` is a **registry slug**. `--remote` against a slug resolves via the bundled `agents-registry.json` → URL form. Do we surface the resolved `(owner, repo, ref, subpath)` in the output, or hide it as an implementation detail? [NEEDS CLARIFICATION: leans toward surface, for transparency.]
3. **Q3 (`tail --since-tool` and `--follow`)**: When `--follow` is on (default), does `--since-tool` apply (a) only to the historical replay and live events flow unchanged, (b) suppresses live events that don't match a `tool_call` window, or (c) only valid with `--snapshot`? R3 in § Complexity flags this; spec assumes (c) for the first release. [NEEDS CLARIFICATION]
4. **Q4 (`outside.md` authoring source)**: The FX003b dossier says "reference `docs/how/companion-mode.md` and `agents/coordination-loop-validator/outside.md`." Both exist; the question is whether to lift companion-mode-specific protocol verbatim from `companion-mode.md`, or write fresh prose with citations. Leaning fresh prose to avoid doc duplication. [NEEDS CLARIFICATION]

## Workshop Opportunities

| Topic | Type | Why Workshop | Key Questions |
|-------|------|--------------|---------------|
| MCP-error watchdog event-loop integration | State Machine | The watchdog is a new runner-level state machine (arm-on-isError, disarm-on-tool-call, fire-on-timer) that must interleave cleanly with the existing terminal-condition logic (idle-budget, peer-verdict, explicit `control:stop`). Getting the precedence order wrong risks watchdog firing during a legitimate idle-budget shutdown, or vice-versa. | What's the precedence ladder among `mcp_error` / `idle_budget` / `control:stop` / `peer-verdict-dead` terminal reasons? Where does watchdog state live (per-run in-memory, or persisted)? How does it survive a `minih resume`? Does `compact()` reset it? |
| `minih agent info` verb shape | CLI Flow | Adding `--remote`, `--local`, `--diff` to one verb opens design questions about flag composition (do `--remote --diff` and `--local --diff` both work?), output envelope shape (3 nested fields? 3 separate command shapes?), and the registry-slug vs URL-form resolution UX. Worth getting right before shipping `--remote` and having to retrofit `--diff` later. | What's the minimum viable shape for v1 (`--remote` only, or `--remote --local --diff` all at once)? When `agent info <slug>` runs without flags, what's the default? Does `--diff` imply `--remote`? How does this compose with `MINIH_AGENT_PACK_FETCHER=fake:...` env-injection? |
| `minih tail` filtering vocabulary | CLI Flow | `--since-tool` is the primitive; `--around-error` is the wrapper. But there's a longer tail of likely follow-ups (`--since-event <type>`, `--message-only`, `--tool-only`, `--only-coordination`) that share the same matcher engine. Worth sketching the matcher contract once so we don't reimplement it three times. | Is the matcher a single string-equality on `toolName`, or fnmatch-style? Does it match against the namespaced form (`minih-coordination-state_transition`) or the bare tool name? What's the precedence between multiple filter flags? Does `--around-error` accept a tool-name filter (find last `isError` from `state_transition` specifically)? |

---

📚 This specification incorporates findings from the live dialogue on [`AI-Substrate/minih#30`](https://github.com/AI-Substrate/minih/issues/30) (3 comments, 2026-05-15) and the pre-existing FX003b dossier in plan 017.

ℹ️ Consider running `/plan-1a-explore` if the watchdog's runner-loop integration (Q1, Workshop 1) needs deeper code mapping before architecture.

## Next Steps

- **Workshop Opportunities identified** (3) → consider running `/plan-2c-workshop` on the watchdog state machine first; it's the riskiest design decision and the workshop output gates Phase 3 architecture.
- **Then** `/plan-2-v2-clarify` for the 7 open questions (most are bounded design picks; Q7 — rollout shape — is the highest-leverage one).
- **Then** `/plan-3-architect` for per-phase task breakdown.
