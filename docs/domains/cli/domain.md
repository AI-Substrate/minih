# Domain: cli

**Purpose**: User-facing CLI commands and composition root. Owns SDK runtime construction and wires domain-specific run configuration such as the inside MCP spawn factory.

## Boundary

**Owns**: Command definitions (quickstart, init, run, resume, connect, list, doctor, check, validate, history, tail, last-run, status, inspect, difficulties, outside coordination commands), argument parsing, JSON output envelope, SDK client instantiation (composition root), agent scaffolding (init), SDK runtime helper (shared by run + resume), cross-domain composition wiring, inside-context command blocking

**Excludes**: Execution logic (runner), SDK communication (adapter), schema validation (runner), MCP tool implementation (mcp)

## Composition

| File | Classification | Purpose |
|------|---------------|---------|
| `src/cli/index.ts` | internal | CLI entry point (shebang, commander program) |
| `src/cli/output.ts` | contract | MinihEnvelope — JSON output format (Phase 4) |
| `src/cli/commands/run.ts` | internal | Composition root — dynamic SDK import + inside MCP factory wiring + dry-run prompt preview through runner builder (Phase 4 / 007 P4/P6) |
| `src/cli/commands/resume.ts` | internal | Resume session — follow-up messages + inside MCP factory wiring (003-resume-prompt / 007 P4) |
| `src/cli/commands/connect.ts` | internal | Print copilot CLI resume command (003-resume-prompt) |
| `src/cli/commands/quickstart.ts` | internal | Scaffold + run hello-world in one command (FX001-quickstart) |
| `src/cli/commands/sdk-runtime.ts` | internal | Shared SDK bootstrap: auth, import, client, SIGINT (003-resume-prompt) |
| `src/cli/commands/list.ts` | internal | List agents with descriptions (Phase 4) |
| `src/cli/commands/doctor.ts` | internal | Structural validation plus coordinated `outside.md` drift/size checks (Phase 5 + 007 P6) |
| `src/cli/commands/check.ts` | internal | Explicit file validation against schema, with a friendly `check --run` correction toward `validate --run` (Phase 5 + 008 FX003) |
| `src/cli/commands/init.ts` | internal | Agent scaffolding, including canonical shared-preamble creation and `--coordinated` outside/state-schema scaffold (Phase 5 + 007 P6) |
| `src/cli/commands/history.ts` | internal | Past runs display (Phase 4) |
| `src/cli/commands/validate.ts` | internal | Re-validate latest or selected completed run output (Phase 4 + 008 FX003) |
| `src/cli/commands/last-run.ts` | internal | Latest run info (Phase 4) |
| `src/cli/commands/tail.ts` | internal | Follow event stream or print bounded `--lines`/`--snapshot` samples (Phase 4 + 008 FX003) |
| `src/cli/commands/difficulties.ts` | internal | Aggregate difficulty reports across all agents (006-compounding-value) |
| `src/cli/commands/status.ts` | internal | Latest run status summary |
| `src/cli/commands/inspect.ts` | internal | Prompt/config inspection |
| `src/cli/preaction-context.ts` | internal | Reusable inside-context block for outside-only shell commands (007-backgrounding P5) |
| `src/cli/coordination.ts` | internal | Shared outside coordination CLI helpers: agent/run resolution, schema validation, inbox lane parsing/appending (007-backgrounding P5 + FX001) |
| `src/cli/commands/outside.ts` | contract | Append outside-lane inbox messages, including ack records (007-backgrounding P5) |
| `src/cli/commands/inside.ts` | contract | Read/filter inside-lane replies for outside callers (007-backgrounding P5) |
| `src/cli/commands/state.ts` | contract | Outside state get/set/transition subcommands (007-backgrounding P5) |
| `src/cli/commands/outside.ts` | contract | Emit outside-side coordination markdown in a JSON envelope (007-backgrounding P5) |
| `src/cli/commands/outside.ts` | contract | Record outside-side retro messages with target metadata (007-backgrounding P5) |
| `src/cli/commands/retros.ts` | contract | Aggregate inside report retros and outside retro messages (007-backgrounding P5) |

