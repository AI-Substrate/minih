# MCP Config Support in Agent Sessions

**Mode**: Simple

📚 This specification incorporates findings from research-dossier.md

## Research Context

- SDK already supports `configDir` and `mcpServers` on `SessionConfig` and `ResumeSessionConfig` — minih just doesn't forward them
- Auto-discovery convention: SDK walks from `workingDirectory` up to git root for `.mcp.json`, `.vscode/mcp.json`
- User-level config at `~/.copilot/mcp-config`
- No CWD isolation conflict: `configDir` is independent of `workingDirectory`
- Existing data flow pattern (model, reasoningEffort, workingDirectory) provides exact template for threading new fields
- 8 files need changes across all 3 domains

## Summary

Enable agents running via `minih run` to access MCP tools defined in project or user configuration. By default, minih should auto-discover MCP config from the project root (`.mcp.json`) so agents get the same tool surface they were designed for — without any flags. An optional `--mcp-config <path>` override allows pointing to a specific config file.

This removes the friction where agents degrade to shell-based workarounds because their intended MCP tools aren't available during minih sessions.

## Goals

- **MCP tools just work**: Agents see project MCP servers automatically when `.mcp.json` exists at the project root — zero configuration needed
- **Explicit override**: `--mcp-config <path>` flag for custom config files or non-standard locations
- **Resume support**: MCP config is forwarded on both fresh sessions and resumed sessions
- **No-MCP is fine**: Projects without MCP config continue to work exactly as before — no new requirements
- **Consistent pattern**: Follow the same threading pattern used for `model`, `reasoningEffort`, and `workingDirectory`

## Non-Goals

- minih AS an MCP server (`minih serve --mcp`) — explicitly post-V1 per workshop 002
- MCP server health checking or management
- MCP config editing or scaffolding commands
- Hot-reloading MCP config during a running session
- MCP OAuth flow handling (SDK handles this internally)

## Target Domains

| Domain | Status | Relationship | Role in This Feature |
|--------|--------|-------------|---------------------|
| adapter | existing | **modify** | Extend session config types, forward `configDir`/`mcpServers` to SDK createSession/resumeSession |
| runner | existing | **modify** | Thread MCP fields through AgentRunConfig → AgentRunOptions |
| cli | existing | **modify** | Add `--mcp-config` flag to run/resume/quickstart commands, resolve config path |

No new domains. This follows the existing cross-domain data flow pattern exactly.

## Complexity

- **Score**: CS-2 (small)
- **Breakdown**: S=2, I=1, D=0, N=0, F=0, T=1
- **Confidence**: 0.95
- **Assumptions**:
  - SDK handles MCP server lifecycle (start, stop, error recovery) — minih just passes config through
  - `configDir` pointing to project root enables auto-discovery of `.mcp.json`
  - FakeAgentAdapter ignores MCP fields without changes (options bag pattern)
- **Dependencies**: `@github/copilot-sdk >=0.2.1` (MCP support in SessionConfig)
- **Risks**: MCP server startup adds latency; projects without MCP config must not be affected
- **Phases**: Single phase — all changes follow the established threading pattern

## Acceptance Criteria

1. **AC1**: When a project has `.mcp.json` at the root, `minih run <slug>` creates a session with those MCP servers available to the agent
2. **AC2**: `minih run <slug> --mcp-config path/to/config.json` loads MCP servers from the specified file
3. **AC3**: `minih resume <slug>` forwards MCP config to the resumed session
4. **AC4**: `minih quickstart` works with MCP config (auto-discovery)
5. **AC5**: Projects without any MCP config continue to work exactly as before — no errors, no warnings
6. **AC6**: `minih inspect <slug>` shows the resolved MCP config (or "none") in the runtime environment section
7. **AC7**: `AgentRunOptions` type includes optional `configDir` and `mcpServers` fields
8. **AC8**: `CopilotSessionConfig` and `CopilotResumeSessionConfig` types include `configDir` and `mcpServers`
9. **AC9**: `minih run --help` shows the `--mcp-config` option
10. **AC10**: All existing tests continue to pass (FakeAgentAdapter unaffected)

## Risks & Assumptions

| Risk | Impact | Mitigation |
|------|--------|-----------|
| MCP servers fail to start (missing binaries, network issues) | Agent runs without expected tools | SDK handles gracefully; agents should degrade, not crash |
| configDir auto-discovery misses project config from run folder | MCP tools not available | Pass project root as configDir, not run folder |
| Breaking FakeAgentAdapter contract | Test failures | FakeAgentAdapter uses options bag — ignores unknown fields |
| MCP server startup adds latency to agent cold start | Slower first run | Acceptable — user opted in by having MCP config |
| SDK version dependency | Feature unavailable on older SDK | peerDependency already `>=0.1.32`; MCP support is in 0.2.x |

## Open Questions

None — all resolved in Clarifications session below.

## Testing Strategy

- **Approach**: Lightweight
- **Rationale**: Changes follow established pattern (type extension + field forwarding). Verify threading with FakeAgentAdapter fixtures.
- **Focus**: Confirm MCP fields pass through the full chain; existing tests unbroken
- **Mock Usage**: Avoid mocks — real fixtures only
- **Excluded**: E2E MCP server integration (SDK responsibility)

## Documentation Strategy

- **Location**: README.md + AGENTS_README.md
- **Rationale**: Add `--mcp-config` to CLI reference sections in both docs

## Workshop Opportunities

None identified — the implementation follows the exact pattern of existing session config threading (model, reasoningEffort, workingDirectory). No novel design decisions.

## Clarifications

### Session 2026-04-10

**Q1: Workflow Mode** → Simple (confirmed — CS-2, established pattern)

**Q2: Testing Strategy** → Lightweight — test threading with FakeAgentAdapter, real fixtures only, no mocks.

**Q3: Mock Usage** → Avoid mocks entirely — real data/fixtures only.

**Q4: Documentation Strategy** → README + AGENTS_README — add `--mcp-config` to CLI reference sections.

**Q5: --mcp-config scope** → File path only. `--mcp-config` points to a `.json` file. Auto-discovery via `configDir` handles directory-based config resolution.

**Q6: Doctor validation** → No. Don't validate MCP config files in `minih doctor`. Just forward to SDK and let it handle errors.

**Q7: Domain Review** → Confirmed. All 3 existing domains modified, no new domains, no contract-breaking changes. IAgentAdapter interface unchanged — MCP config goes in AgentRunOptions bag.
