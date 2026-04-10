# Copilot Instructions — minih

## Build, Test, Lint

```bash
just fft                    # Full quality gate: lint → format → build → typecheck → test → audit
npm run build               # TypeScript compile + copy schemas to dist/
npm test                    # Run all tests (vitest)
npx vitest run test/runner/runner.test.ts           # Single test file
npx vitest run -t "validates output"                # Single test by name
npx biome check .           # Lint + format check
npx biome check --write .   # Auto-fix lint/format issues
```

## Architecture

Three domains with strict import direction: `cli → runner → adapter` (never upward).

- **adapter** (`src/adapter/`) — Wraps `@github/copilot-sdk` behind `IAgentAdapter` interface. Tests use `FakeAgentAdapter` instead of the real SDK. Only `sdk-copilot.ts` and `sdk-runtime.ts` touch the SDK.
- **runner** (`src/runner/`) — Pure orchestration: prompt assembly (preamble + instructions + prompt + system requirements), execution via adapter, event streaming to NDJSON, output validation (AJV), artifact writing. Zero SDK imports.
- **cli** (`src/cli/`) — Commander.js commands. Each command in `src/cli/commands/`. JSON envelopes go to stdout (`formatSuccess`/`formatError`), human-readable output goes to stderr.

The runner never imports from cli. The adapter never imports from runner or cli. Cross-domain communication uses the `IAgentAdapter` interface contract.

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

Agents are folders under `agents/` with at least `prompt.md` (YAML frontmatter required). Optional: `output-schema.json`, `instructions.md`, `input-schema.json`. The shared preamble at `agents/_shared/preamble.md` is injected into every agent's prompt.

Prompt assembly order: preamble → instructions → output path hint → input params → prompt body → system output requirements (joined with `\n\n---\n\n`).

## Testing

Tests mirror `src/` structure in `test/`. Runner tests use `FakeAgentAdapter` (never the real SDK). CLI command tests use `execSync` against the built CLI. Validators have dedicated tests including fuzzy matching (Levenshtein).
