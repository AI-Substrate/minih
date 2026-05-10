/**
 * CLI param parser — shared between `minih run` and `minih inspect`.
 *
 * Plan 019 FX001 — auto-coerces `-p key=value` values via `JSON.parse`,
 * falling back to the raw string if parse fails. This lets agent
 * authors declare integer/boolean/object/array fields in their
 * input-schema and have orchestrators pass typed values from the
 * CLI without an additional flag.
 *
 * Examples:
 *   -p count=3            → integer 3
 *   -p enabled=true       → boolean true
 *   -p name=alice         → string "alice"           (parse fails, fallback)
 *   -p obj='{"k":1}'      → object { k: 1 }
 *   -p arr='[1,2,3]'      → array [1, 2, 3]
 *   -p val='"3"'          → string "3"               (quoted JSON)
 *   -p whatever=null      → JS null
 *
 * Prototype-pollution hardening: the resulting params map is
 * constructed with `Object.create(null)` so a malicious caller
 * passing `-p k='{"__proto__":{"x":1}}'` cannot pollute the prototype
 * chain if a downstream consumer ever spreads/merges the result.
 */

export interface ParamParseResult {
  params: Record<string, unknown>;
  /** First malformed entry (no `=` separator), if any — caller decides how to surface. */
  invalidEntry: string | null;
}

/**
 * Parse a list of `key=value` strings (from Commander's `-p` flag) into a
 * map of typed values. The map has a null prototype.
 */
export function parseParamFlags(entries: readonly string[]): ParamParseResult {
  const params = Object.create(null) as Record<string, unknown>;
  for (const entry of entries) {
    const eq = entry.indexOf('=');
    if (eq < 1) {
      return { params, invalidEntry: entry };
    }
    const key = entry.slice(0, eq);
    const rawValue = entry.slice(eq + 1);
    let parsed: unknown = rawValue;
    try {
      parsed = JSON.parse(rawValue);
    } catch {
      // Not valid JSON — keep as raw string. Backward compatible:
      // -p name=alice still produces "alice".
    }
    params[key] = parsed;
  }
  return { params, invalidEntry: null };
}
