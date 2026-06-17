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
