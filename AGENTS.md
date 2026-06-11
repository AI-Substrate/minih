# Copilot Instructions — minih

## 🛑 Dogfood rule — never read run-dir files directly

**The harness IS the product. We MUST be exemplar users.** That means: NEVER `cat`/`tail`/`grep`/`jq` files under `agents/<slug>/runs/<runId>/` directly. ALWAYS go through the `minih` CLI. Every time you bypass the CLI, you skip a UX gap that real users will hit — and you set a bad pattern in this very document for the next agent reading it.

**This rule is non-negotiable.** If the CLI doesn't expose what you need, that's a missing surface — file it as MW/fix dossier (`harness observe "<the gap>" --kind magic-wand`) and use `cat` only AFTER raising the gap explicitly with the user. Don't silently bypass.

**Equivalence table** (read left-to-right; if you reach for the left, use the right instead):

| ❌ Direct file access | ✅ Dogfood path |
|---|---|
| `cat agents/<slug>/runs/<run>/run.json` | `minih status <slug> --run <run>` |
| `cat agents/<slug>/runs/<run>/state/inside.json` | `minih inside state get <slug> --run <run>` |
| `cat agents/<slug>/runs/<run>/state/outside.json` | `minih outside state get <slug> --run <run>` |
| `cat .../state/{inside,outside}.json` (both at once) | `minih state get <slug> --run <run>` |
| `cat agents/<slug>/runs/<run>/state/history.ndjson` | (no CLI surface — missing; file as MW) |
| `cat agents/<slug>/runs/<run>/inbox/inside/messages.ndjson` | `minih inside inbox list <slug> --run <run>` |
| `cat agents/<slug>/runs/<run>/inbox/outside/messages.ndjson` | `minih outside inbox list <slug> --run <run>` |
| `tail -f .../events.ndjson` | `minih tail <slug> --run <run>` (follow is default) |
| `tail .../events.ndjson \| head -N` | `minih tail <slug> --run <run> --snapshot --lines N` |
| `cat .../output/report.json` | `minih last-run <slug>` then `minih validate <slug> --file <path>`; for inspect, `minih retros --slug <slug>` |
| `ls agents/<slug>/runs/` | `minih history <slug>` |
| Reading any prompt assembly | `minih inspect <slug>` |
| Watching a run live (read-only) | `minih view <slug>` |
| Following a run live AND chiming in | `minih attach <slug>` (FX008 — coordinated agents only; Ctrl-C detaches) |

### When the CLI gap matters

If you find yourself wanting to read a file the CLI doesn't expose:
1. **Stop.** Don't `cat` silently.
2. **Raise it** with the user. State the gap precisely: "I want X; minih doesn't expose it."
3. **File it** as a magicWand or fix dossier in the active plan's deferred-follow-ups section — that's the encode step.
4. **Then** decide with the user whether to `cat` the file once as an emergency unblock OR to ship the CLI surface first.

The infrastructure improvement IS the work. Going around it is the failure mode.

### Self-check before a `cat`/`jq`/`tail`

Ask: "Could `minih X` answer this?" If yes, use that. If no, the gap is the answer — file it.

---

## Engineering harness — session start

**Start every session with `harness boot --json`.** minih's engineering harness runs on the global harness-core CLI — always bare `harness` (the `engh` alias also works); **never `npm install` it into this repo**. Boot runs five read-only sensors (lint, typecheck, build+test, minih doctor, audit) and returns one JSON envelope: `ok` / `degraded` (workable-with-awareness — read `next_action` for the named caveats) / `error` (fix the named sensor before feature work). For orientation, run `harness instructions` (then `harness instructions boot`). The governance contract lives at [`.harness/engineering-harness.md`](.harness/engineering-harness.md).

**File friction the moment it bites**: `harness observe "<what>" --kind <kind>` — one silent line into gitignored scratch (`.harness/temp/`); it round-trips to a committed record at retro time via `harness record retro --slug <plan-slug>`.

