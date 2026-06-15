# Phase 3 — State-vocabulary coherence (#27/#31) · Execution Log

**Plan**: [companion-coordination-plan.md](../../companion-coordination-plan.md) · **Phase**: 3 · **CS**: 2
**Mode**: Full · **Testing approach**: TDD (verify-and-pin + discriminating negatives) · **Companion**: code-review-companion (Power-On-Mode)
**Started**: 2026-06-15 · **Branch**: `027-companion-coordination`

> Phase shape (Finding 01): **verify-and-pin**, not a build. The schema already exists with the exact enum and resolves at root; this phase pins AC-6/AC-7 against regression and corrects one stale description. PIC-1 **decided 2026-06-15 (Jordan): keep schema at root, no relocate** → T002 is verify-and-record.

---

## Harness seam — pre-implement (T000)

`/eng-harness-flow --event pre-implement --phase "Phase 3: State-vocabulary coherence (#27/#31)" --plan-dir docs/plans/027-companion-coordination --json`

- **Adoption gate**: S0 (`harness` 0.2.0 + `.harness/`) ✅ · S2 (`.harness/engineering-harness.md`) ✅ · S4 (`fft`/`just check` boot recipe) ✅ → **engineering zone**.
- **`harness doctor`**: `status: ok` — 5/5 layers green (toolchain, cli-build n/a, extensions, instructions, record-types); branch `027-companion-coordination`.
- **`harness boot`**: **`degraded`** — hard sensors clean (`lint` pass · `typecheck` pass · `build+test` (`just check`) pass); two `warn` sensors: `minih-doctor` (warnings present) + `audit` (1 critical / 6 high npm-dependency findings — **pre-existing, unrelated to Phase 3**; dependency-update work tracked separately, GH Dependabot task).
- **Decision**: degraded ≈ SLOW → **proceed with note**. The build/test/lint/typecheck sensors that gate code correctness are clean; the warn sensors are pre-existing dependency/doctor noise, not introduced by this phase.

---

## Companion — code-review-companion (Power-On-Mode)

- **Slug**: `code-review-companion` · **Run ID**: `2026-06-15T12-21-24-317Z-ef6a`
- **Boot**: `minih run code-review-companion` (GH_TOKEN exported); verdict `active`, read-only preset; idle long-poll on `[task, question, directive, control]`.
- **Briefing** (`01KV4HEQKF…`): plan/spec/phase/tasks paths + the per-task `review-request` protocol + hazards (PIC-1 keep-root, validation-IS-enforced, one-directional doctor check) + domain context (mcp/cli/pack).
- **Protocol**: per-task `review-request: T### <sha>` pings (fire-and-forget); final drain → `control:stop` → farewell.

### Findings reconciliation

| ackOf (review-request) | Finding | Severity | Disposition |
|---|---|---|---|
| T001 `984b504` | **APPROVE** — 0 findings (5/5 passed) | — | Clean |
| T003 `3190952` | **APPROVE** — 0 findings ("drift sweep found only historical stale-phrase references, not live contract drift") | — | Clean — historical refs are Phase-6 sensor scope, not live drift |
| T004 `8c6ae4b` | **APPROVE** — 0 findings (14/14 passed) | — | Clean |
| final `8c6ae4b` (drain) | **APPROVE** — 0 findings (19/19; "only inside-state.schema.json at root, no state/ schema") | — | Clean — independent PIC-1 keep-root confirmation |

_The companion replied only via its farewell envelope (fire-and-forget; no `finding`-typed messages during the phase). **0 findings raised** — a clean APPROVE on every commit and the final cross-commit sweep._

---

## Tasks

### T000 — Harness pre-flight ✅
Fired the pre-implement seam; boot `degraded` (hard sensors clean), proceeded with note (see above).

### T001 — AC-6 transition-acceptance test ✅ · commit `984b504`
- **File**: `test/mcp/coordination-contract.test.ts` (extended; +91 lines).
- **(d)** Reads the **real shipped** `agents/code-review-companion/inside-state.schema.json`, writes it to the fixture agent **root** (no `state/` dir), and asserts every published target (`idle/reading/reviewing/reporting/blocked/stopping`) is accepted by `stateTransition`. Also pins the published 6-value set so an enum change forces a deliberate revisit.
- **(e) discriminating negative**: a truncated enum (drop `stopping`) makes `stateTransition({to:'stopping'})` throw `MCP_INVALID_ARGUMENT` (asserted via `error.code`); a still-present value (`reading`) resolves fine — proving the rejection is about the dropped value, not a broken fixture.
- **Evidence**: `vitest run test/mcp/coordination-contract.test.ts` → **5/5 passed** (115ms). RED-for-the-right-reason proven by (e).

