# Core Harness Implementation Plan

**Mode**: Simple
**Plan Version**: 1.0.0
**Created**: 2026-06-11
**Spec**: [core-harness-spec.md](./core-harness-spec.md)
**Status**: READY

## Gate Matrix

| Gate | Check | Status | Notes |
|------|-------|--------|-------|
| G1 | Clarify | PASS | 9 clarifications resolved 2026-06-11; zero `[NEEDS CLARIFICATION]` markers; Open Questions: none |
| G2 | Constitution | N/A | No `docs/project-rules/constitution.md` |
| G3 | Architecture | N/A | No `docs/project-rules/architecture.md` (AGENTS.md import-direction rules honored: eng-harness has zero imports) |
| G4 | ADR Compliance | N/A | No `docs/adr/` |
| G5 | Structure | PASS | All required sections present; cross-references resolve |
| G6 | Testing Alignment | PASS | Lightweight strategy: every task has a behavioral Done-When; T010 is the AC verification battery; zero mocks |
| G7 | Domain Completeness | PASS | All 4 spec domains present; NEW eng-harness has domain.md/registry/map setup tasks (T005–T007); manifest covers all touched files |

## Summary

minih's session-level engineering harness moves onto harness-core: the `.harness/` substrate (partially live since the setup excursion on this branch — composite boot built, verified `degraded`-honest and read-only) gets completed with migrated governance, committed retro records, repo-level temp hygiene, AGENTS.md routing in the bare-`harness` dialect, registration of **eng-harness as the sixth domain** with a strict one-way boundary, and one deep guide in docs/how/. The product harness (`docs/retros/` writers) is untouched; governance declares it a legacy READ path for harvest. Completion is proven behaviorally: the spec's 11 acceptance criteria run as real commands, ending with repo-wide `just fft` green.

## Target Domains

| Domain | Status | Relationship | Role |
|--------|--------|-------------|------|
| cli | existing | consume | Boot shells `minih doctor` and reads its deterministic exit signals (see Finding 01); cli domain doc lists eng-harness as a named external consumer |
| runner | existing | consume | Retro read-bridge source — observed only via CLI envelopes (`runs`, `difficulties`, `retros --json`); runner domain doc lists eng-harness as a named external consumer |
| measurement | existing | consume | Vocabulary donor: governance cites its fact-vs-interpretation authority model and proof-level framing; no file changes |
| eng-harness | **NEW** | create | Sixth registered domain: `.harness/**` substrate, composite boot, friction capture, governance, AGENTS.md routing block, docs/how guide |

## Domain Manifest

| File | Domain | Classification | Rationale |
|------|--------|---------------|-----------|
| `.harness/engineering-harness.md` | eng-harness | contract | Governance: BIO contract, Phase Gates, History, Injection map, legacy-read-path declaration |
| `.harness/extensions/boot/extension.ts` | eng-harness | internal | Composite boot verb — already built in setup excursion; T010 verifies, no rebuild |
| `.harness/extensions/boot/instructions.md` | eng-harness | contract | Agent briefing served by `harness instructions boot` |
| `.harness/records/retro/**` (first record) | eng-harness | internal | Created by draining DL-001 via `harness record retro --slug 024-core-harness` (AC-6) |
| `.gitignore` | eng-harness | cross-domain | Repo-shared file: add `.harness/temp/` defense-in-depth entry |
| `AGENTS.md` | eng-harness | cross-domain | Repo-shared routing surface: harness block above "Build, Test, Lint" |
| `docs/project-rules/harness.md` | eng-harness | cross-domain | Reduced to a dated deprecation pointer (content migrates out) |
| `docs/domains/eng-harness/domain.md` | eng-harness | contract | New domain doc, mirrors sibling structure |
| `docs/domains/registry.md` | eng-harness | cross-domain | Shared registry: add sixth row |
| `docs/domains/domain-map.md` | eng-harness | cross-domain | Shared map: node + one-way dashed edge + Health Summary row |
| `docs/domains/cli/domain.md` | cli | cross-domain | Add named-external-consumer note under § Contracts |
| `docs/domains/runner/domain.md` | runner | cross-domain | Add named-external-consumer note under § Contracts |
| `docs/how/engineering-harness.md` | eng-harness | contract | The one deep guide (Documentation Strategy: docs/how only) |

