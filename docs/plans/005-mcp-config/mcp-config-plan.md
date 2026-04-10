# MCP Config Support — Implementation Plan

**Mode**: Simple
**Plan Version**: 1.0.0
**Created**: 2026-04-10
**Spec**: [mcp-config-spec.md](./mcp-config-spec.md)
**Status**: DRAFT

## Summary

Thread `configDir` and `mcpServers` through minih's session creation chain so agents can access project MCP tools. Auto-discovery from project root by default (`.mcp.json` just works), `--mcp-config <path>` for explicit override. Includes an MCP test stub server and dogfood agent for validation.

## Target Domains

| Domain | Status | Relationship | Role |
|--------|--------|-------------|------|
| adapter | existing | modify | Extend session config types, forward configDir/mcpServers to SDK |
| runner | existing | modify | Thread MCP fields through AgentRunConfig → AgentRunOptions |
| cli | existing | modify | Add --mcp-config flag, resolve config, build test infra |

No new domains. No contract-breaking changes. IAgentAdapter interface unchanged.

## Domain Manifest

| File | Domain | Classification | Rationale |
|------|--------|---------------|-----------|
| `src/adapter/copilot-types.ts` | adapter | contract | Add configDir/mcpServers to session config types |
| `src/adapter/events.ts` | adapter | contract | Add configDir/mcpServers to AgentRunOptions |
| `src/adapter/sdk-copilot.ts` | adapter | internal | Forward new fields to createSession/resumeSession |
| `src/runner/types.ts` | runner | contract | Add configDir/mcpConfigPath to AgentRunConfig |
| `src/runner/runner.ts` | runner | internal | Thread MCP fields to adapter.run() call |
| `src/cli/commands/run.ts` | cli | internal | Add --mcp-config flag, resolve config, build AgentRunConfig |
| `src/cli/commands/resume.ts` | cli | internal | Add --mcp-config flag, forward to config |
| `src/cli/commands/quickstart.ts` | cli | internal | Forward configDir (auto-discovery) |
| `src/cli/commands/inspect.ts` | cli | internal | Show MCP config in environment section |
| `scripts/mcp-test-server.js` | — (test infra) | internal | Zero-dep MCP stub (echo tool) |
| `test/fixtures/mcp-config.json` | — (test) | internal | Unit test fixture |
| `test/runner/mcp.test.ts` | — (test) | internal | MCP threading tests |
| `agents/mcp-smoke-test/prompt.md` | — (dogfood) | internal | E2E MCP validation agent |
| `agents/mcp-smoke-test/output-schema.json` | — (dogfood) | internal | Structured pass/fail output |
| `.mcp.json` | — (test) | internal | Project-root MCP config for local testing |
| `README.md` | — (docs) | internal | Add --mcp-config to CLI reference |
| `AGENTS_README.md` | — (docs) | internal | Add --mcp-config to CLI reference, MCP section |

## Key Findings

| # | Impact | Finding | Action |
|---|--------|---------|--------|
| 01 | Critical | Adapter builds session config with explicit per-field construction — nothing auto-forwarded | T003: Add configDir/mcpServers explicitly to both createSession and resumeSession calls |
| 02 | Critical | runAgent() drops anything not explicitly mapped to adapter.run() | T004: Thread configDir/mcpServers through runAgent() |
| 03 | Critical | No config-loading utility exists in the codebase | T005: Create loadMcpConfig() helper or inline in CLI |
| 04 | Critical | SDK uses Content-Length framed JSON-RPC (vscode-jsonrpc), not line-delimited JSON | T007: Test stub MUST use Content-Length framing on stdin/stdout |
| 05 | High | CopilotSessionConfig/CopilotResumeSessionConfig lack MCP fields | T001: Extend both types |
| 06 | High | CLI commands construct AgentRunConfig without MCP fields | T005: Update run.ts, resume.ts, quickstart.ts |
| 07 | High | configDir is independent of workingDirectory — must point to project root for auto-discovery | T004: Default configDir to config.cwd |
| 08 | High | --mcp-config file format is `{mcpServers:{...}}` wrapper, not bare server map | T005: Parse file and extract .mcpServers only |
| 09 | High | Local MCP server `cwd` inherits SDK process cwd if not set explicitly | T007/T010: Set cwd in .mcp.json fixture |
| 10 | Medium | FakeAgentAdapter accepts AgentRunOptions bag without destructuring — safe to extend | No change needed |

## Implementation

**Objective**: Thread MCP config through session creation chain + build test/validation infrastructure
**Testing Approach**: Lightweight — unit tests for config threading with real fixtures, dogfood agent for E2E
**Complexity**: CS-2 (small)

