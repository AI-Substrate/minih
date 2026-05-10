#!/usr/bin/env bash
# Warn (don't fail) if @github/copilot-sdk has a newer published version
# than what's installed. Network-tolerant: skips silently if npm view fails.
#
# Used by `just sdk-check` (and therefore by `just fft`).

set -u

installed=$(node -p "require('./node_modules/@github/copilot-sdk/package.json').version" 2>/dev/null || echo "")
latest=$(npm view @github/copilot-sdk version 2>/dev/null || echo "")

if [ -z "$installed" ] || [ -z "$latest" ]; then
  echo "⚠️  sdk-check: could not resolve @github/copilot-sdk versions (offline?). skipping."
  exit 0
fi

if [ "$installed" = "$latest" ]; then
  echo "✓ @github/copilot-sdk: $installed (latest)"
else
  echo "⚠️  @github/copilot-sdk: installed $installed → latest $latest"
  echo "    run: npm install @github/copilot-sdk@latest"
fi
