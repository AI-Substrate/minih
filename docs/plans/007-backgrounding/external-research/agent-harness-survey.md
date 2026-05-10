# External Research: Agent Harness Survey — Outside/Inside, Messaging, State, Backgrounding

**Source**: Perplexity Sonar Deep Research, 2026-04-26
**Full text**: persisted at `/private/tmp/claude-501/-Users-jordanknight-substrate-minih/c6d7acac-8199-4edf-95cf-2a607a2f01b1/tool-results/toolu_01U6N7uwzH4y2fDB4T1U7cLo.txt` (~62KB, comparative analysis of Cursor / Aider / Claude Code / AutoGen / LangGraph / Codex / goose / continue.dev plus git/npm/CI precedents)

---

## TL;DR

**Our design (outside-CLI / inside-MCP / filesystem inbox / JSON-schema state) is well-validated by precedent**, particularly:
- **Claude Code's MCP-based tool exposure** is the closest analog — same inside-only-tools-via-MCP-server pattern we picked.
- **AutoGen v0.4's layered messaging** (point-to-point `send_message`/`broadcast_message` + filesystem-backed history) maps onto our inbox NDJSON pattern.
- **LangGraph's checkpoint-based state** (versioned, durable across resumptions) matches our state-file design + per-side-files convention.
- **Git's hook-context env vars** (`GIT_AUTHOR_*`, `GIT_INDEX_FILE`) directly precedent our `MINIH_*` env-var hidden-context pattern, including the inside/outside distinction.

**No surveyed tool combines all four dimensions** (outside/inside split + inbox + state + backgrounding) the way we are. We're early in a real space, not chasing established convention. The strongest cross-cutting recommendation: use **environment-variable-based context detection** (git pattern) for outside/inside, NOT subcommand prefixes — confirms our existing `MINIH=1`/`MINIH_AGENT_SLUG` approach.

---

## Tools Surveyed

### Cursor (cursor.com)
- **Outside/inside**: implicit. The IDE wraps the LLM; agents have access to file/edit tools but no separate "inside" command surface. Permission system is the closest analog (read-only vs full).
- **Messaging**: chat panel = host UI; agents respond via streaming text. No formal inbox.
- **State**: ephemeral per-conversation; no first-class state files.
- **Backgrounding**: "Background Agent" feature (2024+) runs agents on remote VMs for long tasks; not file-watch-driven; communicates back via IDE notifications.
- **Takeaway**: confirms backgrounding is an active concern in the space; their model is "remote VM + notification" rather than "local daemon + file event."

### Aider (github.com/paul-gauthier/aider)
- **Outside/inside**: not formally split. Aider has `/commands` (chat-mode subcommands) which are the closest thing to an inside surface, but they're text commands the user types, not tools the agent invokes.
- **Messaging**: chat history serialized to JSONL files in `.aider.chat.history.md`. Filesystem-backed log, similar to our inbox NDJSON.
- **State**: git is the state machine — Aider commits per-message. No separate state file.
- **Backgrounding**: none; synchronous interactive only.
- **Takeaway**: validates filesystem-backed message logs as a sufficient pattern at small scale.

### Claude Code / Claude Agent SDK (github.com/anthropics/claude-code)
- **Outside/inside**: explicit MCP-based separation. Inside-agent tools are MCP servers registered into the session via `.claude/mcp.json` (or equivalent). Slash commands are the *outside* (user-typed) surface. **This is the closest analog to our chosen design.**
- **Messaging**: subagents communicate with the parent via Task tool calls (MCP tool); no peer-to-peer messaging surface.
- **State**: hooks (`UserPromptSubmit`, `PreToolUse`, `PostToolUse`, etc.) can read/write state files; no formal state schema.
- **Backgrounding**: "background agents" via `Agent` tool with `run_in_background: true`; user gets notified on completion.
- **Takeaway**: **This is our validation.** Same pattern: outside = CLI/slash, inside = MCP tools, state = hook-mediated files, backgrounding = first-class option. Confirms inside-MCP is the right primitive.

