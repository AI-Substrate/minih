# Per-repo Copilot SDK Session Isolation (`COPILOT_HOME` under `./.minih`)
**Mode**: Simple
**Plan Version**: 1.0.0
**Created**: 2026-06-23
**Status**: READY
**Spec source**: unified (this file)

📚 Incorporates findings from `research-dossier.md`.

## Business Specification

### Research Context
minih wraps `@github/copilot-sdk` 1.0.1. The SDK client option `baseDirectory` sets the `COPILOT_HOME` env var on the spawned Copilot CLI runtime (default `~/.copilot`), governing the entire data store: session-state, session-store.db, history, config, logs, embedding cache, auth. Today minih only isolates via CWD (sets the SDK `workingDirectory` = run folder so `copilot --resume` filters its runs out by cwd), but the sessions still physically accumulate in the shared `~/.copilot` (now 82 MB `session-store.db` + 1,228 `session-state/` dirs). The fix is a separate per-repo `COPILOT_HOME`. (Full evidence + file:line citations in `research-dossier.md`.)

### Summary
Point the Copilot SDK at a **per-repo, git-ignored `./.minih/copilot-home`** so minih's sessions are physically separate from the user's interactive `copilot` CLI store and easy to find per repo. Pass `gitHubToken` explicitly so auth survives the fresh home. Make the runtime log level toggleable (default `info`) and warn on CLI usage when an area's logs grow large.

### Goals
- minih's Copilot sessions live under `<repo>/.minih/copilot-home/`, never in `~/.copilot`.
- The user's `copilot --resume` never shows minih runs (regardless of cwd/picker).
- Auth keeps working with a fresh empty home (via `GH_TOKEN`).
- Per-repo `.minih/` is git-ignored.
- Log verbosity is toggleable (default `info`); large per-repo logs produce a visible CLI warning.

### Non-Goals
- **Fixing the `configDir`→`configDirectory` SDK field-name mismatch** (verified real, but a separate per-session knob — its own issue).
- Migrating or cleaning minih's existing sessions already in `~/.copilot`.
- Seeding user-level config (mcp-config.json / settings.json / plugins) into the new home — minih threads model/mcp/skills per-run already.
- A single global `~/.minih` home — explicitly per-repo per the user.

### Target Domains

| Domain | Status | Relationship | Role in This Feature |
|--------|--------|--------------|----------------------|
| cli | existing | **modify** | The composition root (`sdk-runtime.ts`) that constructs the Copilot client — add `baseDirectory`/`gitHubToken`/`logLevel` + the home resolver and large-logs warning |
| adapter | existing | **consume** | Receives the already-constructed client; no changes (the home is set at construction, before the adapter) |

