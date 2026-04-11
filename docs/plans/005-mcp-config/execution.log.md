# Execution Log — 005 MCP Config Support

## T001: Extend adapter types — DONE
Added `configDir?` and `mcpServers?` to `CopilotSessionConfig`, `CopilotResumeSessionConfig`, and `AgentRunOptions`.

## T002: Extend runner types + loader — DONE
Added `configDir?` and `mcpServers?` to `AgentRunConfig`. Created `loadMcpConfig()` helper in folder.ts with fail-fast validation (file exists, valid JSON, has mcpServers property). Exported from runner/index.ts.

## T003: Forward MCP in SdkCopilotAdapter — DONE
Added `configDir` and `mcpServers` to destructuring in `run()`. Spread into both `createSession()` and `resumeSession()` calls using existing conditional spread pattern.

## T004: Thread MCP through runAgent() — DONE
Added mutually exclusive logic (DYK #1): if `config.mcpServers` is set, send that only. Otherwise send `configDir` defaulting to `config.cwd` (project root). This ensures auto-discovery works for all projects without explicit config.

## T005: Add --mcp-config to CLI commands — DONE
- `run.ts`: Added `--mcp-config <path>` flag, fail-fast validation via loadMcpConfig(), mutually exclusive configDir/mcpServers in AgentRunConfig
- `resume.ts`: Same pattern
- `quickstart.ts`: Auto-discovery only (configDir set to cwd)

## T006: Show MCP in inspect — DONE
Added MCP config source detection (auto-discovery from .mcp.json or "none") to the Runtime Environment section in inspect command output and JSON envelope.

## T007: Create MCP test stub — DONE
`scripts/mcp-test-server.js`: ~140 lines, zero deps, Content-Length framed JSON-RPC. Two tools (echo + add). --help flag. Verified with spawn test that initialize returns correct response.

## T008: Unit tests — DONE
`test/runner/mcp.test.ts`: 7 tests — loadMcpConfig (valid, missing, invalid JSON, missing mcpServers), FakeAgentAdapter with configDir/mcpServers/no-config. All pass.

## T009: mcp-smoke-test agent — DONE
Created `agents/mcp-smoke-test/` with prompt.md and output-schema.json. Tests echo + add tools, reports structured pass/fail.

## T010: .mcp.json + docs — DONE
Created `.mcp.json` at project root pointing to test stub. Updated AGENTS_README (CLI reference + agent table) and README (run flags table) with --mcp-config.

## T011: Verify — DONE
114 tests pass (7 new). 9 agents detected by doctor. Build clean. MCP stub responds to JSON-RPC correctly.

## Summary
- 17 files changed across adapter, runner, cli domains + test infra + dogfood + docs
- 114 tests (7 new MCP tests)
- Zero breaking changes — all existing tests pass, FakeAgentAdapter unaffected