### AutoGen (microsoft.github.io/autogen)
- **Outside/inside**: not at the CLI level — AutoGen is a Python library. Agent vs orchestrator distinction is in code only.
- **Messaging**: layered `send_message` (point-to-point) + `broadcast_message` (pub/sub) + memory/history serialized to filesystem.
- **State**: agent state objects with explicit serialization; can be persisted/restored.
- **Backgrounding**: long-running multi-agent conversations are core; no file-event trigger but persistent agents are normal.
- **Takeaway**: validates filesystem-backed message history + serializable state. Their multi-agent messaging design (sender, recipient, content, timestamp) is essentially what our InboxMessage schema should be.

### LangGraph (langchain-ai.github.io/langgraph)
- **Outside/inside**: graph nodes = inside (executed within the graph); the host/runtime = outside. Nodes communicate via shared `state` (TypedDict).
- **Messaging**: state updates are the messaging mechanism; no separate inbox.
- **State**: **first-class** — state schema is mandatory; checkpointer pattern persists state per-step (durable across resumptions).
- **Backgrounding**: explicit support for "human-in-the-loop" via `interrupt()` — graph pauses, persists state, waits for external resume.
- **Takeaway**: validates **state-as-coordination** pattern. Their checkpointer = our `state/{outside,inside}.json` + history.ndjson. The `interrupt()` pattern is exactly the "inside agent waits for outside signal" use case.

### Codex CLI (github.com/openai/codex)
- **Outside/inside**: minimal; CLI is the only surface. Agent runs are one-shot.
- **Messaging**: stdout for results; no inbox.
- **State**: per-run only.
- **Backgrounding**: none.
- **Takeaway**: similar starting point to minih before this plan. Limited precedent.

### goose (github.com/block/goose)
- **Outside/inside**: extension system (extensions register tools with the agent); host = outside, extensions = inside-tool providers.
- **Messaging**: extension tools called by the agent; results returned synchronously.
- **State**: per-session; "session resume" supported via session ID.
- **Backgrounding**: scheduling primitive exists (run a goose recipe on a schedule), but not file-event-driven.
- **Takeaway**: extensions = MCP-like model. Validates the "spawn a tool-providing process per session" pattern.

### continue.dev
- **Outside/inside**: similar to Cursor — IDE wraps LLM, no formal split.
- **Messaging**: chat panel.
- **State**: ephemeral.
- **Backgrounding**: minimal.
- **Takeaway**: confirms most IDE-embedded tools punt on outside/inside.

### GitHub Copilot CLI / copilot-sdk (the SDK we wrap)
- **Outside/inside**: copilot-sdk has no inside/outside primitives at its layer — it's a session-runtime library. The SDK consumer (us) is responsible for any inside/outside distinction.
- **Messaging**: per-session events; no inter-session messaging.
- **State**: session state on disk (per `sdk-session-ttl.md` research).
- **Backgrounding**: `infiniteSessions` mode + `disconnect()`/`resumeSession()` is the building block; no daemon shipping.
- **Takeaway**: SDK gives us building blocks but no opinions. Our plan adds the layer above.

### Anthropic Computer Use / OpenAI Agents SDK
- Both are agent runtimes that focus on tool execution within a session; neither has explicit outside/inside CLI distinction.

---

## Cross-Cutting Patterns

### From git: env-var hidden context (DIRECTLY PRECEDENTS OUR DESIGN)
- `git` outside: full command surface.
- `git` invoked inside hooks: same binary, same commands, but different env vars set (`GIT_DIR`, `GIT_INDEX_FILE`, `GIT_AUTHOR_*`, etc.).
- Detection: hooks check for these env vars to know they're running inside a git operation.
- **This is exactly our `MINIH=1`/`MINIH_AGENT_SLUG` pattern**, validated by 20+ years of git practice.

### From npm: scripts run during install
- `npm install` is outside; lifecycle scripts (`preinstall`, `postinstall`) run inside the install context.
- Different env vars set (`npm_config_*`, `npm_lifecycle_event`, `npm_package_*`).
- Same env-var precedent.

### From CI runners (GitHub Actions, CircleCI)
- Runner orchestrator = outside; job step = inside.
- Job steps see runtime-set env vars (`GITHUB_ACTIONS=true`, `CI=true`, `RUNNER_*`).
- Steps don't get a different command surface — they get the same shell, but with hidden context.

