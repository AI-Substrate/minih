# Research Report: Upgrade minih's engineering harness to harness core (the `harness` CLI)

**Generated**: 2026-06-11T04:58:38Z
**Research Query**: "Upgrade minih's engineering harness to harness core (the global `harness` CLI): evaluate this repo for wrapping. Use the CLI's bundled docs (extensions, verbs, records, the harness loop) and the installed eng-harness skills. Map the harness concepts minih already has (retros/magicWand harvesting, AGENTS_README philosophy, just fft gate, eng-harness skills) so harness core embraces and replaces them rather than duplicating. No repo-local install of the CLI — it is already available globally."
**Mode**: Plan-Associated (`docs/plans/024-core-harness/`)
**FlowSpace**: Available (repo indexed, markdown sections included)
**Findings**: 69 across 8 subagents (IA×10, DC×10, PS×10, QT×10, IC×10, DE×10, PL×15 — top-loaded here, full detail per section — DB×8)
**Harness seam (session-start)**: eng-harness-flow router installed globally; minih has **no repo-local harness substrate** (`.harness/` absent, 0 extensions per `harness doctor`) — this plan IS the setup work. Standard testing applies meanwhile.

---

## Executive Summary

### What It Does
minih already runs a complete, *compiled-in* feedback harness for its spawned agents: a schema-enforced retrospective contract (workedWell/confusing/magicWand), auto-harvest into `docs/retros/*.md`, difficulties aggregation, and a doctor that audits the loop. The harness-core upgrade adds the *session-level* engineering harness — the global `harness` CLI's extension/record/observe substrate plus the eng-harness skills loop (Boot → Backpressure → Observe → Retro → Improve) — for the agent **operating** this repo, not the agents minih spawns.

### Business Purpose
Close the gap the ledger documents over and over: friction noticed by the *session* agent (the Claude driving the repo) has no deterministic capture surface today, governance prose drifts from runtime truth, and the repo's dev-loop knowledge lives in skill prose instead of encoded verbs. Harness core is the encode-don't-document fix — and minih's own philosophy is its direct ancestor (the severity enum `blocking|degrading|annoying` is character-for-character identical on both sides — DE-02).

### Key Insights
1. **Two harnesses, one vocabulary — keep the writers separate.** minih-as-product-harness (AJV-enforced agent retros → `docs/retros/`) and the engineering harness (honour-system session capture → `.harness/`) are parallel channels of the same lineage. Never funnel one through the other; bridge **read-side only** (DB-02, DB-04, DE-03, DE-10).
2. **The global CLI is a moving target**: `harness` on PATH is **v0.2.0**, npm-linked to the local dev checkout `/Users/jordanknight/substrate/harness-engineering` (branch `feat/cli-bin-engh`) — it silently changes when that checkout rebuilds. Everything operational is cwd-relative, so global-only usage works; the plan must pin the *contract*, not the binary (DC-10).
3. **A prior-generation governance doc already exists**: `docs/project-rules/harness.md` (plan 020, maturity L2, Boot = `just build` + `minih doctor`). The canonical path the current skills probe is `.harness/engineering-harness.md` — content must migrate (history table preserved) or boot reports UNAVAILABLE beside a stale L2 claim (DE-08, IC-01, IC-06).
4. **Boot cannot wrap `just fft` verbatim** — fft's `format` step runs `biome format --write .` (mutates the tree) and its audit/sdk tails are `|| true`-softened. The recommended composite: `biome check` + `tsc --noEmit` + `just check` + `minih doctor --json` (parse envelope, not exit code) + unmasked `npm audit` → full CI-equivalence in ~17s (QT-01, QT-06, QT-08).

### Quick Stats
- **Components**: minih feedback loop ≈ 8 src files (validator, retro-ledger, runner harvest, harvest/difficulties/retros/doctor/check commands); harness-core substrate to create: `.harness/{extensions,records,temp,reports}` + governance doc
- **Dependencies**: global `harness` v0.2.0 (commander + jiti only, Node ≥22); eng-harness skills ×7 global; zero new npm deps for minih
- **Test Coverage**: 110 test files / 1201 tests (1185 pass, 16 env-gated skips) in ~12.5s; one live flake found (QT-10)
- **Complexity**: Medium — file scaffolding is trivial; the real work is contract alignment (invocation dialects, governance migration, read-bridges)
- **Prior Learnings**: 15 relevant discoveries (4+ recurring frictions directly answered by this upgrade)
- **Domains**: 5 registered product domains; `.harness/` should stay **outside** the registry with a tooling note (DB-08)