### T002 — Location disposition (PIC-1): keep root ✅ · verify-and-record (no code)
- **Verified**: `agents/code-review-companion/inside-state.schema.json` **present at root**; **no** `agents/code-review-companion/state/inside-state.schema.json`; `agent.json` lists it in the install payload (`"path": "inside-state.schema.json"`, line 32). Resolver finds it at **level 2** (proven green by T001 case d, which never creates a `state/` dir).
- **Decision (Jordan, 2026-06-15)**: keep schema at root, **do not relocate**, **do not remove**. `state/` is install-denied (`RUNTIME_DIR_NAMES`); relocating would drop it from the install payload and reintroduce #27/#31 on installed copies. The plan's Phase 3 Delivers/Domain-Manifest relocate rows are **superseded**.

### T003 — Correct stale schema description ✅ · commit `3190952`
- **File**: `agents/code-review-companion/inside-state.schema.json` (`status.description`).
- **Was**: "…inside-state validation is not yet enforced…". **Now**: states the runtime validates every `state_transition`/`state_set` against the enum and rejects out-of-enum statuses with `MCP_INVALID_ARGUMENT` (`validateInsideState`, `state.ts`), and notes `minih doctor`'s authoring-time drift check.
- **Ground truth**: `validateInsideState` is invoked at `state.ts:100` (stateTransition) and `:81` (stateSet) and throws `MCP_INVALID_ARGUMENT` (`:166`). Enum **unchanged**; JSON re-validated.

### T004 — Pin doctor no-drift (AC-7) ✅ · commit `8c6ae4b`
- **File**: `test/cli/doctor-state-vocabulary.test.ts` (extended).
- Runs `minih doctor --agents-dir <real agents/>` and asserts `prompt-state-vocabulary-drift` = **`pass`** for the **real** `code-review-companion` pack (schema resolved at root). Green today; RED the moment a prompt edit or enum change reintroduces drift.
- **Evidence**: `vitest run test/cli/doctor-state-vocabulary.test.ts` → **14/14 passed** (AC-7 case 457ms). Companion confirmed `coordination: enabled`.

---

## Phase-complete summary

- **AC-6** (per-transition acceptance) ✅ pinned (T001 d/e). **AC-7** (doctor no-drift) ✅ pinned (T004). **Schema description** ✅ truthful (T003). **PIC-1** ✅ resolved keep-root (T002).
- **AC-17** (whole-plan gate): `just fft` → **exit 0** (lint · format · build · typecheck · test · audit · sdk-check). No regression; **no format drift** on committed files. Coordination suite + the 3 new tests green.
- **Commits** (surgical, branch `027-companion-coordination`): `984b504` (T001), `3190952` (T003), `8c6ae4b` (T004). T002 produced no code diff (verify-and-record).
- **Non-goals honoured**: global default schema (`src/schemas/inside-state.json`) byte-unchanged; per-pack enum unchanged; no ledger/tool/CLI/transport work; **no relocation to `state/`**.

### Suggested commit message (flow bookkeeping)
`chore(027): close Phase 3 (#27/#31) — execution log, task table, companion debrief`

---

## Companion debrief

- **Session**: started 02:21:24Z → ended 02:31:15Z · exitReason `stop_requested` · tasksReceived 4 · **findingsSent 0**.
- **Verdict**: clean **APPROVE** on T001/T003/T004 + final sweep; `findings: []`.
- **Reconciliation**: nothing to reconcile — 0 findings (no ADDRESSED/DEFERRED/DISAGREE items). All four `review-request` pings acknowledged; 0 unresolved peer requests; state published throughout (7 peer updates).
- **magicWand** (`magicWandTarget: coordination`): *"Add the planned coordination_status/report-draft primitive for companions so the inside agent can fetch reviewed task IDs, finding counts, summaries, unresolved requests, allowed states, and a schema-valid farewell draft from the ledger instead of hand-counting before exit."*
  → **Follow-up candidate**: this is the **already-planned Phase 4** (`coordination_status` ledger primitive, #36/#32). **Third independent re-derivation** by a companion (P1 + P2 companions both surfaced the same). No new dossier needed — it confirms Phase 4's motivation. Surfaced only.
- **Companion-side difficulty** CRC-001 (`debug`, annoying): the `glob` tool returned no matches for `docs/plans/027-…` despite the files existing; worked around with `find`. This is the **companion's own toolchain**, not the minih dev harness — noted, not actioned here.
- **Worked well** (companion retro): focused vitest files covered AC-6 + AC-7; the coordination inbox gave clean `ackOf`-linked review boundaries; state + long-poll made the outside/inside workflow observable without reading run-dir files.

---

## Harness seam — phase-end (T0z)

`/eng-harness-flow --event phase-end --plan-dir docs/plans/027-companion-coordination --json` — fired at phase end; router owns drain-vs-harvest.

- **Routing**: observe buffer non-empty (`.harness/temp/agent/session-buffer.md` carries `SUGG-002` fft lint-before-format + others) → router routes **`--drain`** (drain-before-harvest).
- **Decision**: **defer the drain to the plan-complete seam** — the established cadence for this plan (observations accumulate across phases and drain once at merge). Advisory; never forces.
- **This session's capture**: `SUGG-003` (improvement-suggestion) — the progress sub-skill's documented farewell-read `minih validate <slug> --file <report.json>` path is stale for minih 0.2.0 (`--file` rejected; read `output/report.json` directly). Added to the buffer for the plan-complete drain.
