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

# Negation flag (override env in a single invocation)
MINIH_PERMISSIONS_DOCTOR_SEVERITY=error minih doctor --no-strict-permissions  # → warning, exit 0

# Existing default unchanged
minih doctor                       # warning, exit 0
```

**Env-var enum**: valid values for `MINIH_PERMISSIONS_DOCTOR_SEVERITY` are exactly `warning` | `error`. Any other value MUST cause `minih doctor` to exit 1 with stderr: `Invalid MINIH_PERMISSIONS_DOCTOR_SEVERITY value '<v>'; expected 'warning' or 'error'.` Empty string is treated as unset.

**Precedence (full matrix)**:

| `--strict-permissions` | `--no-strict-permissions` | `MINIH_PERMISSIONS_DOCTOR_SEVERITY` | Effective severity |
|---|---|---|---|
| set | unset | (any) | `error` (flag wins) |
| unset | set | (any) | `warning` (negation wins) |
| set | set | (any) | error: conflicting flags, exit 2 |
| unset | unset | `error` | `error` |
| unset | unset | `warning` | `warning` |
| unset | unset | unset | `warning` (default unchanged) |

When effective severity is `error`, ANY agent missing the explicit `permissions:` field escalates the existing R6 doctor check to `error` and doctor exits 1. Agents with explicit `permissions: yolo` PASS the check (presence of any explicit field satisfies it). Doctor MAY emit a separate advisory note ("yolo is the least-restrictive preset") that does NOT affect exit code (per AC-FX3.1c). Sidecar `lockedDefault` is treated as 'explicit' (passes the check); only frontmatter-missing fields fail.

### Phase 2 (post-bridge) — default flip decision

> ⚠ **DO NOT IMPLEMENT in Phase 1**: The following is Phase 2 only. Phase 1 ships only the flag + env-var bridge above.

Optional telemetry — opt-out — at `~/.minih/doctor-stats.log` aggregates % of agents with explicit `permissions:`. **Privacy impact**: minih currently has no telemetry; adding requires explicit policy decision before implementation. Defer until Phase 1 has reasonable adoption signal from issue tracker / community feedback.

If telemetry is rejected, decision falls back to community signal + `git log` of public agent packs.

## Acceptance criteria

### Phase 1
- AC-FX3.1: `minih doctor --strict-permissions` exits 1 if any agent lacks explicit `permissions:` frontmatter (sidecar `lockedDefault` counts as 'explicit'; frontmatter `permissions: yolo` counts as 'explicit').
- AC-FX3.1b: Doctor MAY emit an advisory-level note for `permissions: yolo` ("yolo is the least-restrictive preset") that does NOT affect exit code.
- AC-FX3.2: `MINIH_PERMISSIONS_DOCTOR_SEVERITY=error` env var has identical effect to the flag.
- AC-FX3.2b: Invalid `MINIH_PERMISSIONS_DOCTOR_SEVERITY` value (anything other than `warning`/`error`/empty) exits 1 with stderr `Invalid MINIH_PERMISSIONS_DOCTOR_SEVERITY value '<v>'; expected 'warning' or 'error'.`
- AC-FX3.3: Precedence matrix in § Scope is implemented. Both flags set together exit 2 with `Conflicting flags: --strict-permissions and --no-strict-permissions.`
- AC-FX3.3b: `--no-strict-permissions` flag is accepted and forces severity back to `warning` regardless of env var (parity with `MINIH_PERMISSIONS_DEFAULT` precedent).
- AC-FX3.4: Default behaviour unchanged: bare `minih doctor` still exits 0 with warning.
- AC-FX3.5: `docs/how/permissions.md` § Doctor contains a code block showing both invocation forms (`--strict-permissions` flag and `MINIH_PERMISSIONS_DOCTOR_SEVERITY=error`), the precedence matrix from § Scope, and the exit-code contract. Link-check passes on the modified file.
- AC-FX3.6: `just fft` does NOT run `--strict-permissions` by default; opt-in only.

### Phase 2 (deferred sub-dossier — not implemented in this fix)
- AC-FX3.7: Telemetry opt-out + no PII (counts only).
- AC-FX3.8: At R6+N (informed by Phase 1 adoption), default flips to `error` with `--no-strict-permissions` escape.

## Out of scope
- Phase 2 telemetry implementation in this dossier.
- Network telemetry upload (forever out of scope).
- Severity flip itself (Phase 2 sub-dossier).
- A three-value severity enum (`warning`/`error`/`off`) — off-state is achieved by not setting the flag/env (default behaviour).
- Coordination-aware agents are NOT special-cased — same rules apply.

## Risks
- Operators enabling the flag prematurely on third-party agent packs they don't own — mitigated by clear docs.
- CI friction at eventual default-flip time — announce in advance with migration pointer (FX001 `permissions migrate`).
- Two ways to enable the same behaviour (flag + env var) — accepted; matches existing `MINIH_PERMISSIONS_DEFAULT` precedent.

## Testing
- TDD: doctor exit code matrix (4 cases: flag/no-flag × explicit/missing).
- Lightweight: env-var override matches flag behaviour.
- Manual: run on a project mixing explicit and missing agents; verify table output highlights offenders.

---

## Validation Record (2026-05-04)

| Agent | Lenses Covered | Issues | Verdict |
|-------|---------------|--------|---------|
| Source-Truth | Technical Constraints | 0 (--strict-permissions/env var conventions clean) | ✅ |
| Cross-Reference | Integration & Ripple, Concept Documentation | 0 (OQ7 spec ref confirmed) | ✅ |
| Completeness | Edge Cases, Deployment & Ops | 3 HIGH + 2 MEDIUM → all fixed inline | ⚠️ → ✅ |
| Forward-Compatibility | Forward-Compatibility (Shape mismatch) | 1 MEDIUM (precedence matrix incomplete) → fixed inline | ⚠️ → ✅ |

**Lens coverage**: 8/12 (at floor).

**Fixes applied**: Yolo explicit/implicit contradiction resolved (yolo PASSes; advisory only), env-var enum defined (`warning`|`error`), full 6-row precedence matrix added, `--no-strict-permissions` negation flag added, AC-FX3.5 reformulated to be observable, Phase 2 telemetry callout-fenced.

**Overall**: ⚠️ VALIDATED WITH FIXES — ready for `/plan-6 --fix FX003` cycle.
