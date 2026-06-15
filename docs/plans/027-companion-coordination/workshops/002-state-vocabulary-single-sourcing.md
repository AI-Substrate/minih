# Workshop: State Vocabulary Single-Sourcing

**Type**: Data Model / Contract
**Plan**: 027-companion-coordination
**Spec**: [companion-coordination-spec.md](../companion-coordination-spec.md)
**Created**: 2026-06-14
**Status**: Review

**Value Thesis**: Ends the perennial prompt-vs-schema state-vocabulary drift (#27/#31) by deciding where the *one* source of truth for a coordinated agent's status enum lives and how `minih doctor` enforces it — so a companion's documented `state_transition` calls stop being silently rejected at runtime.
**Target Proof Level**: Contract Ready
**Current Proof Level**: Preferred Direction

**Selected Value Axes**:
- **Knowability**: surfaces that the companion ships *no* state schema today and silently falls back to a global default it violates.
- **Operational Reliability**: a rejected `state_transition` means the orchestrator's state channel goes stale mid-run — this restores it.
- **Learning Compounding**: a doctor-enforced lockstep means the drift can't silently re-accumulate.
- **Cross-Domain Coordination**: the fix spans the global schema (`runner`/`schemas`), the validation gate (`mcp`), the doctor check (`cli`), and the agent pack (ungoverned).

**Related Documents**: Research dossier CF-06; `src/cli/commands/doctor.ts` drift check

**Domain Context**:
- **Primary Domain**: schemas + mcp (`src/schemas/inside-state.json`, `src/mcp/tools/state.ts`)
- **Related Domains**: cli (doctor), agent pack `agents/code-review-companion/`

---

## Purpose

Decide the single-source-of-truth strategy for inside-state status vocabulary, so every status the companion prompt instructs the agent to publish is accepted by the schema it validates against (#27/#31), and `minih doctor` proves the absence of drift.

## Fresh Entrant Outcome

Reach **Contract Ready**: understand the current drift, the resolution seam that already exists, the three strategies, the chosen one, and how doctor enforces it.

## Key Questions Addressed

- Where does the companion's state schema actually resolve from today, and why does it warn?
- Widen the global enum, ship a per-pack schema, or generate both from one source?
- How does `minih doctor` go from *warning* to *guaranteeing* coherence?

---

## Current State (made explicit)

- **Global default enum** (`src/schemas/inside-state.json:9-16`): `idle, in-progress, paused, reviewing, complete, error`.
- **Companion prompt vocabulary** (`agents/code-review-companion/prompt.md:153-158`, transition calls at `:224-233`): `idle, reading, reviewing, reporting, blocked, stopping`.
- **Drift**: `reading, reporting, blocked, stopping` are published by the prompt but **absent** from the enum. `idle`/`reviewing` match. The global's `in-progress, paused, complete, error` are unused by the companion.
- **Validation gate** (`src/mcp/tools/state.ts:138-170`): AJV compiles the resolved schema; an out-of-enum `to` throws `MCP_INVALID_ARGUMENT` ("state does not match inside state schema").
- **Resolution seam already exists** — 3-level fallback (`state.ts:182-192`): `<agentDir>/state/inside-state.schema.json` → `<agentDir>/inside-state.schema.json` → global default. **The companion ships neither**, so it resolves to the global default it then violates. That is precisely why `minih doctor` warns (`doctor.ts:538-557`).

So the cheapest correct fix is *already wired*: drop a per-pack schema into the seam.

## Decision Space

| Option | Description | Pros | Cons | Decision |
|--------|-------------|------|------|----------|
| **A. Per-pack schema override** | Ship `agents/code-review-companion/state/inside-state.schema.json` with the companion's full enum. | Uses the existing seam (zero runtime change); isolates companion vocabulary from the global default; immediate fix | Enum is now stated in two places (prompt table + schema) — drift can still recur unless doctor enforces | **Selected (mechanism)** |
| **B. Widen the global enum** | Add `reading, reporting, blocked, stopping` to `src/schemas/inside-state.json`. | One edit, every agent benefits; no per-pack files | Leaks companion-specific lifecycle states into the *global* default every agent inherits; semantic pollution; still two places (prompt vs schema) | Rejected |
| **C. Generated single source** | Declare states once; generate both the schema enum and the prompt's state table from it; doctor diffs. | Truly one source; drift structurally impossible | Build-time codegen + a new declaration format; over-engineered for one pack today | Rejected now; **note as future** |

## Preferred Direction — A (per-pack schema) + doctor-enforced lockstep

The mechanism is the per-pack override; the *single source of truth* is **the per-pack schema's enum**, and the prompt's state table is **validated against it by `minih doctor`** (rather than being a second independent source). This is C's guarantee without C's machinery: one authoritative file (the schema), one automated check (doctor) that the prompt agrees.

### Contract

1. **Ship** `agents/code-review-companion/state/inside-state.schema.json` — same shape as the global default, with `status.enum` = the companion's full vocabulary:
   `["idle", "reading", "reviewing", "reporting", "blocked", "stopping"]`
   (plus `complete`/`error` if the pack's exit/error states publish them — confirm against the prompt; include only what the prompt actually transitions to, so doctor's "schema has values the prompt never uses" stays clean too if that check exists).
2. **Global default unchanged.** Other agents keep the conservative 6-value enum. No global churn, no semantic leak.
3. **Doctor enforces lockstep.** The existing `prompt-state-vocabulary-drift` check (`doctor.ts`) already extracts prompt state values and diffs against the resolved schema enum. With the per-pack schema in place it flips to **pass** for the companion. Decision for the build: keep it a `warning` (advisory) or add an opt-in `--strict` that makes drift a `fail`. **LEAN**: keep `warning` as default (consistent with the harness "never gate" ethos), pin the companion's *pass* with a test so a future prompt edit that re-introduces drift trips CI via that test.
4. **Symmetry check.** If doctor also flags "schema enum has values the prompt never publishes," keep the per-pack enum minimal (exactly the published set) to stay green both ways.

### Data Model

```jsonc
// agents/code-review-companion/state/inside-state.schema.json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://minih.dev/schemas/code-review-companion/inside-state.json",
  "type": "object",
  "required": ["status", "data", "updatedAt", "updatedBy"],
  "properties": {
    "status": {
      "type": "string",
      "enum": ["idle", "reading", "reviewing", "reporting", "blocked", "stopping"]
    },
    "data": { "type": "object" },
    "updatedAt": { "type": "string", "format": "date-time" },
    "updatedBy": { "const": "inside" }
  },
  "additionalProperties": false
}
```

> Mirror the global schema's shape exactly (only `enum` and `$id` differ) so the validation gate and the human-view workbench treat it identically.

### Attention Reduction

| Future Loop | Before | After |
|-------------|--------|-------|
| Implementation | author guesses which states are legal; runtime rejects some | the pack's schema is the legal set; prompt validated against it |
| Review | reviewer cross-reads prompt vs global enum by eye | `minih doctor` reports drift = none; a test pins it |
| Agent execution | `state_transition('reading')` silently rejected → stale state channel | accepted; workbench timeline stays live |

## Evidence Ledger

| Evidence | Location | Supports | Status |
|----------|----------|----------|--------|
| Global enum (6 values) | `src/schemas/inside-state.json:9-16` | drift baseline | Validated |
| Companion vocab (6 values, 4 drifting) | `prompt.md:153-158, 224-233` | drift baseline | Validated |
| 3-level fallback seam | `state.ts:182-192` | per-pack mechanism exists | Validated |
| AJV rejection path | `state.ts:138-170` | what fails today | Validated |
| Doctor drift check | `doctor.ts:538-557` | enforcement point | Validated |

## Validation / Acceptance

Contract Ready when:
- A test exercises every companion `state_transition` target against the **resolved** (per-pack) schema and all pass.
- A `minih doctor` test asserts **no** `prompt-state-vocabulary-drift` warning for the companion pack.
- The global default schema is byte-unchanged (no regression for other agents).

## Open Questions

- **Q1: Include `complete`/`error` in the companion enum?** Depends on whether the prompt ever transitions to them (it exits via `idle`/`stopping` + an `exitReason` field, not a `complete` state). **LEAN**: include only what the prompt publishes; verify during build.
- **Q2: Make `--strict` doctor drift a fail now or defer?** **LEAN**: defer (warning + pinned test) — consistent with "never gate"; revisit if drift recurs across packs.
- **Q3 (future): codegen single source (Option C)** — worth it once ≥3 packs carry custom vocabularies. Note, don't build.
