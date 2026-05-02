# Research Dossier: OpenTelemetry Instrumentation for minih

**Generated**: 2026-05-02
**Research Query**: "Add OpenTelemetry tracing, metrics, and logs to minih with OTLP export and LGTM backend"
**Plan**: 008-opentelemetry

---

## Executive Summary

### What Exists Now

minih has zero observability instrumentation. The only runtime visibility is the NDJSON event stream (`events.ndjson`) and the pretty-mode display. There are no traces, no metrics, and no structured logs. Debugging agent runs requires reading raw event files or tailing stderr output. There's no way to correlate slow tool calls, adapter latency, or validation time across runs without manually inspecting artifacts.

### What We Want

Full OpenTelemetry instrumentation across all three domains (adapter, runner, cli) with:

- **Traces**: Spans for key operations (agent runs, prompt assembly, SDK calls, validation, tool calls) with rich contextual attributes and proper parent-child propagation
- **Metrics**: Counters and histograms for run durations, tool call counts, validation pass/fail rates, event throughput
- **Logs**: Structured log output via OTel Logs API, replacing ad-hoc `process.stderr.write` patterns, with automatic trace correlation
- **Export**: OTLP over HTTP/protobuf to a local Grafana LGTM (Loki, Grafana, Tempo, Mimir) all-in-one container
- **Configuration**: Standard OTel environment variables (`OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME`, etc.)

### Impact

- **New domain**: `src/telemetry/` — a new internal module (not a separate domain in the architecture sense; imported by all three domains)
- **All domains modified**: adapter, runner, and cli gain spans and metrics at key points
- **New dependencies**: `@opentelemetry/api`, `@opentelemetry/sdk-node`, OTLP exporters, `@opentelemetry/sdk-logs`
- **New infra**: Docker Compose for LGTM stack, documentation for viewing traces/metrics/logs

---

## OpenTelemetry JS Ecosystem

### Core Packages Required

| Package | Purpose |
|---------|---------|
| `@opentelemetry/api` | API surface (tracer, meter, logger acquisition) |
| `@opentelemetry/sdk-node` | All-in-one Node.js SDK (TracerProvider, MeterProvider, LoggerProvider) |
| `@opentelemetry/sdk-trace-node` | Node.js-specific trace SDK (BatchSpanProcessor) |
| `@opentelemetry/sdk-metrics` | Metrics SDK (PeriodicExportingMetricReader) |
| `@opentelemetry/sdk-logs` | Logs SDK (LoggerProvider, BatchLogRecordProcessor) |
| `@opentelemetry/exporter-trace-otlp-proto` | OTLP trace exporter (HTTP/protobuf) |
| `@opentelemetry/exporter-metrics-otlp-proto` | OTLP metrics exporter (HTTP/protobuf) |
| `@opentelemetry/exporter-logs-otlp-proto` | OTLP logs exporter (HTTP/protobuf) |
| `@opentelemetry/resources` | Resource attributes (service.name, service.version) |
| `@opentelemetry/semantic-conventions` | Standard attribute names |

### ESM Compatibility (Critical for minih)

minih is ESM-only (`"type": "module"` in package.json). Key considerations:

1. **SDK initialization must happen before app code** — use `--import ./telemetry.js` or initialize at the top of the CLI entry point
2. **Auto-instrumentation of third-party libraries requires a loader hook** — `--experimental-loader=@opentelemetry/instrumentation/hook.mjs` (Node.js ≥ 20)
3. **Manual instrumentation works without loader hooks** — since minih hand-rolls everything and the copilot-sdk is the only external dependency, manual instrumentation is sufficient
4. **Recommendation**: Initialize OTel SDK at the very top of `src/cli/index.ts` (before any other imports get executed). No loader hook needed for manual-only instrumentation.

### Environment Variable Configuration (Standard OTel)

The OTel SDK reads these env vars automatically — no custom config parsing needed:

| Variable | Default | Purpose |
|----------|---------|---------|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318` | OTLP collector endpoint |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `http/protobuf` | Transport protocol |
| `OTEL_SERVICE_NAME` | — | Service name (we set `minih` as default) |
| `OTEL_RESOURCE_ATTRIBUTES` | — | Additional resource attributes |
| `OTEL_TRACES_EXPORTER` | `otlp` | Trace exporter type |
| `OTEL_METRICS_EXPORTER` | `otlp` | Metrics exporter type |
| `OTEL_LOGS_EXPORTER` | `otlp` | Logs exporter type |
| `OTEL_SDK_DISABLED` | `false` | Kill switch for all telemetry |
| `MINIH_TELEMETRY` | `false` | minih-specific opt-in flag (telemetry off by default) |

**Design decision**: Telemetry is **opt-in**. Unless `MINIH_TELEMETRY=true` is set, the SDK is not initialized and all API calls become no-ops (OTel API's built-in behavior when no provider is registered).

---

## LGTM All-in-One Container

Grafana provides a single Docker image (`grafana/otel-lgtm`) that bundles:

- **Loki** — log aggregation (receives OTLP logs)
- **Grafana** — visualization UI (pre-configured dashboards)
- **Tempo** — distributed tracing backend (receives OTLP traces)
- **Mimir** — metrics backend (receives OTLP metrics)
- **OpenTelemetry Collector** — built-in, receives OTLP on ports 4317 (gRPC) and 4318 (HTTP)

### Docker Compose Setup

```yaml
services:
  lgtm:
    image: grafana/otel-lgtm:latest
    ports:
      - "3000:3000"   # Grafana UI
      - "4317:4317"   # OTLP gRPC
      - "4318:4318"   # OTLP HTTP
    environment:
      - GF_AUTH_ANONYMOUS_ENABLED=true
      - GF_AUTH_ANONYMOUS_ORG_ROLE=Admin
```

Usage: `docker compose up -d` then open `http://localhost:3000` for Grafana.

All three signals (traces, metrics, logs) are correlated automatically via trace ID when sent to the same OTLP endpoint.

---

## Context Propagation Strategy

### The Problem

minih's architecture has clear layer boundaries: `cli → runner → adapter`. A single agent run spans all three layers. Without explicit context propagation, child spans in the runner or adapter won't be linked to the parent CLI span.

### OTel's Built-in Context Propagation

Within a single Node.js process, OTel uses `AsyncLocalStorage` (via `@opentelemetry/context-async-hooks`) to propagate context automatically through async operations. This means:

- **Automatic propagation works** when code is in the same async call chain
- **Manual propagation needed** when:
  - Passing work to a callback that breaks the async chain
  - Event handlers (e.g., `onEvent` callback in `runAgent`)
  - Timer-based operations
  - Creating spans in a different logical context

### Propagation Points in minih

| Location | Propagation Type | Notes |
|----------|-----------------|-------|
| CLI command → `runAgent()` | Automatic | Same async chain |
| `runAgent()` → `adapter.run()` | Automatic | Direct await |
| `adapter.run()` → SDK event handlers | Manual needed | SDK `session.on()` callback breaks context |
| `onEvent` callback (pretty display) | Manual needed | Callback passed from CLI into runner |
| Validation after run completes | Automatic | Same async chain as `runAgent()` |

### Implementation Approach

```typescript
// Explicit context passing for event handlers
import { context, trace } from '@opentelemetry/api';

// Capture context at span creation
const currentContext = context.active();

// Pass context into callback
session.on((event) => {
  context.with(currentContext, () => {
    // Span created here will be child of the captured context
    handleEvent(event);
  });
});
```

---

## Logger Factory Design

### Requirements

- Each module/file gets a logger with automatic context (module name, agent slug, run ID)
- Logs automatically correlate with active trace/span
- Central creation point — no scattered `console.log` or `process.stderr.write`
- Must work when telemetry is disabled (fallback to no-op or stderr)

### Design: Factory Pattern

```typescript
// src/telemetry/logger.ts
import { logs, SeverityNumber } from '@opentelemetry/api-logs';

export function createLogger(moduleName: string) {
  const logger = logs.getLogger('minih', '0.1.5');

  return {
    info(message: string, attributes?: Record<string, unknown>) {
      logger.emit({
        severityNumber: SeverityNumber.INFO,
        body: message,
        attributes: { 'module.name': moduleName, ...attributes },
      });
    },
    warn(message: string, attributes?: Record<string, unknown>) { /* ... */ },
    error(message: string, attributes?: Record<string, unknown>) { /* ... */ },
    debug(message: string, attributes?: Record<string, unknown>) { /* ... */ },
  };
}
```

### Context Enrichment

The logger factory automatically attaches:

- `module.name` — which source module emitted the log
- `minih.agent.slug` — current agent (from env or span attributes)
- `minih.run.id` — current run ID
- Trace context (trace_id, span_id) — automatic via OTel SDK correlation

### Fallback When Telemetry Disabled

