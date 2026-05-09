# Flight Plan: Fix FX001 — Typed Param Coercion

**Fix**: [FX001-typed-param-coercion.md](FX001-typed-param-coercion.md)
**Status**: **Landed** (2026-05-09)

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

- [x] **Stage 1: Widen types** — `AgentRunConfig.params` + `validateInput` signature: `string` → `unknown` (`src/runner/types.ts`, `src/runner/validator.ts`) — commit `f4fde73`
- [x] **Stage 2: Auto-coerce in CLI** — `-p key=value` parser tries `JSON.parse(value)`, falls back to raw string; constructs result via `Object.create(null)` to harden against prototype pollution (`src/cli/commands/run.ts` + `src/cli/commands/inspect.ts` + new `src/cli/param-parser.ts`) — commit `f42852a`
- [x] **Stage 3: Help text + docs sync + tests** — Updated `--param` help, synced `README.md` and `docs/plans/001-setup/workshops/007-agent-runtime-environment.md` to describe `MINIH_PARAMS` typed-value reality, added `test/cli/run-typed-params.test.ts` covering int/bool/string/object/array/fallback + a runner-level end-to-end assertion (20 tests pass) — commits `04deb7e` + `c80d685`
- [x] **Stage 4: Unblock plan 019 AC8** — Removed the `mw-typed-input-params` blocker callout from spec AC8 + companion-mode.md "Configuring the protocol"; replaced `--input-json '{...}'` examples with the actual working `-p key=value` form
- [ ] **Stage 5: `just fft`** — Final gate; address all findings

## Acceptance

- [x] Manual repro: `minih run code-review-companion -p firstContactPollThreshold=3 -p postTaskPollThreshold=2 -p replyWaitPolls=1` boots cleanly — verified live in run `2026-05-09T10-25-25-419Z-8784` (3min 15s, exit 0, validated)
- [x] Check-in fired at ~90s; companion farewelled with `no_engagement` after `replyWaitPolls=1` wait window — full AC1 + AC2 + AC8 cycle verified
- [x] `-p name=alice` continues to produce string `"alice"` (backward compat) — covered in test/cli/run-typed-params.test.ts
- [x] All existing tests pass; new typed-params test passes (20/20)
- [x] `mw-typed-input-params` followup marked `done`