### Testing Strategy
- **Approach**: Lightweight (defaulted — per the user's "keep it simple / don't prompt"). Unit-test the pure helpers (home resolution, large-logs threshold); verify end-to-end behavior manually.
- **Focus Areas**: home-path resolution (default + env override + mkdir); the log-size warning threshold logic.
- **Excluded**: mocking the Copilot SDK runtime (covered by the manual run-through).
- **Mock Usage**: Avoid mocks — use real temp dirs / fixtures.

### Documentation Strategy
- **Location**: `docs/how/` — a short `copilot-home.md` documenting the three operator-facing env vars and the isolation behavior.
- **Rationale**: discoverable next to other how-docs; these are operator-facing (read by the CLI process), so **not** the agent preamble (PL-12 governs agent-facing `MINIH_*` vars only).

### Complexity
- **Score**: CS-2 (small)
- **Breakdown**: S=1, I=1, D=0, N=0, F=1, T=1
- **Confidence**: 0.85
- **Assumptions**: minih is invoked from the repo root (`process.cwd()` = repo root, matching `{{REPO_ROOT}}`); `GH_TOKEN` is always set (hard-gated at `sdk-runtime.ts:52`).
- **Dependencies**: none new.
- **Risks**: see Risks table.
- **Phases**: 1 (Simple).

### Acceptance Criteria
1. **AC-01** — A `minih run` writes its Copilot session store under `<repo>/.minih/copilot-home/` (e.g. `session-state/`, `session-store.db`) and creates **no** new session under `~/.copilot`.
2. **AC-02** — After a run, `copilot --resume` from the repo root lists none of minih's sessions.
3. **AC-03** — Auth succeeds with a fresh/empty `.minih/copilot-home` when `GH_TOKEN` is set (no dependency on `~/.copilot/m-auth`).
4. **AC-04** — `.minih/` is git-ignored (`git status` clean after a run); `.minih.json` remains tracked.
5. **AC-05** — Home path overridable via `MINIH_COPILOT_HOME`; log level defaults to `info`, is overridable via `MINIH_COPILOT_LOG_LEVEL`, and an **invalid** value falls back to `info` (an out-of-range string never reaches the SDK).
6. **AC-06** — When `<home>/logs` exceeds the threshold (default 500 MB, override `MINIH_COPILOT_HOME_WARN_MB`) a single stderr warning naming the area + remedy prints on run/resume start; below threshold (or no logs dir) it is silent.
7. **AC-07** — `docs/how/copilot-home.md` documents the three env vars (`MINIH_COPILOT_HOME`, `MINIH_COPILOT_LOG_LEVEL`, `MINIH_COPILOT_HOME_WARN_MB`) and the isolation behavior.

### Risks & Assumptions
- Auth is the only must-handle; mitigated by passing `gitHubToken` explicitly.
- The change is confined to one composition-root file + a small helper.

### Open Questions
None — decisions are locked (location, log toggle, warning, auth approach).

### Workshop Opportunities
None — scope is small and fully researched.

### Clarifications
#### Session 2026-06-23
- **Workflow Mode**: Simple (`--simple`; user: "keep it all simple, not boil ocean").
- **Testing / Mock / Docs**: defaulted (Lightweight · no mocks · `docs/how/`) at the user's explicit request to proceed without prompting ("do the plan and validation please then report complete"). Override any of these by re-running the plan verb.

## Planning Seam
_Refinement opportunities still open — recorded as evidence; the flow surfaces and offers these, none gate:_
- Open Workshop Opportunities: none — all resolved.

| Artifact | Present? | Effect on the plan |
|----------|----------|--------------------|
| research-dossier.md | y | informs Key Findings, the fix surface, and the auth approach |
| workshops/*.md | n | — |

## Implementation Plan

### Gate Matrix

| Gate | Check | Status | Notes |
|------|-------|--------|-------|
| G1 | Clarify | PASS | No critical `[NEEDS CLARIFICATION]`; Round-1 defaults recorded in Clarifications |
| G2 | Constitution | N/A | No `docs/project-rules/constitution.md` |
| G3 | Architecture | N/A | No `docs/project-rules/architecture.md` |
| G4 | ADR Compliance | N/A | No `docs/adr/` |
| G5 | Structure | PASS | All required sections present |
| G6 | Testing Alignment | PASS | Lightweight: ≥1 validation task (T006) + manual verify (T007) |
| G7 | Domain Completeness | PASS | `cli` (modify) + `adapter` (consume) both in registry; Domain Manifest covers all task files |

### Summary
Add a per-repo `COPILOT_HOME` by passing `baseDirectory` (+ `gitHubToken`, `logLevel`) to the single `CopilotClient` construction in `src/cli/commands/sdk-runtime.ts`. A small `copilot-home.ts` helper resolves the path (env override → `<repo>/.minih/copilot-home`, mkdir -p) and emits a large-logs warning. Git-ignore `.minih/`, document the env vars, unit-test the helpers, and verify a real run lands its store in the new home with auth intact.

### Domain Manifest

| File | Domain | Classification | Rationale |
|------|--------|----------------|-----------|
| src/cli/commands/copilot-home.ts | cli | internal | New helper: home resolution + large-logs warning |
| src/cli/commands/sdk-runtime.ts | cli | internal | Wire `baseDirectory`/`gitHubToken`/`logLevel`; call the helper |
| .gitignore | cli | internal | Ignore `.minih/` (repo config) |
| docs/how/copilot-home.md | cli | internal | Operator-facing env-var + behavior docs |
| test/cli/copilot-home.test.ts | cli | internal | Unit tests for the helpers |

### Key Findings

| # | Impact | Finding | Action |
|---|--------|---------|--------|
| 01 | Critical | `baseDirectory` → `COPILOT_HOME` is the one knob; default `~/.copilot` is the shared store causing pollution (`client.js:1376-1377`) | Set `baseDirectory` to the per-repo home in the single construction site |
| 02 | High | A fresh home loses `~/.copilot/m-auth`; minih doesn't pass `gitHubToken` today (relies on `useLoggedInUser` default) | Pass `gitHubToken: process.env.GH_TOKEN` → SDK sets `COPILOT_SDK_AUTH_TOKEN` (`client.js:1370`) |
| 03 | High | `~/.copilot/logs` reached 1.2 GB; per-repo that bloats `.minih` | Default `logLevel: info` toggleable + shallow-sum large-logs warning |
| 04 | Medium | `configDir` (minih) vs `configDirectory` (SDK) mismatch silently drops the per-session config dir | Out of scope — flag as a separate issue (Non-Goal) |

### Implementation

**Objective**: Relocate minih's Copilot session/config store to a per-repo, git-ignored `./.minih/copilot-home`, with auth preserved, a toggleable log level, and a large-logs warning.
**Testing Approach**: Lightweight — unit tests for the pure helpers + one manual end-to-end verification.

#### Tasks

| Status | ID | Task | Domain | Path(s) | Done When | Depends | Notes |
|--------|-----|------|--------|---------|-----------|---------|-------|
| [x] | T001 | Helpers: `resolveCopilotHome()` — `MINIH_COPILOT_HOME ?? join(process.cwd(), '.minih', 'copilot-home')` + `mkdirSync(home,{recursive:true})`; **and** `resolveCopilotLogLevel()` — read `MINIH_COPILOT_LOG_LEVEL`, validate against the SDK set (`none`/`error`/`warning`/`info`/`debug`/`all`), fall back to `'info'` on unset or invalid | cli | src/cli/commands/copilot-home.ts | home resolver returns per-repo path + dir created + env override honored; log-level resolver returns a valid SDK level, never an out-of-range string | — | AC-05; finding 02 (invalid env must not reach the SDK) |
| [x] | T002 | Extract a pure `buildCopilotClientOptions(home, token, logLevel, otlpEndpoint?)` returning the `CopilotClient` opts (`baseDirectory`, `gitHubToken`, `logLevel`, **preserved** `onGetTraceContext` + `telemetry`); call it from `sdk-runtime.ts` with `resolveCopilotHome()` + `resolveCopilotLogLevel()` (T001) and pass the result to `new CopilotClient(...)` | cli | src/cli/commands/copilot-home.ts, src/cli/commands/sdk-runtime.ts:105-118 | opts object carries all five fields; trace/telemetry preserved; client constructed from it | T001 | AC-01, AC-03, AC-05; findings 01,02; DoD contract (the wiring sensor) |
| [x] | T003 | `warnIfHomeLogsLarge(home)` — shallow-sum `<home>/logs/*` sizes; if > `MINIH_COPILOT_HOME_WARN_MB ?? 500` print one stderr line naming the area + remedy; call once on run/resume start (after the home is resolved) | cli | src/cli/commands/copilot-home.ts, src/cli/commands/sdk-runtime.ts | over-threshold warns once; under/absent silent | T001 | AC-06; finding 03 |
| [x] | T004 | Add `.minih/` (trailing slash — directory only) to `.gitignore` | cli | .gitignore | `git check-ignore .minih/copilot-home` exits 0; `git ls-files .minih.json` still lists it (tracked); `git status` clean after a run | — | AC-04; DoD contract (sensor is `check-ignore`, not a grep of the file) |
| [x] | T005 | Document the three operator-facing env vars + isolation behavior | cli | docs/how/copilot-home.md | doc lists `MINIH_COPILOT_HOME`, `MINIH_COPILOT_LOG_LEVEL`, `MINIH_COPILOT_HOME_WARN_MB` + behavior | — | AC-07; PL-12: operator-facing, not agent preamble |
| [x] | T006 | Unit tests: home resolver (default / env override / mkdir); log-level resolver (valid / unset→info / **invalid `verbose`→info** neg-control); large-logs threshold (under / over / missing dir — seed a temp `logs/` *just over* a low `MINIH_COPILOT_HOME_WARN_MB`, capture stderr); **`buildCopilotClientOptions()` carries `baseDirectory`=home, `gitHubToken`=GH_TOKEN, `logLevel`, and preserves `onGetTraceContext`+`telemetry` (neg-control: missing GH_TOKEN ⇏ `undefined` token)** | cli | test/cli/copilot-home.test.ts | tests pass; no mocks (real temp dirs) | T001, T002 | AC-01, AC-03, AC-05, AC-06; DoD contract |
| [x] | T007 | Manual verify with a defined oracle: snapshot `ls ~/.copilot/session-state | wc -l` **before**, `minih run`, snapshot **after** (must be equal) + `find .minih/copilot-home -name session-store.db` non-empty; `copilot --resume` **from the default home** lists no minih runs; run authenticates (token valid) | cli | — | T002, T003, T004 | AC-01, AC-02, AC-03 confirmed by hand; DoD contract |

### Acceptance Coverage Map

| AC | Covered by | Verified in |
|----|------------|-------------|
| AC-01 | T002 | T007 (manual run) |
| AC-02 | rides AC-01 (sessions not in `~/.copilot` at all) | T007 (resume from default home) |
| AC-03 | T002 | T007 (run with GH_TOKEN, fresh home) |
| AC-04 | T004 | `git status` after run |
| AC-05 | T001, T002 | T006 |
| AC-06 | T003 | T006 |
| AC-07 | T005 | manual inspection of docs/how/copilot-home.md |

### Definition-of-Done Contract (grill 2026-06-23)

Each AC lined up against the strongest proof grade it admits. The implement stage consumes this directly. Advisory — the verdict comes from running the sensors, not this table.

| Claim | Grade | Sensor / reviewer | Pass condition | Gap |
|---|---|---|---|---|
| AC-01 store isolation | deterministic + inferential | `buildCopilotClientOptions()` unit (T002/T006); scripted T007 `~/.copilot` before/after diff | opts carry `baseDirectory`=home & telemetry preserved; `~/.copilot` count unchanged & store in `.minih` | SDK-honors-`COPILOT_HOME` re-proven only by hand |
| AC-02 resume-clean | deterministic (rides AC-01) + inferential | AC-01 diff; T007 "resume from default home" | `~/.copilot` count unchanged ⟹ default resume can't list minih runs | none beyond AC-01 |
| AC-03 auth | deterministic + inferential | `buildCopilotClientOptions()` asserts `gitHubToken`=`GH_TOKEN` (T006); normal run (T007) | token in opts (neg-ctrl: no `GH_TOKEN` ⇏ `undefined`); SDK contract `gitHubToken ⟹ useLoggedInUser:false`; run authenticates | token validity/expiry; no clean-room (trusts SDK contract) |
| AC-04 gitignore | deterministic | `git check-ignore .minih/copilot-home` + `git ls-files .minih.json` (T004) | check-ignore exits 0; `.minih.json` still tracked; `git status` clean post-run | — |
| AC-05 home/log-level | deterministic | T006 unit | env override honored; invalid `verbose`→`info` (neg-ctrl) | — |
| AC-06 large-logs warn | deterministic | T006 unit (real temp dirs, stderr capture) | over→1 warn; under→silent; no dir→silent (neg-ctrl: seed just-over) | shallow-sum perf not proven (accepted) |
| AC-07 docs | inferential (+ optional det. floor) | reviewer; optional grep-test for the 3 var names (precedent: `test/cli/docs-vocabulary.test.ts`) | doc exists & names all 3 vars; content accurate | content quality is human |

**Leverage**: `buildCopilotClientOptions()` (one extracted pure fn) is the deterministic sensor for AC-01, AC-02 (via AC-01), AC-03, and the T002 telemetry-preservation regression.

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Auth breaks on a fresh empty home | Low | High | Pass `gitHubToken` explicitly (T002); `GH_TOKEN` already required at entry |
| Per-repo logs bloat `.minih` | Medium | Medium | `logLevel` default `info` + toggle to `error`; large-logs warning (T003) |
| `process.cwd()` from a subdir creates a stray `.minih` | Low | Low | Matches existing `{{REPO_ROOT}}` semantics; documented; anchor to git toplevel later if needed |
| Recursive full-dir size scan slows CLI start | Low | Low | Shallow-sum `logs/` only (one level) — cheap even at multi-GB |
| Concurrent `minih run`s in one repo share a single `.minih/copilot-home/session-store.db` | Low | Low | Pre-existing pattern (the store was already shared under `~/.copilot`); SQLite WAL handles concurrent access; runs are typically sequential per repo — accepted, no new mitigation |
| Invalid `MINIH_COPILOT_LOG_LEVEL` reaches the SDK | Low | Medium | `resolveCopilotLogLevel()` validates against the SDK union and falls back to `info` (T001); tested in T006 |

---

## Validation Record (2026-06-23)

### Validation Thesis
**Raison d'être**: Isolate minih's Copilot SDK sessions into a per-repo, git-ignored `./.minih/copilot-home` so they stop polluting the user's main `copilot` CLI resume list, without breaking auth or bloating logs.
**Value claim**: Per-repo findability + a clean user `copilot --resume`.
**Artifact promise**: An implementer can build it with minimal clarification (one composition-root edit + a small helper + gitignore + docs + tests), knowing the knob (`baseDirectory`→`COPILOT_HOME`), the auth handling (`gitHubToken`), and the acceptance bar.
**Intended beneficiaries**: the implementer; the user/operator; future maintainers.
**Proof target**: Implementation.
**Evidence standard**: Source-grounded fix locus + SDK option names verified against `node_modules/@github/copilot-sdk` + testable ACs.
**Thesis source**: `original-ask.md` (verbatim user intent) + `research-dossier.md`.
**Thesis verdict**: Advanced.
**Main thesis risk**: Minimal — the `process.cwd()` = repo-root assumption (documented, Low).

| Agent | Lenses Covered | Thesis Axes Covered | Issues | Verdict |
|-------|----------------|---------------------|--------|---------|
| Coherence & Completeness | Coherence, Completeness, Domain Boundaries, Proof-Level Fit | Implementation Readiness | 1 HIGH, 2 MED, 1 LOW — all fixed | ⚠️ → ✅ |
| Risk & Evidence | Evidence Sufficiency, Technical Constraints, Integration & Ripple, Hidden Assumptions, Deployment & Ops, Edge Cases | Evidence Sufficiency, Safety to Change | 0 (1 MED observation folded in) | ✅ |
| Thesis Alignment | Thesis Alignment | Thesis Alignment, User-Value Preservation | 0 | ✅ |
| Forward-Compatibility | Forward-Compatibility, Technical Constraints | Downstream Usefulness | 0 real (1 false-positive downgraded) | ✅ |

### Forward-Compatibility Matrix

| Consumer | Requirement | Failure Mode | Verdict | Evidence |
|----------|-------------|--------------|---------|----------|
| Implement stage / engineer | Unambiguous tasks, real file paths, testable done-when | shape mismatch | ✅ | All T001–T007 paths valid; done-when concrete (post-fix T002 names its T001 dependency) |
| Copilot SDK contract | `baseDirectory`/`gitHubToken`/`logLevel` are valid client options | contract drift | ✅ | `types.d.ts:176,191,181` — all present; `'info'` is a valid `logLevel` |
| CWD-isolation mechanism (AC-02) | `baseDirectory` additive to `workingDirectory=runDir` | lifecycle ownership | ✅ | client-level vs session-level — orthogonal (`types.d.ts:169` vs `:176`) |
| minih telemetry wiring | new opts compose with `onGetTraceContext`+`telemetry` | encapsulation lockout | ✅ | spread-merge preserves existing opts (`sdk-runtime.ts:105-118`) |

**Thesis alignment**: Value claim advanced at the Implementation proof level on strong, source-verified evidence; main risk is the documented `process.cwd()` assumption (Low).

**Outcome alignment**: The plan advances the user's outcome — "find them per repo really easily" — by relocating the session store to a git-ignored `./.minih/copilot-home` via the verified `baseDirectory`→`COPILOT_HOME` knob, with the `.gitignore` entry (T004) and auth (`gitHubToken`) closing the loop.

**Standalone?**: No — downstream consumer is the implement stage (tasks T001–T007 + ACs).

Overall: ✅ VALIDATED WITH FIXES