If the eng-harness skills are missing from your agent CLI: `npx skills@latest add AI-Substrate/harness-engineering -a claude-code -g -y`.

Deep guide — loop narrative, friction lifecycle, narrow gates, copy-paste validation: [`docs/how/engineering-harness.md`](docs/how/engineering-harness.md).

---

## Build, Test, Lint

```bash
just fft                    # Full quality gate: lint → format → build → typecheck → test → audit
npm run build               # TypeScript compile + copy schemas to dist/
npm test                    # Run all tests (vitest)
MINIH_REGRESSION=1 npm test  # Include slow doctor/list baseline regression
npx vitest run test/runner/runner.test.ts           # Single test file
npx vitest run -t "validates output"                # Single test by name
npx vitest run test/cli/outside-context.test.ts test/cli/init-coordinated.test.ts test/cli/doctor-outside-md.test.ts  # Coordination CLI docs/contracts
MINIH_E2E=1 npx vitest run test/e2e/two-agent-coordination.test.ts test/e2e/daemon-light.test.ts  # Opt-in coordination e2e
MINIH_PGREP=1 npx vitest run test/mcp/leak-regression.test.ts  # Opt-in MCP cleanup gate
npx biome check .           # Lint + format check
npx biome check --write .   # Auto-fix lint/format issues
```

### Pre-commit / pre-push gate

**ALWAYS run `just fft` before `git commit` and before `git push`.** The pipeline is the contract — lint, format, build, typecheck, test, audit. If any step fails, fix it before committing.

The backward-compatibility regression for all existing agents is gated behind `MINIH_REGRESSION=1` because it shells out to the built CLI and compares `doctor`/`list` output against the P1 baselines. Run `npm run build` first when invoking that gate directly.

**Own every finding.** Anything `fft` surfaces is ours, regardless of which file it lives in. Don't dismiss a lint warning, type error, or test failure as "pre-existing" or "unrelated to my change" — if our pipeline turns it up, our PR fixes it. If the noise is genuinely out-of-scope for the current change, raise it explicitly with the user before deciding to defer; never commit past it silently. Audit findings (transitive deps) follow the same rule: surface and decide, don't ignore.

### Globally-linked `minih` reflects this checkout

The `minih` binary on `$PATH` is symlinked from `~/.npm-global/bin/minih` to `dist/cli/index.js` in this repo (via `npm link`, set up once by `just install`). That means **every `minih ...` invocation runs whatever is currently in this repo's `dist/`** — no install step needed.

What's NOT automatic: rebuilding `dist/` after source edits. Watching/auto-build is intentionally off. The contract is: **edit source → run `just build` (fast) or `just fft` (full gate) → global `minih` reflects your changes**. If `minih` behaves like an older version, run `just build` first; you don't need to re-link.

```bash
just build         # tsc + copy schemas (~2s) — quick rebuild during iteration
just fft           # full gate — required before every commit/push
```

### Companion-mode is mandatory when editing code

**Whenever you (the AI) are editing source code, a `code-review-companion` MUST be running** as a Power-On-Mode peer. This catches drift, finds bugs, and turns the live feedback loop into a paid-for review pass. See [`docs/how/companion-mode.md`](docs/how/companion-mode.md) for the full protocol.

**Either you or the user may start the companion.** Always check first — don't assume:

```bash
# Check whether one is already running
RUN=$(minih status code-review-companion 2>/dev/null | jq -r '.data | select(.verdict == "active") | .runId')
if [ -z "$RUN" ]; then
  # First-time setup: install the companion if it isn't in this project yet.
  # Idempotent — re-running upgrades from upstream.
  if [ ! -d agents/code-review-companion ]; then
    minih agent install code-review-companion
  fi

  # No active run — start one. Requires GH_TOKEN in the spawning shell env.
  export GH_TOKEN=$(gh auth token)   # set this once if you don't have it
  minih run code-review-companion &
  sleep 12
  RUN=$(minih status code-review-companion 2>/dev/null | jq -r '.data.runId')
fi
echo "Companion run: $RUN"
```

