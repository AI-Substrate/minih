# Research Report: MCP Config Support in minih Sessions

**Generated**: 2026-04-10T01:40:00Z
**Research Query**: "Load project MCP config in minih run sessions (issue #9)"
**Mode**: Plan-Associated (005-mcp-config)
**Findings**: 28 across 4 subagents

## Executive Summary

### What's Missing
minih creates SDK sessions without forwarding MCP configuration. Agents only see built-in tools — any MCP servers defined in the project are invisible. The SDK already supports `configDir` and `mcpServers` on both `SessionConfig` and `ResumeSessionConfig` — we just don't pass them through.

### The Fix
Thread MCP config through 7 files in the existing data flow chain. Two modes:
1. **Auto-discovery** (primary): Pass `configDir` so the SDK discovers `.mcp.json` / `~/.copilot/mcp-config` automatically
2. **Explicit override**: `--mcp-config <path>` CLI flag to load a specific MCP config file

### Impact
- **Adapter domain**: Extend session config types, forward MCP fields to createSession/resumeSession
- **Runner domain**: Thread MCP fields through AgentRunConfig → AgentRunOptions
- **CLI domain**: Add `--mcp-config` flag to run/resume/quickstart commands

## Current Data Flow (No MCP)

```
CLI flag → AgentRunConfig → runAgent() → AgentRunOptions → IAgentAdapter.run() → SdkCopilotAdapter.run() → createSession()
```

Each hop currently passes: `model`, `reasoningEffort`, `cwd`, `timeout`, `sessionId`, `prompt`

MCP config is **absent at every level**.

## SDK MCP API (What's Available)

### SessionConfig (createSession)
```typescript
interface SessionConfig {
  configDir?: string;                           // Override config discovery root
  mcpServers?: Record<string, MCPServerConfig>; // Explicit MCP servers
  // ... plus model, reasoningEffort, workingDirectory, etc.
}
```

### ResumeSessionConfig (resumeSession)
Also accepts `configDir` and `mcpServers` — same fields via `Pick<SessionConfig, ...>`.

### MCPServerConfig Shape
```typescript
interface MCPLocalServerConfig {
  type?: "local" | "stdio";
  command: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
  tools: string[];
  timeout?: number;
}

interface MCPRemoteServerConfig {
  type: "http" | "sse";
  url: string;
  headers?: Record<string, string>;
  tools: string[];
  timeout?: number;
}

type MCPServerConfig = MCPLocalServerConfig | MCPRemoteServerConfig;
```

### Auto-Discovery Convention
The SDK/CLI discovers MCP config from:
- `~/.copilot/mcp-config` (user-level)
- `.mcp.json` in working directory (project-level, walked up to git root)
- `.vscode/mcp.json` (VS Code convention)
- `.devcontainer/devcontainer.json` (devcontainer convention)

`configDir` overrides the discovery root. If not set, no user-level config is loaded.

## Files Requiring Changes

| # | File | Domain | Change |
|---|------|--------|--------|
| 1 | `src/cli/commands/run.ts` | cli | Add `--mcp-config` flag |
| 2 | `src/cli/commands/resume.ts` | cli | Add `--mcp-config` flag |
| 3 | `src/cli/commands/quickstart.ts` | cli | Forward MCP config if present |
| 4 | `src/runner/types.ts` | runner | Add `configDir?`, `mcpConfigPath?` to `AgentRunConfig` |
| 5 | `src/runner/runner.ts` | runner | Forward MCP fields to adapter.run() |
| 6 | `src/adapter/events.ts` | adapter | Add `configDir?`, `mcpServers?` to `AgentRunOptions` |
| 7 | `src/adapter/copilot-types.ts` | adapter | Add `configDir?`, `mcpServers?` to session config types |
| 8 | `src/adapter/sdk-copilot.ts` | adapter | Forward to createSession/resumeSession |

## Design Decisions

### D1: configDir vs mcpServers
- **configDir**: Let the SDK discover MCP config automatically. Simplest — just pass the project root or `~/.copilot` path.
- **mcpServers**: Explicit server map. Requires parsing the config file ourselves.
- **Recommendation**: Support both. Default to `configDir` auto-discovery. `--mcp-config` loads a file and passes as `mcpServers`.

### D2: Default Behavior
The issue says "MCP configuration is not forwarded." Options:
- **Option A**: Always pass `configDir` pointing to the project root (auto-discovers `.mcp.json`)
- **Option B**: Only pass config when `--mcp-config` is explicitly provided
- **Option C**: Auto-discover from project root by default, override with `--mcp-config`
- **Recommendation**: Option C — auto-discover by default (just works), explicit flag for overrides.

### D3: IAgentAdapter Interface
The `IAgentAdapter` interface doesn't need method signature changes. MCP config goes into `AgentRunOptions` (the existing options bag). `FakeAgentAdapter` in tests simply ignores MCP fields.

### D4: CWD Isolation Interaction
minih sets `workingDirectory` to the run folder for session isolation. But MCP auto-discovery walks from `workingDirectory` up to git root. Since run folders are inside the project tree (`agents/<slug>/runs/<id>/`), auto-discovery should still find `.mcp.json` at project root. **No conflict.**

## Prior Learnings

### PL-01: SDK Session Config Threading Pattern
**Source**: docs/plans/001-setup, Phase 3
The existing pattern for adding session options is well-established: add to `AgentRunOptions` → thread through `runAgent()` → forward in `createSession()`. Model, reasoningEffort, and workingDirectory all followed this exact path. MCP config should follow the same pattern.

### PL-02: MCP Server is Post-V1
**Source**: docs/plans/001-setup/workshops/002-cli-command-design.md
`minih serve --mcp` (minih AS an MCP server) is explicitly post-V1. This issue (#9) is different — it's about minih CONSUMING MCP servers during agent runs. No conflict.

### PL-03: Session Isolation + configDir
**Source**: docs/plans/001-setup/workshops/005-session-isolation-cwd-strategy.md
CWD is set to the run folder for isolation. configDir is independent of workingDirectory — it tells the SDK where to find config files, not where to run. Can safely set `configDir` to project root while keeping `workingDirectory` as the run folder.

## Domain Placement

| Change | Domain | Rationale |
|--------|--------|-----------|
| CLI flag parsing | cli | User-facing input |
| Config resolution (file → object) | runner | Orchestration concern |
| AgentRunConfig/AgentRunOptions types | runner + adapter | Shared contract |
| Session config forwarding | adapter | SDK integration |

## Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| MCP servers fail to start in CI (no local tools) | Agent degradation | MCP is optional — SDK handles missing servers gracefully |
| configDir pointing to run folder misses project .mcp.json | MCP not discovered | Set configDir to project root, not run folder |
| Breaking FakeAgentAdapter | Test failures | FakeAgentAdapter ignores unknown options — no change needed |
| MCP server startup adds latency to agent runs | Slower cold start | Acceptable — MCP servers are user-requested |

## Next Steps

1. Run `/plan-1b-specify` to create formal spec
2. Implementation is ~8 file changes, CS-2 complexity

---

**Research Complete**: 2026-04-10T01:40:00Z
**Report Location**: docs/plans/005-mcp-config/research-dossier.md
