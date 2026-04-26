# Outside/Inside Coordination — Inbox, State, and MCP Inside Channel

📚 This specification incorporates findings from `research-dossier.md` (80 findings across 8 subagents) and 5 external-research files: `sdk-session-ttl.md`, `file-watching-daemon-patterns.md`, `state-machine-jsonschema.md`, `agent-harness-survey.md`, `mcp-leak-validation.md`.

> **Plan-folder name vs feature**: this folder is `007-backgrounding` because the user opened the branch in anticipation of a future backgrounding/eventing capability (file-changed events drive an inside agent). This spec covers the **prerequisite** coordination primitives that the backgrounding capability will require — it does NOT add backgrounding itself. The backgrounding plan will be a follow-up (likely `008-eventing` or similar).

## Research Context

**The shape of the problem (from research):**

- minih today is synchronous one-shot: each `minih run <slug>` spins up a Copilot SDK session, runs the agent to completion, and exits. Runs are independent; nothing communicates between them.
- Two callers exist for minih commands today: humans/host tools (Claude Code, CI) at the shell ("outside"), and agents executing inside an SDK session ("inside"). The split is implicit — `check`/`validate` accidentally support both via env-var fallback (`MINIH_AGENT_SLUG`); other commands are unsafe inside a session (`run`/`resume` would nest sessions; `tail` needs a TTY).
- Sessions persist on disk at `~/.copilot/session-state/<uuid>/` regardless of `disconnect()` vs `destroy()` (SDK source confirms both delegate to the same RPC). The 30-min idle timer cleans up *in-memory* state only; on-disk state survives until explicit `client.deleteSession(id)`. `client.listSessions(filter)` is the canonical liveness probe.
- Plan 005 already shipped MCP **consumption** (`--mcp-config` / auto-discovery → `mcpServers` in SDK session config). minih has *zero* MCP-server code today.
- The earlier "minih AS an MCP server" idea (`minih serve --mcp` exposing the full external CLI surface) was deferred post-V1 in `001-setup/workshops/002-cli-command-design.md`; this spec does NOT revive that. It introduces a *narrower* internal MCP server scoped to inside-only tools.

**Architectural decision already made (recorded in conversation memory and `research-dossier.md` Key Insight 1):** the inside surface will be a small per-run minih-spawned MCP server, with per-session context (runId, runDir, agentSlug, side, inboxPath, statePath) baked into the MCP server's spawn config — agents call tools by name only, never seeing IDs or paths. This mirrors today's `MINIH_*` env-var hidden-context pattern but moves from "env vars + shellout" to "MCP tool calls."

**Empirical validation (from `mcp-leak-validation.md`):** GitHub Issue #1132 (MCP server processes leaking on session disconnect) does NOT reproduce in our usage. minih's existing `client.stop()`-in-finally pattern triggers `cliProcess.kill()` cascade in the SDK, which reaps the bundled CLI subtree and its child MCP servers within ~5s. We can spawn an inside-channel MCP server per run without a custom reaper, provided we keep the `client.stop()` invariant.

**Validated against precedent (from `agent-harness-survey.md`):** Claude Code uses the same MCP-based inside-tool exposure pattern. AutoGen validates filesystem-backed message logs. LangGraph validates state-as-coordination with checkpointed state. Git's `GIT_*` hook env vars validate hidden-context pattern. No surveyed harness combines all four dimensions; we're early in a real space, not chasing established convention.

## Summary

minih currently lacks any way for outside callers (Claude Code, CI, humans) and inside agents (running in a session) to **coordinate progress** during a multi-step task. The only communication channels are: the agent's final `report.json`, the run-folder filesystem snapshot, and stdin/stdout streaming during a single run. There is no inbox, no shared state, no signal that one side has finished its part of a longer cooperative task.

This spec adds three coordination primitives, all designed so that a future eventing/daemon plan can drive them:

