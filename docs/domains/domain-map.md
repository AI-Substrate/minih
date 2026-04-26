# Domain Map

```
cli --listAgents, resolveAgent, findRunSession, runAgent, validate*, display*, detectContext, inbox/state helpers, ulid, RunLockHeldError, coordinated init/doctor contracts--> runner
cli --buildInsideMcpServerConfig--> mcp
cli --SdkCopilotAdapter, ICopilotClient--> adapter
mcp --inbox/state paths, state helpers, schemas, ulid--> runner
runner --IAgentAdapter, AgentEvent, AgentResult--> adapter
```

- **cli** depends on **runner** (agent discovery, execution, session lookup, validation, display, context detection, inbox/state path helpers, state persistence helpers, ULIDs, typed runner errors), **mcp** (inside MCP spawn config factory for coordinated runs), and **adapter** (SdkCopilotAdapter instantiation in shared SDK runtime)
- **mcp** depends on **runner** (coordination paths, state helpers, schemas, and shared coordination types)
- **runner** depends on **adapter** (IAgentAdapter interface, AgentEvent types, AgentResult)
- **adapter** has no internal domain dependencies (only external: @github/copilot-sdk)

Import direction: `cli → {mcp, runner, adapter}`, `mcp → runner`, `runner → adapter`. No upward imports; runner does not import mcp.
