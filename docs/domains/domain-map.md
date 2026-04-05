# Domain Map

```
cli --listAgents, resolveAgent, runAgent, validate*, display*--> runner
cli --SdkCopilotAdapter, ICopilotClient--> adapter
runner --IAgentAdapter, AgentEvent, AgentResult--> adapter
```

- **cli** depends on **runner** (agent discovery, execution, validation, display) and **adapter** (SdkCopilotAdapter instantiation in composition root)
- **runner** depends on **adapter** (IAgentAdapter interface, AgentEvent types, AgentResult)
- **adapter** has no internal domain dependencies (only external: @github/copilot-sdk)

Import direction: `cli → runner → adapter`. No upward imports.
