# minih — declarative agent runner

# Full pipeline: format → lint → build → typecheck → test → audit → sdk-check
# format runs BEFORE lint so freshly-authored files are auto-formatted first;
# otherwise `lint` (biome check, CI-mode) fails on format drift before `format`
# ever runs (recurring friction on hand-cranked docs/plans/**/the-flow.json —
# bit plans 027 and 028; encoded from the harness retro harvest).
fft: format lint build typecheck test audit sdk-check

# Lint (code quality, suspicious patterns)
lint:
    npx biome check .

# Auto-format code
format:
    npx biome format --write .

# Build TypeScript → dist/
build:
    npm run build

# Strict type checking (no emit)
typecheck:
    npx tsc --noEmit

# Run all tests
test:
    npm test

# Watch tests
test-watch:
    npm run test:watch

# Dependency vulnerability scan
audit:
    npm audit --audit-level=high || true

# Warn (don't fail) if @github/copilot-sdk has a newer published version
# than what's installed. Network-tolerant: skips silently if npm view fails.
sdk-check:
    @bash scripts/check-sdk-version.sh

# Install all dependencies, build, and link `minih` to this repo
# (so fresh clones get a working `minih` CLI without npm-publishing).
install:
    npm install
    npm run build
    npm link
    @echo ""
    @echo "✅ minih linked to this repo. Try: minih list"
    @echo "   To unlink: npm unlink -g minih && npm install -g minih"

# Clean build artifacts
clean:
    npm run clean

# Build + test (quick check)
check: build test

# Pack for npm (dry run)
pack:
    npm pack --dry-run

# ── Observability — local OpenTelemetry LGTM stack ───────────────────────────
# Grafana + Tempo (traces) + Loki (logs) + Prometheus/Mimir (metrics) + OTLP
# collector, all in the grafana/otel-lgtm image (see docker-compose.yml).

# Start the LGTM stack and block until every backend is accepting data.
lgtm-up:
    docker compose up -d
    @just lgtm-check

# Each line is its own shell: loop ~60s per backend, else fail loudly.
# Block until Grafana, Tempo, Prometheus, and OTLP HTTP ingest are all ready.
lgtm-check:
    @command -v docker >/dev/null || { echo "Docker is required for the LGTM stack"; exit 1; }
    @echo "Waiting for LGTM (Grafana, Tempo, Prometheus, OTLP)..."
    @for i in $(seq 1 60); do curl -fsS http://127.0.0.1:3060/api/health >/dev/null 2>&1 && exit 0; sleep 1; done; echo "✗ Grafana not ready on http://127.0.0.1:3060"; exit 1
    @for i in $(seq 1 60); do curl -fsS http://127.0.0.1:3260/ready >/dev/null 2>&1 && exit 0; sleep 1; done; echo "✗ Tempo not ready on http://127.0.0.1:3260"; exit 1
    @for i in $(seq 1 60); do curl -fsS http://127.0.0.1:9190/-/ready >/dev/null 2>&1 && exit 0; sleep 1; done; echo "✗ Prometheus not ready on http://127.0.0.1:9190"; exit 1
    @for i in $(seq 1 60); do curl -fsS -X POST -H 'Content-Type: application/json' --data '{"resourceSpans":[]}' http://127.0.0.1:4328/v1/traces >/dev/null 2>&1 && exit 0; sleep 1; done; echo "✗ OTLP HTTP not accepting traces on http://127.0.0.1:4328"; exit 1
    @echo "✅ LGTM ready — Grafana http://localhost:3060 (anon admin) · OTLP http://localhost:4328 · Tempo :3260 · Prometheus :9190 · Loki :3160"

# Stop the LGTM stack (keeps the data volume).
lgtm-down:
    docker compose down

# Stop the LGTM stack AND delete its data volume (fresh slate).
lgtm-clean:
    docker compose down -v

# Tail the LGTM container logs.
lgtm-logs:
    docker compose logs -f lgtm

# Endpoint defaults to localhost:4328 (this stack's remapped OTLP port); inside a
# devcontainer override OTEL_EXPORTER_OTLP_ENDPOINT (e.g. http://host.docker.internal:4328).
# Run an agent with telemetry into the local stack: just telemetry-run <slug> [params...]
telemetry-run slug *PARAMS:
    MINIH_TELEMETRY=true \
    MINIH_TELEMETRY_VERBOSE=true \
    MINIH_LOG_LEVEL=debug \
    OTEL_EXPORTER_OTLP_ENDPOINT="${OTEL_EXPORTER_OTLP_ENDPOINT:-http://localhost:4328}" \
    npx minih run {{slug}} {{PARAMS}}
