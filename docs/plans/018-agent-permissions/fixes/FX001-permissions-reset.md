# FX001 — `minih agent permissions reset <slug>`

**Status**: DEFERRED (post-R6)
**Plan**: 018-agent-permissions
**Origin**: Spec OQ4 — "Should there be a way to clear `lockedDefault`?"
**Resolution**: YES, but ship as a follow-up.

## Motivation

R3 sidecar `lockedDefault` is intentionally lossless — once an install captures intent, no later minih binary will overwrite it. This is the lossless-preservation invariant from workshop 003 § Q3.

Sometimes the user wants to reset:
- Picked yolo at install, now wants to migrate to restricted without re-installing.
- Manifest's `recommended` value changed upstream; user wants to opt back in.
- Debugging: confirm the resolution chain falls through cleanly.

## Scope

```bash
minih agent permissions reset <slug>
  [--to <preset>]              # set to a specific preset instead of clearing
  [--reason "<text>"]
  [--yes]
```

## Acceptance criteria

- AC-FX1.1: `reset <slug>` clears `lockedDefault*` fields from sidecar.
- AC-FX1.2: `--to <preset>` writes `lockedDefault: <preset>` + `lockedDefaultReason: 'user-reset'`.
- AC-FX1.3: Without `--yes`, prints confirmation including current and new values.
- AC-FX1.4: Audit trail to `~/.minih/permissions-resets.log`.
- AC-FX1.5: Refuses agents without sidecar (E183-class — points at `permissions set`).

## Out of scope
- Bulk `reset --all` — sticky-default reset is per-agent by design.
- Reverting to previous values — no journal to read from.

## Risks
- Trust loss after regret — mitigated by audit + `--yes`.
- Race with `agent install` upgrade — install always writes fresh sidecar.

## Testing
- TDD on sidecar mutator (3 fixtures).
- Lightweight CLI integration.