## Contracts

| Contract | Type | Consumers |
|----------|------|-----------|
| `MinihEnvelope` | Type | External agents, CI, humans (JSON output) |
| Error codes | Constants | All CLI consumers |
| Outside coordination commands | CLI | Outside callers coordinating with inside minih sessions |
| Inside-context block | CLI guard | Outside-only commands invoked from inside a minih session |
| `init --coordinated` | CLI | Agent authors creating two-sided coordinated agents |
| `doctor` outside-contract checks | CLI | Agent authors keeping `outside.md` current and bounded |
| `run --dry-run` | CLI | Agent authors inspecting the exact coordinated inside prompt without launching the SDK |

## Concepts

| Concept | Definition |
|---------|-----------|
| Composition root | `sdk-runtime.ts` owns shared SDK bootstrap (auth check, dynamic import, CopilotClient, SIGINT). Used by both `run.ts` and `resume.ts`. |
| Inside MCP wiring | `run.ts` and `resume.ts` import `mcp` spawn config and pass a generic factory to runner only at the CLI composition boundary. |
| stdout = machine | JSON envelope on stdout. Human formatting on stderr. TTY-detected. |
| Three consumers | Agent inside minih, external coding agents, humans/CI. |
| Outside commander surface | Humans, CI, and host agents coordinate with an inside session through `outside inbox send`, `inside inbox list`, `state get`, `state set`, `outside context`, `outside retro add`, and `retros`. Mutable commands target a run explicitly with `--run <runId>` or resolve only when unambiguous; they read/write runner coordination files and do not invoke inside MCP tools directly. |
| Context block | `run`, `resume`, `quickstart`, `tail`, and `init` fail with `E128 INVALID_CONTEXT` under strict `MINIH=1`, while normal outside behavior is unchanged. |
| Cross-side retros | Inside managed `report.json.retrospective` entries and outside-lane `retro` messages flow into the same `retros` aggregation surface. |
| Coordinated scaffold | `init --coordinated` writes `coordination: enabled`, `outside.md`, `inside-state.schema.json`, and `outside-state.schema.json` without changing default init output. |
| Outside context preview | `outside context` with no slug returns system-only guidance. With a slug, `contractStatus` is `absent`, `empty`, or `present`, and `hasOutsideContract` distinguishes no file from an empty file. |
| Outside contract health | `doctor` warns when coordinated `outside.md` is older than `prompt.md` or over 4KB, fails over 8KB, ignores absent/non-coordinated outside contracts, and preserves realpath containment checks. |
| Dry-run prompt parity | `run --dry-run` uses `buildInsidePreamble()` and returns the assembled prompt in the JSON envelope, so coordinated previews include the same identity/tool/peer/checklist sections as real runs. |
| File vs run validation | `check` validates explicit files (`--file` or best-effort `MINIH_OUTPUT_PATH`), while `validate --run` revalidates completed run outputs. A mistaken `check --run` returns a JSON envelope with the correct alternatives. |
| Tail snapshot | `tail --lines <n> --snapshot` prints a bounded recent event window plus completion summary if present, then exits without polling forever; no flags preserve live follow behavior. |

## Tests & Validation

| Area | Tests |
|------|-------|
| Outside context statuses | `test/cli/outside-inbox-wait.test.ts` |
| Outside inbox/state/retro commands | `test/cli/outside-inbox-wait.test.ts`, `test/cli/outside-inbox-wait.test.ts`, `test/cli/outside-inbox-wait.test.ts`, `test/cli/state.test.ts`, `test/cli/retros.test.ts` |
| Coordinated scaffold and dry-run parity | `test/cli/init-coordinated.test.ts` |
| Doctor outside-contract checks | `test/cli/doctor-outside-md.test.ts` |
| MCP composition wiring from CLI | `test/mcp/spawn.test.ts`, `test/mcp/leak-regression.test.ts` |

