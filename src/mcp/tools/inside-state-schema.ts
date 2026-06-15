/**
 * Plan 027 Phase 6 (T002) — shared mcp-internal inside-state schema resolver.
 *
 * Extracted verbatim from `state.ts` so BOTH surfaces resolve through one path:
 *   - `state.ts` (validation: `state_set` / `state_transition`)
 *   - `coordination-status.ts` (the AC-14 `allowedStates` self-discovery field)
 *
 * Intra-domain (mcp → mcp) by design — the cli `doctor` keeps its OWN resolver
 * (`resolveInsideStateSchemaPath`), since mcp ↔ cli imports are illegal.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { McpServerContext } from '../context.js';

/**
 * Built-in default inside-state schema — used when an agent ships no per-pack
 * schema at all. Resolved relative to THIS module; the file lives at
 * `src/schemas/inside-state.json` (the `../../schemas/` path is sibling-stable
 * across `state.ts` and this module).
 */
export const DEFAULT_INSIDE_STATE_SCHEMA = fileURLToPath(
  new URL('../../schemas/inside-state.json', import.meta.url),
);

/**
 * Resolves the inside-state JSON schema path with 3-level fallback:
 *   1. `<agentDir>/state/inside-state.schema.json` — preferred convention
 *      (groups state-related files under `state/`, matches Phase 2 view layout).
 *   2. `<agentDir>/inside-state.schema.json` — legacy ROOT fallback. This is
 *      where the `code-review-companion` schema lives and **stays** (PIC-1):
 *      `state/` is install-denied (`RUNTIME_DIR_NAMES`), so a relocated schema
 *      would drop out of the install payload and reopen #27/#31. Resolution must
 *      keep finding it at the root.
 *   3. `DEFAULT_INSIDE_STATE_SCHEMA` — built-in default
 *      (preserves agents that ship no inside-state schema at all).
 */
export function insideStateSchemaPath(context: McpServerContext): string {
  const preferred = path.join(
    context.agentDir,
    'state',
    'inside-state.schema.json',
  );
  if (fs.existsSync(preferred)) return preferred;
  const legacy = path.join(context.agentDir, 'inside-state.schema.json');
  if (fs.existsSync(legacy)) return legacy;
  return DEFAULT_INSIDE_STATE_SCHEMA;
}
