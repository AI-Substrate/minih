# Core Harness — wrap minih with the harness-core engineering substrate

**Mode**: Simple

📚 Specification incorporates findings from research-dossier.md (69 findings, 8 subagents, 2026-06-11).

## Research Context

The dossier established: minih already runs a compiled-in *product* feedback harness (AJV-enforced agent retros → `docs/retros/`); harness core adds the *session-level* engineering harness for whoever develops this repo. Key constraints discovered: the global `harness` CLI is **v0.2.0 npm-linked to a live dev checkout** (DC-10); the eng-harness skills' setup rung hard-codes a repo-local npm install that the operator forbids — everything we write must use the bare-`harness` dialect (IC-03/IC-10); a prior-generation governance doc exists at `docs/project-rules/harness.md` claiming maturity L2 (DE-08); `just fft` mutates the tree so boot needs a hand-written composite verb (QT-01); biome checks `.harness/**/*.{ts,json}` and `.harness/temp/` is unprotected today (PS-01/PS-05); `docs/retros/` is a shipped product contract — read-bridge only (DB-04/DE-03).

## Summary

Stand up the `.harness/` engineering-harness substrate in the minih repo, driven by the globally-installed `harness` CLI (no repo-local install): migrate governance from `docs/project-rules/harness.md` to `.harness/engineering-harness.md`, build a hand-written read-only composite `boot` verb, establish the records/temp storage split with correct gitignore/biome hygiene, route future agents via an AGENTS.md block, declare `docs/retros/` a legacy read path for retro harvest, and add the domain-registry tooling note — so the eng-harness skills loop (Boot → Backpressure → Observe → Retro → Improve) becomes operable here, embracing minih's existing harness concepts rather than duplicating them.

## Goals