## History

| Phase | Changes |
|-------|---------|
| Phase 1 | Created domain. Placeholder entry point only. |
| Phase 4 | Full CLI implementation. Commander program with 6 commands (run, list, history, validate, last-run, tail). Output envelope (MinihEnvelope). Composition root with dynamic SDK import. Session isolation (CWD=runDir). chalk + cli-table3 for display. hello-world agent. |
| Phase 5 | Added `doctor`, `check`, `init`, and `run --dry-run`. Scaffolded `_shared/preamble.md`. `check` supports zero-arg via MINIH_* env vars. `init` creates output-schema with system fields. `dry-run` works without GH_TOKEN. |
| 002-pretty-mode | Added `--verbose` flag. Default display switched to PrettyDisplay (pretty.ts). SIGINT handler calls PrettyDisplay.cleanup(). |
| 003-resume-prompt | Added `resume` command (follow-up messages to completed sessions), `connect` command (print copilot CLI resume command). Extracted shared `sdk-runtime.ts` from `run.ts`. Updated `history` with `↩` indicator for resumed runs. |
| FX001-quickstart | Added `quickstart` command — scaffold + run hello-world in one command. Extracted `ensurePreamble()` from `init.ts`. |
| FX002-agent-ux | Suppressed SQLite ExperimentalWarning via `NODE_NO_WARNINGS`. Added tool elapsed timer to pretty mode. |
| 006-compounding-value | Added `difficulties` command (aggregates difficulty reports across all agents). Added velocity trend column + summary line to `history`. Run envelope now includes summary/magicWand/magicWandTarget/difficulties from parsed report.json. |
| 007-backgrounding P4 | Wired coordinated `run` and `resume` sessions to supply the inside MCP spawn config factory and reserved inbox/state tool namespace checks. |
| 007-backgrounding P5 | Added outside coordination CLI surface: context block guard, outside inbox send/list, outside state get/set/transition, outside-context, outside-retro, retros aggregation, command discovery, and run help guidance. |
| 007-backgrounding P6 | Extended `init` with `--coordinated` scaffolding and canonical shared-preamble creation, `doctor` with coordinated `outside.md` drift/size checks, and `run --dry-run` prompt preview parity while preserving default init and non-coordinated doctor behavior. |
| 007-backgrounding P7 | Finalized CLI documentation for the complete command surface, outside-context contract statuses, coordinated scaffold files, doctor outside-contract checks, dry-run parity, and MCP composition-root boundary. |
| 008-canonical-coordination-loop | Updated coordinated `run`/`resume` reserved MCP namespace checks from dotted `inbox.*`/`state.*` prefixes to backend-safe `inbox_`/`state_` prefixes and added the rich `coordination-loop-validator` worked-example docs/tests. |
| 008 FX001 | Outside coordination commands now resolve a run target, include `runId` in envelopes, and keep same-agent concurrent runs isolated across inbox/state/retros. |
| 008 FX002 | Clarified worked-example docs that `waitMs` is an inside MCP long-poll option while outside peers continue observing through CLI `status`, `tail`, `inside inbox list`, and state commands. |
| 008 FX003 | Added `tail --lines` and `--snapshot`, clarified `check --file` vs `validate --run`, and added friendly `check --run` guidance for fresh-agent coordination evals. |
| 010 HF-001/HF-002 | Lane CLI hard rename: introduced `outside <verb>` and `inside <verb>` Commander subcommand trees (replacing flat `outside-send` / `outside-inbox-list` / `outside-context` / `outside-retro` and moving `state set`/`transition` under `outside state`). Top-level `state get` survives as cross-lane both-view. Inside lane is read-only from CLI; write attempts return E143. Long-poll on inbox-list via shared `runner.pollInboxLane`: `--wait <ms>` (bare = 60_000, max 300_000), composes with `--type` / `--unread` / `--after`, surfaces E141 (out-of-range), E142 (agent-gone via run.json status flip). New `inside retro show` reads farewell envelope retrospective. Error code range E140-E149 reserved. Functional smoke verified against live coordinated agent. |
| 010 HF-003 | Resume CLI rewritten for resume-in-place semantics. New flags `--resume-prompt <text>`, `--takeover`, `--fresh`, `--yes`. Default `minih resume <slug>` reuses the original runDir + sessionId; `--fresh` opts back into pre-HF-003 (new run dir). Eligibility check via `runner.detectRunState`; active runs without `--takeover` return E144, with `--takeover` go through SIGTERM → 5s grace → SIGKILL and a TTY confirmation (or `--yes`). Concurrent resumes coordinate via `resume-intent.lock` (E147 RESUME_IN_PROGRESS after 35s wait). `--resume-prompt` emits a `[SYSTEM RESUME]` envelope concatenated with any user message via `---` separator. New error codes wired: E144 ALREADY_ACTIVE, E145 NO_RUN_TO_RESUME, E146 SESSION_EXPIRED, E147 RESUME_IN_PROGRESS, E149 MCP_SPAWN_FAILED. `output.ts` got a doc-comment table for the full code surface. |
| 011-retro-harvest-loop | New `minih harvest <slug>` command (single + `--since <ISO>` batch) writes agent retrospectives to `docs/retros/<slug>.md` (and `docs/retros/<plan-id>.md` when `MINIH_PLAN_ID` is set). Idempotent on `runId`. `MINIH_NO_AUTO_HARVEST=1` is intentionally ignored by the explicit verb (kill-switch is for runner auto-append only). End-of-run hint added to `displaySummary` (`📝 magicWand: "..." (full: minih harvest <slug>)` on success; `⚠️ Retrospective not written` on timeout/failed). `minih doctor` extended with retro-ledger audit: walks `agents/*/runs/`, reports unharvested retros + soft-warns on ledger files >1MB. `minih run`/`minih resume` `--help` updated to mention the harvest command. `minih init` now scaffolds `docs/retros/README.md` from a bundled template. |
| 012-peer-activity-telemetry | Added `peer` block to 5 transactional outside commands' success envelopes: `outside inbox send`, `outside state set`, `outside state transition`, `outside retro add` always include peer; `outside inbox list --wait` includes peer (post-poll, not at call entry). Pure reads (`state get`, bare `inbox list`) skip peer. New `--strict-peer` flag on `outside inbox send` derives peer BEFORE the append and exits `E150 DEAF_PEER` (refusing delivery) when verdict is `'deaf'`; default behaviour is visible-but-non-blocking. TTY mode renders a colour-coded verdict line on stderr (red=deaf/dead, yellow=silent, green=healthy); silent in piped mode. New error code: `E150 DEAF_PEER`. `minih doctor` extended with `auditPeerActivity()` — walks active coordinated runs, surfaces `verdict ∈ {silent, dead}` rows in `peer[]` envelope array (deaf cannot fire because audit calls with messageType=null); healthy runs emit a single `✓ N active coordinated runs healthy` line. New `derivePeerOrNull(runDir, type)` helper keeps peer-derive sites uniform and error-tolerant (peer is always additive — never blocks the underlying command). 9 new CLI tests (5 outside-peer + 4 doctor-peer). |
| 013-message-reply-chains | Removed the gate at `outside.ts:209-216` that rejected `--ack-of` unless `--type ack`. The flag now works for any `--type`, allowing outside operators to reply to a specific inbox message and form chains (since each reply's id is itself a valid `--ack-of` target). Inverse check (`--type ack` requires `--ack-of`) preserved. 4 new integration tests in `outside-peer.test.ts` covering reply-chain non-ack flow + AC-2 / AC-3 no-regression assertions. |
