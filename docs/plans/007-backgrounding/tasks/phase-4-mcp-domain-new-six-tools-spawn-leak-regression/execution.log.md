# Execution Log — Phase 4: MCP Domain (NEW)

**Plan**: [coordination-plan.md](../../coordination-plan.md)  
**Phase**: Phase 4: MCP Domain (NEW) — six tools + spawn + leak regression  
**Started**: 2026-04-26

---

## Pre-Phase Validation

| Check | Status | Evidence |
|-------|--------|----------|
| Harness | Unavailable | `docs/project-rules/harness.md` is absent; standard repo testing applies. |
| Baseline tests | Passed | `npm test -- --run` passed: 305 passed, 4 skipped. |

---

## T001 — Add MCP SDK dependency and executable build artifact support

**Status**: In progress  
**Started**: 2026-04-26

### Plan

- Install `@modelcontextprotocol/sdk` with npm so `package.json` and `package-lock.json` remain synchronized.
- Verify TypeScript can resolve the MCP SDK imports.
- Prefer the existing ESM build path; only add copied runtime artifacts if the SDK/server implementation proves it necessary.

### Evidence

- `npm install @modelcontextprotocol/sdk` completed successfully, updated `package.json` and `package-lock.json`, and reported 0 vulnerabilities.
- `npm run build` passed after install.

### Discovery

The repo is ESM-only (`"type": "module"`) and `tsc` emits `src/**/*.ts` into `dist/`. No `copy-schemas.js` change is needed for T001 because the future `src/mcp/server.ts` entry will naturally compile to `dist/mcp/server.js`; a copied CJS shim remains deferred unless later MCP server tests require it.

**Status**: Complete

---

## T010 — Register the new MCP domain, document exports, and run quality gates

**Status**: In progress  
**Started**: 2026-04-26

### Plan

- Create `docs/domains/mcp/domain.md` and update registry/map dependency documentation.
- Document the opt-in `MINIH_PGREP=1` leak gate alongside the existing daemon-light opt-in gate.
- Run the phase quality gates and update plan-level flight status when landed.

### Evidence

- Added `docs/domains/mcp/domain.md`.
- Updated `docs/domains/registry.md`, `docs/domains/domain-map.md`, `docs/domains/runner/domain.md`, `docs/domains/cli/domain.md`, `CONTRIBUTING.md`, and plan-level flight status.
- Ran `npx biome check --write .`; it formatted the new/changed files.
- `just fft` passed: biome check, biome format, build, typecheck, vitest suite (355 passed, 8 skipped), and audit (0 vulnerabilities).

### Discovery

The domain map needed to move from a single linear dependency summary to the explicit sibling graph: `cli → mcp`, `cli → runner`, `cli → adapter`, `mcp → runner`, and `runner → adapter`.

**Status**: Complete

---

## T009 — Add real JSON-RPC MCP server integration coverage for all six tools

**Status**: In progress  
**Started**: 2026-04-26

### Plan

- Add a tmpdir-backed MCP test client helper using the SDK stdio client transport.
- Spawn the real built server via the T006 spawn config.
- Verify `tools/list`, success calls for all six tools, and representative `_meta.code` errors.

### Evidence

- Added `test/mcp/helpers/test-client.ts`.
- Added real stdio server integration coverage in `test/mcp/server.test.ts`.
- `npx vitest run test/mcp/server.test.ts test/mcp/server-dispatch.test.ts` passed: 9 tests.
- `npm run build` passed.

### Discovery

The SDK client transport merges a safe default environment with the server entry env, so the T006 minimal env can remain small while still allowing `command: 'node'` resolution through `PATH`.

**Status**: Complete

---

## T008 — Add opt-in MCP cleanup/leak regression coverage

**Status**: In progress  
**Started**: 2026-04-26

### Plan

- Add a skipped-by-default `MINIH_PGREP=1` regression that uses the `minih-mcp-<runId>` process marker.
- Cover clean shutdown, startup failure, timeout cleanup, and SIGINT cleanup-equivalent paths.
- Use PID-specific process signaling only; no broad process killing.

### Evidence