### Tasks

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|--------|-----|------|--------|---------|-----------|-------|
| [ ] | T001 | Extend adapter types with MCP fields | adapter | `src/adapter/copilot-types.ts`, `src/adapter/events.ts` | `CopilotSessionConfig`, `CopilotResumeSessionConfig`, and `AgentRunOptions` all have optional `configDir` and `mcpServers` fields | AC7, AC8 |
| [ ] | T002 | Extend runner types + add MCP config loader | runner | `src/runner/types.ts` | `AgentRunConfig` has optional `configDir` and `mcpConfigPath` fields. Helper to load/parse MCP config file if `--mcp-config` provided | Per finding 03 |
| [ ] | T003 | Forward MCP fields in SdkCopilotAdapter | adapter | `src/adapter/sdk-copilot.ts` | `configDir` and `mcpServers` are spread into both `createSession()` and `resumeSession()` calls | Per finding 01. AC1, AC3 |
| [ ] | T004 | Thread MCP fields through runAgent() | runner | `src/runner/runner.ts` | `runAgent()` passes `configDir` and `mcpServers` from config to `adapter.run()`. `configDir` defaults to `config.cwd` (project root) when not explicitly set | Per finding 02. AC1, AC5 |
| [ ] | T005 | Add --mcp-config to CLI commands | cli | `src/cli/commands/run.ts`, `resume.ts`, `quickstart.ts` | All 3 commands accept `--mcp-config <path>`, load file, set mcpServers on AgentRunConfig. Auto-set configDir to project root | AC2, AC3, AC4, AC9 |
| [ ] | T006 | Show MCP config in inspect command | cli | `src/cli/commands/inspect.ts` | `minih inspect <slug>` shows MCP config source (auto-discovery / explicit file / none) in environment section | AC6 |
| [ ] | T007 | Create MCP test stub server | test infra | `scripts/mcp-test-server.js` | Stub responds to initialize, tools/list (echo tool), tools/call. Runs as stdio MCP server | Per workshop 001 |
| [ ] | T008 | Create unit tests for MCP threading | test | `test/runner/mcp.test.ts`, `test/fixtures/mcp-config.json` | Tests verify: configDir passes through, mcpServers passes through, no-config works, --mcp-config loads file | AC10 |
| [ ] | T009 | Create mcp-smoke-test dogfood agent | dogfood | `agents/mcp-smoke-test/prompt.md`, `output-schema.json` | Agent validates MCP tools are visible, calls echo tool, reports pass/fail | Per workshop 001 |
| [ ] | T010 | Create project .mcp.json + update docs | docs | `.mcp.json`, `README.md`, `AGENTS_README.md` | .mcp.json points to test stub. Both READMEs show --mcp-config in CLI reference. AGENTS_README has MCP section | AC9 |
| [ ] | T011 | Verify all tests pass + run dogfood agent | test | — | `npm test` passes (107+ tests), `minih run mcp-smoke-test` shows echoTestPassed: true | Manual gate |

### Acceptance Criteria

- [ ] AC1: `.mcp.json` at project root → MCP servers available to agent
- [ ] AC2: `--mcp-config path/to/config.json` loads MCP servers from file
- [ ] AC3: `minih resume` forwards MCP config
- [ ] AC4: `minih quickstart` works with MCP config (auto-discovery)
- [ ] AC5: No MCP config → works exactly as before (no errors)
- [ ] AC6: `minih inspect` shows MCP config in environment section
- [ ] AC7: `AgentRunOptions` has optional configDir/mcpServers
- [ ] AC8: `CopilotSessionConfig`/`CopilotResumeSessionConfig` have configDir/mcpServers
- [ ] AC9: `minih run --help` shows --mcp-config
- [ ] AC10: All existing tests pass

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| MCP server startup latency | Medium | Slower cold start | Acceptable — user opted in |
| Test stub needs Content-Length framing (not line-delimited) | Certain | Stub won't work with SDK if readline-based | T007: Use Content-Length framed JSON-RPC (SDK uses vscode-jsonrpc StreamMessageReader/Writer) |
| --mcp-config file must be wrapper format `{mcpServers:{...}}` | Certain | Wrong parse if treated as bare server map | T005: Parse file and extract `.mcpServers` property only |
| MCP server `cwd` inherits SDK process cwd, not workingDirectory | Medium | Stub runs in wrong directory | T007: Set explicit `cwd` in .mcp.json fixture pointing to project root |
| configDir from run folder misses .mcp.json | Low | Tools not discovered | T004 defaults configDir to project root (config.cwd) |
