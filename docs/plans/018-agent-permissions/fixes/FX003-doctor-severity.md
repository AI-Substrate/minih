# FX003 — Doctor severity escalation at R6+N

**Status**: DEFERRED (post-R6)
**Plan**: 018-agent-permissions
**Origin**: Spec OQ7 — "Should doctor severity escalate after R6?"
**Resolution**: WAIT-AND-SEE.

## Motivation

R6 doctor still emits `warning` for missing `permissions:` field. After dwell time post-R6:
- If virtually all agents have the field → escalate to `error` (fft-fatal).
- If many user-authored agents lack it → keep `warning` and add migration tooling.

This dossier scopes the future escalation, not the decision.

## Scope

1. Telemetry collection (opt-out): `~/.minih/doctor-stats.log` aggregates % of agents with explicit `permissions:`. **Privacy impact**: minih currently has no telemetry; adding requires policy update.
2. Severity bump via `MINIH_PERMISSIONS_DOCTOR_SEVERITY=error` env var.

## Acceptance criteria

- AC-FX3.1: Telemetry opt-out + no PII (counts only).
- AC-FX3.2: Env var changes doctor exit code semantics.
- AC-FX3.3: At R6+N (informed by telemetry), default flips to `error`.

## Out of scope
- Severity flip itself in this dossier.
- Network telemetry upload.

## Risks
- Privacy paranoia for any telemetry surface.
- CI friction at flip time — announce in advance with migration pointer.

## Testing
- Lightweight: env-var override flips severity.
- Manual: telemetry write + opt-out.
