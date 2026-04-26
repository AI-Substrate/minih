# External Research: JSON Schema Patterns for State-Machine Validation

**Source**: Perplexity Sonar Deep Research, 2026-04-26
**Full text**: persisted at `/private/tmp/claude-501/-Users-jordanknight-substrate-minih/c6d7acac-8199-4edf-95cf-2a607a2f01b1/tool-results/toolu_01G5c7JA3FQ7dkvaKG6v9LWk.txt` (~55KB, 5 alternative architecture sketches with JSON Schema examples)

---

## TL;DR

There is **no standard JSON Schema vocabulary for finite state machines**. People express transitions through one of five patterns. For our use case (two coupled state docs: inside cannot transition to `complete` until outside is `done`), the **right answer is a hybrid**: schema validates the *data shape* of each state document (phase enum, data object), and a small `state.ts` module enforces *transition rules* (with a transitions map serialized as JSON for tooling/docs). AJV custom keywords were considered and rejected — they buy little over a pure-TS rule function and add cross-version maintenance pain.

---

## Five Patterns Surveyed

### Pattern 1: Plain TS rules in `state.ts` ⭐ Recommended for minih
- Pros: Full expressiveness; simplest mental model; easy testing; clear error messages.
- Cons: Rules not introspectable without reading code (mitigation: serialize the transition map as JSON for tooling/docs to consume).
- Real-world precedent: most production agents/workflow engines store rules in code, not JSON Schema.

### Pattern 2: JSON Schema `if/then/else` chains
- Encode "if phase is X, then nextPhase must be in [Y, Z]" via nested conditionals.
- Pros: All in one schema file; AJV can validate.
- Cons: Schemas grow combinatorially with state count; **cannot reference a peer document** in JSON Schema 2020-12 without external `$ref` URIs that may not resolve cross-doc; error messages are cryptic.
- Verdict: Workable for 3–4 states; breaks down beyond.

### Pattern 3: Separate `transitions-allowed.json` document
- A declarative table: `{ from: "in-progress", to: "complete", requires: { peer: "done" } }`.
- Validated against a meta-schema; consumed by application code at transition time.
- Pros: Highly introspectable; easy to document; tooling can render diagrams.
- Cons: Adds a third validation layer + a new file convention; agents must read this file to know rules.
- Verdict: Strong second choice. Could ship later if we need richer state machines.

### Pattern 4: AJV custom keyword `transitions`
- `addKeyword({ keyword: 'transitions', validate: function(...) })`.
- Pros: Schema-native syntax; pluggable.
- Cons: AJV custom keywords have to be registered everywhere AJV is used (spreads complexity); maintenance pain across SDK versions; debugging is harder than plain code.
- Verdict: Rejected — buys little over Pattern 1 with much more friction.

### Pattern 5: Purpose-built workflow engine (XState v5 / Temporal / Conductor)
- Full FSM engine with persistence, history, queries.
- Pros: Battle-tested; rich ecosystem.
- Cons: Massive overkill for two state docs with one transition gate; new dep; conceptual weight.
- Verdict: Rejected for our scope.

---

## Cross-Document Coupling Strategies (the inside↔outside dependency)

For "inside cannot transition to `complete` until outside is `done`":

- **Schema-only approach is impractical**: JSON Schema 2020-12 has no way to reference the value of a *separate* document during validation. Workarounds (composed schemas with both docs validated together) require the application to construct the composed input — code is doing the work either way.
- **Application-code approach is straightforward**: at transition time, the `state.transition` MCP tool (per our architecture decision) reads the peer state file and rejects if the gate isn't open. Returns a typed error to the agent.
- Recommendation: **encode the rules in `src/runner/state.ts`** as a pure function `isAllowedTransition(side, from, to, peerState): { ok: true } | { ok: false, reason: string }`. The MCP tool and the outside CLI command (`minih state transition <slug> ...`) both call it. Errors include the peer-state value so the rejection is explainable.

---

## Real-World Precedents

