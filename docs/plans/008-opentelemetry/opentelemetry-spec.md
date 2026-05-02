# OpenTelemetry Instrumentation for minih

**Mode**: Simple

📚 This specification incorporates findings from [research-dossier.md](./research-dossier.md)

## Research Context

- minih is ESM-only; manual instrumentation avoids loader hook complexity
- OTel SDK reads standard env vars (`OTEL_EXPORTER_OTLP_ENDPOINT`, etc.) — no custom config parsing
- Telemetry must be opt-in (`MINIH_TELEMETRY=true`) to avoid overhead and respect CLI tool conventions
- Context propagation is automatic within async chains but needs manual handling at SDK event callbacks
- Grafana LGTM all-in-one container provides Tempo (traces), Mimir (metrics), Loki (logs), Grafana (UI) in a single image
- No auto-instrumentation libraries needed — minih has no HTTP server or database

## Summary

Add OpenTelemetry instrumentation (traces, metrics, logs) to minih with OTLP export, opt-in activation, centralized logger factory, and a local Grafana LGTM development stack. Every agent run produces a trace with child spans for prompt assembly, SDK execution, and validation. Metrics track run counts, durations, and tool call volumes. Structured logs correlate automatically with traces via trace ID.

**WHY**: As minih scales from dozens to hundreds of agent runs per day, debugging slow runs, flaky validations, or adapter timeouts requires more than NDJSON event files. Distributed tracing reveals exactly where time is spent. Metrics surface trends (are runs getting slower? are validations failing more?). Structured logs with trace correlation let you jump from a failed run straight to the relevant log context.

## Goals

- Instrument all three domains (cli, runner, adapter) with spans at key boundaries
- Record metrics for run duration, tool call count, validation pass/fail rate, and event throughput
- Provide a centralized logger factory that attaches module name, agent slug, run ID, and trace context to every log entry
- Export all signals via OTLP HTTP/protobuf to any OTel-compatible backend
- Use standard OTel environment variables for configuration — no minih-specific config files
- Provide a Docker Compose file with Grafana LGTM for local development
- Keep telemetry opt-in — zero overhead when disabled, zero behavior change for existing users
- Document how to enable, view, and debug using the telemetry stack
- Propagate context manually where the OTel SDK cannot do it automatically (event callbacks, cross-boundary callbacks)

## Non-Goals

- Auto-instrumentation of third-party libraries (no HTTP server, no DB)
- Custom OTel collector configuration or pipelines
- Production deployment guidance for OTel backends (focus is local dev)
- Telemetry for the agents themselves (agents run inside the copilot-sdk; minih instruments its own orchestration)
- Modifying the IAgentAdapter interface contract
- Replacing the pretty-mode display or NDJSON event stream (telemetry supplements, does not replace)
- Sampling configuration beyond OTel defaults (all spans exported in dev)

## Target Domains

| Domain | Status | Relationship | Role in This Feature |
|--------|--------|-------------|---------------------|
| telemetry (new) | new | **create** | SDK initialization, logger factory, span helpers, metric definitions |
| adapter | existing | **modify** | Add spans for session create/resume/send, propagate context into event handlers |
| runner | existing | **modify** | Add spans for prompt assembly, execution, validation; record run metrics |
| cli | existing | **modify** | Initialize telemetry, add root command span, shutdown on exit |

The new `src/telemetry/` module is an internal utility, not a new architectural domain. Import direction: all domains may import from `telemetry/`. The strict `cli → runner → adapter` direction is preserved — telemetry is a shared utility like `node:fs`.

## Complexity

- **Score**: CS-3 (medium)
- **Breakdown**: S=3 (new module + modifications across 3 domains), I=2 (new OTel dependencies), D=1 (context propagation complexity), N=0, F=0, T=2 (telemetry tests + integration verification)
- **Confidence**: 0.85
- **Assumptions**:
  - OTel SDK no-ops gracefully when provider not registered (documented behavior)
  - `AsyncLocalStorage`-based context propagation works across `await` boundaries in Node.js ≥ 20
  - LGTM container handles all three signals on a single OTLP endpoint
  - Manual instrumentation is sufficient (no auto-instrumentation needed)
- **Dependencies**: `@opentelemetry/api`, `@opentelemetry/sdk-node`, OTLP exporter packages
- **Risks**: Context loss in SDK event callbacks; OTel dependency size; ESM initialization ordering
- **Phases**: 3 phases — foundation/init, instrumentation, documentation/infra

## Acceptance Criteria

1. **AC1**: When `MINIH_TELEMETRY=true` and `OTEL_EXPORTER_OTLP_ENDPOINT` points to LGTM, `minih run hello-world` produces a trace visible in Grafana Tempo
2. **AC2**: The trace contains child spans for prompt assembly, SDK execution, and output validation
3. **AC3**: Metrics (run duration histogram, run counter, tool call histogram) appear in Grafana/Mimir
4. **AC4**: Structured logs from the logger factory appear in Grafana/Loki with trace_id correlation
5. **AC5**: Logger factory creates loggers with `module.name` attribute and automatically inherits active span context
6. **AC6**: Context propagation works through the `onEvent` callback chain — event handler spans are children of the run span
7. **AC7**: When `MINIH_TELEMETRY` is unset or `false`, no telemetry is emitted, no SDK is initialized, and no performance overhead exists
8. **AC8**: All existing tests pass without modification (telemetry disabled by default)
9. **AC9**: `docker compose up` starts the LGTM stack and minih can export to it
10. **AC10**: Documentation explains how to enable telemetry, start the LGTM stack, view traces/metrics/logs, and debug common issues
11. **AC11**: Spans include rich contextual attributes (agent slug, run ID, model, duration, result)
12. **AC12**: `IAgentAdapter` interface is unchanged — instrumentation is internal to each implementation

## Risks and Assumptions

| Risk | Impact | Mitigation |
|------|--------|-----------|
| OTel SDK initialization adds cold-start latency | Slower CLI startup (~50-100ms) | Only initialize when `MINIH_TELEMETRY=true`; lazy import OTel modules |
| Context lost in SDK event handler callbacks | Orphaned spans without parent | Capture `context.active()` before callback registration, use `context.with()` inside |
| Large OTel dependency tree | Slower install, larger node_modules | Use only required packages (no auto-instrumentations bundle) |
| ESM top-level import ordering | Telemetry misses early operations | Initialize at first line of CLI entry point before any command logic |
| LGTM container resource usage | Heavy for constrained dev machines | Document as optional; telemetry works with any OTLP endpoint |
| Span explosion from high-frequency events | Noisy traces, high export volume | Only create spans for significant operations, not per-event |
| Breaking FakeAgentAdapter in tests | Test failures | Telemetry off by default in tests; FakeAgentAdapter unchanged |
