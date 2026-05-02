# OpenTelemetry Instrumentation — Implementation Plan

**Mode**: Simple
**Plan Version**: 1.0.0
**Created**: 2026-05-02
**Spec**: [opentelemetry-spec.md](./opentelemetry-spec.md)
**Status**: READY FOR IMPLEMENTATION

## Summary

Add OpenTelemetry tracing, metrics, and structured logging to minih. Opt-in via `MINIH_TELEMETRY=true`, export via OTLP HTTP/protobuf, local dev via Grafana LGTM container. Three phases: foundation → instrumentation → documentation.

## Target Domains

| Domain | Status | Relationship | Role |
|--------|--------|-------------|------|
| telemetry (new) | new | create | SDK init, logger factory, span/metric helpers |
| adapter | existing | modify | Span for session create/send, context propagation in event handler |
| runner | existing | modify | Spans for prompt assembly, execution, validation; run metrics |
| cli | existing | modify | Init telemetry, root command span, graceful shutdown |

No contract-breaking changes. `IAgentAdapter` interface unchanged.

## Domain Manifest

| File | Domain | Classification | Rationale |
|------|--------|---------------|-----------|
| `src/telemetry/index.ts` | telemetry | contract | Public API re-exports |
| `src/telemetry/init.ts` | telemetry | internal | SDK initialization, resource config, exporter setup |
| `src/telemetry/logger.ts` | telemetry | contract | Logger factory with context enrichment |
| `src/telemetry/spans.ts` | telemetry | internal | Span creation helpers, context propagation utils |
| `src/telemetry/metrics.ts` | telemetry | internal | Metric instrument definitions (singleton) |
| `src/cli/index.ts` | cli | internal | Add telemetry init + shutdown |
| `src/cli/commands/run.ts` | cli | internal | Root span for run command |
| `src/runner/runner.ts` | runner | internal | Spans for assembly, execution, validation; metrics recording |
| `src/adapter/sdk-copilot.ts` | adapter | internal | Spans for session lifecycle, context propagation in event handler |
| `docker-compose.yml` | — (infra) | internal | LGTM stack definition |
| `docs/telemetry.md` | — (docs) | internal | User-facing telemetry documentation |
| `test/telemetry/init.test.ts` | — (test) | internal | SDK init/no-op tests |
| `test/telemetry/logger.test.ts` | — (test) | internal | Logger factory tests |
| `test/telemetry/metrics.test.ts` | — (test) | internal | Metric recording tests |
| `package.json` | — | internal | Add OTel dependencies |

## Key Findings

| # | Impact | Finding | Action |
|---|--------|---------|--------|
| 01 | Critical | minih is ESM-only — OTel SDK must be initialized before other imports execute | T01: Initialize at top of `src/cli/index.ts` |
| 02 | Critical | Context is lost in SDK `session.on()` event callbacks | T07: Capture context before callback, restore with `context.with()` |
| 03 | High | OTel SDK no-ops when no provider registered — free kill switch | T01: Only call `NodeSDK.start()` when `MINIH_TELEMETRY=true` |
| 04 | High | `onEvent` callback passed from CLI to runner breaks async context chain | T06: Pass context explicitly or use `context.with()` wrapper |
| 05 | High | LGTM container accepts OTLP on port 4318 (HTTP) by default — matches OTel SDK defaults | T09: No custom endpoint config needed for local dev |
| 06 | Medium | OTel packages are ESM-compatible since v1.x — no CJS interop issues | No special handling needed |
| 07 | Medium | `@opentelemetry/sdk-node` bundles trace+metrics providers but not logs | T01: Add `@opentelemetry/sdk-logs` separately |
| 08 | Medium | OTel Logs API is separate package (`@opentelemetry/api-logs`) | T03: Install alongside `@opentelemetry/api` |
| 09 | Low | HTTP/protobuf is lighter than gRPC — no native dependency needed | Use `*-otlp-proto` exporter packages |
| 10 | Low | `InMemorySpanExporter` available for testing spans without network | T10: Use for unit tests |

