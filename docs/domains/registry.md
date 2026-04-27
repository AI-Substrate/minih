# Domain Registry

| Domain | Owner | Status | Purpose |
|--------|-------|--------|---------|
| adapter | minih | Active | SDK boundary: wraps copilot-sdk sessions, emits normalized events, exposes `SessionSender`, and keeps SDK lifecycle details out of runner |
| runner | minih | Active | Core orchestration: agent discovery, prompt/preamble assembly, execution, event handling, coordination file helpers, daemon-light forwarders, snapshots, artifact writing |
| mcp | minih | Active | Inside-only coordination MCP server: six backend-safe inbox/state tools, hidden baked context, private spawn config, cleanup/leak regression |
| cli | minih | Active | User-facing composition root: run/resume/connect/list/doctor/check/history/tail/status/inspect/difficulties plus coordinated scaffolding, outside peer commands, and MCP server wiring |
