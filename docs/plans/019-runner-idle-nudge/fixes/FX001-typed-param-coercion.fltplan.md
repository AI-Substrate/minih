# Flight Plan: Fix FX001 — Typed Param Coercion

**Fix**: [FX001-typed-param-coercion.md](FX001-typed-param-coercion.md)
**Status**: Ready

## What → Why

**Problem**: `minih run -p key=value` only passes string values. Integer-typed schema fields (idleBudgetMs, firstContactPollThreshold, etc.) fail E120 at boot. Plan 019 AC8 dogfood recipe is currently un-executable.

**Fix**: Auto-`JSON.parse` each `-p value`; fall back to raw string if parse fails. `Record<string,string>` → `Record<string,unknown>`. Backward-compatible (string values unaffected); typed values now work as expected.

## Domain Context

| Domain | Relationship | What Changes |
|--------|--------------|--------------|
| `cli` | modify | `commands/run.ts` + `commands/inspect.ts` param parsers auto-parse JSON |
| `runner` | modify | `AgentRunConfig.params` type widened; `validateInput` signature follows |

No contract changes between domains; AJV is the source of truth for input validation.

## Stages

- [ ] **Stage 1: Widen types** — `AgentRunConfig.params` + `validateInput` signature: `string` → `unknown` (`src/runner/types.ts`, `src/runner/validator.ts`)
- [ ] **Stage 2: Auto-coerce in CLI** — `-p key=value` parser tries `JSON.parse(value)`, falls back to raw string (`src/cli/commands/run.ts` + `src/cli/commands/inspect.ts`)
- [ ] **Stage 3: Help text + tests** — Update `--param` help, add `test/cli/run-typed-params.test.ts` covering int/bool/string/object/array/fallback
- [ ] **Stage 4: Unblock plan 019 AC8** — Remove the `mw-typed-input-params` blocker callout from spec AC8 + companion-mode.md "Configuring the protocol"
- [ ] **Stage 5: `just fft`** — Final gate; address all findings

## Acceptance

- [ ] Manual repro: `minih run code-review-companion -p firstContactPollThreshold=3 -p postTaskPollThreshold=2 -p replyWaitPolls=1` boots cleanly
- [ ] `-p name=alice` continues to produce string `"alice"` (backward compat)
- [ ] All existing tests pass; new typed-params test passes; `just fft` clean
- [ ] `mw-typed-input-params` followup marked `done`
