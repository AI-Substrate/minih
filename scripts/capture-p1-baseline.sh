#!/usr/bin/env bash
# Capture pre-P1 (or post-P1) backward-compat baseline.
#
# Per code-review F003 (2026-04-26): `minih check` requires `--file <path>` to
# validate, so the previous version's per-agent `check` calls produced E108
# argument errors instead of structural evidence. The real backward-compat probe
# is `minih doctor` (full agent audit, exit 0, structurally identical pre/post
# unless agent definitions change). `minih list` adds an additional structural
# probe of agent discovery.
#
# `minih run hello-world` baseline is INTENTIONALLY skipped — it would invoke a
# real Copilot SDK session whose timestamps + agent reasoning are inherently
# non-deterministic; the diff-baselines key-strip would have to whitelist far
# too much to be meaningful. doctor + list cover the surface P1 actually
# touches (folder discovery, frontmatter parsing, schema loading).
#
# Usage:
#   bash scripts/capture-p1-baseline.sh <output-dir>

set -euo pipefail

OUT="${1:-baselines}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI="$ROOT/dist/cli/index.js"

if [[ ! -f "$CLI" ]]; then
  echo "ERROR: $CLI not found. Run 'npm run build' first." >&2
  exit 1
fi

mkdir -p "$OUT"

# 1) doctor — full agent audit (the canonical backward-compat probe)
node "$CLI" doctor > "$OUT/doctor.json"

# 2) list — agent discovery surface
node "$CLI" list > "$OUT/list.json"

echo "Captured baseline to $OUT/" >&2
ls "$OUT/" >&2
