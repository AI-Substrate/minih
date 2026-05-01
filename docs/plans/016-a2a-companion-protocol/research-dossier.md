# Research: A2A Protocol — Fit for minih Companion Communication

**Generated**: 2026-05-01
**Research query**: "research a2a on perplexity etc and report on fit for purpose as a use for communication with companions (and in future, between companions!)"
**Sources**: Perplexity Deep Research over the official A2A spec (v1.0), Linux Foundation announcement, a2aproject GitHub, AWS/IBM/LangChain integration writeups, Solo/Semgrep security analyses, plus minih's own `docs/how/companion-mode.md`.
**Mode**: External-protocol research with codebase fit overlay (not a full 8-subagent codebase sweep — most of the question is "what is A2A?", and minih's companion contract is already documented and stable).

---

## TL;DR

**A2A is the right *vocabulary* for minih's companion direction. It is the wrong *transport* for minih today.**

- **Conceptual overlap is striking.** A2A's `Task` lifecycle, `Message` parts, `Artifact` streaming, `contextId` threading, push-notification webhooks, and AgentCard discovery are almost a 1:1 superset of what we already invented for companion mode (inbox types, `ackOf`, farewell envelope, state status, `wait_for_any`). We could rename our concepts to A2A's and lose nothing.
- **A2A's transport (HTTP/JSON-RPC + SSE + webhooks + TLS + OAuth/mTLS) is wildly heavy** for what minih actually does today: one local CLI process driving one local long-running coordinated agent over filesystem inbox/state. There is no network. There are no tenants. There is no untrusted peer.
- **The killer use case is the *future* one the user named:** companion-to-companion. Once there's more than one companion in a session, or once external orchestrators (a CI bot, a different harness) want to drive a minih companion, A2A becomes interesting because it makes minih companions *consumable* by anything that speaks A2A — and lets minih *consume* anyone else's A2A agent without inventing yet another adapter.
- **Pragmatic recommendation:** treat A2A as a *target shape*, not a transport. Keep the file-based inbox/state core. Add an optional A2A *facade* — a thin JSON-RPC server in front of an existing run — when (and only when) a second consumer or a peer companion appears. That preserves minih's "enabler not orchestrator" stance and avoids building HTTP+TLS into the inner loop.

---

## 1. What A2A actually is

### Origin and governance
- Announced by Google **April 2025**; v1.0 released; governance moved to the **Linux Foundation** June 2025. ~50 launch partners (Atlassian, Box, LangChain, MongoDB, Salesforce, SAP, ServiceNow, Workday, all the SIs).
- Explicitly designed for **cross-org, cross-vendor, cross-framework** agent interop. Black-box peers. Federated. The inverse of minih's "everything is local files in one repo" stance.
- AWS Bedrock AgentCore now hosts A2A agents alongside MCP servers; LangChain/LangGraph, Strands, Google ADK, and Claude Agents SDK all have first-party adapters.

### Five design principles (worth quoting because they shape every fit decision below)
1. **Reuse web standards** — HTTP, JSON-RPC 2.0, SSE, DNS. No new wire format.
2. **Enterprise-ready** — auth, observability, tracing assumed.
3. **Async-first** — multi-step tasks measured in hours/days are the default, not the exception.
4. **Modality-agnostic** — text, audio, video, files, structured data, embedded UI components.
5. **Agent opacity** — peers collaborate via declared capabilities only; no shared state.

Principle #5 is the one that matters most for minih. **A2A assumes peers don't trust each other.** minih currently assumes the opposite — companions live inside your project, you wrote their prompt, the harness can read their inbox files, the operator owns the lifecycle.

### The wire surface (concrete)

**Transport bindings (functionally equivalent):**
- JSON-RPC 2.0 over HTTPS *(canonical)*
- gRPC + Protobuf
- REST + JSON

**Core RPC methods** (`{category}/{action}`):
- `message/send` — fire one message, get a `Task` back
- `message/stream` — same, but server keeps an SSE connection open and streams `status-update` and `artifact-update` events until terminal
- `tasks/get` — poll status
- `tasks/cancel` — terminate
- `tasks/pushNotificationConfig/set` — register a webhook for terminal-state delivery (the "long-running task" pattern)

**Three first-class objects:**
| A2A object | What it represents | minih analogue |
|---|---|---|
| `Message` | One inbox-shaped item with `role` (user/agent), `messageId`, `parts[]`, optional `metadata` | Inbox entry (typed: briefing/task/question/control/finding/summary/review-request) |
| `Task` | A long-running unit of work with a state machine and an id; outlives the message | A coordinated minih *run* (the agent's session) |
| `Artifact` | Output produced during/after a task — chunkable, named, can be streamed in pieces | Farewell envelope at `$MINIH_OUTPUT_PATH`, plus per-finding payloads we currently shove into messages |

**Parts** within a Message: `text`, `file`, `data` (structured JSON). This cleanly subsumes our practice of stuffing JSON into a message `body` string.

**Task state machine:**
```
submitted → working → (input-required ⇄ working)* → completed
                   ↘ canceled
                   ↘ failed
```
Compare minih's `idle | in-progress | paused | done | error`. Same shape, slightly different vocab. A2A's `input-required` is the standardised version of what we currently express as "send a message of type=question".

### Long-running pattern (the part that maps best to companion mode)

A2A's three async patterns:
1. **SSE stream** (`message/stream`) — client holds an open HTTP connection, gets every status-update + artifact-update event live. ≈ our `wait_for_any` long-poll, but server-pushed.
2. **Polling** (`tasks/get`) — client periodically checks state. ≈ our `state get` outside CLI.
3. **Webhook push** (`tasks/pushNotificationConfig/set`) — client gives the agent a callback URL and disconnects; agent POSTs on terminal transitions. ≈ our farewell envelope dropped to `$MINIH_OUTPUT_PATH` after `control:stop`.

We have invented all three. A2A names them.

---

## 2. AgentCard and discovery

A2A agents publish an **AgentCard** at `/.well-known/agent.json` (or, more recently, `/.well-known/agent-card.json` — naming is mid-flux). It declares:

- `name`, `description`, `version`
- `url` (the JSON-RPC endpoint)
- `capabilities` (does it support streaming? push notifications? input-required?)
- `defaultInputModes` / `defaultOutputModes` (`text`, `data`, `file`)
- `skills[]` — named, scoped capabilities with descriptions, tags, examples
- `securitySchemes` — OAuth2/OIDC, mTLS, API key, declared OpenAPI-style
- v1.0 adds **signed AgentCards** for cryptographic identity

**Direct minih analogue**: agent `prompt.md` frontmatter (`model`, `coordination`, `output-schema`, `idleBudgetMs`, etc.) plus `outside.md`. We don't expose these as a single discoverable document, but we trivially could. `npx minih agent-card <slug>` that emits the AgentCard JSON would be a one-day implementation.

**Security note worth flagging now**: AgentCards are a documented prompt-injection vector (Solo, Semgrep). Any field that flows into an LLM prompt must be treated as untrusted. minih's analogous risk is the contents of `prompt.md` and `outside.md`, but those are *authored* by the project owner and live in the repo, so the risk model is different.

---

## 3. A2A vs MCP — how they relate

This is the most-confused topic in the space. Clean answer:

| | **MCP** (Anthropic, Nov 2024) | **A2A** (Google, Apr 2025) |
|---|---|---|
| **Question it answers** | "What tools/data can *one agent* use?" | "How do *agents* talk to each other?" |
| **Topology** | Asymmetric (LLM client ↔ tool server) | Symmetric (peer ↔ peer) |
| **Granularity** | Inside an agent | Between agents |
| **Wire** | JSON-RPC over stdio/HTTP/SSE | HTTPS + JSON-RPC/gRPC/REST |
| **Trust model** | Server provides tools to one client | Peers, possibly across orgs |

**They are layered, not competing.** Canonical pattern: an A2A agent exposes capabilities to peers; internally it uses MCP to reach its own tools. AWS Bedrock AgentCore now lets an agent be both — A2A peer-facing, MCP tool-facing — at the same endpoint.

**This maps onto minih perfectly:** our hidden inside MCP server (six tools for inbox/state) is the right place for tool access. An A2A facade — if we add one — sits *outside* the agent, peer-facing, and is a separate concern from the MCP surface.

---

## 4. Mapping A2A onto minih's companion contract

This is the central question. Rough one-to-one:

| minih companion mode | A2A equivalent | Notes |
|---|---|---|
| `npx minih run code-review-companion` (boots run, sets up inbox/state) | Agent server starts; AgentCard published | minih runs are local processes; A2A agents are network services |
| `outside inbox send --type briefing` | `message/send` with `parts[{kind:'text', text:...}, {kind:'data', data:...}]` | type→metadata; subject/body→parts |
| `outside inbox send --type task --subject "review-request: T### $SHA"` | `message/send` creating a new `Task` (or sub-message under contextId) | A2A would model each review-request as its own Task |
| `ackOf` (reply chain via plan 013) | `contextId` threading + `taskId` reference | A2A handles this natively |
| `waitForAny([inbox.message, state.peer.changed])` | `message/stream` SSE, server pushes status-update events | minih currently *pulls*; A2A *pushes* |
| `state get/set` (paused/in-progress/done/error) | `Task.status.state` (working/input-required/completed/...) | minih state is a free-form data field too; A2A keeps state separate from artifact |
| Per-finding `type:finding` message | An `artifact-update` event on the parent Task with severity/file metadata | Artifacts are the "right" home for findings under A2A |
| Farewell envelope at `$MINIH_OUTPUT_PATH` | Terminal `Task.status = completed` + final `Artifact` (the report) + optional webhook POST | We already do exactly this, just over filesystem |
| `control:stop` | `tasks/cancel` *or* a final inbox message that triggers graceful drain | A2A's `cancel` is hard-stop; we'd want to keep our soft-stop semantics |
| Auto-harvest of retro on completion | Out of band; minih-specific concern | No A2A equivalent — this is project ledger machinery, correctly outside the protocol |

**Verdict on the mapping**: clean. Not even a forced fit. Companion mode has been independently arriving at A2A's conceptual model — long-running tasks, role-tagged messages, artifact streaming, threaded context, push on terminal. The shapes match because the problem is the same.

---

## 5. Where A2A would shine for minih

In rough order of value:

1. **Companion-to-companion** *(the user's stated future)*. Today, two minih companions in the same session can't talk to each other directly — the operator has to fan out. A2A gives every coordinated run a peer-callable endpoint at near-zero conceptual cost, and the message/task/artifact model already handles the asymmetric reply chains we want.
2. **External orchestrators driving a minih companion**. CI bot, IDE extension, another team's harness. Today they'd have to shell out to `npx minih outside ...` and read JSON-on-stdout. With an A2A facade, anything that speaks A2A can attach to a running companion and get streaming progress without a minih SDK.
3. **Cross-vendor agent participation**. A LangGraph orchestrator could include a minih companion as one of its A2A peers. Or vice versa — minih's outside CLI could `message/send` to a Strands or ADK agent.
4. **Forces clean separation of protocol from logic**. A2A's most-cited anti-pattern (per the dev.to architecture critique) is mixing business rules into the AgentExecutor. minih is already on the right side of this: the runner is pure orchestration, the prompt is the business logic. An A2A facade would naturally sit at the runner edge with no temptation to leak.
5. **Artifact streaming**. Right now a finding is a message-body string. A2A artifacts are first-class, chunkable, append-able, and have stable IDs across updates. If a companion produces a 5MB report, A2A handles it cleanly; minih currently doesn't have a great answer there.
6. **Standardised observability hooks**. The whole A2A ecosystem is converging on OpenTelemetry-traced tasks. minih could inherit that tracing layer for free if we ever want cross-process visibility.

---

## 6. Where A2A is wrong for minih (today)

In rough order of severity:

1. **HTTP/TLS for what is currently a local subprocess**. The minih companion lives in your project repo, on your laptop. Wrapping it in an HTTPS server (with cert management, port allocation, SSL termination, TLS 1.2+ requirement) is grossly disproportionate. File-based inbox/state is *the right primitive* for "one CLI driving one local subprocess in the same checkout". A2A would replace that with a network round-trip.
2. **Auth model overhead**. A2A's auth story is OAuth2 / mTLS / API keys. None of those make sense between a CLI and the subprocess it spawned five seconds ago. We'd end up with a bypass mode that is "no auth on localhost", which is fine but adds machinery for nothing.
3. **Async-first when most companion interactions are sync-ish**. A2A treats every send as creating a Task. That's right for cross-org delegation. For "tell the companion the new SHA, it'll reply if interested" — a fire-and-forget pattern we explicitly built — Task lifecycle is overhead.
4. **Specification-implementation gaps the spec admits to**. Authorization policy, observability, resilience are explicitly delegated to "implementation layers". So is the `input-required` state in some SDKs (Strands, per their tracker). Adopting A2A means owning all of those gaps for our use case.
5. **Versioning is still moving**. v0.3 → v1.0 was a breaking transition (April 2025–Q4 2025). AgentCard discovery URL is mid-rename. A2A is real but young; we'd be a moving target consumer.
6. **Filesystem is debuggable; HTTP isn't (without tooling)**. `cat agents/<slug>/inbox/*.json` is the most debuggable inbox imaginable. Replacing it with HTTP requests means every operator needs a JSON-RPC client to inspect state. We can keep filesystem-as-truth and bolt HTTP *on top*, but only if we never let HTTP become the source of truth.
7. **Security gotchas the protocol doesn't yet have answers for**: AgentCard prompt-injection, naming-collision attacks, "rug pull" agents, shadowing. Inside a single repo these are non-issues; the moment we expose A2A on a port, they become our problem.

---

## 7. Recommended approach

A staged approach that captures value without paying transport cost prematurely:

### Stage 0 — Borrow the vocabulary now (free)
- Refactor `docs/how/companion-mode.md` and the inbox `type` enum docs to reference A2A's terms in parentheses ("a `task`-typed message creates an A2A-style Task") so future readers / external integrators see the bridge.
- Add a `## A2A correspondence` section to `AGENTS_README.md` showing the mapping table from §4 above. **Cost: a docs commit.**

### Stage 1 — Publish AgentCards (cheap, optional)
- Add `npx minih agent-card <slug>` that emits a v1.0-shaped AgentCard JSON (name, description, version, capabilities, skills, securitySchemes={none}, url=local).
- Even without an A2A server backing them, AgentCards become the canonical "what does this agent do" advertisement, replacing scattered prompt-frontmatter reads. **Cost: a small CLI command.**

### Stage 2 — Optional A2A facade for live runs (when triggered)
- Introduce `npx minih run --a2a-port 7321 <slug>` that boots the existing run *plus* a thin JSON-RPC server in the same process.
- The facade translates `message/send` → write to inbox/, `tasks/get` → read state/, `message/stream` → tail inbox+state events as SSE, terminal Task → emit farewell envelope as final Artifact.
- File-based inbox/state remains the canonical store. The HTTP server is a *projection*, not a replacement.
- Trigger this when (a) a second consumer wants to drive the run, or (b) two companions in the same session need peer-to-peer messaging. Until then, the facade is dead code we don't need.
- **Cost: a small adapter (probably ≤500 LOC) hugging the existing runner.**

### Stage 3 — Companion-to-companion (the future the user named)
- With Stage 2 in place, a companion's inside MCP gains an `a2a_send(peerUrl, message)` tool. Two companions discover each other via local registry (or each other's AgentCards on filesystem), then exchange tasks/artifacts directly without round-tripping through the operator.
- **This is where A2A finally pays for itself.** The peer-to-peer story is *exactly* what A2A was designed for; trying to invent it on top of file-based inbox/state would mean reinventing A2A poorly.

### Things to *not* do
- Do not replace the file-based inbox/state with HTTP as the primary store. That breaks the "minih is an enabler, not an orchestrator" anchor and gives up the debuggability we have.
- Do not adopt A2A's auth surface (OAuth/mTLS) inside a single repo. If we add a port, bind it to localhost and stop.
- Do not chase v0.3↔v1.0 compatibility ourselves; pick v1.0, document the lock-in, and revisit when the spec stabilises further.
- Do not let A2A vocabulary leak into the runner core. The runner should not import A2A SDKs; it should keep speaking in minih types. The facade does the translation.

---

## 8. External research opportunities (if we proceed past Stage 0)

If we move toward Stage 2 or 3, three follow-ups would tighten the design:

### Opportunity A — JS SDK fitness for facade pattern
**Why**: Stage 2 needs a JSON-RPC + SSE server. `@a2a-js/sdk` provides one with Express integration, but it's targeted at server-as-source-of-truth. We need server-as-projection-over-files. Need to verify the SDK's executor pattern doesn't fight us.
```
/deepresearch "How does @a2a-js/sdk handle the case where Task state and Artifacts live outside the SDK's in-memory store — e.g. on a filesystem that the SDK reads on each request? Is there a documented pattern for stateless executors backed by an external store, or does the SDK assume it owns task state? What hooks exist for synthesising message/stream SSE events from filesystem watches?"
```

### Opportunity B — Companion-to-companion discovery without DNS
**Why**: A2A discovery assumes `.well-known/agent.json` over HTTP. For two companions in the same project, AgentCards on filesystem under `agents/<slug>/agent-card.json` is more natural. Need to know whether the spec leaves room for non-HTTP discovery, or whether we'd be diverging from the standard.
```
/deepresearch "Does the A2A specification allow non-HTTP discovery of AgentCards (e.g., filesystem, mDNS, local registry)? Are there any reference implementations of intra-host A2A discovery? What's the canonical answer for two A2A agents on the same machine that don't want to depend on DNS or a registry service?"
```

### Opportunity C — Push notifications via filesystem rather than webhook
**Why**: A2A's terminal-state push is HTTP POST to a webhook. minih's farewell envelope is a file write. A future "A2A-compatible push notification" might just be "we wrote `$MINIH_OUTPUT_PATH/report.json`". Need to know whether any A2A client can be configured to watch a file as a webhook target, or whether we'd need an adapter.
```
/deepresearch "What is the canonical pattern for adapting A2A push notifications (tasks/pushNotificationConfig/set) to non-HTTP delivery channels — e.g., filesystem writes, message queues, or local IPC? Do any existing A2A clients support pluggable notification transports?"
```

---

## 9. Concept dictionary (quick reference)

For anyone reading this dossier in six months:

- **AgentCard** — JSON metadata describing one A2A agent: name, version, endpoint URL, capabilities, skills, auth schemes. Hosted at `/.well-known/agent.json` or `/.well-known/agent-card.json`. v1.0 supports cryptographic signing.
- **Message** — One inbound or outbound communication. Has a `role` (user/agent), a `messageId`, an array of typed `parts` (text/file/data), and optional metadata.
- **Task** — A long-running unit of work created by `message/send`. Has an `id`, a `contextId` (groups related tasks), a `status` (state + optional message), and an optional `artifacts` array.
- **Artifact** — A named, chunkable output produced by a task. Has an `artifactId`, `name`, and an array of parts. Streamed via `artifact-update` events; `append=true` and `lastChunk=false` allow incremental delivery.
- **`message/send`** — JSON-RPC method: synchronous send, returns a Task in submitted/working state.
- **`message/stream`** — JSON-RPC method: opens an SSE stream, server pushes `status-update` and `artifact-update` events until terminal.
- **`tasks/get`** — Polling.
- **`tasks/cancel`** — Hard cancellation.
- **`tasks/pushNotificationConfig/set`** — Register a webhook for terminal-state notifications; the disconnected long-poll variant.
- **input-required** — Task state where the agent has paused waiting for client input. The interactive primitive A2A adds over plain request/response.
- **MCP** — Sibling protocol from Anthropic. Tool/resource access for one agent. Layered *under* A2A in canonical multi-agent stacks.

---

## 10. Final position

**A2A is what minih's companion mode would have been if it had been designed inside Google in 2025 instead of inside this repo in 2026.** The shapes match because the problem is the same. We should adopt the *vocabulary* immediately (Stage 0), publish *AgentCards* opportunistically (Stage 1), build a *facade* the moment a second consumer appears (Stage 2), and unlock companion-to-companion when that future arrives (Stage 3). The file-based inbox/state core stays. We do not rebuild minih on HTTP.

The most important sentence in the research: A2A explicitly delegates auth, observability, and resilience to "implementation layers". For minih, those layers are *already there* — they're the filesystem, the operator, and the project repo. We don't need A2A to provide them. We need A2A to provide a **shared language for when our companion needs to talk to something that isn't us**, and that's precisely where it earns its keep.

---

**Next step (suggested)**: Confirm whether to act on Stage 0 (a docs PR adding the A2A correspondence table to `AGENTS_README.md` and `companion-mode.md`). Stages 1–3 are conditional on a real second-consumer or peer-companion use case appearing.