1. **Outside/inside command split** — formalize who can call what. The same `minih` binary is both surfaces, but each context exposes a different set of operations. Outside = commander subcommands; inside = MCP tools the agent invokes by name.
2. **Notes/inbox messaging** — filesystem-backed per-agent inbox (NDJSON, append-only, two lanes for the two senders). Outside writes notes to inside; inside writes notes to outside. Each side can list, read, and acknowledge messages from its peer.
3. **First-class outside-state and inside-state with schemas** — two JSON state files per agent (`outside.json`, `inside.json`), each with a `phase` enum + free-form `data`. State transitions are gated by rules, including cross-side invariants (e.g., inside cannot transition to `complete` until outside has signaled `done`).

**Why now**: the user wants to build a code-review agent that runs in the background and reviews source files as they are edited (the eventing/daemon plan). That requires the host to signal "I just finished phase 2" and the agent to signal "I just finished reviewing phase 2" — neither is possible without these primitives. Building the primitives first lets us ship them, validate them with simple synchronous flows, then add the daemon layer cleanly on top.

## Goals

- **Make outside/inside contexts a first-class concept**: any future minih command can declare which contexts it serves; the binary auto-detects and refuses to run a command in the wrong context (with a clear error pointing the caller at the right one).
- **Give outside callers a way to send notes to a running or future agent run**, with the message visible to the inside agent at its next inbox check.
- **Give inside agents a way to send notes to outside**, visible to the human or CI step that started (or is monitoring) the run.
- **Establish per-agent state as a versioned, append-only history** that survives across runs and is inspectable from both sides.
- **Encode the user's "inside completes only after outside signals done" rule** as a first-class transition gate — declarative, testable, with clear error messages when an attempted transition is rejected.
- **Preserve every existing minih invariant**: stdout = JSON envelope; stderr = pretty/human; agents that don't use the new primitives keep working unchanged; system output (summary + retrospective + magicWand) still mandatory; run folder + frozen inputs still preserved per-run.
- **Set up the architecture so the future eventing/daemon plan can be additive** — no rework of inbox/state/MCP layout when the daemon arrives.

## Non-Goals

- **NO file watcher.** Native `node:fs.watch` selection (validated against chainglass FD-exhaustion experience) is documented for the future plan; this spec does not add it.
- **NO long-running daemon mode.** No `minih daemon start/stop/status`, no pidfiles, no Unix-socket IPC, no supervisor. This spec keeps the synchronous one-shot execution model; daemon is the next plan.
- **NO `minih serve --mcp` (full external MCP surface).** Per `001-setup/workshops/002-cli-command-design.md` Q5, that remains post-V1. This spec adds *only* an internal MCP server scoped to inside-only tools; the external surface stays as commander subcommands.
- **NO migration of legacy dual-use shellout commands** (`check`, `validate`, `doctor`, `status`, `inspect`, `last-run`, `history`, `difficulties`) to MCP. They keep their current `npx minih …` shellout pattern; agents that already call them are unaffected.
- **NO multi-party messaging beyond outside↔inside.** Two lanes only. Multi-agent meshes / pub-sub fan-out are not in scope.
- **NO server-push of inbox notifications during a single agent turn.** MCP notifications would enable this for the future eventing plan; for the prerequisite work, agents poll their inbox at instruction-driven intervals (preamble + system-output instruction).
- **NO automatic state cleanup or retention policy.** State and inbox files grow over an agent's lifetime; pruning is a follow-up concern.
- **NO MCP server registration of any tool that performs writes outside the run folder, or that can spawn nested minih runs.** The inside-channel MCP server is intentionally narrow: inbox + state + nothing else.
- **NO change to the SDK or the `@github/copilot-sdk` peer dep**. We work within its existing `mcpServers` plumbing.

## Target Domains

