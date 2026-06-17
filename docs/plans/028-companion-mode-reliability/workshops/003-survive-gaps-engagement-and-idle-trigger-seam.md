# Workshop: Survive-gaps engagement definition + #49 idle-trigger seam (Phase 5b)

**Type**: Integration Pattern (contract seam between Phase 5b and issue #49)
**Plan**: 028-companion-mode-reliability
**Spec**: [companion-mode-reliability-plan.md](../companion-mode-reliability-plan.md) § Phase 5 "Open (workshop 5b)"
**Created**: 2026-06-17
**Status**: Approved

**Value Thesis**: Resolves the one fork that gates Phase 5b (T005/T006) — *does survive-gaps redefine engagement, or just enlarge `idleBudgetMs`?* — and pins the exact `evaluateIdlePolicy` contract change so #49's future idle trigger **cannot be written ignorant of the survive-gaps posture**. Turns an open design question into a buildable, typed seam.
**Target Proof Level**: Contract Ready
**Current Proof Level**: Contract Ready

**Selected Value Axes**:
- **Cross-Domain Coordination**: the decision IS a contract handoff between this plan (Phase 5b lands the typed seam) and #49 (wires the runner-side trigger) — the boundary must be explicit and un-ignorable.
- **Safety to Change**: `evaluateIdlePolicy`'s contract widens; the change must preserve every existing default-run behaviour (plan 027 #35) and compose with Phase-4 clean terminals.
- **Implementation Readiness**: T005 (RED) and T006 (GREEN) must be buildable from this doc with no further design.
- **Knowability**: makes the never-spoke incident (the actual #50 failure) an explicit, named arm of the policy rather than an emergent consequence of a magic budget number.

**Related Documents**:
- [001-run-read-path-fail-open.md](./001-run-read-path-fail-open.md) — the Phase-1 active predicate the heartbeat (5a) keeps fresh.
- [002-terminal-state-taxonomy.md](./002-terminal-state-taxonomy.md) — the Phase-4 clean-terminal vocabulary a survive-gaps stand-down composes with.
- `src/runner/idle-policy.ts` — `evaluateIdlePolicy` (the function this workshop changes).
- Phase 5 tasks dossier — T005/T006 (the gated tasks this workshop unblocks).

**Domain Context**:
- **Primary Domain**: runner (`idle-policy.ts`, pure decision function).
- **Related Domains**: runner terminal block (where #49 will call it) + reconcile/status (Phase-4 clean-terminal consumers).

---

## Purpose

Decide what "engagement" means for a survive-gaps companion, and specify the typed, durable input #49 must pass to `evaluateIdlePolicy` so a companion deliberately waiting through a long human gap is **not** stood down on idle alone — while every default companion keeps the exact plan-027 #35 behaviour.

## Fresh Entrant Outcome

A fresh agent should be able to use this workshop to reach **Contract Ready** and:

- Build T005 (RED) and T006 (GREEN) without re-opening the design.
- Know the precise `IdlePolicyInput` shape, the `evaluateIdlePolicy` branch change, and what stays unchanged.
- Know exactly what #49 reads, passes, and writes (the underscore→hyphen reason map).

## Key Questions Addressed

1. Does survive-gaps **redefine engagement** (a typed posture: expecting-work ⇒ don't stand down on idle) **or** just **enlarge `idleBudgetMs`**?
2. What is the durable seam #49 reads, and how is it un-ignorable?
3. How does the never-spoke arm (`idleElapsedMs === null` — the #50 incident) behave under survive-gaps?
4. How does a survive-gaps stand-down compose with the Phase-4 clean-terminal reasons?

---

## Value Frame

| Field | Selection | Why It Matters |
|-------|-----------|----------------|
| Target Proof Level | Contract Ready | T005/T006 must be buildable with no further design. |
| Primary Value Axis | Cross-Domain Coordination | The artifact IS the 028↔#49 contract boundary. |
| Supporting Value Axes | Safety to Change · Implementation Readiness · Knowability | Preserve default behaviour; make 5b buildable; name the incident. |
| Downstream Loop Improved | Implementation (#49) + Testing | #49 cannot mis-wire the trigger; the never-spoke arm gets a fixed test. |

---

## Background — the current contract (do not break it)

`evaluateIdlePolicy(ledger, opts: IdlePolicyInput)` (`src/runner/idle-policy.ts`) is a **pure** decision used by #49's *future* runner-side idle trigger (it is **not yet wired** into the loop). Today:

- `IdlePolicyInput = { idleBudgetMs, runElapsedMs, timeoutSec, now? }`.
- `effectiveIdleMs = idleElapsedMs ?? runElapsedMs` — a peer that **never spoke** (`idleElapsedMs === null`) is treated as idle since boot (`runElapsedMs`).
- Stand-down when **(a)** the absolute backstop fires (`runElapsedMs ≥ timeoutSec*1000`, overrides outstanding work), or **(b)** nothing outstanding *and* `effectiveIdleMs ≥ idleBudgetMs`.
- `exitReason`: `no_engagement` (never spoke) | `idle_budget` (spoke then idled) — **underscore** spelling.

**The #50 incident** is branch (b) on the never-spoke arm: a companion booted, no commit ever arrived, `effectiveIdleMs = runElapsedMs` reached the default `idleBudgetMs` (30 min), and it stood down — exactly when its human was about to push reviewable work.

---

## Decision Space

| Option | Description | Pros | Cons | Decision |
|--------|-------------|------|------|----------|
| **A — enlarge `idleBudgetMs`** | Pass a large `idleBudgetMs` (≈ `timeoutMs`) for survive-gaps runs; no contract change. | Zero contract change; the durable floor already exists (`budgets.idleBudgetMs`, read by `readIdleBudgetMs`). | Overloads `idleBudgetMs` into a magic number; #49 reading just a number **can't tell** "survive-gaps, don't stand down on idle" from "this run has a 2 h idle budget" — the forward-compat hazard the dossier flagged. Branch (b) still conceptually applies. | **Rejected as the whole answer** (kept as the durable floor — see below) |
| **B — typed posture field** | Add `surviveGaps?: boolean` to `IdlePolicyInput`; when true, **suppress branch (b)** — idle alone never stands the companion down; only the absolute backstop (a) does. | Explicit, typed, un-ignorable by #49; separates posture from budget; the never-spoke incident becomes a named arm; composes cleanly with Phase-4. | Contract change to `IdlePolicyInput` (precisely why 5b is workshop-gated). | **SELECTED** |
| **C — hybrid (B over A's floor)** | Ship B's typed field **and** keep `budgets.idleBudgetMs` as the durable floor/fallback for runs that don't set the field. | Best of both: typed posture for survive-gaps; unchanged budget semantics for everyone else. | Slightly more surface (one field + one durable record). | **SELECTED — this is the shipping shape** |

### Why B/C over A (the rationale)

"Engagement" for a survive-gaps companion is **not** "did the human speak recently" — it is "is reviewable work still potentially coming." That is a *posture*, not a *duration*. Encoding it as a large `idleBudgetMs` (Option A) hides the posture inside a number that #49 must interpret by convention; a future #49 author could read the number and still apply idle stand-down. A **named typed field** (Option B) is the seam #49 *cannot* ignore — it must branch on it. Option C keeps A's durable `idleBudgetMs` as the floor so nothing about default/non-survive-gaps runs changes.

**Field name**: `surviveGaps` (one vocabulary across `AgentDefinition.surviveGaps` → `AgentRunConfig.surviveGaps` → `IdlePolicyInput.surviveGaps`). Rejected `expectingWork` — more semantic, but a second name for the same posture invites drift.

---

## The Contract (Contract Ready — what T006 builds)

### 1. `IdlePolicyInput` gains a typed posture field

```typescript
export interface IdlePolicyInput {
  idleBudgetMs: number;
  runElapsedMs: number;
  timeoutSec: number;
  now?: number;
  /**
   * Plan 028 Phase 5b — survive-gaps posture. When true the companion is
   * EXPECTING work across a long human gap, so an idle stretch alone must not
   * stand it down: branch (b) is suppressed and only the absolute wall-clock
   * backstop (a) terminates it. Default/unset = the plan-027 #35 behaviour,
   * unchanged. Sourced durably from run.json (see §3) so #49 reads it the same
   * way it reads idleBudgetMs.
   */
  surviveGaps?: boolean;
}
```

### 2. `evaluateIdlePolicy` behaviour change (suppress branch (b) only)

```
(a) absolute backstop   runElapsedMs >= timeoutSec*1000   → stand down   [UNCHANGED — fires even for surviveGaps]
    unresolvedPeerRequests > 0                            → continue     [UNCHANGED]
(b) effectiveIdleMs >= idleBudgetMs                       → stand down   [SUPPRESSED when surviveGaps === true]
    else                                                  → continue
```

- When `surviveGaps === true`: skip branch (b) entirely → a quiet survive-gaps companion (including the never-spoke arm) returns `continue` until the wall-clock backstop (a).
- `exitReason` rule is **unchanged**: a survive-gaps stand-down via (a) on a never-spoke peer is `no_engagement`; on a peer that spoke then idled, `idle_budget`. The never-spoke arm is a **fixed requirement** (the #50 incident) — covered by a test, not a tunable.
- Everything for `surviveGaps` falsy/unset is byte-for-byte the current behaviour (plan 027 #35).

### 3. Durability — how the posture reaches #49

Phase 5a put `surviveGaps` on `AgentRunConfig` but does **not** record it to `run.json`. T006 records it alongside the existing budget:

```jsonc
// run.json
"budgets": { "timeoutSec": 7200, "stallTimeoutSec": 0, "maxTurns": 0,
             "idleBudgetMs": 1800000, "surviveGaps": true }   // ← NEW (T006)
```

- Recorded at run start in `runner.ts` (mirrors how `idleBudgetMs` is recorded for coordination runs).
- Read synchronously the same way `readIdleBudgetMs` reads `idleBudgetMs` (extend it to also return `surviveGaps`, or add `readSurviveGaps`). `budgets.idleBudgetMs` **remains** the durable floor #49 reads today (Option A's substrate, unchanged).

### 4. Reason-spelling map (the Phase-4 seam — T006 owns the test)

`idle-policy.ts` emits **underscore** `idle_budget` / `no_engagement`; the Phase-4 `terminalReason` union + `CLEAN_TERMINAL_REASONS` use **hyphen** `idle-budget` / `no-engagement`. #49's producer maps `exitReason → terminalReason`:

| `IdlePolicyDecision.exitReason` | `terminalReason` written | Clean? |
|---|---|---|
| `idle_budget` | `idle-budget` | ✅ (Phase-4 `CLEAN_TERMINAL_REASONS`) |
| `no_engagement` | `no-engagement` | ✅ |

T006 asserts this map in a test (the dossier's named requirement). A survive-gaps stand-down therefore reconciles to `completed` (clean), never `crashed`.

---

## What #49 must do (the consumed contract)

1. Wire `evaluateIdlePolicy` into the runner idle path (the trigger — out of 028 scope).
2. Pass the **durable** `surviveGaps` + `idleBudgetMs` from `run.json` (not a bare default).
3. On `standDown`, write the mapped hyphen `terminalReason` (clean) + the `cleanStop` marker so Phase-4 reconcile honours it.
4. Honour the posture: a `surviveGaps` run is never stood down on idle alone — only the wall-clock backstop.

#49 **cannot** satisfy (4) by accident: `surviveGaps` is a required-to-read typed field, not an inferred number.

---

## Attention Reduction

| Future Loop | Before Workshop | After Workshop |
|-------------|-----------------|----------------|
| #49 implementation | Open question: redefine engagement or enlarge a number? Risk of mis-wiring idle stand-down for survive-gaps. | Typed `surviveGaps` field + exact branch change + durability + reason map — un-ignorable. |
| T005/T006 build | Blocked (contract undecided). | Buildable: T005 fixture + T006 field/suppression/durability/map are fully specified. |
| Testing | Never-spoke arm was an emergent consequence. | A fixed, named test requirement (`idleElapsedMs:null` + survive-gaps ⇒ continue under budget; backstop ⇒ `no_engagement`). |

---

## Validation / Acceptance

This workshop reaches Contract Ready (and unblocks 5b) when:

- The fork is resolved with rationale (Option C: typed `surviveGaps` field over the `idleBudgetMs` floor). ✅
- The exact `IdlePolicyInput` change + `evaluateIdlePolicy` branch suppression are specified, with default behaviour provably unchanged. ✅
- The durable run.json seam #49 reads is named. ✅
- The underscore→hyphen reason map + Phase-4 composition are pinned. ✅
- The never-spoke arm is fixed as a test requirement, not a tunable. ✅

## Open Questions

### Q1: Suppress branch (b) entirely, or just raise the budget under survive-gaps?

**RESOLVED**: Suppress branch (b) entirely when `surviveGaps === true`. Raising the budget (Option A) leaves the posture implicit in a number; suppression makes it explicit and keeps the wall-clock backstop as the single, honest terminator.

### Q2: New field name — `surviveGaps` or `expectingWork`?

**RESOLVED**: `surviveGaps`, matching the existing `AgentDefinition`/`AgentRunConfig` switch. One vocabulary end-to-end.

### Q3: Does the prompt-level check-in protocol (`firstContactPollThreshold` etc.) change?

**OPEN (out of 5b scope, low priority)**: `evaluateIdlePolicy` is the runner-side backstop #49 wires; the companion prompt's poll-streak check-in is a separate, prose-level mechanism. A survive-gaps companion's frontmatter may also want relaxed check-in thresholds, but that is a prompt-config tweak, not part of the `evaluateIdlePolicy` contract. Track separately if a survive-gaps companion is observed nagging too early.

---

## Decision Summary (authoritative — the architect/implementer treats this as binding)

> Phase 5b adds a typed `surviveGaps?: boolean` to `IdlePolicyInput`; when true, `evaluateIdlePolicy` suppresses the idle-budget stand-down (branch b) so only the wall-clock backstop terminates the companion. The posture is recorded durably to `run.json` `budgets.surviveGaps` and read like `idleBudgetMs`; `budgets.idleBudgetMs` remains the floor. `evaluateIdlePolicy` stays **unwired** — #49 wires the trigger, passes the durable posture, and writes the hyphen-spelled clean `terminalReason`. The never-spoke arm is a fixed test requirement.