- Added `test/mcp/leak-regression.test.ts`.
- Default run: `npx vitest run test/mcp/leak-regression.test.ts` skipped 4 tests as expected.
- `npm run build` passed.
- Opt-in run: `MINIH_PGREP=1 npx vitest run test/mcp/leak-regression.test.ts` passed 4 tests.

### Discovery

The leak regression can assert the cleanup invariant without broad process killing by inspecting the marker with `pgrep -fl` and signaling only the child PID that the test spawned.

**Status**: Complete

---

## T007 — Merge inside MCP server into coordinated runs without violating domain direction

**Status**: In progress  
**Started**: 2026-04-26

### Plan

- Add a runner-level generic factory seam so the runner never imports `mcp`.
- Let CLI compose the inside MCP spawn config for coordinated `run` and `resume`.
- Preserve user MCP servers while failing reserved `minih-coordination`, `inbox.*`, and `state.*` collisions clearly.

### Evidence

- Added `insideMcpServerFactory` and reserved tool-prefix config seam in `src/runner/types.ts`.
- Merged internal/user MCP servers in `src/runner/runner.ts` without importing the `mcp` domain.
- Wired CLI `run` and `resume` composition roots to `buildInsideMcpServerConfig(...)`.
- Added coexistence coverage in `test/mcp/coexist.test.ts`.
- `npx vitest run test/mcp/coexist.test.ts test/mcp/spawn.test.ts` passed: 11 tests.
- `npm run build` passed.

### Discovery

Existing `.mcp.json` auto-discovery is rooted at `config.cwd ?? process.cwd()`. Tests that are asserting absence of inside MCP need an explicit tmp `cwd`, otherwise the repo's own MCP config can legitimately flow into adapter options.

**Status**: Complete

---

## T006 — Build inside-channel spawn config with install-safe path resolution

**Status**: In progress  
**Started**: 2026-04-26

### Plan

- Build a `minih-coordination` MCP server entry with `node`, an absolute private server entry path, and minimal baked env.
- Reuse runner coordination env names for inbox/state/context and add only MCP-specific metadata.
- Prove dev/build/package path resolution with focused tests.

### Evidence

- Added spawn config builder/path resolver in `src/mcp/spawn.ts`.
- Added coverage in `test/mcp/spawn.test.ts` for entry shape, missing artifacts, empty node command, packaged sibling resolution, source-mode built-dist resolution, and missing build failure.
- `npx vitest run test/mcp/spawn.test.ts test/mcp/server-dispatch.test.ts` passed: 13 tests.
- `npm run build` passed.
- `npm pack --dry-run --json` completed after the package `prepare`/build path and was checked for MCP dist artifacts.

### Discovery

Install-safe resolution needs two paths: packaged runtime resolves `server.js` beside `dist/mcp/spawn.js`, while source/test runtime resolves the built `dist/mcp/server.js` from repo root. This keeps the server artifact private without making a public filename contract.

**Status**: Complete

---

## T005 — Implement the stdio MCP server and tool dispatcher

**Status**: In progress  
**Started**: 2026-04-26

### Plan

- Register/list exactly six MCP tools from the contract table.
- Dispatch tool calls to the inbox/state modules and preserve typed `_meta.code` errors.
- Add a stdio entrypoint that loads hidden context, sets the process marker, and closes cleanly on SIGTERM/SIGINT.

### Evidence

- Added stdio MCP server/dispatcher in `src/mcp/server.ts`.
- Added public MCP domain exports in `src/mcp/index.ts`.
- Added coverage in `test/mcp/server-dispatch.test.ts`.
- `npx vitest run test/mcp/server-dispatch.test.ts test/mcp/inbox.test.ts test/mcp/state.test.ts test/mcp/types.test.ts` passed: 37 tests.
- `npm run build` passed.

### Discovery

The dispatcher boundary must treat JSON-RPC `params.arguments` as untrusted records. Tool entrypoints now parse record-shaped arguments directly instead of assuming the server dispatcher has already narrowed them to the TypeScript input interfaces.

**Status**: Complete

---

## T004 — Implement state MCP tools without a minih rule engine

**Status**: In progress  
**Started**: 2026-04-26

### Plan