## Key Findings

| # | Impact | Finding | Action |
|---|--------|---------|--------|
| 01 | Critical | **`minih doctor --json` does not exist** (live-probed: dist and `src/cli/commands/doctor.ts`; only `--strict`). The spec's sensor-composition line assumed it. Captured as observe-buffer entry DL-001 during setup. Distinct from `harness doctor --json`, which exists and serves AC-2. | Boot (already built) detects deterministically via exit-code pair: plain run → hard errors, `--strict` run → warnings. T001 documents the as-built mechanism in governance; "add `--json` to minih doctor" is recorded as a follow-up candidate (src change — spec Non-Goal) |
| 02 | High | The setup excursion on this branch already delivered S0 + S4: boot extension built via `harness new` + hand-filled composite, verified `loaded`/biome-clean, first run `degraded` in ~17s with read-only tree proof. `harness observe` is a core verb in 0.2.0; `.harness/temp/` self-gitignores | Plan **verifies** boot (T010) rather than re-building; remaining scope is governance, records, hygiene, routing, domain registration, docs |
| 03 | High | All inbound references to `docs/project-rules/harness.md` live in frozen plan history (docs/plans/009, 020 artifacts) — zero live code/skill/tooling references | T002's deprecation pointer is safe; historical plan docs are never edited retroactively |
| 04 | High | biome's `vcs.useIgnoreFile: true` means gitignored paths are invisible to `biome check`; records are `.md` (biome-inert) | T003's repo-level `.harness/temp/` ignore entry simultaneously resolves the PS-05 biome exposure; only `extension.ts` needs biome-clean discipline (already verified) |
| 05 | High | Harness-core 0.2.0 contract surface live-confirmed: `harness record [type] --slug <slug>` → `.harness/records/<type>/`; observe flags (`--kind/--target/--severity/--workaround/--suggested-encoding/--agent/--list/--clear`); VerbContext (`exec/fs/env/git/clock` + `ok/degraded/unconfigured/error`); no `init` verb (E108) | T001 records exactly this version + contract surface in governance (R1 mitigation: record contract, no pinning) |
| 06 | High | AGENTS.md already opens with the dogfood rule and "file it as MW" language; "Build, Test, Lint" is the first operational section | T004 inserts ONE block between them and extends the existing MW sentence with `harness observe --kind magic-wand` — no duplicate rule text |

## Implementation

**Objective**: Complete the `.harness/` substrate around the already-live composite boot — governance, records, hygiene, routing, domain registration, docs — and prove all 11 spec ACs behaviorally.
**Testing Approach**: Lightweight (from spec): deterministic behavioral verification by running the real verbs and asserting envelope contracts; no mocks, no new test infra.