When `MINIH_TELEMETRY` is not set, `logs.getLogger()` returns a no-op logger. Logs that need to appear on stderr regardless (user-facing output) continue to use the existing `process.stderr.write` pattern — the OTel logger is for structured observability, not user display.

---

## Manual Instrumentation Plan

### Traces — Key Spans

| Span Name | Location | Attributes | Parent |
|-----------|----------|-----------|--------|
| `minih.cli.command` | CLI command handler | `command.name`, `agent.slug`, `model` | Root |
| `minih.run` | `runAgent()` | `agent.slug`, `run.id`, `model`, `timeout` | `cli.command` |
| `minih.run.prompt_assembly` | `runAgent()` prompt building | `preamble.chars`, `instructions.chars`, `prompt.chars` | `minih.run` |
| `minih.run.execution` | `adapter.run()` call | `session.id` | `minih.run` |
| `minih.run.validation` | `validateOutput()` / `validateSystemOutput()` | `valid`, `error.count` | `minih.run` |
| `minih.adapter.session_create` | `SdkCopilotAdapter.run()` | `model`, `has_mcp`, `is_resume` | `minih.run.execution` |
| `minih.adapter.session_send` | `session.send()` | `prompt.length` | `minih.adapter.session_create` |
| `minih.event.tool_call` | Event handler | `tool.name`, `tool.duration_ms` | `minih.run.execution` |

### Metrics — Key Instruments

| Metric Name | Type | Unit | Description |
|-------------|------|------|-------------|
| `minih.run.duration` | Histogram | `ms` | Agent run duration |
| `minih.run.count` | Counter | `{runs}` | Total runs (with `result` attribute: completed/failed/timeout) |
| `minih.run.tool_calls` | Histogram | `{calls}` | Tool calls per run |
| `minih.run.events` | Counter | `{events}` | Total events emitted |
| `minih.validation.count` | Counter | `{validations}` | Validation attempts (with `valid` attribute) |
| `minih.prompt.tokens` | Histogram | `{chars}` | Assembled prompt character count |
| `minih.adapter.session_duration` | Histogram | `ms` | SDK session active duration |

### Logs — Key Points

| Level | Location | Message Pattern |
|-------|----------|----------------|
| INFO | CLI entry | `Command started: {command} {slug}` |
| INFO | Run start | `Agent run started: {slug} model={model}` |
| INFO | Run complete | `Agent run completed: {slug} duration={ms}ms result={result}` |
| WARN | Validation fail | `Output validation failed: {errors}` |
| ERROR | Adapter error | `SDK session error: {message}` |
| DEBUG | Prompt assembly | `Prompt assembled: preamble={chars} instructions={chars} prompt={chars}` |
| DEBUG | Event stream | `Event received: type={type}` (high volume, debug only) |

---

## File Impact Analysis

### New Files

| File | Purpose |
|------|---------|
| `src/telemetry/index.ts` | Public API — re-exports init, logger factory, helpers |
| `src/telemetry/init.ts` | SDK initialization (NodeSDK setup, resource config, exporters) |
| `src/telemetry/logger.ts` | Logger factory with automatic context enrichment |
| `src/telemetry/spans.ts` | Span helper utilities (start with attributes, context propagation) |
| `src/telemetry/metrics.ts` | Metric instrument definitions (singleton meter + instruments) |
| `docker-compose.yml` | LGTM stack for local development |
| `docs/telemetry.md` | User-facing documentation |

### Modified Files

| File | Change |
|------|--------|
| `src/cli/index.ts` | Import and call `initTelemetry()` before command registration |
| `src/cli/commands/run.ts` | Add root span for run command, record metrics |
| `src/runner/runner.ts` | Add spans for prompt assembly, execution, validation; propagate context to onEvent |
| `src/adapter/sdk-copilot.ts` | Add spans for session create/resume/send; propagate context into event handler |
| `src/runner/validator.ts` | Add span for validation, record validation metrics |
| `package.json` | Add OTel dependencies |
| `tsconfig.json` | Possibly add `src/telemetry/` path if needed |

### Unchanged

| File | Why |
|------|-----|
| `src/adapter/interface.ts` | IAgentAdapter contract unchanged — instrumentation is internal |
| `src/adapter/fake.ts` | FakeAgentAdapter unaffected — no telemetry in tests |
| `src/runner/types.ts` | No new types needed in the public runner contract |
| `src/runner/folder.ts` | Agent discovery unchanged |
| `src/cli/output.ts` | Output formatting unchanged |

---

