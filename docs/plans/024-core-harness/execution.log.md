# Execution Log — 024-core-harness, Phase 1: Implementation

**Plan**: [core-harness-plan.md](./core-harness-plan.md) · **Mode**: Simple · **Started**: 2026-06-11T06:57:28Z
**Testing approach**: Lightweight — behavioral verification by running real verbs and asserting envelope contracts; no mocks.

---

## T000 — Harness pre-flight (pre-implement seam)

**Fired**: `/eng-harness-flow --event pre-implement --phase "Phase 1: Implementation" --plan-dir docs/plans/024-core-harness --json`

Router envelope (derived from live signals, stateless):

- `decision: redirect` · `missing_rung: S2-governance` · `actual_stage: setup`
- S0 ✓ — `harness doctor --json` → `status: ok`; extensions layer `1 loaded, 0 failed, 0 conflict(s)`; toolchain ok (node, just, biome); branch `024-core-harness`
- S4 ✓ — boot extension loaded (built + run in the setup excursion on this branch)
- S2 ✗ — `.harness/engineering-harness.md` absent → engineering zone closed; loop boot verdict narrated verbatim: **`UNAVAILABLE`** (governance owed)
- Observe buffer intact: `harness observe --list --json` shows exactly DL-001 (the `minih doctor --json` spec-drift difficulty) — preserved for the AC-6 drain in T010

Per plan-6 §2a, `UNAVAILABLE` is not an error → noted, proceeding with standard testing. This redirect is the expected pre-T001 state (plan § Harness Seams): **T001 IS the governance provisioning that flips S2.** No human override needed — the plan was validated against exactly this signal state.

Working-tree baseline at phase start: `git status --porcelain` shows only `?? .harness/` and `?? docs/plans/024-core-harness/` on branch `024-core-harness` — no unrelated changes to sweep into harness commits.

---

## T001 — Governance written: `.harness/engineering-harness.md`

Migrated the full v1.0.0 contract from `docs/project-rules/harness.md` and added the four harness-core sections. Content map (no section silently lost):

| Old section | Destination |
|---|---|
| Purpose | migrated, loop updated to Boot → Backpressure → Observe → Retro → Improve; product-vs-engineering harness distinction added |
| Boot / Health | modernized: `harness boot --json` is the session proof; `just build` kept as the iteration rebuild; boot-time threshold names its query (`time harness boot`) |
| Interact / Observe | migrated verbatim-equivalent (minih command tables intact) + harness verbs and the observe→record evidence paths |
| Phase Gates | migrated verbatim + new `eng-harness` row (narrow gate `harness boot --json`) |
| Dogfood Rules | all 5 migrated; MW rule extended with `harness observe --kind magic-wand`; new friction-capture rule appended |
| Maturity + both Validation Checklists | migrated; L2 current (honest: no retro-driven encoded improvement shipped yet); L3 row notes the strengthened evidence rung |
| Validation Checklist for Agents | 4-step list migrated (`harness boot` based); copy-paste block → modernizes into docs/how (T009) |
| History | 3 L0→L2 rows preserved verbatim + migration row appended (L2 -> L2) |
| USER CONTENT block (empty) | dropped intentionally |

New sections: **§ Harness-core contract** (0.2.0 surface per Finding 05; bare-`harness` dialect rule; no-`init`/E108 note), **§ Boot sensors (as built)** (5-sensor table; Finding 01 explained in reviewer terms — plain+`--strict` exit-code pair, DL-001, follow-up candidate; degraded-is-honest per R2; read-only rule), **§ Injection map** (all 5 seams + AGENTS.md cold-start cue + task-pause-is-manual note; no TODO stubs), **§ Legacy read paths** (docs/retros = READ-only harvest source via minihToUniversal; `.harness/` writers prohibited).