---

## How It Currently Works

### minih's compiled-in feedback loop (the thing being embraced)

| Stage | Surface | Location |
|---|---|---|
| Contract taught | `SYSTEM_OUTPUT_INSTRUCTIONS` injected into every prompt (incl. mandatory `minih check` self-validation, magicWand framing, MH-001 difficulty IDs) | `src/runner/runner.ts:187-288` (IA-02) |
| Contract enforced | AJV against bundled `retrospective.json` (workedWell≥10 / confusing≥10 / magicWand≥20 chars; `magicWandTarget: project\|minih\|coordination`; difficulties `{category, description, severity: blocking\|degrading\|annoying, workaround?}`) | `src/schemas/retrospective.json`, `src/runner/validator.ts:241-313` (IA-01, IA-06) |
| Auto-harvest | Runner appends to `docs/retros/<slug>.md` (+ `<planId>.md` via `MINIH_PLAN_ID`) at every terminal branch; crash stubs `> ⚠️` in `finally`; kill-switch `MINIH_NO_AUTO_HARVEST=1`; idempotent on literal `runId: <id>` | `src/runner/runner.ts:87-184,1382-1439`, `src/runner/retro-ledger.ts:117-261` (IA-03, IA-04) |
| Explicit harvest | `minih harvest <slug> [--run\|--since]` — ignores the kill-switch by design | `src/cli/commands/harvest.ts` (IA-05) |
| Aggregate | `minih retros` (inside+outside, target filter), `minih difficulties` (recomputed from run artifacts, exact-string frequency) | `src/cli/commands/{retros,difficulties}.ts` (IA-06, IA-08) |
| Audit | `minih doctor` flags unharvested retros + >1MB ledgers; currently **degraded** (74 warnings) on this branch | `src/cli/commands/doctor.ts:452-536` (IA-08, QT-06) |

Friction state lives in exactly two places: per-run `report.json` (source of truth) and `docs/retros/*.md` (curated ledger, 10 files / ~510 lines). **There is no in-flight session buffer** — minih goes straight from run artifact to permanent ledger. That missing middle is harness-core's clearest net-new contribution (IA-10).

### The harness-core substrate (the thing being adopted)

- **Envelope**: every command emits `{command, status: ok|degraded|unconfigured|error, data, error?, next_action?, timestamp}`; exits 0 (ok/degraded), 2 (unconfigured), 1 (error); `next_action` required on non-ok (DC-01).
- **Extensions**: `.harness/extensions/<name>/extension.ts` + `instructions.md`; default-export `HarnessVerb` with injected `VerbContext` (`ctx.exec`, `ctx.ok/degraded/unconfigured/error`); discovery is strictly **cwd-relative** (`<cwd>/.harness/extensions/`, one level deep); TS loaded via jiti at runtime — zero toolchain needed in minih (DC-02, DC-03).
- **`harness new <name> [--wrap "<cmd>"]`**: scaffolds an immediately-loadable verb; wrap maps child exit 0→ok, non-zero→error(E1) — loses nuance, so minih's boot needs a hand-written `run()` (DC-04).
- **Records**: `harness record <type>` → `.harness/records/<type>/<YYYY-MM-DD>/<NNN>-<slug>.md`; record type = 4-field contract `{kind:'record', type, description, template}`; core `retro` template carries `system.compound` lifecycle (`open|suggested|encoded|wontfix|stale|dismissed`), and its `target` comment already names `minih` (DC-05, DC-07).
- **Observe**: `harness observe "<desc>" --kind difficulty|magic-wand|gift|insight|coordination|improvement-suggestion|confusion [--severity blocking|degrading|annoying] [--workaround] [--suggested-encoding] [--agent <bucket>]` → `.harness/temp/<bucket>/session-buffer.md`, self-gitignored on first capture (DC-06).
- **No `.harness/` dir → `record` is `unconfigured` exit 2** and writes nothing. `harness doctor` in minih today: status ok, 0 extensions, toolchain layer hard-codes `node, just, biome` checks (DC-05, DC-09).