## ESM Initialization Strategy

### Option A: Top-of-entry-point initialization (Recommended)

```typescript
// src/cli/index.ts (first lines)
import { initTelemetry } from '../telemetry/index.js';
initTelemetry(); // No-op if MINIH_TELEMETRY !== 'true'

// ... rest of CLI setup
```

**Pros**: Simple, no loader hooks, no `--import` flag needed
**Cons**: Slightly later initialization than `--import` (but minih has no HTTP server, so no auto-instrumentation is missed)

### Option B: Separate entry point with `--import`

```bash
node --import ./dist/telemetry/register.js ./dist/cli/index.js
```

**Pros**: Earliest possible initialization
**Cons**: Requires modifying the bin entry in package.json or wrapper script, more complex

### Recommendation: Option A

minih is a CLI tool, not a server. There are no incoming HTTP requests to auto-instrument. All instrumentation is manual. Initializing at the top of the CLI entry point is sufficient and keeps the setup simple.

---

## Testing Strategy

### Unit Tests

- `test/telemetry/init.test.ts` — verify SDK initializes when `MINIH_TELEMETRY=true`, no-ops when unset
- `test/telemetry/logger.test.ts` — verify logger factory creates loggers with correct module name
- `test/telemetry/metrics.test.ts` — verify metrics are recorded (using in-memory exporter)

### Integration Approach

- Use `@opentelemetry/sdk-trace-base` `InMemorySpanExporter` in tests to capture spans without network calls
- Verify span hierarchy: `cli.command` → `minih.run` → `minih.run.execution`
- Verify context propagation: event handler spans have correct parent
- Existing tests unaffected — telemetry disabled by default (no `MINIH_TELEMETRY` env var in test)

### No Auto-Instrumentation Libraries

minih doesn't use Express, HTTP servers, or databases. The only external I/O is the copilot-sdk (which we instrument manually at the adapter boundary). No `@opentelemetry/auto-instrumentations-node` needed — this keeps dependencies lean.

---

## Risks and Considerations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| OTel SDK adds startup latency | Slower `minih run` cold start | Only initialize when `MINIH_TELEMETRY=true` |
| Large dependency tree from OTel packages | Bloated `node_modules`, longer install | OTel packages are well-scoped; only install what's needed |
| ESM loader hook issues with copilot-sdk | Breaks SDK loading | Don't use loader hooks — manual instrumentation only |
| Context lost in SDK event callbacks | Orphaned spans | Explicit `context.with()` propagation at callback boundaries |
| Telemetry noise in CI | Flaky tests, unwanted network calls | `OTEL_SDK_DISABLED=true` or omit `MINIH_TELEMETRY` in CI |
| Breaking existing tests | Test failures | Telemetry off by default; no behavior change without opt-in |
| LGTM container resource usage | Heavy for local dev | Document resource limits, make it optional |

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Opt-in via `MINIH_TELEMETRY=true` | CLI tools should not emit telemetry by default; respects user privacy and avoids noise |
| HTTP/protobuf over gRPC | Simpler setup, no native gRPC dependency, works with LGTM out of the box |
| Manual instrumentation only | minih has no HTTP server or DB — auto-instrumentation adds complexity for zero benefit |
| Logger factory pattern | Centralizes log creation, ensures consistent context, avoids scattered imports |
| `src/telemetry/` as internal module | Not a new architectural domain — utility module consumed by all three domains |
| LGTM for local dev, OTLP for production | Single container for dev simplicity; standard protocol for any production backend |
| Spans at domain boundaries | Instrument at cli→runner and runner→adapter boundaries for maximum insight with minimum noise |
| No changes to IAgentAdapter interface | Instrumentation is an internal concern, not a contract change |

---

## References

- [OpenTelemetry JS Manual Instrumentation](https://opentelemetry.io/docs/languages/js/instrumentation/)
- [OpenTelemetry JS Exporters](https://opentelemetry.io/docs/languages/js/exporters/)
- [OpenTelemetry JS ESM Support](https://github.com/open-telemetry/opentelemetry-js/blob/main/doc/esm-support.md)
- [Grafana LGTM Docker Image](https://grafana.com/blog/2024/03/13/an-opentelemetry-backend-in-a-docker-image-introducing-grafana/otel-lgtm/)
- [OTel SDK Configuration via Environment Variables](https://opentelemetry.io/docs/languages/sdk-configuration/)
- [OTel Logs API for JavaScript](https://www.npmjs.com/package/@opentelemetry/api-logs)
