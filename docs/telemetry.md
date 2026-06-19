# Telemetry

minih supports OpenTelemetry instrumentation for traces, metrics, and structured logs. Telemetry is **opt-in** — disabled by default with zero overhead.

## Quick start

```bash
# Start the local observability stack (idempotent; waits until ready)
just lgtm-up

# Run an agent with telemetry flowing into the stack
just telemetry-run hello-world
# …or manually — note this stack's OTLP port is 4328, not the 4318 default:
# MINIH_TELEMETRY=true OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4328 minih run hello-world

# View traces in Grafana (anonymous admin)
open http://localhost:3060
```

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MINIH_TELEMETRY` | unset | Set to `true` to enable telemetry |
| `MINIH_TELEMETRY_VERBOSE` | unset | Set to `true` to include prompt content and tool outputs in spans |
| `MINIH_LOG_LEVEL` | `info` | Minimum log severity: `debug`, `info`, `warn`, `error` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318` | OTLP collector endpoint. The bundled `just lgtm-up` stack listens on `http://localhost:4328` (remapped to coexist with other stacks); `just telemetry-run` sets this for you. |
| `OTEL_SERVICE_NAME` | `minih` | Override the service name in traces |
| `OTEL_RESOURCE_ATTRIBUTES` | — | Additional resource attributes (e.g., `deployment.environment=ci`) |
| `MINIH_TELEMETRY_FLUSH_MS` | `1500` | Settle window (ms) after a run so the Copilot CLI subprocess flushes its span exporter before shutdown. Bounded to `[0, 30000]`; `0` disables the wait. |

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

#### Coordinated runs

Coordinated agents (those with `coordination: enabled`) add spans for the inter-agent channel.
The **inside MCP coordination server** runs as a separate process; its tool calls are stitched
into the run trace via a `TRACEPARENT` injected at spawn (it roots under `minih.run.execution`):

```
minih.run.execution                            (minih)
  └── minih.mcp.inbox_send                     (minih · MCP subprocess)
  └── minih.mcp.state_transition               (minih · MCP subprocess)  [state.from, state.to]
  └── minih.coordination.message_received      (minih · inbox forwarder)
        ⇢ link → producer span (from the message's traceparent)
  └── minih.coordination.state_change          (minih · state forwarder)
```

Inbox messages carry the producer's `traceparent` (W3C). When the forwarder delivers an outside
message to the inside agent, it creates a `minih.coordination.message_received` span **linked** to
the producer's span — async messaging connects sender↔receiver with span links, not parent/child.

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
| `minih.coordination.messages_sent` | Counter | Inbox messages sent (attrs: `type`, `sender`) |
| `minih.coordination.messages_received` | Counter | Inbox messages delivered to the inside agent (attr: `type`) |
| `minih.coordination.state_transitions` | Counter | Inside-state transitions (attrs: `from`, `to`) |

### Logs

Structured logs are emitted at key points (run start/complete, validation results, adapter errors) and automatically correlate with the active trace via trace ID.

## Viewing telemetry

### Traces (Tempo)

1. Open Grafana at `http://localhost:3060`
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

- **Loki** — log aggregation (host port 3160)
- **Grafana** — visualization UI (host port 3060)
- **Tempo** — distributed tracing (host port 3260)
- **Mimir** — metrics, Prometheus-compatible (host port 9190)
- **OpenTelemetry Collector** — receives OTLP on host ports 4327 (gRPC) and 4328 (HTTP)

Host ports are shifted off the OTel defaults so this stack coexists with any other
LGTM/OTLP stack already running on the host (container-internal ports are unchanged).

```bash
just lgtm-up        # start + wait until every backend is ready
just lgtm-down      # stop (keeps the data volume)
just lgtm-clean     # stop + wipe the data volume (fresh slate)
just lgtm-logs      # tail the container logs
# (plain `docker compose up -d` / `down` also work)
```

## Sensitive data

By default, spans contain only safe metadata: agent slug, run ID, model name, character counts, durations, and success/failure indicators. No prompt content, tool outputs, or environment variable values are exported.

Set `MINIH_TELEMETRY_VERBOSE=true` to include prompt bodies and tool outputs — use only when you control the telemetry backend.

## Cross-process trace stitching

If minih detects `TRACEPARENT` and `TRACESTATE` environment variables, it uses them as the parent context. This allows stitching traces across process boundaries (e.g., when an agent runs `minih check` during a `minih run`).

### Cross-run stitching (orchestrator → agent)

minih reads `TRACEPARENT` at startup but never sets it for you — so an orchestrator that shells out
to `minih run` can stitch the child's entire trace under its own span by exporting the active
context first:

```bash
# Inside an already-traced process (TRACEPARENT reflects the active span):
TRACEPARENT="00-<trace>-<span>-01" \
  MINIH_TELEMETRY=true OTEL_EXPORTER_OTLP_ENDPOINT=$OTEL_EXPORTER_OTLP_ENDPOINT \
  minih run worker-agent
```

The child run's root span (`minih.cli.command`) becomes a child of the supplied context (DD11), so
the orchestrator and worker appear in one trace.

For **inter-agent messages** (one run writing to another's inbox via `minih outside inbox send`),
linking is automatic and finer-grained: each message carries the sender's `traceparent`, and the
receiving run's forwarder emits a `minih.coordination.message_received` span **linked** to the
sender's span — no env wiring required.

## Troubleshooting

**No traces appearing?**
- Verify `MINIH_TELEMETRY=true` is set
- Check that the LGTM container is running: `docker compose ps` (or `just lgtm-check`)
- Confirm the OTLP port is accessible: `curl -s http://localhost:4328/v1/traces`
- If running inside a devcontainer with Docker-outside-of-Docker, `localhost` won't reach the LGTM container. Use the host gateway IP instead:

```bash
# Find the host gateway IP
ip route | grep default | awk '{print $3}'

# Export the correct endpoint (typically 172.17.0.1, this stack's port)
export OTEL_EXPORTER_OTLP_ENDPOINT=http://172.17.0.1:4328
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
