# Flight Plan: Fix FX010 — `restricted` preset + `$MINIH_OUTPUT_PATH` auto-narrowing

**Fix**: [FX010-restricted-output-auto-narrow.md](./FX010-restricted-output-auto-narrow.md)
**Plan**: [agent-permissions-plan.md](../agent-permissions-plan.md)
**Source issue**: [#25](https://github.com/AI-Substrate/minih/issues/25) (suggested fix #1)
**Generated**: 2026-05-04
**Status**: DEFERRED — depends on FX008

---

## What → Why

**Problem**: Even after FX008, coordinated agents under `restricted` need a `write: allow` override that's globally permissive — wider than the actual contract requires. The contract is "write `output/report.json`"; the override is "write anywhere".

**Fix**: Inject `<runDir>/output/` into the resolved `allowedRoots` when the run is `coordination: enabled` AND the preset is in the restricted-family (`restricted`, `read-only`, `network`). The policy-layer `decisions.write === 'deny'` becomes "deny except for output/", which matches the documented contract precisely and keeps the security posture tight.

---

## Domain Context

| Domain | Relationship | What Changes |
|--------|-------------|-------------|
| `runner/permissions/compile` | adds auto-injection step | `injectCoordOutputRoot()` helper called after `canonicalizeRoots` |
| `runner/permissions/coord-write-precondition` (FX008) | trigger refinement | Replaces `decisions.write === 'deny'` with `!canWriteUnderOutput(policy, runDir)` |

**Domains we depend on (no changes)**:

| Domain | What We Consume | Contract |
|--------|----------------|----------|
| `runner/permissions/fs-guard` | allowedRoots check (already in place) | Workshop 001 § Q5 allowedRoots composition |

---

## Flight Status

```mermaid
stateDiagram-v2
    classDef pending fill:#9E9E9E,stroke:#757575,color:#fff
    classDef active fill:#FFC107,stroke:#FFA000,color:#000
    classDef done fill:#4CAF50,stroke:#388E3C,color:#fff
    classDef blocked fill:#F44336,stroke:#D32F2F,color:#fff

    state "1: Inject helper" as S1
    state "2: Wire into compile" as S2
    state "3: Stamp provenance" as S3
    state "4: Refine FX008 trigger" as S4
    state "5: Tests + docs" as S5

    [*] --> S1
    S1 --> S2
    S2 --> S3
    S3 --> S4
    S4 --> S5
    S5 --> [*]

    class S1,S2,S3,S4,S5 pending
```

---

## Stages

- [ ] **Stage 1: `injectCoordOutputRoot()` helper** — pure function (`src/runner/permissions/compile.ts`)
- [ ] **Stage 2: Wire into `compile()`** — call after `canonicalizeRoots`; gated on coord-enabled + restricted-family preset
- [ ] **Stage 3: Provenance in run.json** — `permissions.coordOutputAutoAllowed: true` field surfaced in `minih status` (`src/runner/runner.ts`)
- [ ] **Stage 4: Refine FX008 trigger** — `canWriteUnderOutput()` replaces `decisions.write === 'deny'` (`src/runner/permissions/coord-write-precondition.ts`)
- [ ] **Stage 5: Tests + CHANGELOG + permissions.md** — coverage of four-corner matrix; cross-link from companion-mode.md

---

## Architecture: Before & After

```mermaid
flowchart LR
    classDef existing fill:#E8F5E9,stroke:#4CAF50,color:#000
    classDef changed fill:#FFF3E0,stroke:#FF9800,color:#000
    classDef new fill:#E3F2FD,stroke:#2196F3,color:#000

    subgraph Before["Before FX010 (FX008 in place)"]
        B1[restricted preset]:::existing
        B2[Operator must add<br/>write: allow override<br/>OR FX008 hard-fails]:::existing
        B1 --> B2
    end

    subgraph After["After FX010"]
        A1[restricted preset]:::existing
        A2{coord-enabled?}:::new
        A3[Auto-inject<br/>runDir/output<br/>into allowedRoots]:::new
        A4[FX008 sees<br/>canWriteUnderOutput=true]:::changed
        A5[Run boots normally;<br/>writes outside output/<br/>still denied]:::existing
        A1 --> A2
        A2 -- yes --> A3 --> A4 --> A5
        A2 -- no --> A4
    end
```

---

## Acceptance Criteria

- [ ] **AC-FX10.1** Coord-enabled + `restricted` writes to `<runDir>/output/` succeed without `write: allow` override
- [ ] **AC-FX10.2** Writes to ANY OTHER path under same setup still fire 5-signal denial
- [ ] **AC-FX10.3** Non-coordinated runs under `restricted` unaffected
- [ ] **AC-FX10.4** `run.json.permissions.coordOutputAutoAllowed: true` provenance recorded
- [ ] **AC-FX10.5** FX008 precondition correctly handles post-FX010 case (no false fires)

## Goals & Non-Goals

**Goals**: Make `restricted` semantically usable for coord-enabled agents without forcing operators to broaden the write-allow scope. Keep the security posture as tight as the contract permits.

**Non-Goals**: Loosen `restricted` for non-coordinated agents. Auto-allow writes outside `output/`. Remove the FX008 precondition. Provide per-tool path narrowing (the auto-injection is at the directory level only).

---

## Checklist

- [ ] FX010-1: `injectCoordOutputRoot()` helper
- [ ] FX010-2: Wire into `compile()`
- [ ] FX010-3: Provenance in `run.json`
- [ ] FX010-4: FX008 trigger refinement
- [ ] FX010-5: Tests
- [ ] FX010-6: CHANGELOG + permissions.md

## Dependencies

- **FX008** must land first (precondition surface). FX010-4 depends on FX008's `coord-write-precondition.ts` existing.
