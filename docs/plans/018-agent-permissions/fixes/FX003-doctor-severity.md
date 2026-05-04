# FX003 — Doctor `--strict-permissions` opt-in (now) + severity escalation (later)

**Status**: DEFERRED (post-R6)
**Plan**: 018-agent-permissions
**Origin**: Spec OQ7 — "Should doctor severity escalate after R6?" + top-10 follow-up #6 (CI opt-in bridge).
**Resolution**: WAIT-AND-SEE on default flip; ship opt-in bridge first.

## Motivation

R6 doctor still emits `warning` for missing `permissions:` field. Two needs:

**Now**: CI projects that *want* to enforce explicit `permissions:` today have no clean signal — they have to grep stderr. An opt-in `--strict-permissions` flag (and matching env var) escalates the missing-field check to `error`/non-zero exit so careful teams can lock in early.

**Later**: After dwell time post-R6, decide whether to flip the default:
- If virtually all agents have the field → escalate default severity to `error` (fft-fatal).
- If many user-authored agents lack it → keep `warning` and add migration tooling.

The bridge collects de-facto adoption signal (operators opting in early vs not) without requiring telemetry.

## Scope

### Phase 1 (ship soonest) — opt-in bridge

```bash
# Flag form
minih doctor --strict-permissions

# Env-var form (CI-friendly)
MINIH_PERMISSIONS_DOCTOR_SEVERITY=error minih doctor

# Existing default unchanged
minih doctor                       # warning, exit 0
```

When opt-in is active, ANY agent missing the explicit `permissions:` field (or with `permissions: yolo` flagged as default-implicit) escalates the existing R6 doctor check from `warning` to `error`. Doctor exits non-zero.

### Phase 2 (post-bridge) — default flip decision

Optional telemetry — opt-out — at `~/.minih/doctor-stats.log` aggregates % of agents with explicit `permissions:`. **Privacy impact**: minih currently has no telemetry; adding requires explicit policy decision before implementation. Defer until Phase 1 has reasonable adoption signal from issue tracker / community feedback.

If telemetry is rejected, decision falls back to community signal + `git log` of public agent packs.

## Acceptance criteria

### Phase 1
- AC-FX3.1: `minih doctor --strict-permissions` exits 1 if any agent lacks explicit `permissions:`.
- AC-FX3.2: `MINIH_PERMISSIONS_DOCTOR_SEVERITY=error` env var has identical effect to the flag.
- AC-FX3.3: `--strict-permissions` AND env=warning → flag wins.
- AC-FX3.4: Default behaviour unchanged: `minih doctor` still exits 0 with warning.
- AC-FX3.5: `docs/how/permissions.md` documents the flag for CI users.
- AC-FX3.6: `just fft` does NOT run `--strict-permissions` by default; opt-in only.

### Phase 2 (deferred sub-dossier — not implemented in this fix)
- AC-FX3.7: Telemetry opt-out + no PII (counts only).
- AC-FX3.8: At R6+N (informed by Phase 1 adoption), default flips to `error` with `--no-strict-permissions` escape.

## Out of scope
- Phase 2 telemetry implementation in this dossier.
- Network telemetry upload (forever out of scope).
- Severity flip itself (Phase 2 sub-dossier).
- Affecting agents that have explicit `permissions: yolo` — they're explicit; check passes.

## Risks
- Operators enabling the flag prematurely on third-party agent packs they don't own — mitigated by clear docs.
- CI friction at eventual default-flip time — announce in advance with migration pointer (FX001 `permissions migrate`).
- Two ways to enable the same behaviour (flag + env var) — accepted; matches existing `MINIH_PERMISSIONS_DEFAULT` precedent.

## Testing
- TDD: doctor exit code matrix (4 cases: flag/no-flag × explicit/missing).
- Lightweight: env-var override matches flag behaviour.
- Manual: run on a project mixing explicit and missing agents; verify table output highlights offenders.
