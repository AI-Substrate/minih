# Domain Registry

| Domain | Owner | Status | Purpose |
|--------|-------|--------|---------|
| adapter | minih | Active | SDK boundary: wraps copilot-sdk sessions, emits normalized events, exposes `SessionSender`, and keeps SDK lifecycle details out of runner |
| runner | minih | Active | Core orchestration: agent discovery, prompt/preamble assembly, execution, event handling, coordination file helpers, daemon-light forwarders, snapshots, artifact writing |
| mcp | minih | Active | Inside-only coordination MCP server: nine backend-safe inbox/state/introspection tools (`inbox_list`, `inbox_send`, `inbox_ack`, `state_get`, `state_set`, `state_transition`, `wait_for_any`, `permission_status`, `coordination_status`), hidden baked context, private spawn config, cleanup/leak regression |
| cli | minih | Active | User-facing composition root: run/resume/connect/list/doctor/check/history/tail/status/inspect/difficulties plus coordinated scaffolding, outside peer commands (incl. `companion status`, the outside twin of the `coordination_status` MCP tool), and MCP server wiring |
| measurement | minih | Active | Conceptual measurement contract: metric vocabulary, traceability, proof levels, scorecard categories, authority/redaction rules, benchmark semantics, pulse semantics, and reporting guardrails |
| eng-harness | minih | Active | Session-level dev-loop harness on harness-core: `.harness/` substrate (governance, composite boot, friction capture, committed retro records), AGENTS.md routing, zero inbound edges — observes minih only via CLI envelopes at the process boundary |