## Implementation

**Objective**: Full OTel instrumentation (traces, metrics, logs) across minih's three domains with opt-in activation and LGTM dev stack
**Testing Approach**: Unit tests with in-memory exporters; manual E2E validation with LGTM container
**Complexity**: CS-3 (medium)

### Phase 1: Foundation (Telemetry Module + SDK Init)

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|--------|-----|------|--------|---------|-----------|-------|
| [ ] | T01 | Create telemetry init module | telemetry | `src/telemetry/init.ts` | `initTelemetry()` creates and starts NodeSDK with OTLP exporters when `MINIH_TELEMETRY=true`; no-ops otherwise. `shutdownTelemetry()` flushes and shuts down providers | AC7 |
| [ ] | T02 | Create telemetry barrel export | telemetry | `src/telemetry/index.ts` | Re-exports `initTelemetry`, `shutdownTelemetry`, `createLogger`, span helpers, metrics | Public API surface |
| [ ] | T03 | Create logger factory | telemetry | `src/telemetry/logger.ts` | `createLogger(moduleName)` returns object with `info/warn/error/debug` methods that emit OTel log records with `module.name` attribute and auto-correlated trace context | AC5 |
| [ ] | T04 | Create metrics module | telemetry | `src/telemetry/metrics.ts` | Defines and exports metric instruments: `runDuration` (histogram), `runCount` (counter), `toolCallCount` (histogram), `eventCount` (counter), `validationCount` (counter) | AC3 |
| [ ] | T05 | Create span helpers | telemetry | `src/telemetry/spans.ts` | Helper to start spans with standard minih attributes, helper to propagate context into callbacks | AC6 |
| [ ] | T06 | Add OTel dependencies to package.json | — | `package.json` | Adds `@opentelemetry/api`, `@opentelemetry/sdk-node`, `@opentelemetry/sdk-logs`, `@opentelemetry/api-logs`, `@opentelemetry/exporter-trace-otlp-proto`, `@opentelemetry/exporter-metrics-otlp-proto`, `@opentelemetry/exporter-logs-otlp-proto`, `@opentelemetry/resources`, `@opentelemetry/semantic-conventions` | All as regular dependencies |
| [ ] | T07 | Wire telemetry init into CLI entry point | cli | `src/cli/index.ts` | `initTelemetry()` called at top of file (first line after imports). `shutdownTelemetry()` registered on process exit/SIGTERM | AC7 |

### Phase 2: Instrumentation (Spans + Metrics + Logs)

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|--------|-----|------|--------|---------|-----------|-------|
| [ ] | T08 | Add root command span in run.ts | cli | `src/cli/commands/run.ts` | `minih.cli.command` span wraps the run command execution with attributes: `command.name`, `agent.slug`, `model` | AC1, AC11 |
| [ ] | T09 | Add spans in runner.ts | runner | `src/runner/runner.ts` | Three child spans: `minih.run.prompt_assembly`, `minih.run.execution`, `minih.run.validation`. Records `runDuration` histogram and `runCount` counter on completion. Propagates context to `onEvent` callback | AC2, AC3, AC6 |
| [ ] | T10 | Add spans in sdk-copilot.ts | adapter | `src/adapter/sdk-copilot.ts` | `minih.adapter.session_create` span wraps session creation. Context captured before `session.on()` and restored inside callback via `context.with()`. `minih.adapter.session_send` span wraps `session.send()` | AC2, AC6 |
| [ ] | T11 | Add validation span | runner | `src/runner/validator.ts` | Span wraps validation calls. Records `validationCount` counter with `valid` attribute | AC2, AC3 |
| [ ] | T12 | Add structured logging to key points | all | `src/runner/runner.ts`, `src/adapter/sdk-copilot.ts`, `src/cli/commands/run.ts` | Use `createLogger()` at run start, completion, errors, validation results. Replaces no existing stderr output (additive only) | AC4 |

