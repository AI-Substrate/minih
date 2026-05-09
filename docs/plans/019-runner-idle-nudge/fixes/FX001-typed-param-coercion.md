# Fix FX001: Typed Param Coercion (`-p key=value` auto-parses JSON)

**Created**: 2026-05-07
**Status**: Proposed
**Plan**: [019-runner-idle-nudge](../runner-idle-nudge-spec.md) (surfacing context — fix is generic CLI infra)
**Source**: `mw-typed-input-params` followup + companion magicWand from plan 019 smoke run (`2026-05-07T08-36-36-851Z-feed`). The companion's farewell named two acceptable shapes for resolving the gap: *"a documented `minih run <slug> --input-json '{...}'` path"* OR *"`--param` should JSON.parse values when the target schema declares non-string types (auto-coerce)"*. **FX001 picks the second shape** (auto-coerce on existing `-p`) because it has smaller CLI surface, requires no new flag, and resolves the same blocker. Rationale captured under § Out of Scope. Also referenced as Discovery 1 in `docs/plans/009-human-agent-view/tasks/phase-1-run-contract-and-view-model/execution.log.md:105`.
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
| [ ] | FX001-2 | Auto-parse JSON in `-p key=value` parser in `run.ts` (try `JSON.parse(value)`, fallback to raw string on parse error). **Construct the resulting `params` map as `Object.create(null)`** to avoid prototype-pollution risk if a user passes `-p k='{"__proto__":{"x":1}}'` and a future consumer spreads/merges the result. | cli | `/Users/jordanknight/substrate/minih/src/cli/commands/run.ts` | `-p count=3` produces integer 3; `-p name=alice` still produces string "alice"; `-p enabled=true` produces boolean true; `-p obj='{"__proto__":{"x":1}}'` does not pollute prototypes | F6 fix design above; prototype hardening per validate-v2 finding |
| [ ] | FX001-3 | Mirror auto-parse in `inspect.ts` `-p` parser (same `Object.create(null)` hardening) | cli | `/Users/jordanknight/substrate/minih/src/cli/commands/inspect.ts` | inspect's `--dry-run` preview shows typed values consistent with run | parity with FX001-2 |
| [ ] | FX001-4 | Update `--param` help text in `run.ts` to mention JSON auto-coercion + escape recipe for literal-string-of-numeric (`-p val='"3"'`); also update `README.md:321` and `docs/plans/001-setup/workshops/007-agent-runtime-environment.md:101` to describe `MINIH_PARAMS` as carrying typed values (numbers, booleans, objects, arrays) — not just strings | cli + docs | `/Users/jordanknight/substrate/minih/src/cli/commands/run.ts`, `/Users/jordanknight/substrate/minih/README.md`, `/Users/jordanknight/substrate/minih/docs/plans/001-setup/workshops/007-agent-runtime-environment.md` | `minih run --help` mentions JSON parsing + the `-p val='"3"'` escape; README and runtime-env workshop describe `MINIH_PARAMS` value types accurately | docs sync per validate-v2 cross-ref + forward-compat findings |
| [ ] | FX001-5 | Add `test/cli/run-typed-params.test.ts` covering integer/boolean/string/JSON-object/JSON-array/parse-fallback cases. **Plus a runner-level assertion** (in the same file or in `test/runner/`) that typed params survive end-to-end: a `validateInput()` call with mixed-type params passes, and the resulting `MINIH_PARAMS` env var contains typed values (e.g. `{"count":3}` not `{"count":"3"}`). | cli (test) + runner (test) | `/Users/jordanknight/substrate/minih/test/cli/run-typed-params.test.ts` | tests pass; covers all 6 JSON value types + fallback + end-to-end runner ripple | exercise validateInput + MINIH_PARAMS propagation per validate-v2 forward-compat finding |
| [ ] | FX001-6 | Update plan 019 spec AC8 + companion-mode.md "Configuring the protocol" to remove the blocker callout AND replace the `--input-json '{...}'` recipes (currently labelled `(intended, post-mw-typed-input-params)`) with the actual working `-p key=value` form using JSON values, e.g. `-p firstContactPollThreshold=3 -p postTaskPollThreshold=2 -p replyWaitPolls=1` | docs | `/Users/jordanknight/substrate/minih/docs/plans/019-runner-idle-nudge/runner-idle-nudge-spec.md`, `/Users/jordanknight/substrate/minih/docs/how/companion-mode.md` | both files describe `-p` syntax (no `--input-json` references); plan 019 AC8 reads as "verified" without the blocker prose | unblocks plan 019 AC8 |
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
- **Auditing/refactoring agent prompts that read `MINIH_PARAMS`** — there are zero in-tree consumers today (verified via repo-wide grep on 2026-05-09 — only `src/runner/runner.ts:605` writes the env var, no agent prompt reads it). Future agents that adopt `MINIH_PARAMS` should design for typed values from day one. The `MINIH_PARAMS` value content change (string-only → mixed types) is documented in FX001-4's docs sync but is otherwise a forward-compatible change because no current consumer is broken.

