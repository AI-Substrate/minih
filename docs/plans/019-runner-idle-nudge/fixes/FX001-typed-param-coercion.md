# Fix FX001: Typed Param Coercion (`-p key=value` auto-parses JSON)

**Created**: 2026-05-07
**Status**: Proposed
**Plan**: [019-runner-idle-nudge](../runner-idle-nudge-spec.md) (surfacing context — fix is generic CLI infra)
**Source**: `mw-typed-input-params` followup + companion magicWand from plan 019 smoke run (`2026-05-07T08-36-36-851Z-feed`) — *"Add a first-class minih CLI recipe for starting a coordinated agent with typed JSON input overrides"*. Also referenced as Discovery 1 in `docs/plans/009-human-agent-view/tasks/phase-1-run-contract-and-view-model/execution.log.md:105`.
**Domain(s)**: `cli` modify (param parsing); `runner` modify (type signature on `AgentRunConfig.params`)

---

## Problem

`minih run --param key=value` (`-p`) parses the value as a literal string and stores it in `AgentRunConfig.params: Record<string, string>`. When the agent's `input-schema.json` declares a non-string field type (most commonly `integer` for tunables like `idleBudgetMs`, `firstContactPollThreshold`, `replyWaitPolls`, etc.), the runner's `validateInput()` path fails immediately with `E120: Input parameter validation failed: /<field>: must be integer`. The agent never boots.

Concrete impact: plan 019's AC8 ("configurable thresholds work") encoded a tight-threshold dogfood recipe that's currently **un-executable** because there is no working CLI surface for typed input. Plan 009's earlier discovery noted the same gap. Two independent agents (the orchestrator + the canonical companion's farewell magicWand) have flagged it.

## Proposed Fix

In `src/cli/commands/run.ts` (and matching site in `src/cli/commands/inspect.ts`), the `-p key=value` parser becomes:

```ts
let parsed: unknown = value;
try {
  parsed = JSON.parse(value);  // "3" → 3, "true" → true, '{"k":1}' → {k:1}, '"hello"' → "hello"
} catch {
  // Not valid JSON — keep raw string. Backward compatible: -p name=alice still works.
}
params[key] = parsed;
```

Type ripples:
- `AgentRunConfig.params?: Record<string, string>` → `Record<string, unknown>`
- `validateInput(schemaPath: string, params: Record<string, string>)` → `Record<string, unknown>`
- `MINIH_PARAMS` env var continues to be `JSON.stringify(params)` (works for any value)

AJV validation in `validateInput` remains the source of truth — it validates the actual JS values against the schema, so typing the input as `unknown` is correct.

**Backward compatibility**: existing string-only schemas continue to work. `-p name=alice` parses as JSON and falls back to `"alice"` string when `JSON.parse('alice')` throws. The only behavior change is that values that *happen* to be valid JSON (numbers, booleans, JSON literals) now produce typed values instead of strings — which was the explicit goal.

**Edge case**: if a user genuinely needs a literal string value of `"3"` or `"true"` for a string-typed field, they need quoted JSON: `-p val='"3"'`. Documented in the help text and a small recipe in `companion-mode.md`'s "Configuring the protocol" section.

## Domain Impact

| Domain | Relationship | What Changes |
|--------|--------------|--------------|
| `cli` | **modify** | `commands/run.ts` + `commands/inspect.ts` param parser auto-parses JSON |
| `runner` | **modify** | `AgentRunConfig.params` type widens `string` → `unknown`; `validateInput` signature follows |

No contract changes (runner→adapter, mcp→runner, etc. unaffected). Single-file ripples. No new commands, no new flags.

## Tasks

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|--------|-----|------|--------|---------|-----------|-------|
| [ ] | FX001-1 | Widen `AgentRunConfig.params` type from `Record<string,string>` to `Record<string,unknown>`; update `validateInput` signature | runner | `/Users/jordanknight/substrate/minih/src/runner/types.ts`, `/Users/jordanknight/substrate/minih/src/runner/validator.ts` | typecheck passes; existing tests pass unchanged | AJV doesn't care about TS types — schema is source of truth |
| [ ] | FX001-2 | Auto-parse JSON in `-p key=value` parser in `run.ts` (try `JSON.parse(value)`, fallback to raw string on parse error) | cli | `/Users/jordanknight/substrate/minih/src/cli/commands/run.ts` | `-p count=3` produces integer 3; `-p name=alice` still produces string "alice"; `-p enabled=true` produces boolean true | F6 fix design above |
| [ ] | FX001-3 | Mirror auto-parse in `inspect.ts` `-p` parser | cli | `/Users/jordanknight/substrate/minih/src/cli/commands/inspect.ts` | inspect's `--dry-run` preview shows typed values consistent with run | parity with FX001-2 |
| [ ] | FX001-4 | Update `--param` help text in `run.ts` to mention JSON auto-coercion + escape recipe for literal-string-of-numeric | cli | `/Users/jordanknight/substrate/minih/src/cli/commands/run.ts` | `minih run --help` mentions JSON parsing + the `-p val='"3"'` escape | small docs touch |
| [ ] | FX001-5 | Add `test/cli/run-typed-params.test.ts` covering integer/boolean/string/JSON-object/JSON-array/parse-fallback cases | cli (test) | `/Users/jordanknight/substrate/minih/test/cli/run-typed-params.test.ts` | tests pass; covers all 6 JSON value types + fallback | exercise validateInput end-to-end |
| [ ] | FX001-6 | Update plan 019 spec AC8 + companion-mode.md "Configuring the protocol" — drop the `mw-typed-input-params` blocker callout, restore the working recipes (now using `-p` with JSON values per FX001) | docs | `/Users/jordanknight/substrate/minih/docs/plans/019-runner-idle-nudge/runner-idle-nudge-spec.md`, `/Users/jordanknight/substrate/minih/docs/how/companion-mode.md` | the companion-mode "Configuring" section recipes work as-typed; plan 019 AC8 reads as "verified" | unblocks plan 019 AC8 |
| [ ] | FX001-7 | Run `just fft`; address all findings | — | — | gate green | standard close |

## Workshops Consumed

None — fix is self-contained CLI infra change.

## Acceptance

- [ ] `minih run code-review-companion -p firstContactPollThreshold=3 -p postTaskPollThreshold=2 -p replyWaitPolls=1` boots successfully (no E120) — manually verified
- [ ] `-p name=alice` (raw string) continues to work unchanged
- [ ] All existing tests pass; new test/cli/run-typed-params.test.ts passes
- [ ] `mw-typed-input-params` followup marked `done` after FX001-7
- [ ] Plan 019 AC8 verification clause updated to remove the blocker callout
- [ ] `just fft` clean

## Out of Scope

- A separate `--input-json '{...}'` flag. Auto-coercion of `-p` covers the same need with smaller surface; we may add a JSON-file flag later if multi-line config becomes painful, but that's a separate fix.
- Validation error messages in `E120` — already adequate; AJV's `must be integer` is clear enough.
- Other CLI commands' param parsing (only `run` and `inspect` accept `-p key=value` today).

## Discoveries & Learnings

_Populated during implementation._

| Date | Task | Type | Discovery | Resolution |
|------|------|------|-----------|------------|
