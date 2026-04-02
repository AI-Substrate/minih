# Domain Map

```
cli → runner → adapter
```

- **cli** depends on **runner** (agent discovery, execution, validation) and **adapter** (SdkCopilotAdapter instantiation in composition root)
- **runner** depends on **adapter** (IAgentAdapter interface, AgentEvent types, AgentResult)
- **adapter** has no internal domain dependencies (only external: @github/copilot-sdk)

Import direction: `cli → runner → adapter`. No upward imports.