- **XState v5 (Statelyai)**: stores state machine definitions as JSON-serializable objects; runtime validates transitions in code, not via JSON Schema. JSON serialization is for tooling/visualization only.
- **Netflix Conductor**: workflow definitions in JSON, but transition logic is in the orchestrator (Java).
- **ServiceNow workflows**: declarative state via metadata, but enforcement is server-side.
- **Robot, machina-js, finity**: all encode FSM in JS objects; none use JSON Schema for transition enforcement.

**No agent harness or CLI tool surveyed uses JSON Schema specifically to validate state transitions.** They use schema for data shape only.

---

## AJV-Specific Notes

- AJV's `addKeyword({ keyword: 'transitions', validate })` is technically supported but: every AJV instance in the codebase needs the keyword registered; `ajv-cli` and other AJV-using tools won't recognize the keyword by default.
- AJV's `if/then/else` works in 2020-12 but error messages are confusing without explicit `errorMessage` annotations (requires `ajv-errors` plugin → +1 dep).
- minih's `validator.ts` already uses fresh AJV per validation call. Adding custom keywords would conflict with that "fresh per call" pattern (keywords would need to be registered each time, slowing things down).

---

## Trade-off Analysis

| Approach | Expressiveness | Tooling introspection | Authoring ergonomics | Test ergonomics | Error clarity |
|----------|----------------|-----------------------|----------------------|-----------------|---------------|
| Pure TS (Pattern 1) | ⭐⭐⭐⭐⭐ | ⭐⭐ (mitigatable: serialize map to JSON for docs) | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| JSON Schema if/then/else (P2) | ⭐⭐ | ⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐ | ⭐ |
| Separate transitions doc (P3) | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| AJV custom keyword (P4) | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ | ⭐⭐ | ⭐⭐⭐ |
| Workflow engine (P5) | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ |

---

## Recommendation for Plan 007

**Adopt Pattern 1** (plain TS rules in `src/runner/state.ts`) for the prerequisite work. Specifically:

1. JSON Schema validates *data shape* of each state document (`src/schemas/{outside-state,inside-state}.json`) — phase enum, data object, etc. Same pattern as today's `output-schema.json`/`retrospective.json`.
2. Transition rules live in `src/runner/state.ts`:
   ```ts
   export type Side = 'outside' | 'inside';
   export type Phase = 'idle' | 'in-progress' | 'paused' | 'complete' | 'done';

   export interface TransitionRule {
     from: Phase;
     to: Phase;
     requiresPeer?: { phase: Phase | Phase[] };
   }

   export const TRANSITIONS: Record<Side, TransitionRule[]> = {
     outside: [
       { from: 'idle', to: 'in-progress' },
       { from: 'in-progress', to: 'done' },
       { from: 'in-progress', to: 'paused' },
       { from: 'paused', to: 'in-progress' },
     ],
     inside: [
       { from: 'idle', to: 'in-progress' },
       { from: 'in-progress', to: 'complete', requiresPeer: { phase: 'done' } },
     ],
   };

   export function isAllowedTransition(
     side: Side, from: Phase, to: Phase, peerState: { phase: Phase }
   ): { ok: true } | { ok: false; reason: string } {
     // Lookup TRANSITIONS[side]; return clear error including peerState
   }
   ```
3. Both the MCP tool `state.transition` (inside) and the CLI command `minih state transition <slug> ...` (outside) call `isAllowedTransition`.
4. Failed transitions return:
   - Inside (MCP tool): typed MCP tool error with reason.
   - Outside (CLI): `MinihEnvelope` with `error.code = E12X`, `error.message = reason`, `error.details = { side, from, to, peerState }`.
5. **Bonus introspection**: serialize `TRANSITIONS` to `state-machine.json` at build time for tooling/diagram-rendering. Pure additive; no validation logic.

This avoids adding deps, keeps validation logic clear and testable, and mirrors how XState/Stateless/Conductor handle the same problem. If future plans need richer state machines, Pattern 3 (separate transitions document) is the natural upgrade path.

---

## Citations (selected)

- json-schema.org — Draft 2020-12 spec
- ajv-validator.github.io — `addKeyword` docs + `if/then/else` semantics
- github.com/statelyai/xstate — XState v5 design notes
- conductor.netflix.com — workflow definition format
- Discussion threads on JSON Schema GitHub for FSM vocabulary proposals (none merged)