**Common thread**: **env-var-based context detection beats subcommand prefixes** for outside/inside. Subcommand prefixes (`minih inside foo`, `minih outside foo`) are a worse pattern because they require remembering which prefix to use; env-vars are auto-detected.

---

## Anti-Patterns to Avoid

1. **Don't build a separate "inside" CLI binary.** No surveyed tool does this. Adds packaging complexity with zero benefit over env-var detection.
2. **Don't make agents poll for inbox messages every N turns via prompt instruction without server-push fallback.** AutoGen learned this: pure-prompt instruction is unreliable; agents forget. MCP server-push (notifications) is much more reliable. Our inside-MCP design enables this.
3. **Don't serialize full state into every message.** AutoGen/LangGraph use *deltas* + checkpoints. Our state files should be similarly designed (transitions append to `state/history.ndjson`, current state is a snapshot).
4. **Don't couple inbox to runtime session lifecycle.** Inbox should survive across runs (per-agent shared, not per-run). Otherwise cross-run conversation is impossible — already in our dossier as Critical Finding 02.
5. **Don't try to enforce state-machine rules in JSON Schema.** No surveyed tool does. They all enforce in code. (Validated independently in `state-machine-jsonschema.md`.)

---

## Patterns We're Adopting (validated)

1. **MCP-based inside surface** (Claude Code precedent): `inbox.list`, `inbox.send`, `state.get`, `state.set`, `state.transition` as MCP tools, not commander commands.
2. **Hidden-context spawn config** (git/npm/CI precedent): per-session params (runId, runDir, agentSlug, side) baked into the MCP server's spawn args; agent calls tools by name only.
3. **Filesystem-backed message log** (Aider/AutoGen precedent): NDJSON, append-only, per-agent shared.
4. **State-as-coordination** (LangGraph precedent): explicit state schema, checkpointed.
5. **Env-var context detection** (git/npm/CI precedent): `MINIH=1`, `MINIH_CONTEXT=outside|inside` for the small handful of dual-use legacy commands (`check`, `validate`).

---

## Patterns We're NOT Adopting (deliberate)

1. **No separate CLI binary** — env-var detection is sufficient.
2. **No formal pub/sub event bus for the prerequisite plan** — defer until eventing/daemon plan; filesystem inbox is enough for the user's stated use case.
3. **No graph-based execution model** (LangGraph) — overkill for two coupled state docs.
4. **No remote-VM backgrounding** (Cursor) — local daemon is the right scope.

---

## Specific Things to Cite in Plan 007 Spec

- "Following Claude Code's MCP-based inside-tool exposure pattern" — for the inside-channel decision.
- "Hidden-context env-var pattern, established by git's `GIT_*` hook variables" — for the spawn-config-bakes-IDs design.
- "State-as-coordination, mirroring LangGraph's checkpointed state schema" — for the state file design.
- "AutoGen-style filesystem-backed message log (NDJSON, append-only)" — for the inbox.
- "MCP server-push notifications enable agents to be alerted to inbox messages without polling, per the MCP spec" — for the future eventing plan.

---

## Open Questions This Survey Doesn't Resolve

- **Acknowledgement semantics**: do messages need explicit ack? AutoGen does; Aider doesn't. Pick based on use case (the user's "phase 2 done" → "review of phase 2 done" implies ack).
- **Message ordering across both inbox lanes**: when outside writes to its outbox AND inside writes to its outbox simultaneously, what's the canonical order for an observer? Probably: each side's NDJSON file is total-ordered within itself; cross-lane order is per-event timestamp.
- **Inbox retention**: how long do messages persist? AutoGen never deletes. Aider snapshots per session. Pick a policy.

---

## Confidence Level

The Perplexity research surfaced 8+ tools with detailed comparison and direct-source citations (GitHub repos, official docs, blog posts). The analysis is grounded but Perplexity admits no surveyed tool combines all four of our dimensions, so we're partially inventing. The pieces we're reusing (MCP for inside tools, filesystem inbox, env-var context, JSON-schema state) all have working precedent. Our novel contribution is the *combination* + the explicit outside/inside semantics around state-machine transitions.
