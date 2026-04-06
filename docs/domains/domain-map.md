# Domain Map

```
cli --listAgents, resolveAgent, findRunSession, runAgent, validate*, display*--> runner
cli --SdkCopilotAdapter, ICopilotClient--> adapter
runner --IAgentAdapter, AgentEvent, AgentResult--> adapter
```

- **cli** depends on **runner** (agent discovery, execution, session lookup, validation, display) and **adapter** (SdkCopilotAdapter instantiation in shared SDK runtime)
- **runner** depends on **adapter** (IAgentAdapter interface, AgentEvent types, AgentResult)
- **adapter** has no internal domain dependencies (only external: @github/copilot-sdk)

Import direction: `cli → runner → adapter`. No upward imports.