- Implement `state.get`, `state.set`, and `state.transition` over the existing runner state helpers.
- Validate statuses using the bundled inside-state schema or an agent-local `inside-state.schema.json`.
- Preserve the no-rule-engine boundary: transitions are schema/data validation plus history append only.

### Evidence

- Added state tool implementations in `src/mcp/tools/state.ts`.
- Added coverage in `test/mcp/state.test.ts` for inside defaults, peer reads, corrupt files, default schema enum validation, agent-local schema override, no-op transitions, history append, and history overflow.
- `npx vitest run test/mcp/state.test.ts test/mcp/types.test.ts` passed: 19 tests.
- `npm run build` passed.

### Discovery

Schema validation is best localized to the MCP boundary. This keeps `runner/state.ts` as the pure persistence layer while still allowing each agent to narrow or widen its inside statuses through an agent-local schema.

**Status**: Complete

---

## T003 — Implement inbox MCP tools with append-only NDJSON semantics

**Status**: In progress  
**Started**: 2026-04-26

### Plan

- Implement `inbox.list`, `inbox.send`, and `inbox.ack` as in-process functions over runner inbox paths.
- Treat peer and own-lane malformed/torn NDJSON as explicit errors instead of silently skipping data.
- Keep writes append-only and Phase-5-compatible for the future outside CLI reader.

### Evidence

- Added inbox tool implementations in `src/mcp/tools/inbox.ts`.
- Added coverage in `test/mcp/inbox.test.ts` for missing lanes, unread filtering, pagination, invalid inputs, malformed/torn lanes, large-inbox bounds, concurrent appends, and append shape.
- `npx vitest run test/mcp/inbox.test.ts test/mcp/types.test.ts` passed: 21 tests.
- `npm run build` passed.

### Discovery

The MCP tool path intentionally differs from the live runner forwarder: the forwarder can leave a torn final line for a later drain, but an MCP tool call must either return a complete snapshot or fail. `inbox.list` therefore treats torn lanes as `MCP_INBOX_CORRUPT`.

**Status**: Complete

---

## T002 — Define MCP domain contracts: context, tool schemas, result/error envelopes

**Status**: In progress  
**Started**: 2026-04-26

### Plan

- Add the `mcp` source/test scaffold and typed contracts for the six inside tools.
- Implement a context loader that consumes the runner coordination env names and validates canonical containment.
- Keep failure messages model-safe by redacting concrete env values, absolute paths, and private server artifact paths.

### Evidence

- Added MCP contracts/results in `src/mcp/types.ts`.
- Added inside context validation in `src/mcp/context.ts`.
- Added coverage in `test/mcp/types.test.ts`.
- `npx vitest run test/mcp/types.test.ts` passed: 10 tests.
- `npm run build` passed.

### Discovery

The first symlink-escape test exposed a real validation hole: if the expected `agents/<slug>/state` path is also dereferenced, an escaped symlink can compare equal to the escaped target. The fix compares the dereferenced actual path against the lexical canonical expected path.

**Status**: Complete

---

## Code Review Fixes — Phase 4 MCP Domain

**Status**: Complete  
**Started**: 2026-04-26

### Findings Addressed

- **F001 (`state.get` contract)**: Implemented default self+peer reads, `self`/`peer`/`both` aliases, and optional dot-path `key` reads. Added unit and real stdio JSON-RPC coverage.
- **F002 (`inbox.list` type filter)**: Added `type` to the tool input contract and exact message-type filtering, covered with unit and real stdio tests.
- **F003 (leak regression coverage)**: Reworked the opt-in `MINIH_PGREP=1` regression to drive a coordinated `runAgent` path with the production inside MCP spawn config, covering success, failure, timeout/terminate, and SIGINT-equivalent child cleanup.
- **F004 (state transition no-op comparison)**: Replaced `JSON.stringify` equality with order-insensitive stable serialization so semantically identical data does not append redundant history.

### Evidence

- `npm run build` passed.
- `npx vitest run test/mcp/inbox.test.ts test/mcp/state.test.ts test/mcp/server.test.ts test/mcp/leak-regression.test.ts` passed: 25 passed, 4 skipped.
- `MINIH_PGREP=1 npx vitest run test/mcp/leak-regression.test.ts` passed: 4 passed.