`minih agent install` copies the canonical companion's manifest-listed files (prompt, instructions, schemas) into `agents/code-review-companion/` and writes a provenance sidecar. Install once per project; subsequent `install` invocations upgrade idempotently. See [`docs/how/agent-pack.md`](docs/how/agent-pack.md) for the full agent-pack surface.

The `verdict: 'active'` filter is load-bearing — `minih status` defaults to "latest run" which may be a completed one from a prior session.

**Then brief it once at session start**:
- Plan/spec/dossier paths
- The protocol you'll follow (review-request at every commit; fire-and-forget)
- Hazards specific to this work

**Then ping it at every commit boundary** with `outside inbox send --type task --subject "review-request: <topic> <sha>" --body "Diff: git show <sha>. ..."`. Fire-and-forget; the companion replies only if it finds issues.

**To watch it live** in another terminal: `minih view code-review-companion` — read-only TUI, attaches cross-process, renders inbox + state + transcript.

**To watch AND chime in live** (FX008): `minih attach code-review-companion` — same TUI plus footer input writes to the outside inbox. Ctrl-C **detaches** without stopping the agent. Multiple operators may attach simultaneously; messages land in arrival order via append-only file semantics.

**Before reporting back to the user, send `control:stop`** and read the farewell envelope via the dogfood path — `minih retros --slug code-review-companion` (lists retros across runs) or `minih validate code-review-companion --file <output-path>` after `minih last-run code-review-companion`. **Fold any open findings into your final summary.** (Power-On-Mode protocol — without this, the auto-harvested retro misses your session's signal. Companion F002 reminder: do NOT `cat agents/<slug>/runs/<run>/output/report.json` directly — that contradicts the dogfood rule above. If the CLI surface doesn't expose what you need, file it as a magicWand per the "When the CLI gap matters" procedure rather than bypassing.)

**Common gotchas:**
- `E122 GH_TOKEN not set` on `minih run` — the spawning shell needs `GH_TOKEN`. Set with `export GH_TOKEN=$(gh auth token)`. The Copilot CLI's runtime doesn't always inherit it; explicit export is reliable.
- `peer.verdict: 'dead'` after the companion has been quiet for >30min — known false positive when it's working a non-coordinated tool call. Verify by checking `currentlyRunningTool` and `selfReportedState` — both being non-null is a strong "it's alive" signal.
- **Companion check-in question** (plan 019): if you booted a companion and it sends you a `question:'still-needed'` message asking "do you have a task, or shall I stand down?" — that's the new check-in protocol. Reply with a `task` to keep it alive, `control:stop` to release it cleanly, or ignore it (companion will exit with `no_engagement` or `idle_budget` after `replyWaitPolls`). See [`docs/how/companion-mode.md` § Lifecycle and check-in protocol](docs/how/companion-mode.md#lifecycle-and-check-in-protocol).

## Architecture

Four domains with strict import direction: `cli → {mcp, runner, adapter}`, `mcp → runner`, `runner → adapter` (never upward).

- **adapter** (`src/adapter/`) — Wraps `@github/copilot-sdk` behind `IAgentAdapter` interface. Tests use `FakeAgentAdapter` instead of the real SDK. Only `sdk-copilot.ts` and `sdk-runtime.ts` touch the SDK.
- **runner** (`src/runner/`) — Pure orchestration: prompt assembly, coordination file helpers/forwarders/snapshots, execution via adapter, event streaming to NDJSON, output validation (AJV), artifact writing. Zero SDK or MCP imports.
- **mcp** (`src/mcp/`) — Inside-only coordination MCP server: hidden baked context, six inbox/state tools, private spawn config, MCP server/spawn/leak tests. No public `minih serve --mcp`.
- **cli** (`src/cli/`) — Commander.js commands and composition root. Each command in `src/cli/commands/`. JSON envelopes go to stdout (`formatSuccess`/`formatError`), human-readable output goes to stderr. CLI wires the SDK adapter and inside MCP spawn factory.

