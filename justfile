# minih — declarative agent runner

# Full pipeline: lint → format → build → typecheck → test → audit
fft: lint format build typecheck test audit

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

# Install all dependencies
install:
    npm install

# Clean build artifacts
clean:
    npm run clean

# Build + test (quick check)
check: build test

# Pack for npm (dry run)
pack:
    npm pack --dry-run

# Start the LGTM observability stack (Grafana, Tempo, Loki, Mimir, OTel Collector)
lgtm-up:
    docker compose up -d

# Stop the LGTM stack
lgtm-down:
    docker compose down

# Run an agent with full telemetry (usage: just telemetry-run <slug> [params...])
telemetry-run slug *PARAMS:
    MINIH_TELEMETRY=true \
    MINIH_TELEMETRY_VERBOSE=true \
    MINIH_LOG_LEVEL=debug \
    OTEL_EXPORTER_OTLP_ENDPOINT=http://$(ip route | grep default | awk '{print $3}'):4318 \
    npx minih run {{slug}} {{PARAMS}}