## Note on the `MINIH_PARAMS` wire shape

The env var still contains `JSON.stringify(params)` — that part is unchanged. **The values inside that JSON do change**: pre-FX001 they were always JSON strings; post-FX001 they may be JSON numbers, booleans, objects, arrays, or strings depending on what the user passed via `-p`. The validate-v2 forward-compat agent flagged this as a contract drift risk for downstream agents that read `MINIH_PARAMS` — but a repo-wide grep confirmed no in-tree consumer reads it today. FX001-4 updates the README and the runtime-env workshop to document the typed-value reality, so future agent authors design correctly. If a future agent author needs the legacy string-only shape, they can stringify each value at read time.

## Discoveries & Learnings

_Populated during implementation._

| Date | Task | Type | Discovery | Resolution |
|------|------|------|-----------|------------|

---

## Validation Record (2026-05-09)

| Agent | Lenses Covered | Issues | Verdict |
|-------|---------------|--------|---------|
| Source Truth + Correctness | Source Truth, Hidden Assumptions, Technical Constraints, Edge Cases & Failures | 0 | ✅ |
| Cross-Reference + Integration | Integration & Ripple, Concept Documentation, Domain Boundaries, Hidden Assumptions | 1 HIGH fixed, 1 MEDIUM fixed | ⚠️ → ✅ |
| Forward-Compatibility | Forward-Compatibility (mandatory), Hidden Assumptions, Edge Cases & Failures, Deployment & Ops | 3 MEDIUM fixed, 2 LOW fixed | ⚠️ → ✅ |

**Lens coverage**: 11/12 (above the 8-floor — only User Experience lens unaddressed, which is fine for a CLI infra fix; the change is observable as "fewer E120 errors at boot").

### Forward-Compatibility Matrix

| Consumer | Requirement | Failure Mode | Verdict | Evidence |
|----------|-------------|--------------|---------|----------|
| C1: AC8 dogfood recipe | `-p firstContactPollThreshold=3` must stop failing E120 | contract drift | ✅ | `spec:125` blocker is on string-only CLI parsing; FX001 parser + widened `validateInput` resolves it |
| C2: companion-mode.md recipes | recipes must be runnable as-typed (no `--input-json` references) | shape mismatch | ✅ (after FX001-6) | FX001-6 explicitly replaces `--input-json` syntax with `-p key=value` form |
| C3: future typed-schema agents | boolean/integer/object/array params should flow through | shape mismatch + encapsulation lockout | ✅ | `JSON.parse` covers all JSON types; fallback preserves raw strings; literal-string escape (`-p val='"3"'`) documented in FX001-4 |
| C4: validateInput callers | type widening must not break callers/tests | shape mismatch | ✅ | only prod caller is `runner.ts:517`; existing tests assignable as-is |
| C5: MINIH_PARAMS consumers | downstream readers must tolerate mixed types | contract drift | ✅ | repo-wide grep confirms zero in-tree consumers; docs sync (FX001-4) updates README + workshop to reflect typed-value reality; future agents design for it |

**Outcome alignment**: The spec promised *"the canonical defaults (20/10/4 polls = ~10/5/2 min) are the only thresholds users can reach from the CLI"* — FX001-as-specified removes the "only" by enabling typed `-p` overrides; combined with the docs sync and prototype-pollution hardening from validation, the artifact substantially advances the Outcome.

**Standalone?**: No — five named downstream consumers (C1–C5).

**Fixes applied (HIGH)**:
- Source line on dossier rewrote to acknowledge magicWand-shape selection (auto-coerce `-p` over `--input-json` flag) with rationale linking to § Out of Scope.

**Fixes applied (MEDIUM)**:
- FX001-6 task wording: explicit replacement of `--input-json` syntax with `-p key=value` form (was ambiguous "restore the working recipes").
- FX001-4 task scope: now also updates `README.md:321` and `docs/plans/001-setup/workshops/007-agent-runtime-environment.md:101` to describe `MINIH_PARAMS` typed-value reality.
- FX001-5 task scope: now includes a runner-level end-to-end assertion that typed params reach `MINIH_PARAMS` env var, not just CLI-side parsing.

**Fixes applied (LOW)**:
- FX001-2/FX001-3: prototype-pollution hardening via `Object.create(null)` for the params map.
- New § Note on the `MINIH_PARAMS` wire shape: explicit documentation of the value-type change, with the "no current consumers" finding cited.

**Open**: None. All findings folded back into the dossier inline.

Overall: **VALIDATED WITH FIXES**
