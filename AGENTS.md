# Copilot Instructions — minih

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