- `.harness/` substrate matching the router's canonical signal shape (IC-01): `engineering-harness.md`, `extensions/boot/`, `records/retro/`, `temp/` (gitignored), with `reports/harnessability/` reserved for the assessment skill.
- Governance migrated: Phase Gates, Boot definition, and the History table (L0→L2 record preserved, new entry appended) move to `.harness/engineering-harness.md`; `docs/project-rules/harness.md` becomes a deprecation pointer. Every threshold stated in governance must be queryable (PL-05, PL-09).
- A hand-written, **read-only** composite `boot` verb emitting an honest envelope (`ok|degraded|unconfigured|error`, exits 0/0/2/1) with per-sensor results and a machine-readable orientation digest (PL-13). Sensor composition (decided): `biome check` + `tsc --noEmit` + `just check` + `minih doctor --json` (parse envelope status, never exit code) + unmasked `npm audit --audit-level=high --json` (offline → soft-skip, sdk-check precedent).
- Friction capture live end-to-end: `harness observe` → `.harness/temp/` buffer (self-gitignored + repo-level ignore entry) → drain → `harness record retro` → committed `.harness/records/retro/**` that pass `just fft`.
- AGENTS.md harness block at the top (before "Build, Test, Lint"), bare-`harness` dialect throughout, dogfood rule extended ("file it as magicWand" → `harness observe --kind magic-wand`).
- `docs/retros/` declared a **legacy read path** for `eng-harness-4-retro --harvest` in governance — minih's writers untouched (answers the #39 tension without code changes).
- Domain registration (user decision, overriding the dossier's DB-08 lean): **eng-harness becomes the sixth registered domain** — `registry.md` row, `docs/domains/eng-harness/domain.md` (contracts, composition, boundaries), `domain-map.md` updated with a one-way `eng-harness → cli` consumption edge and **zero inbound edges**; `cli` and `runner` domain docs list eng-harness as a named external consumer. The DB-07 rule is encoded as the domain's hard boundary: extensions are shell-wrappers only — no `src/`/`dist/` imports, ever.
- One deep guide at `docs/how/engineering-harness.md` (lean-contract/deep-narrative split per PL-11), including the narrow-gate command map (PL-15).
- Repo-wide `just fft` green at completion; all scaffolded files biome-clean (PL-03).

## Non-Goals

- **No repo-local npm install** of harness-engineering (operator rule; everything is cwd-relative).
- **No `src/` changes**: #37 (env injection), #39 (configurable ledger destination), the QT-10 flake, and minih CLI additions are out of scope — recorded as follow-up candidates only.
- **No migration or redirection of `docs/retros/` writers** — product contract stays intact.
- **No harnessability assessment run** in this plan — the substrate reserves its directory; running `eng-harness-0-harnessability-assessment` is a separate, post-merge activity.
- **No changes to the eng-harness skills themselves** (they live in the harness-engineering repo); dialect conflicts are routed around in what we write here.
- **No project-local skills install** — eng-harness skills stay global-only (decided); the AGENTS.md block carries the one-liner install command for the missing-skills case.
- **No pinning of the harness-engineering checkout** — governance records version + contract surface instead (decided).

## Target Domains

| Domain | Status | Relationship | Role in This Feature |
|--------|--------|-------------|---------------------|
| cli | existing | **consume** | Boot shells `minih doctor --json` and parses the `MinihEnvelope` status (never exit codes); harness gets listed as a named envelope consumer |
| runner | existing | **consume** | Retro read-bridge source — observed only via CLI envelopes (`runs`, `difficulties`, `retros --json`), never direct `agents/*/runs/` reads |
| measurement | existing | **consume** | Vocabulary donor: governance/boot reporting cites its fact-vs-interpretation authority model and proof-level framing; boundary untouched |
| eng-harness | **NEW** | **create** | Sixth registered domain: the `.harness/` substrate, composite boot verb, friction capture, and governance — registered in `docs/domains/` with a strict one-way boundary |

### New Domain Sketches

#### eng-harness [NEW]
- **Purpose**: The repo's own dev-loop harness — deterministic session-start proof (boot), friction capture (observe/records), and governance — for agents/humans developing minih. Registered per user decision (Clarifications 2026-06-11), overriding the dossier's keep-outside-registry lean (DB-08); revisit note retained in domain.md History.
- **Boundary Owns**: `.harness/**` (extensions, records, temp, reports), `.harness/engineering-harness.md` governance, the AGENTS.md routing block, the docs/how guide.
- **Boundary Excludes**: minih-as-product-harness (agent retro contract, `docs/retros/` writers, difficulties aggregation — runner/cli domains); the justfile recipes themselves (consumed, not owned); the eng-harness skills (external family).
- **Hard boundary rules** (encoded in domain.md): (1) extensions are shell-wrappers — no `src/`/`dist/` imports from `.harness/` (DB-07); (2) **zero inbound edges** — no registered product domain may import from or depend on eng-harness; (3) observation only via published CLI envelopes (DB-06); (4) domain-map edge: `eng-harness → cli` (process-boundary consumption), nothing else.

## Testing Strategy

- **Approach**: Lightweight — deterministic behavioral verification, no new test infra.
- **Rationale**: `.harness/extensions/*.ts` is invisible to vitest/tsc by design (PS-03/PS-04); the verbs ARE the sensors, so verification means running them and asserting envelope contracts.
- **Focus Areas**: envelope legality (`status` ∈ vocabulary, exit codes 0/1/2, `next_action` on non-ok); boot read-only proof (`git status --porcelain` unchanged); gitignore efficacy (`git check-ignore .harness/temp/x`); biome cleanliness of every scaffolded file; router signal probes (governance/boot/substrate present); full `just fft` at the end.
- **Excluded**: unit tests for extension internals; e2e of the skills loop choreography (skill-owned); harnessability scoring.
- **Mock Usage**: Avoid mocks entirely — boot genuinely shells `just`/`biome`/`tsc`/`minih`/`npm audit`; verification runs real verbs. The only tolerated simulation is exercising boot's offline path by observing its behavior when the network step soft-skips (matching `sdk-check` precedent).

## Documentation Strategy

- **Location**: `docs/how/engineering-harness.md` only.
- **Rationale**: matches the repo's established lean-contract + deep-how-to split (PL-11): `.harness/engineering-harness.md` stays terse and queryable; the narrative (loop stages, verb briefings, commit-type rule `chore(harness):`/`docs(harness):`, narrow-gate command map) lives in docs/how/. README is product-facing and untouched.

## Complexity

- **Score**: CS-3 (medium)
- **Breakdown**: S=1, I=1, D=1, N=1, F=1, T=1 (P=6)
- **Confidence**: 0.85
- **Assumptions**: global `harness` v0.2.0 contract surface stays stable for the build window (envelope, VerbContext, record placement, observe flags); `just`/`biome`/`node` remain on PATH (harness doctor hard-codes them, DC-09).
- **Dependencies**: global `harness` CLI (linked checkout `/Users/jordanknight/substrate/harness-engineering`); eng-harness skills ×7 (global); minih CLI built (`dist/`) for `minih doctor` composition.
- **Risks**: see Risks & Assumptions.
- **Phases**: 1 (Simple mode — substrate + boot + routing + docs in one phase with ordered tasks).

## Acceptance Criteria

1. **Substrate shape**: `.harness/engineering-harness.md`, `.harness/extensions/boot/extension.ts` + `instructions.md`, `.harness/records/retro/` (with `.gitkeep` or first record), and a gitignored `.harness/temp/` exist; eng-harness-flow's setup signals C/D/E all pass.
2. **Doctor clean**: `harness doctor --json` from repo root reports the boot extension loaded (`installed: 1, failed: 0, conflicts: 0`) and zero convention complaints (including temp-gitignore protection).
3. **Boot envelope honest**: `harness boot --json` exits 0 with `status: ok` or `degraded` (degraded expected day one — `minih doctor` 74 warnings + audit findings, QT-06/QT-07), `data` carrying per-sensor results and the orientation digest; `next_action` present whenever status ≠ ok.
4. **Boot is read-only**: `git status --porcelain` output is byte-identical before and after `harness boot` (no `biome format --write`, no file mutations).
5. **Boot catches the observed failure class**: with a deliberately mis-formatted scratch `.json` committed to a temp branch (or staged), boot reports the lint sensor failing — proving it covers what `just check` alone missed (QT-08).
6. **Friction loop round-trips**: `harness observe "<test>" --kind difficulty --severity annoying` writes to `.harness/temp/`; `git status` stays clean; `harness observe --list --json` returns the entry; `harness record retro --slug 024-core-harness` creates `.harness/records/retro/<date>/<NNN>-024-core-harness.md`; `harness observe --clear` empties the buffer.
7. **Governance migrated**: `.harness/engineering-harness.md` contains the Phase Gates and History table from `docs/project-rules/harness.md` (L0→L2 entries preserved, new migration entry appended); the old file is reduced to a dated deprecation pointer; every threshold in the new doc names the command that queries it.
8. **Legacy read path declared**: governance names `docs/retros/*.md` as a harvest legacy READ source (minihToUniversal mapping per IC-09) and prohibits writers from targeting it from `.harness/`.
9. **AGENTS.md routes**: a harness block sits above "Build, Test, Lint" using only bare `harness …` invocations (zero `npx harness` occurrences in the diff), and extends the dogfood rule with `harness observe --kind magic-wand`.
10. **Domain registered**: `docs/domains/registry.md` carries an `eng-harness` row (Active); `docs/domains/eng-harness/domain.md` exists with Purpose, Owns/Excludes, the four hard boundary rules (shell-wrappers only, zero inbound edges, envelope-only observation, single `eng-harness → cli` map edge), and a History note recording the register-vs-tooling-note decision; `domain-map.md` shows the one-way edge; `cli` and `runner` domain docs list eng-harness as a named external consumer.
11. **Gate green**: `just fft` passes repo-wide after all files land (scaffolds biome-clean; records markdown-inert); commits touching only `.harness/`/docs use non-releasing types (`chore(harness):`/`docs(harness):`, PS-07).

## Risks & Assumptions

| # | Risk | Mitigation |
|---|------|-----------|
| R1 | Global `harness` is a moving target (v0.2.0, npm-linked to live dev checkout on `feat/cli-bin-engh`) — behavior shifts on rebuild | Decided: record contract only. Governance records the version + contract surface (envelope, VerbContext, record placement, observe flags); boot evidence names the version; no checkout pinning |
| R2 | Day-one `degraded` reads as failure to a casual observer | Governance + boot `next_action` explain the known degraded inputs (minih doctor warnings, audit findings); AC-3 codifies degraded-as-honest |
| R3 | Skill-family invocation dialect drift (`npx harness` vs bare) | Everything 024 writes uses bare `harness`; governance notes the dialect rule; skills themselves out of scope |
| R4 | jiti TS loading quirks in extensions | Keep `extension.ts` dependency-free (type-only contract import or JSDoc); verified via `harness doctor` load check (AC-2) |
| R5 | Scaffold files fail biome (the recurring PL-03 class) | Format-then-commit discipline baked into tasks; AC-11 gates on `just fft` |
| R6 | `harness init` ships upstream mid-build and conflicts with hand-written governance | Checked the linked checkout during research window; governance doc is ours regardless — init adoption is a future follow-up |

## Open Questions

- (none remaining after Clarifications — see below)

## Workshop Opportunities

| Topic | Type | Why Workshop | Key Questions |
|-------|------|--------------|---------------|
| Boot envelope & orientation digest schema | API Contract | The digest (canonical paths, plan state, sensor results) becomes a contract future agents parse; worth pinning fields before build | Which fields are stable v1? How do sensor results nest? What does `unconfigured` tier mean per sensor (e.g. GH_TOKEN absent)? |
| Governance content map | Other | Optional — migration from `docs/project-rules/harness.md` is mostly mechanical, but deciding what is *queryable* vs prose could use 20 minutes of design | Which thresholds become doctor/boot checks? What moves to docs/how vs stays in governance? |

## Clarifications

### Session 2026-06-11

- Q: Workflow Mode? → A: **Simple** (CS-3, single tooling layer, no src/ changes).
- Q: Testing strategy? → A: **Lightweight** — deterministic behavioral envelope checks; no new test infra (extensions invisible to vitest/tsc by design).
- Q: Mock usage? → A: **Avoid mocks entirely** — real command runs; offline paths exercised behaviorally.
- Q: Documentation strategy? → A: **docs/how/ only** — one `docs/how/engineering-harness.md` deep guide; governance stays lean per PL-11.
- Q: Domain review — keep eng-harness outside the registry (research lean DB-08) or register it? → A: **Register as real domain** (user override): sixth registry row + `docs/domains/eng-harness/domain.md` + domain-map one-way edge; hard boundary rules preserve everything DB-07/DB-06 protected.
- Q: Boot verb composition? → A: **Composite** — `biome check` + `tsc --noEmit` + `just check` + `minih doctor --json` (parse status) + unmasked `npm audit` (offline→skip) + orientation digest (~17s, full CI-equivalence).
- Q: Pin strategy for the moving-target harness CLI? → A: **Record contract only** — governance records version + contract surface; no checkout pinning (it's the operator's own dev checkout).
- Q: Skills locality? → A: **Global only** — no project-local install; AGENTS.md carries the install one-liner for the missing-skills case.