**Verified**: file exists at canonical path (S2 flips on commit) · exactly one `## Injection map` heading (S3) · all five seam names present · AC-8 phrases present (`READ-only harvest source`, `prohibited`) · zero TODO stubs · the single `npx harness` occurrence is the dialect rule naming the anti-pattern (AC-9's grep targets AGENTS.md, not governance).

## T002 — `docs/project-rules/harness.md` → dated deprecation pointer

Reduced to 9 lines: names `.harness/engineering-harness.md`, migration date 2026-06-11, plan 024-core-harness, and the historical-plans-unedited note. Safe per Finding 03 (zero live inbound references). AC-7 second clause satisfied.

## T003 — Repo-level `.harness/temp/` gitignore entry

Appended `.harness/temp/` to `.gitignore` (with defense-in-depth comment). **Verified non-destructively**: `git check-ignore -v .harness/temp/x` → attributed to `.gitignore:155` (repo-level entry live); nested self-healed `.harness/temp/.gitignore` read back intact (`*` + comment) — no move-aside test. Biome exposure closed per Finding 04 (`vcs.useIgnoreFile: true` makes gitignored paths invisible to `biome check`).

## T004 — AGENTS.md harness routing block

Two edits, per Finding 06: (1) new `## Engineering harness — session start` section inserted immediately above `## Build, Test, Lint` — session-start cue (`harness boot --json` → read envelope; `harness instructions` orientation; governance link), friction one-liner (`harness observe`), skills-missing one-liner (`npx skills@latest add …`); (2) the existing MW/dogfood sentence at the top extended in place with `` `harness observe "<the gap>" --kind magic-wand` `` — no duplicate rule text.

**AC-9 verified**: `git diff AGENTS.md | grep -c "npx harness"` → **0**; exactly one added `magic-wand` line (the rule extension); block heading at line 44, `## Build, Test, Lint` at line 54 → block sits above ✓. Bare dialect throughout.

## T005 — `docs/domains/eng-harness/domain.md` created

Mirrors sibling structure (Boundary / Composition / Contracts / Concepts / Tests & Validation / History). All **four hard boundary rules** present as a numbered list: (1) shell-wrappers only — no `src/`/`dist/` imports, type-only contract import erased by jiti; (2) zero inbound edges — minih ships identically with `.harness/` deleted; (3) envelope-only observation at the process boundary; (4) single one-way map edge `eng-harness → cli`. Concepts table carries the seven planned concepts (composite boot, sensor, envelope, degraded-is-honest, observe buffer, retro record, governance, injection map). History row records the register-vs-tooling-note decision (user override of dossier lean DB-08) **with revisit note** (demote to a registry tooling note if meta-domain registry presence proves heavier than its value). AC-10 clause 2 satisfied.

## T006 — Registry sixth row

`docs/domains/registry.md` gains the `eng-harness | minih | Active` row (purpose: session-level dev-loop harness, zero inbound edges, envelope-only observation). AC-10 clause 1 satisfied.

## T007 — Domain map updated

`eng_harness` node added to the mermaid; **dashed one-way edge** `eng_harness -. "observes via minih CLI envelopes (process boundary)" .-> cli` (mirrors measurement's conceptual-edge precedent — zero inbound edges rendered); prose bullet explains the conceptual edge + delete-`.harness/`-and-nothing-breaks property; import-direction line extended with "`eng-harness → cli` (process boundary, never imports)"; Health Summary row added (Exposes: boot envelope, records, governance · Depends On: cli envelopes at process boundary · Boundary: zero inbound by rule). AC-10 clause 4 satisfied.

## T008 — cli + runner named-external-consumer notes

One line each under § Contracts: cli — "eng-harness boot consumes `minih doctor` exit signals and envelope stdout as an external observer at the process boundary — never an import"; runner — "eng-harness harvest reads runner-produced retro evidence only via published CLI envelopes (`minih retros`, `minih difficulties`) … never by importing runner or reading run-dir files". AC-10 final clause satisfied.

## T009 — `docs/how/engineering-harness.md` + backlinks

The one deep guide (Documentation Strategy: docs/how only): loop narrative (Boot → Backpressure → Observe → Retro → Improve, with the per-beat command table), boot section with degraded-is-honest explainer + the Finding 01 twice-run rationale + boot-never-mutates, friction lifecycle (observe → temp buffer → record retro → clear → harvest incl. the docs/retros legacy READ path), narrow-gate command map (PL-15), the **modernized copy-paste validation block** (old harness.md block, now `harness boot --json`-based with exit-0-covers-ok-and-degraded note), commit-type rule (`chore(harness):`/`docs(harness):` non-releasing, PS-07), dialect + skills-locality notes. Every named command appears in a copy-paste fenced form. All three Done-When paths touched: guide created; governance footer backlink added; AGENTS.md block backlink added (lean-contract/deep-narrative split per PL-11).

## T010 — AC verification battery (all live, evidence below)

**AC-2 — Doctor clean** ✓ `harness doctor --json` → `status: ok`; extensions layer `1 loaded, 0 failed, 0 conflict(s)`; `conventions: []` (zero complaints); boot extension `status: loaded`.

**AC-3 — Boot envelope honest** ✓ `harness boot --json` → exit **0**, `status: degraded` (expected day one); sensors `[lint pass, typecheck pass, build+test pass, minih-doctor warn, audit warn]`; orientation digest carries all six keys (`branch, briefing, capture_friction, governance, pre_commit_gate, what`) — and `orientation.governance` now reads `.harness/engineering-harness.md` (the T001 flip visible in boot's own output); `next_action` on non-ok: *"Ready to work, with caveats: minih-doctor — warnings present — run `minih doctor` for the list; audit — 1 critical, 1 high — run `npm audit --audit-level=high`…"*.

**AC-4 — Boot read-only** ✓ `git status --porcelain` captured before/after the AC-3 boot run → `cmp` byte-identical.

**AC-5 — Boot catches the observed failure class** ✓ (replayable sequence, QT-08):
1. Staged `ac5-lint-bait.json` at **repo root** (non-gitignored — `git check-ignore` confirms; valid JSON, deliberately mis-formatted).
2. `just check` → exit **0**, suite green (`check: build test` — runs **no** biome; that asymmetry IS the proof).
3. `harness boot --json` → exit **1**, `status: error`, `E1 — boot failed: lint`, lint sensor `fail`, `next_action: "Fix the failing sensor(s) first: lint (npx biome check .)"`.
4. `rm ac5-lint-bait.json` → clean re-run: exit **0**, `status: degraded`, lint sensor back to `pass`.

**AC-6 — Friction loop round-trips** ✓
1. `harness observe --list --json` → exactly `[('DL-001','difficulty','annoying')]`.
2. `harness record retro --slug 024-core-harness` → **actual path from command output**: `.harness/records/retro/2026-06-11/001-024-core-harness.md` (matches the expected dated shape exactly); CLI-templated frontmatter scaffold confirmed.
3. Record populated from the buffer — DL-001 fields carried verbatim (description/target/severity/workaround/suggested_encoding, `compound.status: open`); frontmatter shape owned by the CLI template (biome-inert `.md`, Finding 04).
4. `harness observe --clear` → ok; `--list` → `[]` empty.

**AC-1 — Substrate shape** ✓ governance + boot extension + instructions + first committed record under `records/retro/` all exist; `.harness/temp/` gitignored (`git check-ignore` ✓); `reports/harnessability/` **intentionally absent** (post-merge assessment activity, spec Non-Goal). Router signals: C (working boot — ran 3× this battery), D (governance file), E (temp + records/retro) all satisfiable.

## T011 — Repo-wide gate + commit hygiene

`just fft` → **exit 0** (lint → format → build → typecheck → test → audit → sdk-check, full pipeline green; format step produced zero mutations beyond this phase's edits). Audit step surfaced the known advisory chain — **7 vulnerabilities (5 moderate, 1 high, 1 critical)** — and continued by design (`audit: npm audit --audit-level=high || true`); same chain boot's `degraded` verdict names; surfaced + deferred explicitly (transitive deps, R2 known-degraded inputs), not ignored. release-please verification: `release-please-config.json` sets `release-type: node` + pre-major bump flags only — **no `changelog-types`/type overrides**, so the default ruleset applies and `chore:`/`docs:` are non-releasing. Commits (AC-11):

- `85ef669` `chore(harness): stand up .harness substrate on harness-core 0.2.0 (plan 024)` — `.harness/**`, `.gitignore`, `AGENTS.md`
- `81ec083` `docs(harness): register eng-harness as the sixth domain + deep guide (plan 024)` — `docs/domains/**`, `docs/how/`, deprecation pointer

## T012 — Harness phase-end seam

Fired `/eng-harness-flow --event phase-end --plan-dir docs/plans/024-core-harness --json` (router already loaded this session; stateless re-derivation from live signals). **Setup gate now fully holds for the first time: S0 ✓ S2 ✓ S4 ✓ — the engineering zone is open** (T001's governance flipped S2 mid-phase, exactly as planned). Envelope: `decision: noop` on drain — observe buffer **EMPTY** (DL-001 was already drained into the committed record during the AC-6 round-trip), which the plan names as a valid outcome; `next_suggested: eng-harness-4-retro --harvest` (offered per print-then-offer, not auto-run — best-effort, never blocks).

---

## Phase complete — Phase 1: Implementation (13/13 tasks)

All tasks T000–T012 `[x]`; all 11 acceptance criteria verified live and ticked in the plan. Deliverables: governance at `.harness/engineering-harness.md` (S2/S3 router signals live), deprecation pointer, repo-level temp ignore, AGENTS.md routing block (bare dialect, AC-9 grep-clean), eng-harness registered as the sixth domain (domain.md four hard rules / registry / map one-way edge / cli+runner consumer notes), `docs/how/engineering-harness.md` deep guide with backlinks, AC battery evidence above (replayable), `just fft` green, two non-releasing commits + plan bookkeeping. Spec deviation R7 stands documented (spec's literal `minih doctor --json` line; Finding 01 + governance + DL-001 record); amendable via `/plan-2-v2-clarify` if wanted. Progress tracking maintained inline per-task (plan-6a equivalent: task table + this log kept current throughout).

**Next**: `/plan-7-v2-code-review --plan "docs/plans/024-core-harness/core-harness-plan.md"` (Simple mode).