### The skills loop above the CLI

The `eng-harness-flow` router decides setup-vs-loop from repo signals A–J; the canonical on-disk shape it probes (IC-01):

```
.harness/engineering-harness.md          ← D: governance (canonical and ONLY location)
.harness/extensions/boot/                ← C: working boot verb
.harness/temp/ + .harness/records/retro/ ← E: loop substrate
.harness/reports/harnessability/         ← F: assessment (latest.json is a load-bearing sentinel)
```

Setup rungs S0 install → S1 scout → S2 governance ("owed, not provisioned" — the `harness init` writer doesn't exist yet) → S3 inject → S4 boot (built LAST). Seams: `session-start|post-spec|pre-implement|task-pause|phase-end|plan-complete`. Boot verdicts `HEALTHY / SLOW(>45s) / UNHEALTHY / UNAVAILABLE`; retro lifecycle observe → `[s/t/p/e/d/a]` drain → `record retro` → `--clear`; harvest scans `.harness/records/retro/**` **plus legacy paths including `docs/retros/*.md`** with the `minihToUniversal` block mapping (IC-02, IC-06, IC-08, IC-09).

---

## Architecture & Design

### Component Map (post-upgrade target shape)

```
minih repo
├── .harness/
│   ├── engineering-harness.md      # governance — migrated from docs/project-rules/harness.md
│   ├── extensions/boot/            # hand-written composite verb (shell-wrapper ONLY)
│   ├── records/retro/              # committed session retros (harness record retro)
│   ├── reports/harnessability/     # skill-written assessment (latest.json sentinel)
│   └── temp/                       # gitignored observe buffer (self-healing .gitignore)
├── docs/retros/                    # UNCHANGED — minih product ledger; legacy READ path for harvest
├── docs/project-rules/harness.md   # deprecate/redirect after content migration
└── AGENTS.md                       # + harness-core session-start block at top (before Build/Test/Lint)
```

### Design rules established by the evidence
1. **Extensions are shell-wrappers** — spawn `just`/`minih`, parse JSON envelopes, map exit codes. `.harness/` importing `src/`/`dist/` would create an unregistered second composition root invisible to domain health tracking (DB-07).
2. **Harness observes through CLI envelopes only** — the 023 run-inventory projection deliberately omits `runDir`; direct `agents/*/runs/` reads from `.harness/` violate both that redaction decision and the AGENTS.md dogfood rule (DB-06, DE-04).
3. **One canonical governance source** — `.harness/engineering-harness.md`; every threshold it states must be queryable (PL-05, PL-09).
4. **Read-pure verbs** — boot/doctor never write; healing is a separate verb (repo precedent FX009, PL-10).

### System Boundaries
- **minih-as-product-harness** (runner/cli/measurement domains): agents' AJV-enforced retros about project/minih/coordination. Ships to every downstream minih user via `minih init`.
- **engineering-harness** (`.harness/`, justfile, this plan): the session loop for whoever develops THIS repo. Owned by nobody today; stays outside the domain registry with a tooling note (DB-02, DB-08).
- **The dogfood join**: minih runs its own agents against itself, so product retros with `magicWandTarget: "minih"` ARE engineering-harness signal — the existing enum is the selector for the read-bridge (DB-02, DB-04).

---

## Dependencies & Integration

### What the upgrade depends on
| Dependency | Type | Purpose | Risk if changed |
|---|---|---|---|
| global `harness` v0.2.0 (symlink → `~/substrate/harness-engineering@feat/cli-bin-engh`) | Required | the CLI substrate | **HIGH — moving target**: rebuilding/branch-switching that checkout silently changes behavior. Record version + contract surface in the plan; treat the contract as the dependency, not the binary (DC-10) |
| `just`, `biome`, `node` on PATH | Required | `harness doctor` toolchain layer hard-codes all three | CI for any harness-doctor step needs them installed (DC-09) |
| eng-harness skills ×7 (global `~/.agents/skills/`) | Required | the loop choreography | three invocation dialects coexist (`harness X` / `npx harness X` / `npx --no-install harness X`) — see Critical Finding 02 |
| `docs/plans/<ord>-<slug>/` layout | Existing | backpressure artifact home | already conforms (IC-07) |

### What depends on this (consumers of the result)
- **the-flow / SDD pipeline**: fires `--event` seams through the router; consumes `backpressure-coverage.md` at plan-3 (IC-02, IC-07).
- **Future session agents**: AGENTS.md routes them through `harness doctor`/boot at session start (DE-04).
- **`minih doctor` audit**: keeps owning `docs/retros/` health — untouched (DE-03).

---

## Quality & Testing

- **Gate landscape**: `just fft` = lint → **format (MUTATES: `biome format --write .`)** → build → typecheck → test → audit(`|| true`) → sdk-check(always exit 0). `just check` = build + test, honest exits, ~14s. CI quality-gate = biome check / build / tsc / test / soft audit / dist-artifact checks, Node 20+22, ~2m30s (QT-01..QT-04).
- **CI's "Agent Doctor" job is softer than it looks**: `doctor 2>/dev/null | jq .` without pipefail — only fails on unparseable JSON (QT-05). A real boot parsing the envelope `status` field beats CI here.
- **`minih doctor` status taxonomy** is `ok|degraded|error` but exits 0 for degraded — boot must parse JSON, never exit codes. Currently degraded: 74 warnings (mostly plan-018 per-agent permissions notes + unharvested retros). A doctor-composing boot reports **degraded on day one** — honest, expect it (QT-06).
- **npm audit reality**: 7 vulns (5 moderate / 1 high / **1 critical**); the high (`fast-uri` via **ajv — a production dependency**) and critical (vitest, dev) are invisible to every current gate thanks to `|| true`. Unmasked audit in boot = the clearest "honest boot beats current gates" win (QT-07).
- **Risk quantified for boot=`just check` alone**: the only CI failure in the last 8 runs was a biome **format** failure on a docs JSON — the exact step `check` omits; adding `biome check` (+0.7s) + `tsc --noEmit` (+1.3s) closes the entire observed divergence (QT-08, PL-03).
- **Known flake**: `test/runner/agent-pack/extractor.test.ts:595-613` ("rejects zero-length entry name") failed 1 of 3 consecutive local runs — a false-positive source for boot's error signal; fix it or give boot a retry-once rule (QT-10).
- **16 skipped tests are deliberate env gates** (`MINIH_E2E`, `MINIH_REGRESSION`, `MINIH_PGREP`) — default boot's `ok` honestly means "deterministic suite green", not "e2e-verified" (QT-09).

### Boot wrap candidates (QT synthesis)

| Candidate | Proves | Misses | Cost | Honesty |
|---|---|---|---|---|
| `just test` | 1185 tests | compile, lint, typecheck, vulns | ~12.5s | binary; flake risk |
| `just check` | compile + tests | lint/format (the observed CI failure class), vulns | ~14s | honest exits |
| `just fft` | everything CI proves | **mutates tree**; audit/sdk soft-failed | ~20s+net | disqualified for read-only boot |
| **Recommended composite** | `biome check` + `tsc --noEmit` + `just check` + `minih doctor --json` (parse status) + unmasked `npm audit --audit-level=high --json` (offline→skip) | live SDK/e2e (env-gated → `unconfigured` tier) | ~17s + ~2s net | fully controllable ok/degraded/unconfigured/error |

---

## Modification Considerations

### ✅ Safe to create/modify
1. `.harness/` tree — invisible to tsc (`include: src/**` only), vitest (`test/**` only), npm pack (`files: ["dist","LICENSE"]` allowlist) (PS-03, PS-04, PS-06).
2. Markdown records — biome 2.4 doesn't check markdown at all; records are toolchain-inert (PS-01, PS-10).
3. AGENTS.md harness block — natural slot at the very top, before "Build, Test, Lint" (DE-04).

### ⚠️ Modify with caution
1. **Any `.ts`/`.json` under `.harness/`** — biome's `files.includes: ["**", "!!**/dist"]` DOES descend into dot-directories (verified empirically with the repo's binary): unformatted scaffolds fail `just fft` at step 1 (lint runs BEFORE format) and CI. Mitigation: biome-format everything scaffolded before committing; gitignoring `.harness/temp/` also shields it via `vcs.useIgnoreFile: true` (PS-01, PS-02, PS-09).
2. **.gitignore** — no `.harness` entry exists today; `.harness/temp/` must be added (repo-style commented block). The CLI self-heals a *nested* `.harness/temp/.gitignore` on first capture, but the repo-level entry is still the convention (PS-05, DC-06).
3. **Commit types** — release-please does NOT path-filter: `feat:`/`fix:` commits touching only `.harness/` records bump the package version. Use `chore(harness):` / `docs(harness):` (PS-07).
4. **`docs/project-rules/harness.md`** — migrate content (Boot=`just build`+`minih doctor`, Phase Gates, History L0→L2) into `.harness/engineering-harness.md`, then deprecate/redirect (DE-08).

