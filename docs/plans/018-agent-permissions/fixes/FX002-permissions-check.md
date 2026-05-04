# FX002 — `minih agent permissions check <slug>`

**Status**: DEFERRED (post-R6)
**Plan**: 018-agent-permissions
**Origin**: Spec OQ6 — dry-run that records intended attempts.

## Motivation

R1-R6 give us either ALLOW or DENY. There's no "would this work?" dry-run for a user about to migrate yolo → restricted.

`agent permissions check <slug>` runs the agent under a sandboxed handler:
- Always returns `approve-once` (run completes).
- Records every permission request.
- Compares to the *real* policy.
- Reports per-kind summary.

## Scope

```bash
minih agent permissions check <slug> [--against <preset>] [--dry-run-log <path>]
  [--params key=value] [--timeout <s>]
```

## Acceptance criteria

- AC-FX2.1: Run completes with always-approve handler that journals every request.
- AC-FX2.2: End-of-run summary table (Kind / Requests / WouldAllow / WouldDeny).
- AC-FX2.3: `--against <preset>` overrides the agent's preset for comparison.
- AC-FX2.4: `--dry-run-log <path>` writes NDJSON journal.
- AC-FX2.5: `result: 'check'` in completed.json (schema bump post-R6).

## Out of scope
- Truly-interactive prompts at each request.
- Replaying a journal against a different preset (different request streams).

## Risks
- Doubled handler cost — acceptable for one-time invocation.
- Behavioural divergence: agent may take different actions when an approve succeeds vs a real deny — document this.

## Testing
- TDD on the journal-recorder middleware (3 fixtures).
- Lightweight CLI summary table.
