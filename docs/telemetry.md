# Telemetry

minih supports OpenTelemetry instrumentation for traces, metrics, and structured logs. Telemetry is **opt-in** — disabled by default with zero overhead.

## Quick start

```bash
# Start the observability stack
docker compose up -d

# Enable telemetry and run an agent
export MINIH_TELEMETRY=true
minih run hello-world

# View traces in Grafana
open http://localhost:3000
```

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MINIH_TELEMETRY` | unset | Set to `true` to enable telemetry |
| `MINIH_TELEMETRY_VERBOSE` | unset | Set to `true` to include prompt content and tool outputs in spans |
| `MINIH_LOG_LEVEL` | `info` | Minimum log severity: `debug`, `info`, `warn`, `error` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318` | OTLP collector endpoint |
| `OTEL_SERVICE_NAME` | `minih` | Override the service name in traces |
| `OTEL_RESOURCE_ATTRIBUTES` | — | Additional resource attributes (e.g., `deployment.environment=ci`) |

## What is instrumented

### Traces

Every `minih run` and `minih resume` command produces a trace with child spans:

```
minih.cli.command                              (minih)
  └── minih.run.prompt_assembly                (minih)
  └── minih.run.execution                      (minih)
  │     └── minih.adapter.session_create       (minih)
  │     └── minih.adapter.session_send         (minih)
  │           └── agent_turn                   (github-copilot)
  │                 └── chat claude-opus-4.6   (github-copilot)
  │                 └── execute_tool bash      (github-copilot)
  │                 │     └── permission       (github-copilot)
  │                 └── chat claude-opus-4.6   (github-copilot)
  │                 └── ...                    (more turns)
  └── minih.run.validation                     (minih)
```

SDK spans from `github-copilot` are automatically stitched into the same trace via `onGetTraceContext` (DD13). Two services appear in one trace — this is standard distributed tracing.

Other commands only get telemetry lifecycle (init + flush for logs) but no spans.

### Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `minih.run.duration` | Histogram | Agent run duration (ms) |
| `minih.run.count` | Counter | Total runs by result |
| `minih.run.tool_calls` | Histogram | Tool calls per run |
| `minih.run.events` | Counter | Total events emitted |
| `minih.validation.count` | Counter | Validation attempts by result |
| `minih.prompt.tokens` | Histogram | Prompt token count (GPT tokenizer) |
| `minih.adapter.session_duration` | Histogram | SDK session duration (ms) |

### Logs

Structured logs are emitted at key points (run start/complete, validation results, adapter errors) and automatically correlate with the active trace via trace ID.

## Viewing telemetry

### Traces (Tempo)

1. Open Grafana at `http://localhost:3000`
2. Go to **Explore** → select **Tempo** data source
3. Search by service name `minih` or browse recent traces
4. Click a trace to see the span waterfall

### Metrics (Mimir)

1. Go to **Explore** → select **Prometheus** data source
2. Query metrics like `minih_run_duration_bucket` or `minih_run_count_total`

### Logs (Loki)

1. Go to **Explore** → select **Loki** data source
2. Query: `{service_name="minih"}`
3. Click a log line to jump to its correlated trace

## LGTM stack

The `docker-compose.yml` runs [Grafana LGTM](https://github.com/grafana/docker-otel-lgtm) v0.27.0, which bundles:

- **Loki** — log aggregation
- **Grafana** — visualization UI (port 3000)
- **Tempo** — distributed tracing
- **Mimir** — metrics (Prometheus-compatible)
- **OpenTelemetry Collector** — receives OTLP on ports 4317 (gRPC) and 4318 (HTTP)

```bash
docker compose up -d    # start
docker compose down     # stop
```

## Sensitive data

By default, spans contain only safe metadata: agent slug, run ID, model name, character counts, durations, and success/failure indicators. No prompt content, tool outputs, or environment variable values are exported.

Set `MINIH_TELEMETRY_VERBOSE=true` to include prompt bodies and tool outputs — use only when you control the telemetry backend.

## Cross-process trace stitching

If minih detects `TRACEPARENT` and `TRACESTATE` environment variables, it uses them as the parent context. This allows stitching traces across process boundaries (e.g., when an agent runs `minih check` during a `minih run`).

## Troubleshooting

**No traces appearing?**
- Verify `MINIH_TELEMETRY=true` is set
- Check that the LGTM container is running: `docker compose ps`
- Confirm port 4318 is accessible: `curl -s http://localhost:4318/v1/traces`
- If running inside a devcontainer with Docker-outside-of-Docker, `localhost` won't reach the LGTM container. Use the host gateway IP instead:

```bash
# Find the host gateway IP
ip route | grep default | awk '{print $3}'

# Export the correct endpoint (typically 172.17.0.1)
export OTEL_EXPORTER_OTLP_ENDPOINT=http://172.17.0.1:4318
```

**Telemetry slowing down CLI?**
- Shutdown is capped at 2 seconds — should not noticeably delay exit
- If the OTLP endpoint is unreachable, exporters time out after 1 second

**Want to disable for CI?**
- Simply don't set `MINIH_TELEMETRY` (default is disabled)
- Or set `OTEL_SDK_DISABLED=true` as an additional kill switch

## Zero overhead when disabled

When `MINIH_TELEMETRY` is not set (the default), minih guarantees zero telemetry overhead:

- **No eager SDK loading** — OTel SDK modules are only imported when telemetry is enabled
- **No token counting** — `gpt-tokenizer` is dynamically imported and only invoked when telemetry is active; the `minih.prompt.tokens` metric records 0 otherwise
- **No-op API** — the `@opentelemetry/api` package ships lightweight no-op implementations that do nothing when no SDK is registered
- **`minih resume` flush safety** — the resume command uses `printEnvelope()` + `process.exitCode` (not `process.exit()`) so the root span completes and telemetry flushes before the process exits
