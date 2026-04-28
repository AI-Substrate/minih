# Code Review Companion — Review Checklists

These are the checklists you apply per outside `task` message. You are a long-running pair, not a single-shot script: pick up the relevant checklist when a task arrives, apply it to the scope the outside actor specified, and report findings via `inbox_send` (one message per finding) plus a final `summary` message.

You may apply more than one checklist per task; tag each finding with the checklist it came from in the `category` field.

---

## A. Implementation Quality

For every changed file in scope:

- **Correctness** — logic errors, off-by-one, wrong default branches, swallowed `await`, unhandled rejection paths.
- **Null / undefined handling** — every `.foo` on a possibly-undefined value; optional-chaining used consistently; default values explicit.
- **Type mismatches** — `as` casts that hide a real type problem; `unknown`/`any` slipping into a contract; widened return types.
- **Edge cases** — empty input, single-element input, very large input; cancellation; retries.
- **Error handling** — try/catch that hides the real error; messages without context; no log/metric on the failure path.
- **Pattern adherence** — does the code follow conventions already established in the same file/module/domain? Diverging from a local pattern is a finding even if the new pattern is fine in isolation.
- **Scope** — do the changes match the spec's acceptance criteria, or is there silent expansion?

## B. Domain Compliance

If `docs/domains/registry.md` exists:

- File placement matches the domain it claims to extend (`src/<domain>/...`).
- Cross-domain imports go via the public contract (`<domain>/index.ts`), never reach into another domain's internals.
- Dependency direction respects the domain map (`docs/domains/domain-map.md`). For minih: `cli → {runner, mcp, adapter}`, `runner → adapter`, no upward imports.
- New contracts are exported from the domain barrel and reflected in the domain doc's Concepts table.
- Domain `History` row updated for the change.

## C. Anti-Reinvention

Before flagging a missing capability, check whether something already does it:

- Search the domain's `Concepts` table for the named capability.
- Search the source tree for a function/class that matches the intent, not just the name (e.g., a "throttle" might be called "debounce" or "coalesce" elsewhere).
- If a near-match exists, the finding is "extend X" not "add Y".

## D. Testing & Evidence

- Tests cover acceptance criteria the change claims to satisfy.
- Tests assert behavior (output / state transition / contract), not implementation detail.
- Edge cases are tested, not just the happy path.
- Failure paths are exercised — e.g., bad input, missing file, schema mismatch.
- Determinism — flake risks (timers, `Date.now`, file watch) are mitigated with fakes/injectors.

## Severity Guide

- **CRITICAL** — security vuln, data loss, broken public contract.
- **HIGH** — functional bug on a common path, AC not met, missing error handling for an expected failure.
- **MEDIUM** — edge case unhandled, weak coverage, contract drift from spec/workshop.
- **LOW** — minor improvement, stale doc, naming nit.

## Verdict per Task

If the outside `task` asked for a verdict (e.g., "is this PR good?"):

- Zero HIGH/CRITICAL → **APPROVE**
- HIGH/CRITICAL with reasonable mitigations → **APPROVE_WITH_NOTES**
- Unmitigated HIGH/CRITICAL → **REQUEST_CHANGES**

Send the verdict in the `summary` inbox message that wraps up the task.

## Reporting Style

- One `finding` inbox message per finding so the human view's workbench can render them as a list. Include `ackOf` pointing to the outside task message id.
- One `summary` inbox message at the end of each task with verdict (if relevant), totals, and a one-paragraph synthesis.
- Avoid duplicate findings across tasks in the same session — when re-reviewing the same scope after a change, refer to prior findings by id.

## Files to Always Read When in Scope

- The change itself (diff or named files).
- The relevant spec, plan, workshop, and tasks.md if the change is part of a tracked plan.
- The closest test file(s) for the changed code.
- The closest `docs/domains/<slug>/domain.md` for the touched domain.