The runner never imports from cli or mcp. The adapter never imports from runner, cli, or mcp. Cross-domain communication uses public contracts such as `IAgentAdapter`; CLI owns cross-domain composition.

## Key Conventions

- **ESM-only**, TypeScript strict mode, single quotes, 2-space indent (Biome enforced)
- **Hand-roll simple utilities** rather than adding dependencies (frontmatter parser, YAML parser, Levenshtein distance)
- **Fresh AJV instance per validation call** — no caching, simplicity over performance
- **CRLF normalization** — `parseFrontmatter()` normalizes `\r\n` → `\n` before parsing (Windows support)
- **Output convention** — all CLI commands write JSON envelopes to stdout and human-readable tables/pretty output to stderr. Use `exitWithEnvelope()` for consistent output.
- **Agent CWD isolation** — agent runs execute in a run folder, not the project root. The SDK `workingDirectory` is set to the run folder to keep session artifacts isolated.
- **`prepare` script** — `npm run build` runs on install. Build scripts use Node.js APIs (not shell commands) for Windows compatibility.
- **Conventional commits** — `feat:`, `fix:`, `docs:`, `ci:` prefixes. release-please automates versioning from these.

## Agent Structure

Agents are folders under `agents/` with at least `prompt.md` (YAML frontmatter required). Optional: `output-schema.json`, `instructions.md`, `input-schema.json`. Coordinated agents may also include `outside.md`, `inside-state.schema.json`, and `outside-state.schema.json`; enable them with `coordination: enabled` frontmatter. See `agents/coordination-smoke-test/outside.md` for the canonical outside contract example.

Prompt assembly order for non-coordinated agents: preamble → instructions → output path hint → input params → prompt body → system output requirements (joined with `\n\n---\n\n`). Coordinated fresh runs use `buildInsidePreamble()` to add identity, tool, peer-contract, and pre-completion checklist sections; resume turns skip prompt assembly and send only the follow-up message.

Outside/inside split: outside callers use CLI commands (`outside-context`, `outside-send`, `outside-inbox-list`, `state get/set`, `outside-retro`, `retros`) against runner-managed inbox/state files. Inside agents use MCP tools (`inbox_list`, `inbox_send`, `inbox_ack`, `state_get`, `state_set`, `state_transition`) during the live run. Do not describe outside CLI commands as directly invoking MCP tools.

## Testing

Tests mirror `src/` structure in `test/`. Runner tests use `FakeAgentAdapter` (never the real SDK). CLI command tests use `execSync` against the built CLI. Validators have dedicated tests including fuzzy matching (Levenshtein).

For coordination changes, choose the narrow gate:
- Outside CLI/scaffold/doctor docs: `npx vitest run test/cli/outside-context.test.ts test/cli/init-coordinated.test.ts test/cli/doctor-outside-md.test.ts`
- Runner lifecycle/forwarders/snapshots: `npx vitest run test/runner/preamble-builder.test.ts test/runner/runner-event-driven.test.ts test/runner/inbox-forwarder.test.ts test/runner/state-forwarder.test.ts test/runner/run-folder-snapshot.test.ts`
- MCP server/spawn: `npx vitest run test/mcp/server.test.ts test/mcp/server-dispatch.test.ts test/mcp/spawn.test.ts`
- Opt-in e2e/leak gates: `MINIH_E2E=1 npx vitest run test/e2e/two-agent-coordination.test.ts test/e2e/daemon-light.test.ts`; `MINIH_PGREP=1 npx vitest run test/mcp/leak-regression.test.ts`