### Tasks

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|--------|-----|------|--------|---------|-----------|-------|
| [x] | T000 | **Harness pre-flight** — `/eng-harness-flow --event pre-implement --phase "Phase 1" --plan-dir docs/plans/024-core-harness` | — | — | Router envelope handled; verdict narrated verbatim before any edit | _Harness seam — advisory, never a gate_ |
| [x] | T001 | Write `.harness/engineering-harness.md`: migrate Purpose + Boot/Interact/Observe contract, Phase Gates table (+ eng-harness row: narrow gate `harness boot`), **Dogfood Rules (migrated + extended with the observe verb)**, Maturity Assessment + Validation Checklist, History (3 L0→L2 rows preserved verbatim, migration entry appended); add § Harness-core contract (version 0.2.0 + surface per Finding 05, dialect rule: bare `harness`), § Boot sensors **as built** (composite incl. the plain+`--strict` doctor mechanism, Finding 01; degraded-is-honest note per R2), § Injection map (five seams self-fired by the SDD flow + AGENTS.md cold-start cue), § Legacy read paths (`docs/retros/*.md` = harvest READ source via minihToUniversal mapping; writers prohibited from targeting it from `.harness/`). Content map covers every old-file section: the agent copy-paste validation block modernizes into docs/how (T009); the empty USER CONTENT block is dropped intentionally | eng-harness | `.harness/engineering-harness.md` | AC-7 + AC-8 textual checks pass; every threshold from the old Phase Gates table names its query command; Injection map names all five seams + the AGENTS.md cold-start cue (no TODO stubs); § Boot sensors explains the Finding 01 deviation in plan-7-reviewable terms; router signal D flips (S2 = file exists at the canonical path) **and** the `## Injection map` section satisfies the S3 inject rung's separate durable signal | Consumes the setup excursion's proposed injection map; no old-file section may be silently lost (T002 destroys what T001/T009 don't carry) |
| [x] | T002 | Reduce `docs/project-rules/harness.md` to a dated deprecation pointer (one paragraph → new canonical path; preserve nothing else) | eng-harness | `docs/project-rules/harness.md` | File ≤ ~10 lines, names `.harness/engineering-harness.md` + migration date + plan 024; AC-7 second clause | Safe per Finding 03 |
| [x] | T003 | Add repo-level `.harness/temp/` entry to `.gitignore` (defense-in-depth above the CLI's self-healed nested ignore) | eng-harness | `.gitignore` | Repo-level `.gitignore` contains the `.harness/temp/` entry (read check); `git check-ignore -v .harness/temp/x` confirms ignoring works; nested self-healed `.gitignore` verified present by reading it (no destructive move-aside test); biome exposure closed per Finding 04 | |
| [x] | T004 | Insert AGENTS.md harness block immediately above `## Build, Test, Lint`: session-start cue (`harness boot` → read envelope; `harness instructions` for orientation), friction one-liner (`harness observe "<what>" --kind <kind>`), extend the existing MW/dogfood sentence with `--kind magic-wand`, skills-missing one-liner (`npx skills@latest add AI-Substrate/harness-engineering -a claude-code -g -y`), bare-`harness` dialect throughout | eng-harness | `AGENTS.md` | AC-9: block sits above "Build, Test, Lint"; `git diff` shows zero `npx harness` occurrences; MW rule extended not duplicated (Finding 06) | |
| [x] | T005 | Create `docs/domains/eng-harness/domain.md` mirroring sibling structure (Boundary / Composition / Contracts / Concepts / Tests & Validation / History): Purpose, Owns/Excludes from spec sketch, the **four hard boundary rules** (shell-wrappers only — no `src/`/`dist/` imports; zero inbound edges; envelope-only observation; single `eng-harness → cli` map edge), § Concepts table (boot, sensor, envelope, observe buffer, retro record, governance, injection map), History row recording the register-vs-tooling-note decision + revisit note (DB-08 override) | eng-harness | `docs/domains/eng-harness/domain.md` | AC-10 clause 2: domain.md exists with all four rules present verbatim-equivalent; History carries the decision + revisit note | NEW-domain setup; source dir `.harness/` already exists (Finding 02); the map edge is T007's clause |
| [x] | T006 | Add `eng-harness` row to the domain registry (Owner: minih, Status: Active, Purpose: session-level dev-loop harness) | eng-harness | `docs/domains/registry.md` | AC-10 clause 1: sixth row present | |
| [x] | T007 | Update domain map: `eng_harness` node, **dashed one-way edge** `eng-harness -.observes via minih CLI envelopes (process boundary).-> cli`, Health Summary row (Exposes: boot envelope, records; Depends On: cli envelopes at process boundary; Boundary: zero inbound), import-direction line gains "eng-harness → cli (process boundary, never imports)" | eng-harness | `docs/domains/domain-map.md` | AC-10 clause 4: one-way edge rendered; zero inbound edges shown | Mirrors measurement's dashed conceptual-edge precedent |
| [x] | T008 | Add named-external-consumer notes: cli `§ Contracts` ("eng-harness boot consumes `minih doctor` exit signals + envelope stdout as an external observer") and runner `§ Contracts` ("eng-harness harvest reads retro evidence only via published CLI envelopes") | cli, runner | `docs/domains/cli/domain.md`, `docs/domains/runner/domain.md` | AC-10 final clause: both docs name eng-harness as external consumer | Cross-domain edits, one line each |
| [x] | T009 | Write `docs/how/engineering-harness.md`: loop narrative (Boot → Backpressure → Observe → Retro → Improve), verb briefing pointers (`harness instructions boot`), records/temp lifecycle, commit-type rule (`chore(harness):` / `docs(harness):` — non-releasing, PS-07), narrow-gate command map (PL-15), the modernized agent copy-paste validation block (from the old harness.md, now `harness boot`-based), degraded-is-honest explainer, dialect + skills-locality notes; then add backlinks TO this guide in the two surfaces created earlier (governance § footer, AGENTS block) | eng-harness | `docs/how/engineering-harness.md`, `.harness/engineering-harness.md`, `AGENTS.md` | Guide exists, linked from both surfaces (backlink edits applied after T001/T004 creation — all three paths touched); explains every command it names with a copy-paste form | Lean-contract/deep-narrative split (PL-11) |
| [x] | T010 | **AC verification battery** (run + capture in execution log): AC-1 substrate-shape probes (`reports/harnessability/` intentionally absent — created post-merge by the assessment skill, spec Non-Goal); AC-2 `harness doctor --json` (installed:1/failed:0/conflicts:0, no convention complaints); AC-3 `harness boot --json` envelope legality (status ∈ vocabulary, exits 0/0/2/1, `next_action` on non-ok, per-sensor data + orientation digest); AC-4 byte-identical `git status --porcelain` before/after boot; AC-5 stage a deliberately mis-formatted scratch `.json` in a **non-gitignored path** (e.g. repo root) — `just check` (= build+test, runs no biome) stays green while boot's lint sensor fails (that asymmetry IS the proof, QT-08), then clean up and re-verify; AC-6 friction round-trip — `harness observe --list --json` shows DL-001, `harness record retro --slug 024-core-harness` creates the record (capture the actual path from the command output; expected shape `.harness/records/retro/<date>/<NNN>-024-core-harness.md`, live-confirmed), populate it from the buffer (frontmatter validity is owned by the CLI template — fft treats `.md` as inert, Finding 04), `harness observe --clear` empties | eng-harness | `.harness/**`, execution log | Each AC's exact command sequence passes; evidence quoted in the execution log (AC-5 must show staged-file → failing envelope → cleanup → clean re-run, so plan-7 can replay it) | AC-6 drain produces the first committed record, completing AC-1's `records/retro/` requirement |
| [x] | T011 | Repo-wide gate + commit hygiene: `just fft` green; commits touching only `.harness/` + docs use `chore(harness):` / `docs(harness):` | eng-harness | repo-wide | AC-11: fft passes; commit log shows non-releasing types for harness/docs commits (release-please default ruleset treats `chore`/`docs` as non-releasing; repo config sets no type overrides — verified) | Format-then-commit discipline per R5 |
| [x] | T012 | **Harness phase-end** — `/eng-harness-flow --event phase-end --plan-dir docs/plans/024-core-harness` | — | — | Router envelope handled at phase end (router decides drain-vs-harvest; buffer may already be empty after T010 — `noop` is a valid outcome) | _Harness seam — advisory, never a gate_ |

### Acceptance Criteria

- [x] AC-1 Substrate shape: governance, boot extension + instructions, `records/retro/` (first record), gitignored `temp/` exist; router signals C/D/E pass
- [x] AC-2 Doctor clean: boot loaded (1/0/0), zero convention complaints
- [x] AC-3 Boot envelope honest: exit 0, `ok|degraded` (degraded expected day one), per-sensor data + orientation digest, `next_action` on non-ok
- [x] AC-4 Boot read-only: `git status --porcelain` byte-identical across a boot run
- [x] AC-5 Boot catches the observed failure class: staged mis-formatted `.json` → lint sensor fails (covers what `just check` misses)
- [x] AC-6 Friction loop round-trips: observe → temp buffer (tree clean) → `--list` shows it → `record retro --slug 024-core-harness` → committed record → `--clear` empties
- [x] AC-7 Governance migrated: Phase Gates + History (L0→L2 preserved, migration entry appended) in new home; old file a dated pointer; thresholds queryable
- [x] AC-8 Legacy read path declared: `docs/retros/*.md` named as harvest READ source; `.harness/` writers prohibited from targeting it
- [x] AC-9 AGENTS.md routes: block above "Build, Test, Lint", bare dialect (zero `npx harness` in diff), MW rule extended with `--kind magic-wand`
- [x] AC-10 Domain registered: registry row; domain.md with Purpose, Owns/Excludes, four hard rules, History decision note; map one-way edge; cli + runner consumer notes
- [x] AC-11 Gate green: repo-wide `just fft` passes; harness/docs commits use non-releasing types

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| R1 Global `harness` is a moving target (0.2.0, npm-linked dev checkout; version drifted 0.1.0→0.2.0 live mid-session) | Medium | Medium | Record contract only (decided): governance pins version + contract surface (Finding 05); boot evidence names the version; no checkout pinning |
| R2 Day-one `degraded` reads as failure | Medium | Low | Governance + boot `next_action` name the known degraded inputs; AC-3 codifies degraded-as-honest; docs/how explainer (T009) |
| R3 Invocation dialect drift (`npx harness` vs bare) | Medium | Low | Everything 024 writes uses bare `harness`; AC-9 greps the diff; governance records the dialect rule |
| R4 jiti TS loading quirks in extensions | Low | Medium | `extension.ts` is dependency-free (type-only contract import) — already verified loaded (Finding 02); AC-2 re-checks |
| R5 Scaffold files fail biome (PL-03 class) | Medium | Low | Boot extension already biome-clean; records are `.md`; format-then-commit discipline; AC-11 gates |
| R6 `harness init` ships mid-build and conflicts with hand-written governance | Low | Low | Governance doc is ours regardless; init adoption is a recorded follow-up, not a dependency |
| R7 Spec text still names `minih doctor --json` (Finding 01) | Certain | Low | Deviation documented here + in governance + DL-001; spec body untouched (clarification re-entry available via `/plan-2-v2-clarify` if Jordan wants the spec line amended) |
| R8 Router signal definitions evolve with the skill family (same moving target as R1) | Low | Low | Probes are advisory, never gates; T001 satisfies both the S2 signal (file at canonical path) and the S3 signal (`## Injection map` section) independently, so drift in either definition degrades gracefully |

## Harness Seams

- **Entry point**: `/eng-harness-flow --event <seam> [--phase <id>] [--plan-dir <p>] --json` — the single door to the engineering harness; child skills are private and never named in this plan.
- **Backpressure** (post-spec seam): ran before this plan and returned **redirect** (S2 governance + S4 boot were missing — the gap this plan fills). No `backpressure-coverage.md` was produced; the redirect evidence itself shaped this plan. No Phase 0 applies — this plan **is** the backpressure-establishment work.
- **Pre-implement** (`--event pre-implement`): fired by `/plan-6` at phase start (T000); verdict narrated verbatim from the router's envelope (`healthy / SLOW / UNHEALTHY / UNAVAILABLE`). `UNAVAILABLE` is not an error — falls back to standard testing.
- **Phase end** (`--event phase-end`): fired by `/plan-6` at the phase seam (T012); `--event plan-complete` fires at merge (plan-8).
- **Best-effort**: every item above is advisory and never blocks; the router decides what the harness does at each seam.

---

## Validation Record (2026-06-11)

### Validation Thesis

**Raison d'être**: Complete minih's migration onto harness-core (governance, records, hygiene, routing, domain registration, docs around the already-live composite boot) so the engineering loop (Boot → Backpressure → Observe → Retro → Improve) becomes operable, embracing minih's existing harness concepts rather than duplicating them.

**Value claim**: Session-start proof becomes one deterministic command; friction capture round-trips to committed records; governance becomes queryable at its canonical router-visible location; future agents route from AGENTS.md with zero installs.

**Artifact promise**: A plan-6 implementer executes T000–T012 with minimal clarification; completion provable via 11 ACs; the router's setup gate (S2 governance) flips from owed to satisfied.

**Intended beneficiaries**: plan-6 implementer (primary), future dev-session agents, plan-7 reviewer, harness-engineering upstream (friction evidence).

**Proof target**: Implementation

**Evidence standard**: Exact files + runnable Done-When commands; ACs equivalent to the spec's 11; findings grounded in live probes.

**Thesis source**: core-harness-spec.md (Summary l.13, Goals l.15–25, ACs l.77–89) + original-ask.md

**Thesis verdict**: Advanced

**Main thesis risk**: Boot was built in the prior setup excursion — if that excursion's decisions aren't transmitted, the "already verified" assumption fails; mitigated by T010 re-verification and the self-documenting extension source.

---

| Agent | Lenses Covered | Thesis Axes Covered | Issues | Verdict |
|-------|---------------|---------------------|--------|---------|
| Coherence | System Behavior, Integration & Ripple, Edge Cases, Hidden Assumptions | Downstream Usefulness | 1 CRITICAL fixed, 1 HIGH fixed, 2 MEDIUM fixed | ⚠️ → ✅ |
| Risk & Completeness | Evidence Sufficiency, Edge Cases, Deployment & Ops, Technical Constraints | Implementation Readiness, Safety to Change | 4 MEDIUM fixed (2 false positives discarded: AC-5 premise, "row-4 probe"), 2 LOW fixed | ⚠️ → ✅ |
| Thesis Alignment | Thesis Alignment, Proof-Level Fit, Evidence Sufficiency, Domain Boundaries, Concept Documentation | Thesis Alignment, Proof-Level Fit | 1 MEDIUM fixed, 3 LOW (2 fixed, 1 by-design) | ✅ |
| Forward-Compatibility | Forward-Compatibility, Integration & Ripple, Technical Constraints, Deployment & Ops | Downstream Usefulness, Contract Integrity | 1 HIGH fixed, 2 MEDIUM fixed, 1 LOW noted | ⚠️ → ✅ |

Lens coverage: 12/15. Notable validator false positive corrected during synthesis: one agent asserted `just check` runs biome (it is `build + test` — no biome), which is precisely the gap AC-5 proves; T010 now states the asymmetry explicitly to prevent the same misreading downstream. A validator probe incidentally live-confirmed spec AC-6's record path shape (`.harness/records/retro/<date>/<NNN>-<slug>.md`); probe residue was removed.

### Forward-Compatibility Matrix

| Consumer | Requirement | Failure Mode | Verdict | Evidence |
|----------|-------------|--------------|---------|----------|
| plan-6-v2-implement-phase | Directly executable 7-column tasks with runnable Done-Whens | test boundary | ✅ | T001–T012 executable; Simple mode consumed directly, no plan-5 expansion |
| eng-harness-flow router setup gate | Signal D (governance file at canonical path) + S3 (`## Injection map`) + signal E (temp + records) | contract drift | ✅ (post-fix) | T001 Done-When now satisfies S2 and S3 signals independently; E covered by T003 + T010 |
| plan-7-v2-code-review | ACs + Gate Matrix reviewable; no false contract drift from spec's `minih doctor --json` wording | contract drift | ✅ (post-fix) | Finding 01 + R7 document the deviation; T001 Done-When requires governance to explain it in reviewer-readable terms; T010 log must be replayable |
| Release pipeline (release-please) | `chore(harness):`/`docs(harness):` non-releasing | lifecycle ownership | ✅ | Default conventional-commit ruleset; repo config sets no type overrides; T011 Done-When records the verification |

**Thesis alignment**: Value claim advanced at the target Implementation proof level (tasks specified at contract level with content design consciously delegated per the spec's unworkshopped "Governance content map" note); main risk is the setup-excursion dependency, mitigated by T010 re-verification.

**Outcome alignment**: The plan, as shipped, advances the VPO outcome — "so the eng-harness skills loop (Boot → Backpressure → Observe → Retro → Improve) becomes operable here, embracing minih's existing harness concepts rather than duplicating them" — with the three named conditions (signal-D probe alignment, Finding-01 governance documentation, replayable T010 evidence) now folded into the task table.

**Standalone?**: No — four named downstream consumers.

Overall: VALIDATED WITH FIXES
