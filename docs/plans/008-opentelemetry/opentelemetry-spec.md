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

## Design Decisions

### DD1: Short-lived process flushing via Commander `postAction` hook

**Problem**: minih is a CLI tool. Many commands finish in under 1 second. `BatchSpanProcessor` flushes every 5s by default. `PeriodicExportingMetricReader` flushes every 60s. If the process exits before a flush cycle, all telemetry is silently lost. Node.js `process.on('exit')` handlers are synchronous and cannot await async shutdown.

**Decision**: Telemetry initialization happens at CLI entry (`initTelemetry()` at top of `src/cli/index.ts`). Shutdown is handled by a Commander `postAction` hook that calls `shutdownTelemetry()` after every command. The CLI uses `await program.parseAsync()` to ensure async hooks complete before process exit. Command handlers use `printEnvelope()` + `process.exitCode` instead of `process.exit()` inside span callbacks to allow spans to close naturally.

```typescript
// src/cli/index.ts
initTelemetry(); // top of file, before command registration

program.hook('postAction', async () => {
  await shutdownTelemetry();
});

await program.parseAsync(); // must be parseAsync, not parse
```

**Implementation note**: A `withTelemetry()` wrapper is exported from the telemetry module but currently unused — the `postAction` hook pattern proved simpler for Commander.js integration.

**Rationale**: Works for all commands automatically (no per-command wrapping), handles both success and error paths, works for fast commands (<1s) and long commands (20min+), and Commander's hook system ensures shutdown runs even if the command throws.

**Critical constraint**: Command handlers must NOT call `process.exit()` inside span callbacks. Doing so kills the process before spans can `.end()` and before `postAction` can flush. Use `process.exitCode` + `printEnvelope()` instead of `exitWithEnvelope()` inside `withSpan` blocks.

**Rejected alternatives**:

- `SimpleSpanProcessor` (network call per span — adds latency)
- Short `scheduledDelayMillis` without explicit flush (still loses data for sub-second commands)
- Manual `forceFlush()` calls at end of each command (easy to miss a code path)

### DD2: Telemetry must never block the happy path

**Problem**: If the OTLP endpoint is unreachable (LGTM container not running, network issues), the exporter retries with backoff. During `shutdownTelemetry()`, the flush may hang waiting for retries. This could delay CLI exit or make the command appear to hang after it's logically done.

**Decision**: Defense in depth — configure exporters with short timeouts (1s, 1 retry max), cap `sdk.shutdown()` with a `Promise.race` timeout (2s), and wrap everything in try/catch that silently swallows errors. Telemetry is best-effort and must never affect the user's CLI experience.

```typescript
async function shutdownTelemetry(): Promise<void> {
  try {
    await Promise.race([sdk.shutdown(), setTimeout(2000)]);
  } catch {
    // silently swallow — telemetry is best-effort
  }
}
```

**Invariant**: No telemetry failure may affect CLI exit codes, stdout/stderr output, or add >2s latency to any command.

**Rejected alternatives**:

- Relying solely on exporter timeout (doesn't cap shutdown time)
- No timeout on shutdown (could hang indefinitely if collector is slow)
- Logging export failures to stderr (would pollute user-facing output)

### DD3: Sensitive data in span attributes

**Problem**: Agent prompts may contain `GH_TOKEN` references, MCP configs with credentials, or tool outputs with secrets. Span attributes and log bodies are exported to the OTLP backend. Naively attaching full prompt text, tool output, or environment variable values risks leaking secrets into the telemetry backend.

**Decision**: Metadata only by default — spans carry only safe data: slug, run ID, model name, char counts, durations, success/failure booleans. No prompt text, no tool output, no environment variable values. A separate `MINIH_TELEMETRY_VERBOSE=true` flag enables inclusion of prompt content and tool outputs for local debugging when you control the backend.

**Safe attributes (always included)**:

- `agent.slug`, `run.id`, `model`, `command.name`
- `prompt.char_count`, `instructions.char_count`, `preamble.char_count` (character counts — simpler than token counting)
- `duration_ms`, `result`, `valid`, `error.count`
- `tool.name`, `event.type`, `session.id`

**Implementation note**: The `minih.prompt.tokens` metric records actual GPT token count via `gpt-tokenizer` (`encode(prompt).length`). The `prompt.chars` span attribute retains character count for quick reference.

**Verbose attributes (only with `MINIH_TELEMETRY_VERBOSE=true`)**:

- `prompt.body` (full assembled prompt text)
- `tool.output` (tool call results)
- `validation.errors` (full error messages)

**Implementation note**: `MINIH_TELEMETRY_VERBOSE` is checked via `isVerboseEnabled()` in `init.ts` and consumed in `runner.ts` to conditionally attach `prompt.body` and `validation.errors` span attributes.

**Invariant**: Default telemetry output must never contain credentials, tokens, prompt content, or tool output.

**Rejected alternatives**:

- Regex-based redaction (fragile, always misses edge cases)
- Always including content (unsafe for shared/remote backends)
- Never including content even with opt-in (limits debugging power)

### DD4: Scope of instrumented commands

**Problem**: minih has 15+ commands. The spec focuses on `minih run` but doesn't clarify which other commands get instrumentation.

**Decision**: Root span (`minih.cli.command`) in `run` and `resume` only (explicitly via `withSpan`), with detailed child spans. Other commands get telemetry lifecycle (init + flush) via the Commander `postAction` hook but no spans.

**Instrumentation tiers (as implemented)**:

| Tier | Commands | Instrumentation |
|------|----------|----------------|
| Full | `run`, `resume` | `minih.cli.command` root span with baggage context + child spans (prompt assembly, execution, validation, adapter) + SDK spans (via trace stitching) + metrics + structured logs |
| Lifecycle only | All others (`list`, `init`, `inspect`, `status`, `tail`, `history`, `quickstart`, `connect`, `difficulties`, `last-run`, `validate`, `check`, `doctor`) | Telemetry init + flush via `postAction` hook (structured logs still exported) |

**Implementation note**: The `run` and `resume` commands create a `minih.cli.command` root span that carries baggage context, rich attributes, and parents all runner/adapter child spans. The `postAction` hook in `src/cli/index.ts` calls `shutdownTelemetry()` to flush all signals.

**Rationale**: Full instrumentation was only worthwhile for the complex `run`/`resume` paths where debugging visibility matters. The `postAction` hook still ensures all log records flush for every command.

**Rejected alternatives**:

- Universal `preAction` root span for all commands (created an orphaned trace disconnected from `minih.cli.command` — removed in DD13)
- Deep instrumentation of all commands (high effort for low-value commands)

### DD6: Application log level control

**Problem**: `OTEL_LOG_LEVEL` controls the OTel SDK's internal diagnostics, not application-level logs. Without a separate control, debug-level logs (e.g., per-event "Event received: type=thinking") flood the telemetry backend.

**Decision**: `MINIH_LOG_LEVEL` env var controls the minimum severity the logger factory emits. Default: `info`. Valid values: `debug`, `info`, `warn`, `error`.

| `MINIH_LOG_LEVEL` | Emits |
|-------------------|-------|
| `debug` | DEBUG, INFO, WARN, ERROR |
| `info` (default) | INFO, WARN, ERROR |
| `warn` | WARN, ERROR |
| `error` | ERROR only |

The logger factory checks the threshold before calling `logger.emit()` — logs below the threshold are never constructed or exported.

**Rationale**: Familiar pattern (matches Python `logging`, Rust `RUST_LOG`, etc.), independent of `MINIH_TELEMETRY_VERBOSE` (which controls content sensitivity, not volume), sensible default keeps export volume manageable.

**Rejected alternatives**:

- Coupling log level to `MINIH_TELEMETRY_VERBOSE` (conflates content sensitivity with verbosity)
- Always emit all levels, filter at backend (wastes bandwidth, clutters Loki)
- Hardcoded levels with no control (inflexible)

### DD5: Baggage-based attribute propagation

**Problem**: `agent.slug`, `run.id`, and `model` should appear on every child span throughout a trace. Without automation, these must be set manually on each span creation — repetitive and easy to forget.

**Decision**: Use OTel Baggage to propagate common values, plus a custom `BaggageCopyProcessor` that auto-copies `minih.*` baggage entries to span attributes on `onStart()`.

```typescript
class BaggageCopyProcessor implements SpanProcessor {
  onStart(span: Span, parentContext: Context) {
    const baggage = propagation.getBaggage(parentContext);
    if (baggage) {
      for (const [key, entry] of baggage.getAllEntries()) {
        if (key.startsWith('minih.')) {
          span.setAttribute(key, entry.value);
        }
      }
    }
  }
}
```

**Baggage keys set at root**: `minih.agent.slug`, `minih.run.id`, `minih.model`

**Rationale**: Set once at command entry, every child span inherits automatically. Spans are self-contained (useful in metric exemplars). No risk of forgetting attributes in new code.

**Rejected alternatives**:

- Manual attributes on each span (repetitive, easy to miss in new code)
- Root span only, rely on trace viewer to show parent (child spans in isolation lack context)

### DD7: OTel package version pinning

**Problem**: OTel JS packages share internal APIs and must be version-compatible. Mismatched versions cause subtle runtime failures.

**Decision**: Pin exact versions from the same coordinated release. Bump all OTel packages together when upgrading.

**Pinned release set (April 30, 2026)**:

| Package | Version |
|---------|---------|
| `@opentelemetry/api` | `1.9.1` |
| `@opentelemetry/sdk-node` | `0.216.0` |
| `@opentelemetry/sdk-trace-node` | `2.7.1` |
| `@opentelemetry/sdk-metrics` | `2.7.1` |
| `@opentelemetry/sdk-logs` | `0.216.0` |
| `@opentelemetry/api-logs` | `0.216.0` |
| `@opentelemetry/exporter-trace-otlp-proto` | `0.216.0` |
| `@opentelemetry/exporter-metrics-otlp-proto` | `0.216.0` |
| `@opentelemetry/exporter-logs-otlp-proto` | `0.216.0` |
| `@opentelemetry/resources` | `2.7.1` |
| `@opentelemetry/semantic-conventions` | `1.40.0` |

**Rationale**: Exact pins from the same release date guarantee cross-package compatibility. Upgrading is a single coordinated bump (~10 minutes every few months). The `0.216.0` experimental line includes the `sdk-logs` breaking change from `0.215.0` (required `forceFlush()` on `LogRecordExporter`), so no migration is needed.

**Rejected alternatives**:

- `^` ranges (risk cross-package drift on minor bumps)
- Pin only API, `^` for SDK (API is not the only compatibility surface)

### DD8: Pre-built Grafana dashboards

**Problem**: After enabling telemetry, developers must manually construct Tempo/Mimir/Loki queries to see minih data. This adds friction to the first-time experience.

**Decision**: Skip for initial implementation. Document as a future enhancement once we know which metrics and spans are most useful in practice.

**Rationale**: Ship working telemetry first. Provisioned dashboards are polish — better to learn which panels are actually valuable from real usage before investing in dashboard JSON that must be maintained as spans/metrics evolve.

**Future work**: Ship a provisioned `grafana/dashboards/minih.json` mounted into the LGTM container showing run duration, success rate, slowest agents, and recent traces.

### DD9: Performance budget when enabled

**Problem**: The spec guarantees zero overhead when disabled but doesn't specify acceptable cost when `MINIH_TELEMETRY=true`.

**Decision**: Soft guideline — telemetry overhead must not noticeably delay any command. Target ≤100ms total added latency (startup + shutdown combined). No formal benchmark required.

**Rationale**: minih is a CLI tool, not a hot path. Agent runs take 30s–20min; 100ms of telemetry overhead is invisible. Fast commands (list, doctor) finish in <1s; even there, 100ms is acceptable for opt-in observability. A hard budget with benchmark infrastructure is over-engineering for the value it provides.

### DD10: Resource attributes

**Problem**: Only `service.name` and `service.version` are planned. Additional attributes help distinguish telemetry from different machines, environments, or Node.js versions when aggregating across developers or CI runners.

**Decision**: Manually set a small set of resource attributes in code. Allow user override via the standard `OTEL_RESOURCE_ATTRIBUTES` env var (read by the SDK automatically). No resource detector packages.

**Attributes set in code**:

- `service.name` — `minih` (default, overridable via `OTEL_SERVICE_NAME`)
- `service.version` — from `package.json`
- `process.runtime.name` — `node`
- `process.runtime.version` — `process.version`
- `host.name` — `os.hostname()`

**Rationale**: Covers the key filtering dimensions without pulling in resource detector packages. `OTEL_RESOURCE_ATTRIBUTES` provides an escape hatch for anything else (e.g., `deployment.environment=ci`).

**Rejected alternatives**:

- Auto resource detectors (`hostDetector`, `osDetector`) — pulls in more OTel packages, may over-share
- Only `service.name` — insufficient for distinguishing sources in shared backends

### DD11: Trace context propagation across sub-processes

**Problem**: If minih spawns child processes (e.g., `minih check` called during a run), W3C `traceparent` isn't propagated. Child process traces would be orphaned.

**Decision**: Propagate `TRACEPARENT` env var when spawning child processes. When starting a child process, inject the current trace context as `TRACEPARENT` and `TRACESTATE` environment variables. When minih starts, check for `TRACEPARENT` in the environment and use it as the parent context if present.

```typescript
// Outgoing: inject into child process env
const carrier: Record<string, string> = {};
propagation.inject(context.active(), carrier);
execSync('minih check', {
  env: { ...process.env, ...carrier },
});

// Incoming: extract on startup
const parentContext = propagation.extract(context.active(), process.env);
context.with(parentContext, () => { /* run command */ });
```

**Implementation status**: The incoming extraction is implemented in `init.ts` — the extracted parent context is stored and passed to root span creation via `withSpan(name, fn, options, parentContext)`. This correctly stitches root spans as children of the calling trace without replacing the global context manager. The outgoing injection (propagating to child processes) is **not yet implemented** — tracked as a future enhancement.

**Rationale**: Enables stitching traces across process boundaries. When an agent runs `minih check` during a `minih run`, the check span appears as a child of the run trace. W3C `TRACEPARENT` is the standard mechanism for cross-process propagation.

**Rejected alternatives**:

- Ignore and document as limitation (loses trace continuity for a real use case)
- CLI argument propagation (non-standard, clutters command interface)

### DD12: LGTM container version and setup

**Problem**: The Docker Compose setup references `grafana/otel-lgtm:latest` which is non-deterministic. Pin a specific version for reproducible dev environments.

**Decision**: Pin `grafana/otel-lgtm:0.27.0` (released May 1, 2026). Run via Docker Compose.

**Bundled component versions (v0.27.0)**:

- OpenTelemetry Collector `0.151.0`
- Tempo `2.10.5`
- Prometheus `3.11.3`
- Grafana 13

**Docker Compose setup**:

```yaml
services:
  lgtm:
    image: grafana/otel-lgtm:0.27.0
    ports:
      - "3000:3000"   # Grafana UI
      - "4317:4317"   # OTLP gRPC
      - "4318:4318"   # OTLP HTTP
    environment:
      - GF_AUTH_ANONYMOUS_ENABLED=true
      - GF_AUTH_ANONYMOUS_ORG_ROLE=Admin
```

**Usage**:

1. `docker compose up -d` — start the LGTM stack
2. `export MINIH_TELEMETRY=true` — enable minih telemetry
3. `minih run hello-world` — run an agent
4. Open `http://localhost:3000` — view traces in Tempo, metrics in Explore, logs in Loki

**Rationale**: Pinned version ensures all developers get identical behavior. `v0.27.0` is the latest stable release and includes Grafana 13 with improved OTLP support. OTLP HTTP on port 4318 matches the OTel SDK default endpoint when running natively.

**Devcontainer caveat**: When running inside a devcontainer that uses Docker-outside-of-Docker (`ghcr.io/devcontainers/features/docker-outside-of-docker`), the LGTM container's ports are mapped on the **host**, not inside the devcontainer's network namespace. `localhost:4318` is unreachable from within the devcontainer. The exporter must point to the host gateway IP:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=http://$(ip route | grep default | awk '{print $3}'):4318
```

This is typically `172.17.0.1`. The `just telemetry-run` recipe handles this automatically.

### DD13: SDK trace stitching via onGetTraceContext

**Problem**: The `@github/copilot-sdk` has its own built-in OTel instrumentation with a separate `TracerProvider` (service.name=`github-copilot`). SDK spans (agent_turn, chat, execute_tool, permission) appear in a disconnected trace, making it impossible to see the full request lifecycle in Grafana.

**Decision**: Pass an `onGetTraceContext` callback to the `CopilotClient` constructor. The callback returns `{ traceparent }` from `getTraceparent()`, which serializes the current active span context. The SDK calls this on every JSON-RPC request, spreading the result into the wire payload so the server-side SessionManager receives trace context.

**Implementation**:

- `getTraceparent()` in `src/telemetry/spans.ts` serializes the current active span context as `00-{traceId}-{spanId}-{flags}`
- `onGetTraceContext` callback passed to `new CopilotClient({ onGetTraceContext })` in `src/cli/commands/sdk-runtime.ts`
- The callback is invoked on every RPC call (session.create, session.send, etc.), providing live trace context at request time
- No per-session `traceparent` config — the client-level callback handles all sessions

**SDK architecture** (verified from `@github/copilot-sdk` v0.2.1):

The SDK has a client-server architecture over JSON-RPC:

```
minih process  ──JSON-RPC──►  copilot-agent subprocess (SDK server)
     │                              │
  CopilotClient                 SessionManager (W1t)
  (calls onGetTraceContext)     └── OTelService ($Se)
                                    └── OTel tracker (XJe, has parentTraceContext)
```

- `CopilotClient.createSession()` calls `getTraceContext(this.onGetTraceContext)` and spreads the result (`{ traceparent, tracestate }`) into the `session.create` RPC payload
- Server-side `SessionManager.createSession()` passes `traceparent` from the request to `otel.trackSession(session, { traceparent })`
- The OTel tracker's constructor parses traceparent: `this.parentTraceContext = hwt(n.traceparent, n.tracestate)`
- `XJe.ensureAgentSpan()` uses `this.parentTraceContext` as the parent context for `startInvokeAgentSpan()`

**What did NOT work** (per-session `traceparent` in config):

The `SessionOptions.traceparent` field exists on the server-side `SessionManager` interface but `CopilotClient.createSession()` on the client side never reads it from the config object — it only forwards fields it explicitly destructures. The `onGetTraceContext` callback is the designed client-side mechanism.

**Verified behavior**:

- Single unified trace in Tempo containing both `minih` (6 spans) and `github-copilot` (12 spans) services
- SDK's `agent_turn` root span parents under minih's active span at request time
- Span hierarchy: `minih.cli.command` → `minih.run.execution` → `minih.adapter.session_send` → SDK `agent_turn` → `chat`, `execute_tool`, `permission`
- Two services in one trace is correct distributed tracing semantics

**Also fixed**: Removed orphaned `minih.cli` span from `preAction` hook. The hook created a span stored in a variable but never activated it in OTel context, so `minih.cli.command` (inside `withSpan`) started a separate trace. Now only `minih.cli.command` is the root span.

**Rationale**: `onGetTraceContext` is the SDK's documented client-side mechanism for trace propagation (explicit field in `CopilotClientOptions` with JSDoc example showing `propagation.inject(context.active(), carrier)`). It provides live context at every RPC call, not just at session creation.

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
| Telemetry lost on process crash | Missing final spans/metrics | `withTelemetry()` wrapper handles normal exits; crashes are acceptable data loss |
| Metric instruments created before MeterProvider registered | All metrics are permanent no-ops | Lazy initialization via wrapper objects (DD14) |

### DD14: Lazy metric instrument creation

**Problem**: `src/telemetry/metrics.ts` called `metrics.getMeter('minih')` at module import time. Since ES module imports execute before `initTelemetry()` registers the `MeterProvider`, `getMeter()` returned a no-op meter and all instruments derived from it were permanent no-ops — metrics were never exported.

**Decision**: Wrap each instrument in a lazy proxy object that creates the real instrument on first `.record()` or `.add()` call. By that time, `initTelemetry()` has run and the `MeterProvider` is registered.

**Implementation**:

```typescript
let _runDuration: Histogram | undefined;
export const runDuration = {
  record(value: number, attrs?: Attributes) {
    (_runDuration ??= getMeter().createHistogram('minih.run.duration', { ... }))
      .record(value, attrs);
  },
};
```

**Why traces don't have this problem**: `trace.getTracer('minih')` is called inside function bodies (e.g., inside `withSpan()`), not at module scope. By the time any span is created, `initTelemetry()` has already run.

**Rationale**: Minimal change — callers still use `runDuration.record(value, attrs)` as before. The lazy pattern adds one nullish-coalescing check per call (negligible). Once the instrument is created, subsequent calls go directly to the OTel SDK.