### Phase 3: Infrastructure + Documentation + Tests

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|--------|-----|------|--------|---------|-----------|-------|
| [ ] | T13 | Create Docker Compose for LGTM | infra | `docker-compose.yml` | `docker compose up` starts grafana/otel-lgtm with ports 3000 (Grafana), 4317 (gRPC), 4318 (HTTP). Anonymous admin access enabled | AC9 |
| [ ] | T14 | Create telemetry documentation | docs | `docs/telemetry.md` | Documents: enabling telemetry, env vars, starting LGTM, viewing traces in Tempo, viewing metrics in Mimir, viewing logs in Loki, debugging tips, architecture diagram | AC10 |
| [ ] | T15 | Create telemetry unit tests | test | `test/telemetry/init.test.ts`, `logger.test.ts`, `metrics.test.ts` | Tests verify: SDK starts when enabled, no-ops when disabled, logger attaches module name, metrics record values. Uses `InMemorySpanExporter` and `TestMetricReader` | AC8 |
| [ ] | T16 | Verify existing tests still pass | test | — | `npm test` passes with no changes to existing test files. Telemetry off by default ensures no interference | AC8 |
| [ ] | T17 | E2E verification with LGTM | manual | — | Run `minih run hello-world` with `MINIH_TELEMETRY=true`, verify trace appears in Grafana Tempo, metrics in Explore, logs in Loki | AC1, AC2, AC3, AC4 |

### Acceptance Criteria

- [ ] AC1: Trace visible in Grafana Tempo after `minih run hello-world`
- [ ] AC2: Child spans for prompt assembly, execution, and validation
- [ ] AC3: Metrics (duration, count, tool calls) in Grafana/Mimir
- [ ] AC4: Logs in Grafana/Loki with trace_id correlation
- [ ] AC5: Logger factory auto-attaches module name and trace context
- [ ] AC6: Context propagation through onEvent callback chain
- [ ] AC7: Zero overhead when `MINIH_TELEMETRY` not set
- [ ] AC8: All existing tests pass unchanged
- [ ] AC9: `docker compose up` starts LGTM successfully
- [ ] AC10: Documentation covers enable, view, debug workflow
- [ ] AC11: Spans have rich attributes (slug, run ID, model, result)
- [ ] AC12: IAgentAdapter interface unchanged

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| OTel SDK init blocks CLI startup | Low | 50-100ms delay | Conditional init behind `MINIH_TELEMETRY` check |
| Context lost in SDK event callbacks | High | Orphaned spans | T10: Explicit `context.with()` wrapping |
| OTel packages incompatible with strict ESM | Low | Import failures | Research confirms ESM support since v1.x |
| Span explosion from per-event spans | Medium | Noisy traces | Only instrument significant operations, not individual events |
| LGTM container not available (Docker not installed) | Medium | Can't view telemetry locally | Document as optional; OTLP works with any backend |
| `shutdownTelemetry()` not called on crash | Medium | Lost final spans/metrics | Register on both `process.on('exit')` and `SIGTERM` |

### DYK Findings

| # | Insight | Action |
|---|---------|--------|
| 1 | OTel API is designed to no-op when no provider registered — perfect kill switch | Just skip `sdk.start()` when disabled |
| 2 | `@opentelemetry/sdk-node` does NOT include logs — separate `@opentelemetry/sdk-logs` needed | Install both |
| 3 | HTTP/protobuf exporters have no native dependencies (unlike gRPC) | Use `*-otlp-proto` packages |
| 4 | `AsyncLocalStorage` context propagation works automatically through `await` chains | Only manual propagation needed at callback boundaries |
| 5 | `InMemorySpanExporter` and `TestMetricReader` exist for testing without network | Use in unit tests |
| 6 | OTel resource detection reads `OTEL_SERVICE_NAME` automatically | Set default in code, allow env override |
| 7 | `BatchSpanProcessor` flushes on `sdk.shutdown()` — must call before process exit | Register shutdown hook |