### 🚫 Danger zones
1. **minih's auto-harvest into `docs/retros/`** — compiled product behavior + doctor invariant + downstream-user contract (`minih init` scaffolds it everywhere). Do NOT redirect or migrate the files; harvest reads it as a legacy path (DE-03, DB-04, PL-02/issue #39).
2. **The AJV-enforced report.json contract** — never funnel spawned-agent retros through `harness observe`; they are parallel channels (DE-02).
3. **`.harness/extensions` importing `src/`** — boundary violation; shell-wrappers only (DB-07).
4. **The harnessability `latest.json` sentinel** — nothing harness-core does may clobber it; setup detection depends on it (IC-05).

---

## Prior Learnings (From Previous Implementations)

✓ 15 findings surfaced from ~45 ledger blocks — 10 from the legacy minih ledger (`docs/retros/`, 10 files), 5 from plan execution logs / fix dossiers; compound `.retro.md` format **absent** in this repo.

| ID | Type | Source | Key Insight | Action |
|----|------|--------|-------------|--------|
| PL-01 | gotcha+wand (4+ agents, 6 wks) | parallel-param-smoke + 3 ledgers | MINIH_* env empty in agent shells (#37); wands ask for `minih env`/`minih params` | Harness context must be queryable, not documentation-promised; doctor-verify any documented env var |
| PL-02 | debt | 023 execution log | Harvest destination hardcoded to `docs/retros/` (#39) | Declare docs/retros the legacy-READ path in `--harvest`; don't fork the ledger |
| PL-03 | gotcha ×2 | 023 + 008 logs | First `fft` after ANY new JSON fails on biome format | Re-run gate after any edit before push; format scaffolds; gitignore temp |
| PL-04 | insight | 023 log | 3-tier branch validation (fft / live smoke / companion) worked; smoke runs double as retro generators | Template for harness gate/boot reporting |
| PL-05 | gotcha+wand ×7 | code-review-companion ledger | idleBudgetMs in contract but invisible at runtime — agents guessed for 30-min windows | Every governance threshold queryable via a read command |
| PL-06 | wand ×5 | companion + measurement ledgers | Reports manually reconstructed from inbox; want ledger-derived views | CLI computes derived views from on-disk records |
| PL-07 | insight | companion ledger | Enumerated filters rot (root cause of plan-012 deafness) | Wildcard+exclude matching in harvest scanners |
| PL-08 | decision | permission-prober ledger | Failure stubs clustered in one file exposed systemic preset bug at a glance | Carry stub-on-failure into harness records; identical stubs = high-priority recurrence |
| PL-09 | gotcha+wand | permission-prober, code-review | Two truth surfaces disagreed (permission_status vs status) | One canonical governance source; doctor verifies derived surfaces |
| PL-10 | decision | FX009 dossier | Heuristic liveness → false 'active' cost ~14.5 min; read-pure vs reconcile split | Boot/doctor probe-backed and read-only; repair behind separate verb |
| PL-11 | decision | 008 log | doctor warns at 4KB on agent-facing contracts | Keep `.harness/` contracts terse; deep narrative in docs/how/ |
| PL-12 | wand | measurement ledger | "Make the phase-end retro flow an executable command, not prose" — the harness-core thesis, asked for by the orchestrator itself | Frame 024 as fulfilling this wand; audit skill prose against real CLI flags |
| PL-13 | wand ×3 | companion ledger | Sessions re-derive orientation heuristically; want machine-readable digest | Boot emits JSON orientation digest; tolerate any plan lifecycle shape |
| PL-14 | unexpected | skills-smoke-test → plan 022 | Skill presence is a silent failure unless deterministically verifiable | Verify harness-skill install via discover/doctor pattern (plan-022 precedent) |
| PL-15 | gotcha+wand ×3 | companion ledger | `--runInBand` failed 3×; narrow-gate cheat sheet never encoded | Encode command map in governance/boot output |

**The headline**: PL-12 is the orchestrator literally requesting harness core before it existed ("Make the phase-end progress/retro/debrief flow an executable MiniH command rather than a prose skill checklist"). This upgrade is the answer to the ledger's own most-repeated wishes.

---

## Domain Context

| Domain | Relationship | Relevant contracts |
|---|---|---|
| runner | bridge source | owns "magic wand feedback capture", retro-ledger, run inventory (deliberately omits `runDir`) |
| cli | compose | `MinihEnvelope` designed for "External agents, CI" — boot is a natural named consumer of `doctor`/`check`/`runs --json` |
| measurement | vocabulary donor | proof ladder L0-L6, fact-vs-interpretation authority, "reviewable mitigation" ≈ observe→drain→encode lifecycle; do NOT extend its boundary to own `.harness/` |
| adapter, mcp | none | no feedback surfaces |

**Domain action** (DB-08): keep `.harness/` **outside the registry**; add a "non-domain tooling" note to `registry.md`/domain-map naming the engineering-harness layer, and register the harness as a named external consumer in the cli + runner domain docs (three bridges: retro read-bridge, boot↔doctor/check, observe-via-envelope).

---

## Critical Discoveries

### 🚨 Critical Finding 01: The global `harness` is v0.2.0 npm-linked to a live dev checkout
**Impact**: Critical · **Source**: DC-10
`~/.npm-global/lib/node_modules/@ai-substrate/engineering-harness` → symlink to `/Users/jordanknight/substrate/harness-engineering` (branch `feat/cli-bin-engh`). Version is **0.2.0**, not the 0.1.0 assumed at kickoff. The binary silently changes whenever that checkout rebuilds.
**Required Action**: The plan must record the exact version + contract surface (envelope, VerbContext, record placement, observe flags) as the dependency. Consider asking the operator whether to pin (tag checkout) before building.

### 🚨 Critical Finding 02: The skills' invocation dialects conflict with the no-install rule
**Impact**: Critical · **Source**: IC-03, IC-10
`eng-harness-0-setup` unconditionally runs `npm install github:AI-Substrate/harness-engineering` (even seeding `package.json` into non-Node repos), and three dialects coexist across the family (`harness X` / `npx harness X` / `npx --no-install harness X`) — with getting-started.md warning that bare `npx harness` fetches an unrelated registry package. Operator forbids repo-local install in minih.
**Required Action**: The 024 flow must skip/override setup's S0 install rung (signal A already tolerates PATH-resolved `harness`) and standardize on bare `harness` invocations in everything 024 writes (governance, AGENTS.md block, boot instructions). The agents-readme "row 4" probe (`npx --no-install harness --version`) will report "fresh repo" forever here — the AGENTS.md block must route around it.

### 🚨 Critical Finding 03: A prior-generation governance doc already claims L2
**Impact**: High · **Source**: DE-08, IC-01
`docs/project-rules/harness.md` (plan 020, legacy `engineering-harness-setup` generation): Boot = `just build` + `minih doctor`, Phase Gates, History L0→L2. Current skills read ONE location: `.harness/engineering-harness.md`.
**Required Action**: migrate content + history, deprecate the old path — else boot reports UNAVAILABLE while a stale doc claims L2.

### 🚨 Critical Finding 04: `just fft` mutates; `just check` misses the observed failure class
**Impact**: High · **Source**: QT-01, QT-08
fft runs `biome format --write .` (read-only boot disqualifier); check omits lint — the only recent real CI failure was a biome format error check can't see.
**Required Action**: hand-written composite boot verb (recommended composite above); `harness new boot --wrap` alone is insufficient (DC-04 wrap loses status nuance too).

### 🚨 Critical Finding 05: biome WILL check `.harness/**/*.{ts,json}`; `.harness/temp/` is unprotected today
**Impact**: High · **Source**: PS-01, PS-02, PS-05 (verified empirically)
`files.includes: ["**"]` descends into dot-dirs; gitignoring temp/ simultaneously fixes git noise AND biome exposure (`vcs.useIgnoreFile: true`). This is the same failure class that broke CI this week (PL-03).
**Required Action**: scaffold-then-format discipline + repo-level `.harness/temp/` gitignore entry as part of the build.

### 🚨 Critical Finding 06: Day-one degraded signals are real, not bugs
**Impact**: Medium · **Source**: QT-06, QT-07, QT-10
`minih doctor` = degraded (74 warnings); npm audit = 1 critical + 1 high (high on a **prod** path via ajv); one live test flake (1-of-3 observed). An honest boot will say `degraded` immediately.
**Required Action**: plan should expect/accept degraded-at-birth, and decide whether to fix the flake (QT-10) and audit findings in scope or record them as known signal.

---

## Recommendations

### If executing this upgrade (the likely plan shape)
1. **Substrate**: create `.harness/` per the router's canonical shape (IC-01); migrate governance from `docs/project-rules/harness.md`; gitignore temp/.
2. **Boot**: hand-written composite verb (shell-wrapper only): `biome check` + `tsc --noEmit` + `just check` + `minih doctor --json` (parse status) + unmasked audit (offline→skip) → ok/degraded/unconfigured/error. Emit a machine-readable orientation digest (PL-13).
3. **Records/observe**: adopt as-is — `.harness/records/retro/` committed (commit-type `chore(harness):`), temp gitignored; minih's `docs/retros/` declared a legacy READ path for harvest (answers #39's tension without code changes).
4. **Routing**: AGENTS.md harness block at top, bare-`harness` dialect, dogfood rule extended ("file it as magicWand" → `harness observe --kind magic-wand`).
5. **Domains**: registry tooling note + named-consumer entries in cli/runner domain docs (DB-08).
6. **Out of scope but adjacent**: fixing #37 (env injection), #39 (configurable ledger), the QT-10 flake — note as candidates, don't blend in.

### What NOT to do
- Don't `npm install` anything (operator rule; everything works cwd-relative).
- Don't migrate/redirect `docs/retros/` writers.
- Don't let `.harness/extensions` import `src/`.
- Don't wrap `just fft` as boot.
- Don't register `.harness` as a product domain.

---

## External Research Opportunities

No hard external gaps — the CLI's bundled docs + the local harness-engineering checkout answered everything the code couldn't (the one gap IA flagged, the retro record vocabulary, was resolved internally by DC-07).

One optional, locally-answerable check: **`harness init` roadmap** — the skills call S2 governance "owed, not provisioned" pending a future `harness init` writer (IC-04), and setup tolerates `init` being an unknown command. Before the plan writes governance by hand, glance at `/Users/jordanknight/substrate/harness-engineering` (it's the linked checkout) for an in-flight `init` implementation to avoid building what's about to ship.

---

## Appendix: Core file inventory

| File | Purpose |
|---|---|
| `src/runner/runner.ts:87-288,594-626,1382-1439` | prompt contract, env injection, auto-harvest |
| `src/runner/retro-ledger.ts` | legacy block-format writer (runId-idempotent, atomic) |
| `src/schemas/retrospective.json` | the enforced retro contract |
| `src/cli/commands/{harvest,difficulties,retros,doctor,check}.ts` | feedback-loop CLI surface |
| `justfile` | gate recipes (fft mutates; check honest) |
| `biome.json` / `tsconfig.json` / `vitest.config.ts` / `.gitignore` / `package.json` | collision surfaces (PS-01..PS-06) |
| `docs/project-rules/harness.md` | legacy governance to migrate |
| `docs/retros/*.md` (10 files) | product ledger — legacy read path |
| `~/.agents/skills/eng-harness-*` (7 skills) | the loop choreography |
| `/Users/jordanknight/substrate/harness-engineering` | the linked CLI source (v0.2.0) |

## Next Steps

- **Recommended**: `/plan-1b-v3-specify-and-clarify` to spec the wrap (scope question to settle there: substrate+boot only, vs also the read-bridge verb and domain-doc notes).
- The post-spec backpressure seam (`/eng-harness-flow --event post-spec`) is unusually meaty here — the work is literally about deterministic sensors.

---

**Research Complete**: 2026-06-11T04:58:38Z
**Report Location**: `docs/plans/024-core-harness/research-dossier.md`
