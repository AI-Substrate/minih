---
schema_version: "1.0"
retro_id: "2026-06-11T10:34:10Z-claude-code-025dpl"
agent: "claude-code"
plan_id: "025-dead-pid-liveness"
started_at: "2026-06-11T09:53:00Z"
ended_at: "2026-06-11T10:34:00Z"
summary: "Implemented plan 025 (dead-pid liveness trio FX009/FX012/FX011) end-to-end: probe error spec + kill seam, exported status verdict fn, verdict 'dead', envelope diagnostics, vocabulary unify, stream-abort event + runner mapping, reconcile core/lock/CLI, breaking-change docs migration + vocabulary guard, domain currency. fft gate green (1260 tests). Three frictions captured below."
entries:
  - id: DL-001
    kind: difficulty
    description: "Boot's lint sensor covers docs/** JSON: the-flow's hand-cranked the-flow.json broke the boot gate (single-line arrays vs biome's multi-line preference) — first boot of the phase came back UNHEALTHY for a bookkeeping artifact, not product code."
    target: tooling
    severity: annoying
    workaround: "npx biome check --write on the one file, re-ran boot (degraded = session baseline)."
    suggested_encoding: "the-flow's bookkeeping step runs `npx biome check --write docs/plans/<dir>/the-flow.json` after every regeneration."
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-11T09:54:00Z"
  - id: SUGG-001
    kind: improvement-suggestion
    description: "Doctor's 8192-byte outside.md hard cap is invisible until breached: code-review-companion sat at 98.9% of budget, so a 178-byte doc note flipped doctor to fail and broke an unrelated test suite. A near-cap warning (e.g. >95%) in the doctor envelope would surface the budget before the breach."
    target: project-sensor
    suggested_encoding: "doctor outside.md-size check gains a near-cap warning band; alternatively a guard test pinning headroom (one now exists for the companion in test/cli/docs-vocabulary.test.ts)."
    system:
      compound:
        status: suggested
        source: agent-self
        first_seen_at: "2026-06-11T10:28:00Z"
  - id: INS-001
    kind: insight
    description: "Record<union, T> maps beat 'add explicit ternary arms' as a review demand: converting the status TTY ternaries to Record<StatusVerdict, …> made tsc enforce an arm for every future verdict value — the exact JSON-boundary exhaustiveness gap validate-v2 flagged. Worth encoding as a repo idiom for value-rendering switches."
    target: project
    suggested_encoding: "Idiom note in AGENTS.md Key Conventions or a biome-adjacent review checklist item: prefer Record<union, T> over ternary chains for rendering discriminated values."
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-11T10:33:00Z"
---

# Retro — 025-dead-pid-liveness Implementation

Phase ran clean: seams-first ordering meant every behavior landed with its
sensor already reachable; the only mid-flight surprises were gate-shaped
(boot lint on a bookkeeping artifact, the outside.md byte budget), both
captured above. The pre-existing `status <slug>` E171-on-dead-only-slug
resolver gap is logged in the plan's Discoveries table (D2) as a plan-7
fix-loop candidate, not here — it's product scope, not harness friction.