| Domain | Status | Relationship | Role in This Feature |
|--------|--------|--------------|----------------------|
| `cli` | existing | **modify** | Add outside-side commands (`outside-send`, `outside-inbox-list`, `state get/set/transition`); add context-detection helper + per-command context metadata; install preAction hook that refuses inside-unsafe commands when invoked inside a session; thread inside-MCP spawn config into the run pipeline. |
| `runner` | existing | **modify** | Add `state.ts` (transition rules + types), `context.ts` (context detection + `MINIH_*` env-var contract); extend `folder.ts` with helpers for inbox/state paths; ship default JSON schemas for outside-state, inside-state, inbox-message; extend SYSTEM_OUTPUT_INSTRUCTIONS with inbox/state guidance; extend preamble template. |
| `adapter` | existing | **modify** | Minimal: thread an additional `mcpServers` entry for the inside-channel MCP server alongside any user-configured MCP servers (preserve user's right to `--mcp-config` plus auto-discovery). No interface changes. |
| `mcp` | **NEW** | **create** | Per-run inside-only MCP server module. Spawned by `sdk-runtime` before `createSession`, terminated by the existing `client.stop()` cascade. Exposes `inbox.*` and `state.*` tools whose per-run context (runId, runDir, agentSlug, side, paths) is baked into the spawn config — agents invoke tools by name only. |

### New Domain Sketches

#### mcp [NEW]

- **Purpose**: Provide the inside-channel surface. Spawn and manage a small stdio MCP server that exposes inbox/state tools to the agent currently running in the SDK session, with all per-session context baked into the MCP server's startup args/env so the agent never needs to pass IDs or paths.
- **Boundary Owns**: MCP server process lifecycle (spawn, register into `mcpServers` config, rely on `client.stop()` cascade for cleanup); MCP tool definitions and JSON-schema input/output validation for `inbox.list`, `inbox.send`, `inbox.ack`, `state.get`, `state.set`, `state.transition`; the wire format between minih and the spawned MCP child (process args, environment); the regression test that confirms zero process leak.
- **Boundary Excludes**: filesystem layout of inbox/state files (owned by `runner` — `folder.ts` + schemas); transition rules (owned by `runner` — `state.ts`; the MCP tool calls into runner); CLI subcommand registration (owned by `cli`); SDK session creation (owned by `adapter` via the existing `IAgentAdapter` contract). Not a daemon — only lives for the duration of one `minih run`.
- **Dependency direction**: `mcp` depends on `runner` (uses `state.ts` rules, `folder.ts` paths, schemas) and on a third-party MCP server library (likely `@modelcontextprotocol/sdk` for TypeScript — to be confirmed in the workshop). `mcp` is depended on by `cli` (composition root, in the same place that already calls `sdk-runtime`). No circular dependencies; preserves the strict downward-only import direction `cli → mcp → runner` (sibling to `cli → runner → adapter`).

## Complexity

**Score**: CS-4 (large)
**Breakdown**: S=2, I=1, D=2, N=1, F=1, T=2 (total = 9)
**Confidence**: 0.80

| Axis | Value | Why |
|------|-------|-----|
| Surface Area (S) | 2 | All 3 existing domains modified; 1 new domain created; new files in cli/, runner/, adapter/ + entire new `src/mcp/` tree; new schemas; preamble + SYSTEM_OUTPUT_INSTRUCTIONS edits; new tests. |
| Integration (I) | 1 | One new external dep (an MCP server library, likely `@modelcontextprotocol/sdk`). No new external services. |
| Data/State (D) | 2 | New filesystem conventions (`agents/<slug>/inbox/`, `agents/<slug>/state/`); 3+ new JSON schemas; extended `MINIH_*` env-var contract; per-agent shared mutable state — first time minih has cross-run-mutable state. |
| Novelty (N) | 1 | Architecture is well-researched and decided; some implementation novelty in the spawn-config-injects-context pattern; a few open questions remain (ack semantics, retention, history granularity). |
| Non-Functional (F) | 1 | Standard perf; no security/compliance escalation; the MCP-leak regression test adds a non-trivial requirement. |
| Testing/Rollout (T) | 2 | New test patterns: two-agent coordination scenarios; MCP server testing (spawn + tool invocation + cleanup); cross-run state persistence tests; schema-validated state file tests. |

**Assumptions**:

- We can use `@modelcontextprotocol/sdk` (or equivalent) to host a stdio MCP server within minih. To be confirmed in workshop on MCP tool/library choice.
- The SDK's `mcpServers` config supports stdio MCP server entries that minih spawns ourselves (already shown in Plan 005 — confirmed).
- Agents will reliably call `inbox.list` periodically when the prompt instructs them to. (LangGraph/AutoGen precedent confirms this works *if* the prompt is explicit and the tool surface is rich enough — e.g., includes "did anything new arrive since I last checked".)
- The MCP-leak validation result generalizes from sequential one-shot runs to runs with one extra MCP server entry; if it doesn't, we have the cleanup mechanism documented.

**Dependencies**:

- `@modelcontextprotocol/sdk` (TypeScript) — to be added; assumed reasonable dep weight (validate during workshop).
- `@github/copilot-sdk` (existing peer dep) — no version bump required; relies on Plan 005's `mcpServers` threading.

**Risks**:

- **MCP cleanup regression**: if our spawn pattern accidentally bypasses `client.stop()` cleanup, every run leaks one MCP server process. Mitigation: AC-MCP-CLEAN regression test; explicit `finally` cleanup audit.
- **Two-agent test ergonomics**: testing inbox round-trip requires either two real SDK sessions or a clever fake adapter setup. May need a new test fixture (research-dossier QT-06 calls this out as a gap in current test infrastructure).
- **Frontmatter/preamble regression**: SYSTEM_OUTPUT_INSTRUCTIONS additions could change agent behavior. Mitigation: every existing agent re-validated; opt-in markers if instructions become too long.
- **State/inbox file conflicts under concurrent access**: if two `minih` invocations target the same agent simultaneously, append-only NDJSON is safe, but state.json writes need an atomic write pattern. Mitigation: write-then-rename; document.
- **Agent prompts that ignore the inbox**: even with explicit instructions, agents may forget to check. Mitigation: include inbox-check guidance in SYSTEM_OUTPUT_INSTRUCTIONS as a pre-completion checklist item.

**Phases**:

1. **Foundations** — schemas, runner state.ts + context.ts, folder.ts extensions, run-folder layout. No CLI/MCP yet. Pure refactor + addition; backward compatible with no behavior change.
2. **Outside surface** — commander subcommands (`outside-send`, `outside-inbox-list`, `state get/set/transition`); preAction context-blocking hook on existing inside-unsafe commands. Tests for outside flows (no inside, no MCP).
3. **`mcp` domain** — pick MCP library; build the spawn-and-bake-context module; add inside-channel MCP server entry to the SDK session's `mcpServers`; verify cleanup. Tests for MCP tool call round-trip.
4. **Agent integration** — preamble + SYSTEM_OUTPUT_INSTRUCTIONS additions; new `_shared/inside-mcp-tools.md` reference for agents; smoke-test agent that exercises every inbox/state tool. Adjust existing agents only if regressions surface.
5. **Polish & docs** — update `AGENTS.md`, `AGENTS_README.md`, `README.md`, `CONTRIBUTING.md`; new domain.md for `mcp`; update domain-map.md and registry.md.

## Acceptance Criteria

1. **AC-CTX-DETECT**: A new `detectContext()` helper returns `'inside'` when invoked while `MINIH=1` is set in the environment, and `'outside'` otherwise. Documented and exported from the `runner` domain.
2. **AC-CTX-BLOCK**: When `minih run <slug>`, `minih resume <slug>`, `minih quickstart`, `minih init`, or `minih tail` is invoked from inside a minih session (i.e., `MINIH=1` is set), the command exits with a non-zero status and a `MinihEnvelope` carrying error code `E12X INVALID_CONTEXT`, a clear message naming the wrong context, and (where helpful) a suggested alternative tool/command.
3. **AC-OUTSIDE-SEND**: `minih outside-send <slug> --type <type> --subject "..." --body "..."` appends a message to `agents/<slug>/inbox/outside/messages.ndjson` matching the InboxMessage schema. Returns a `MinihEnvelope` containing the message id, target side, and timestamp. Schema validation rejects malformed input with a clear error.
4. **AC-OUTSIDE-LIST**: `minih outside-inbox-list <slug> [--unread] [--type <type>]` returns a `MinihEnvelope` whose `data` lists the messages currently in `agents/<slug>/inbox/inside/messages.ndjson` (i.e., what the inside agent has sent back), filtered as requested.
5. **AC-INSIDE-LIST**: When an agent runs and uses the inside-MCP `inbox.list` tool, it receives a typed list of messages from `agents/<slug>/inbox/outside/messages.ndjson` (i.e., what outside has written for it), with optional `unread` and `type` filters. The tool call requires no IDs or paths from the agent — context is supplied by the spawned MCP server's baked-in config.
6. **AC-INSIDE-SEND**: When an agent uses the inside-MCP `inbox.send` tool, the message is appended to `agents/<slug>/inbox/inside/messages.ndjson` and is visible to the next `minih outside-inbox-list <slug>` invocation. Schema validation enforces required fields.
7. **AC-INSIDE-ACK**: When an agent uses `inbox.ack({ msgId })`, the corresponding message in the outside lane is marked acknowledged. Subsequent `inbox.list({ unread: true })` calls do not return that message.
8. **AC-STATE-OUTSIDE-WRITE**: `minih state set <slug> --side outside --key phase --value done` updates `agents/<slug>/state/outside.json` (atomic write), appends a transition record to `agents/<slug>/state/history.ndjson`, and validates the new state against the outside-state schema.
9. **AC-STATE-INSIDE-READ**: When an agent uses the inside-MCP `state.get` tool with no arguments, it receives both its own state (inside.json) and the peer's state (outside.json). With `key`, it receives a single field.
10. **AC-STATE-TRANSITION-GATED**: When an agent uses `state.transition({ to: 'complete' })` while `outside.json.phase != 'done'`, the call returns a typed MCP tool error containing the proposed transition, the rule that rejected it, and the current peer state. The state file is NOT mutated.
11. **AC-STATE-TRANSITION-OK**: When `outside.json.phase == 'done'` and the agent calls `state.transition({ to: 'complete' })`, the call succeeds, `inside.json.phase` becomes `'complete'`, and a transition record is appended to `state/history.ndjson`.
12. **AC-MCP-CLEAN**: After every `minih run` completes (success, failure, timeout, or SIGINT), the spawned inside-channel MCP server process is reaped within 5 seconds. A regression test asserts this with `pgrep -f` against a process marker unique to the inside-channel MCP server.
13. **AC-MCP-COEXIST**: When the user supplies their own `--mcp-config <path>` (per Plan 005), the user's MCP servers AND the inside-channel MCP server are both available to the agent in the same session. Neither shadows the other; tool name collisions surface as clear errors at MCP server startup, not silently.
14. **AC-BACKWARD-COMPAT**: An agent that does not invoke any inbox/state tools, and a host caller that does not invoke any new outside subcommands, see no behavioral change vs the prior minih release. All existing agents in `agents/` continue to pass `minih check` and `minih doctor`.
15. **AC-RUN-FOLDER**: At run completion, the run folder includes a frozen `state-snapshot.json` and `inbox-snapshot/{outside,inside}.ndjson` capturing the per-agent shared files at the moment of completion. The shared files at `agents/<slug>/{state,inbox}/` are NOT moved or copied into the run folder beyond the snapshot.
16. **AC-ENV-VARS**: The new `MINIH_INBOX_DIR`, `MINIH_STATE_DIR`, and `MINIH_CONTEXT` env vars are set during agent execution and documented in the preamble. All previously documented `MINIH_*` env vars are unchanged.
17. **AC-DOMAIN-MAP**: `docs/domains/registry.md` and `docs/domains/domain-map.md` are updated to include the `mcp` domain. A new `docs/domains/mcp/domain.md` exists and lists boundary, composition, contracts, concepts, history.

## Risks & Assumptions

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| MCP library choice mismatches our needs (dep weight, API ergonomics, maintenance) | M | M | Workshop on MCP tool/lib choice; back-out plan = host MCP server in a tiny in-tree module if no library fits. |
| Inside-MCP cleanup regresses if a new code path bypasses `client.stop()` | L | H | AC-MCP-CLEAN regression test; explicit checklist item in PR review. |
| Two-agent test ergonomics block development | M | M | Workshop on test fixtures; consider extending `FakeAgentAdapter` to model MCP tool round-trip with shared state. |
| Concurrent `minih` invocations against same agent corrupt state.json | L | M | Atomic write (temp file + rename); document; future: file lock if needed. |
| Agents reliably ignore inbox-check instructions in the prompt | M | M | Make inbox-check a pre-completion checklist item; surface "did the agent check inbox" in `completed.json`; difficulty-ledger feedback loop. |
| State files grow unbounded without retention | L | L | Out of scope; add later if it bites. |
| User-supplied MCP server tool names collide with `inbox.*`/`state.*` | L | L | AC-MCP-COEXIST asserts clear error at startup. |
| `MINIH_OUTPUT_PATH` env-var bug surfaced in cycle-3 test (`difficulties: MH-004`) | L | L | File separately; not in scope here, but should be acknowledged in spec polish phase. |

**Assumptions**:

- The `@modelcontextprotocol/sdk` (or chosen MCP library) supports JSON-Schema-validated input parameters and structured output, both of which we want for tool-call safety.
- The SDK's `mcpServers` config accepts entries with `command`, `args`, and `env` we control, allowing us to pass per-run baked context cleanly.
- `client.stop()` continues to cascade-kill child MCP server processes in the SDK version we target. Validated empirically (`mcp-leak-validation.md`); to be re-validated when we bump the SDK peer dep.
- Agents will follow explicit `inbox.list` instructions in the prompt at meaningful checkpoints. Workshop will confirm prompt language.
- Per-agent shared inbox/state under `agents/<slug>/{inbox,state}/` does NOT break the "an agent IS a folder" / frozen-inputs philosophy because shared files are documented as mutable peer-coordination artifacts, distinct from the per-run frozen snapshot.

## Open Questions

> Marked with `[NEEDS CLARIFICATION: ...]` for the next clarify pass.

- [NEEDS CLARIFICATION: Inbox retention. Do messages live forever in `agents/<slug>/inbox/{outside,inside}/messages.ndjson`? Should there be a per-message TTL, a max-message-count, or pruning when the agent run completes? Today's leaning: keep forever; pruning is a follow-up.]
- [NEEDS CLARIFICATION: Acknowledgement semantics. Does `inbox.ack({ msgId })` mutate the original NDJSON line in-place, append an "ack" record, or both? In-place mutation breaks the append-only invariant; appending an ack record means readers must reconstruct unread/read state on every list. Prefer the latter for safety; confirm.]
- [NEEDS CLARIFICATION: State machine — initial set of phases. The user gave one example (`done`/`complete`). What's the canonical default? Suggested: `idle | in-progress | paused | done` for outside; `idle | in-progress | reviewing | complete` for inside. Are these per-agent overridable via frontmatter, or fixed?]
- [NEEDS CLARIFICATION: Frontmatter additions. Should agents declare in their `prompt.md` frontmatter whether they participate in inbox/state (`coordination: enabled`)? Or does presence of `inbox.*`/`state.*` tool calls in the agent's prompt suffice?]
- [NEEDS CLARIFICATION: Initial state behavior. When an agent runs for the first time (no `state/{outside,inside}.json` exists), do we auto-create with `phase: "idle"`, or require explicit initialization via `minih state init <slug>`?]
- [NEEDS CLARIFICATION: Outside agent persona. The user described "outside agents" — but in practice, "outside" is whoever invokes minih (Claude Code, CI, human). Is there a use case for an actual outside *agent* (an agent that runs the outside CLI commands), or is "outside" always a host caller?]
- [NEEDS CLARIFICATION: Inbox/state per-agent shared vs per-slug-and-namespace. If two distinct agents (e.g., `code-reviewer`, `phase-tracker`) need to coordinate, do they each have their own inbox lanes against a shared state, or do they share an inbox? Default leaning: per-agent shared (no cross-agent inbox in v1).]
- [NEEDS CLARIFICATION: Outside-side `state get/set` access control. Should the outside CLI be able to write to `inside.json`, or should writes from outside be restricted to `outside.json`? Default leaning: outside CLI can read both, write only to outside; inside MCP can read both, write only to inside. Symmetric.]
- [NEEDS CLARIFICATION: Inbox sender identity. Today, inside knows it's "the agent" and outside is "whoever called minih". Do we need richer sender metadata (e.g., the host caller's identity)? Default leaning: store sender as `'outside'|'inside'` only; rely on log timestamps and the user's environment knowledge.]

## Workshop Opportunities

| Topic | Type | Why Workshop | Key Questions |
|-------|------|--------------|---------------|
| **Filesystem layout for inbox & state** | Storage Design | The choice between per-agent-shared (mutable across runs) and per-run (frozen) has cascading implications for reproducibility, cross-run coordination, snapshotting, and the future eventing plan. Multiple plausible layouts; need to pin one. | Per-agent-shared with per-run snapshots vs per-run isolation? File naming (`inbox/outside/messages.ndjson` vs `inbox/messages-from-outside.ndjson`)? Where do snapshots live in the run folder? Atomic write strategy for state files (write-then-rename, lockfile, journal)? Concurrent-access semantics? |
| **MCP tool surface design** | API Contract | The tool names, parameter shapes, and return types are the primary contract between minih and inside agents — they're hard to change once agents start using them. Must be designed for forward extension (future eventing-arrived notifications, peer-presence queries, etc.). | Final tool names (`inbox.send` vs `notify.send`; `state.transition` vs `state.set` with implied transition)? Parameter shapes (positional vs named)? Error model (typed errors per tool vs generic)? Idempotency (repeat `inbox.send` with same body)? Pagination for `inbox.list`? |
| **State machine — phases, transitions, history** | State Machine | The user's invariant ("inside complete only after outside done") is the seed; we need a fuller model. State persistence semantics, history granularity, and outside-vs-inside symmetry all need pinning. | Default phases? Are phases per-agent customizable? How are transition rules expressed (TS literal map, separate JSON, frontmatter)? History granularity — every transition or only milestone transitions? How do we surface state changes in the run envelope and `minih history`? |
| **Spawn-config injection & MCP child ergonomics** | Integration Pattern | This is the load-bearing pattern that makes the inside surface clean for agents. Getting it wrong means ID/path leakage into agent prompts (back to the shellout problem). | What library hosts the MCP server (`@modelcontextprotocol/sdk` vs alternatives)? How is per-run context passed (CLI args, env, both)? How does the child handle SIGTERM cleanly so the cleanup cascade works? Process-marker convention so the regression test can `pgrep` reliably? Auth/trust-by-process-descent or per-run secret? |
| **Preamble & SYSTEM_OUTPUT_INSTRUCTIONS additions** | Other (Prompting) | Inbox/state require explicit prompt guidance (per `agent-harness-survey.md`: agents reliably ignore implicit context). Too much added text bloats every run; too little and agents don't use the new tools. | What's the minimum viable preamble addition? Is the inbox-check a pre-completion checklist item or a per-step nudge? Do we offer a per-agent opt-out so single-shot agents don't pay the prompt-bloat tax? How do we A/B test prompt changes without a/b infrastructure? |
| **Test fixtures for two-agent coordination** | Other (Testing) | Per `research-dossier.md` QT-06, the existing test infrastructure does not support testing "outside writes inbox → inside reads inbox" cleanly. Building reliable fixtures is foundational for the whole spec's testability. | Extend `FakeAgentAdapter` with shared inbox/state state? Or build a separate `TestHarness` that runs two real cooperating agents in one process? Mock MCP server vs real spawn? How do we time-travel for state transitions (fake timers)? |

---

**Ready for**: `/plan-2c-workshop` (multiple workshop opportunities identified) or `/plan-2-v2-clarify` (≤8 high-impact questions to resolve open items).

**Recommendation**: run **`/plan-2c-workshop`** for at minimum: (1) filesystem layout, (2) MCP tool surface, (3) state machine. The other three opportunities can be folded in or deferred to design-time.
