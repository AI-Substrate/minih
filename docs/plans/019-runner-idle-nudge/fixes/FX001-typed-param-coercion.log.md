# Execution Log: Fix FX001 — Typed Param Coercion

**Status**: Landed (2026-05-09)
**Plan**: 019-runner-idle-nudge / FX001
**Branch**: 007-backgrounding

---

## Per-task ledger

### FX001-1 — Widen types (commit `f4fde73`)

Files touched:
- `src/runner/types.ts` — `AgentRunConfig.params: Record<string,string>` → `Record<string,unknown>`
- `src/runner/validator.ts` — `validateInput()` signature follows; JSDoc updated
- `src/cli/commands/run.ts` — added `formatParamValue()` helper for two display sites (preflight banner + paramsHint)

Evidence: typecheck clean; existing tests pass (33/33 for validator + runner + run-help).

Discovery: type widening exposed two display sites in `run.ts` that used the raw `v` value as a string. Added a small `formatParamValue` helper that renders strings as-is, everything else via `JSON.stringify`. This is a quality-of-life improvement (preflight now shows `param:count (3)` instead of `[object Object]` for object params) folded into the same commit.

### FX001-2 + FX001-3 — Auto-coerce in CLI (commit `f42852a`)

Files touched:
- `src/cli/param-parser.ts` (NEW) — shared `parseParamFlags(entries)` helper
- `src/cli/commands/run.ts` — replaced inline parser with `parseParamFlags` call
- `src/cli/commands/inspect.ts` — same; preserves tolerant skip-malformed-entry behavior

Helper details: tries `JSON.parse(value)` per entry; falls back to raw string on parse error; constructs result via `Object.create(null)` for prototype-pollution hardening.

Evidence — **live behavioral verification** in run `2026-05-09T10-25-25-419Z-8784`:
- Boot succeeded with `-p firstContactPollThreshold=3 -p postTaskPollThreshold=2 -p replyWaitPolls=1` (no E120)
- Companion oriented at ~30s
- First-contact check-in `[question] still-needed` posted to inside inbox at ~120s (after ~3 empty polls)
- Companion farewelled `[farewell] standing-down` at ~150s (after `replyWaitPolls=1` wait window)
- Total runtime: 3min 15s; exit 0; output schema validates
- This proves AC1, AC2, and AC8 of plan 019 all behaviorally — exactly the criteria FX001 was created to unblock

### FX001-4 — Help text + docs sync (commit `04deb7e`)

Files touched:
- `src/cli/commands/run.ts` — `--param` help text expanded with examples + literal-string escape recipe
- `src/cli/commands/inspect.ts` — same
- `README.md:321` — `MINIH_PARAMS` row updated to acknowledge typed values
- `docs/plans/001-setup/workshops/007-agent-runtime-environment.md:101` — same with example + warning that agents should not assume string values; cross-references FX001

These resolve the validate-v2 Forward-Compatibility finding C5 (MINIH_PARAMS contract drift). Repo-wide grep confirmed zero in-tree consumers, so this is a forward-compatible documentation change.

### FX001-5 — Tests (commit `c80d685`)

File touched:
- `test/cli/run-typed-params.test.ts` (NEW) — 20 tests

Coverage:
- 13 parser tests: int/bool/null/object/array/quoted-JSON-string types; parse-fallback for non-JSON; equals-sign preservation; malformed-entry detection; repeated-key semantics; empty value; **prototype-pollution hardening verification** (`Object.getPrototypeOf(params)` is `null`); empty input
- 7 runner-end-to-end tests using a tmpdir fixture schema with int/bool/string/array fields:
  - integer/boolean/string/array params validate cleanly
  - **regression guard**: pre-FX001 string-typed integer is rejected by AJV (proves the bug class returns if FX001-2 ever regresses)
  - **MINIH_PARAMS round-trip**: typed values survive `JSON.stringify` → `JSON.parse` with types intact; wire format contains `"count":3` (number) not `"count":"3"` (string)

All 20 tests pass.

### FX001-6 — Unblock plan 019 AC8 (this stage)

Files touched:
- `docs/plans/019-runner-idle-nudge/runner-idle-nudge-spec.md` — AC8 verification clause rewritten; `mw-typed-input-params` blocker callout removed; `## Fixes` table entry marked Complete
- `docs/how/companion-mode.md` § "Configuring the protocol" — removed the warning callout; replaced `--input-json '{...}'` recipes with `-p key=value` form
- This execution log + the FX001 flight plan updated to Landed status

The contract drift introduced in commit `ebb7676` (the "acknowledge typed-input CLI gap" commit) is now reversed.

### FX001-7 — `just fft` final gate (next)

To run.

---

## Discoveries

| Date | Task | Type | Discovery | Resolution |
|------|------|------|-----------|------------|
| 2026-05-09 | FX001-1 | unexpected-behavior | Type widening exposed 2 display sites in run.ts (preflight banner + paramsHint) that needed string-coercion. | Added `formatParamValue()` helper in same commit; renders typed values via JSON.stringify for display. |
| 2026-05-09 | FX001-2 | insight | The `Object.create(null)` hardening (validate-v2 finding) is a property of the OUTER params map, not the inner JSON-parsed value. Modern JSON.parse (Node 14+) treats `__proto__` as a regular property of the parsed object, NOT on the prototype chain. | The hardening protects future code that spreads/merges `params` into a plain object — verified in test by checking `Object.getPrototypeOf(params)` is null. |
| 2026-05-09 | FX001-2 | insight | The live smoke run completed the FULL AC1+AC2+AC8 cycle (boot → orient → first-contact check-in → farewell `no_engagement`) in 3min 15s. The plan 019 protocol works end-to-end with FX001. | Recorded as evidence in FX001-6 spec update; serves as durable proof for plan 019 ACs as well as FX001 acceptance. |
| 2026-05-09 | FX001-5 | gotcha | Vitest test file resolved paths via `path.resolve('agents')` (cwd-relative) in the existing precedent (`test/agents/permissions-explicit.test.ts`); using `fileURLToPath(new URL('../../../', ...))` from a deeper test dir gives the wrong root. | Used `path.resolve(...)` and `os.tmpdir()` for the tmpdir fixture; tests pass from any cwd. |
