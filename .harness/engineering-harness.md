# Engineering Harness — minih

> **AGENTS START HERE → `harness instructions`** — the CLI's baked agent
> briefing (envelope contract, role split, discovery loop). Then
> `harness instructions boot` for the boot verb's briefing. `harness help` and
> `harness doctor --json` complete the one-hop orientation.

**Version**: 2.0.0 (migrated from `docs/project-rules/harness.md` v1.0.0)
**Created**: 2026-05-10 · **Migrated**: 2026-06-11 (plan 024-core-harness)
**Maturity Level**: L2
**Project Type**: cli

## Purpose

This harness defines minih's session-level engineering feedback loop — Boot →
Backpressure → Observe → Retro → Improve — running on **harness-core** (the
global `harness` CLI). It is agent-operable, but it is not merely an "agent
harness"; it is the project contract for proving minih itself can be built,
exercised through supported CLI surfaces, and observed without reading private
run files directly.

It is distinct from the **minih product harness** (the retrospective machinery
minih's runner ships to its own users, writing `docs/retros/`). This document
governs the loop for *developing* minih; the product harness is observed, never
written, from here (see § Legacy read paths).

## Boot command

```bash
harness boot --json    # composite read-only readiness proof (~17s warm; target <60s) — `time harness boot` to query
```

Boot proves the environment and re-orients the agent in one envelope: five
read-only sensors plus an orientation digest (branch, governance location, the
friction-capture command, the mutating commit gate). See § Boot sensors for the
composition. `just build` remains the quick rebuild during iteration; boot is
the session-start proof, not the build loop.

## Health check

```bash
harness doctor --json    # harness substrate: toolchain, extensions loaded, conventions
minih doctor             # product health — shelled by boot sensor 4 (see Finding 01 note in § Boot sensors)
```

Healthy reading: `harness doctor` exits 0 with extensions `1 loaded, 0 failed,
0 conflict(s)`. Boot's own verdict vocabulary is `ok / degraded / error` — and
**day-one degraded is honest**, not broken (§ Boot sensors).

## Interact method

- **Primary**: Terminal CLI — two surfaces, one dialect rule (§ Harness-core contract).
- **Harness verbs**: `harness boot`, `harness observe`, `harness record`,
  `harness instructions [verb]`, `harness doctor`, `harness help`, `harness new`,
  `harness docs`, `harness skills`.
- **minih commands** (the system under development):
  - `minih doctor` — validates agent conventions and project health surfaces.
  - `minih list` — lists available agents through the public CLI envelope.
  - `minih check <slug> --file <path>` — validates explicit files against agent schemas.
  - `minih status <slug> --run <runId>` — inspects run status without reading run-directory files directly.
  - `minih tail <slug> --run <runId> --snapshot --lines N` — observes bounded event output through the CLI.
  - `minih retros --slug <slug>` — reads retrospective evidence through the CLI.
- **Auth Strategy**: None for build, doctor, list, check, status, tail, retros,
  and all harness verbs. Running SDK-backed agents may require
  `GH_TOKEN=$(gh auth token)` in the spawning shell.
- **Auth Detection**: Prefer CLI error envelopes and `gh auth status`/`gh auth token`
  for SDK-backed workflows.

## Observe method

- **Response capture**: JSON envelopes on stdout; human-readable tables and
  pretty output on stderr (both CLIs follow this convention).
- **Logs**: Use `minih tail`, `minih last-run`, `minih validate`, `minih retros`.
  Do not read `agents/<slug>/runs/<runId>/...` files directly (§ Dogfood Rules).
- **Friction capture**: `harness observe "<what>" --kind <kind>` — one silent
  line per event into the gitignored buffer (`.harness/temp/`); drained to a
  committed record via `harness record retro --slug <plan-slug>` at retro time.
- **Evidence paths**:
  - `.harness/records/<type>/` — committed harness records (`harness record`).
  - `.harness/temp/` — uncommitted observe scratch (self-gitignored; repo-level ignore as defense-in-depth).
  - the active plan's `execution.log.md` — committed phase evidence.
  - `./scratch/evidence/` — ad hoc command captures (gitignored).

## Harness-core contract

Recorded contract surface (no checkout pinning — the global CLI is an
npm-linked dev checkout and a deliberate moving target; this section is the
drift detector):

- **Version at migration**: harness-core **0.2.0**.
- **Envelope**: every verb returns `{command, status, data, error?, next_action?, timestamp}`
  with `status ∈ ok | degraded | unconfigured | error` mapping to exits
  **0 / 0 / 2 / 1**.
- **Core verbs**: `help`, `doctor`, `instructions`, `new`, `docs`, `skills`,
  `record`, `observe`. There is **no `init` verb yet** (E108) — governance is
  hand-written here; adopting `harness init` when it ships is a recorded
  follow-up, not a dependency.
- **Records**: `harness record [type] --slug <slug>` →
  `.harness/records/<type>/<YYYY-MM-DD>/<NNN>-<slug>.md` (frontmatter owned by
  the CLI's template).
- **Observe flags**: `--kind` (difficulty | magic-wand | gift | insight |
  coordination | improvement-suggestion | confusion), `--target`, `--severity`,
  `--workaround`, `--suggested-encoding`, `--agent`, `--list`, `--clear`.
- **Extension contract**: `.harness/extensions/<name>/extension.ts`
  default-exports a `HarnessVerb`; `VerbContext` provides `exec/fs/env/git/clock`
  plus `ok/degraded/unconfigured/error`. TS loads via jiti; the contract import
  is type-only (erased at runtime — no repo-local package).
- **Dialect rule**: always bare **`harness`** (and the `engh` alias). The CLI is
  installed globally; **never `npx harness`, never `npm install` it into this
  repo.** Everything this repo writes — docs, skills, AGENTS.md, governance —
  uses the bare dialect.

## Boot sensors (as built)

The boot verb (`.harness/extensions/boot/extension.ts`) is a hand-written
composite — `--wrap` would lose status nuance. Five read-only sensors, in order:

| # | Sensor | Command | fail → | warn → |
|---|--------|---------|--------|--------|
| 1 | lint | `npx biome check .` (read-only, never `--write`) | error | — |
| 2 | typecheck | `npx tsc --noEmit` | error | — |
| 3 | build+test | `just check` (= `npm run build` + `npm test`; runs **no** biome) | error | — |
| 4 | minih-doctor | `minih doctor`, then `minih doctor --strict` | error (plain run fails) | warn (plain passes, `--strict` fails ⇒ warnings present) |
| 5 | audit | `npm audit --audit-level=high --json` | error (unparseable, online) | warn (high+critical > 0); **skipped** when registry unreachable/offline — skipped means *unproven*, never gates |

Verdict mapping: any `fail` → envelope `error` (exit 1); any `warn` →
`degraded` (exit 0); else `ok` (exit 0). `data.sensors` carries per-sensor
outcomes; `data.orientation` is the re-orientation digest.

**Finding 01 — why sensor 4 runs doctor twice.** The 024 spec's sensor
composition named `minih doctor --json`, but `minih doctor` has no `--json`
flag (live-probed in `dist` and `src/cli/commands/doctor.ts`; only `--strict`
exists). Warning detection is therefore deterministic via the exit-code pair:
the plain run catches hard errors, the `--strict` run turns warnings into a
non-zero exit — no prose scraping, no src change. Captured as observe entry
DL-001; the follow-up candidate is adding `--json` MinihEnvelope output to
`minih doctor` (a src change, out of 024 scope). Note: `harness doctor --json`
exists and is unrelated to this gap.

**Degraded is honest.** The day-one verdict is `degraded` — known `minih doctor`
warnings plus a known high/critical advisory chain in dependencies. That is the
truthful state of the tree, surfaced with `next_action` naming each warning.
Treat `degraded` as workable-with-awareness; do not "fix" boot to hide it.

**Boot never mutates.** Read-only proven by byte-identical
`git status --porcelain` across a run (AC-4). The mutating gate — `just fft`,
which runs `biome format --write` — belongs at commit time, never in boot.

## Phase Gates

Use the narrowest gate that proves the phase's contract, then run `just fft` before commit or push.

| Domain / Work Type | Boot | Interact | Observe | Narrow Gate |
|--------------------|------|----------|---------|-------------|
| docs / planning | N/A | Read linked plan/domain docs | `git --no-pager diff --check` | `git --no-pager diff --check` |
| runner | `just build` | Focused runner tests | Vitest output | `npx vitest run test/runner/<file>.test.ts` |
| cli | `just build` | Built `minih ...` command | JSON envelope stdout + stderr diagnostics | `npx vitest run test/cli/<file>.test.ts` |
| mcp | `just build` | MCP server/spawn tests | Vitest output | `npx vitest run test/mcp/<file>.test.ts` |
| adapter | `just build` | Fake adapter tests unless SDK behavior is required | Vitest output | targeted adapter test |
| measurement contracts | `just build` | Schema/proof/registry tests | AJV/Vitest output | `npx vitest run test/runner/schemas.test.ts test/runner/measurement/*.test.ts` |
| eng-harness | `harness boot` | `harness <verb> --json` | Envelope `data` + `.harness/records/` | `harness boot --json` |
| release / pre-commit | `just build` | Full pipeline | CLI/test/audit output | `just fft` |

## Dogfood Rules

- Use the minih CLI to inspect minih runs. Do not `cat`, `tail`, `grep`, or `jq` files under `agents/<slug>/runs/<runId>/` directly.
- If a needed run artifact has no CLI surface, record the CLI gap before using emergency direct file access — file it as
  `harness observe "<the gap>" --kind magic-wand` (MW) so it survives to the retro.
- Treat JSON envelopes as the machine contract and stderr as human-readable diagnostics.
- For source-code phases, start or verify code-review-companion before editing source code.
- Keep measurement work local-first and evidence-backed: runner facts are authoritative; agents and companions may only add cited interpretation.
- Capture engineering friction the moment it happens: `harness observe "<what>" --kind <kind>` — one line now beats a
  reconstructed memory at retro time. The buffer is gitignored scratch; nothing lands in history until `harness record retro` drains it.

## Maturity Assessment

| Level | Status | Notes |
|-------|--------|-------|
| L0: No harness | No | minih has named build, test, CLI, and observation commands. |
| L1: Manual boot + CLI | Yes | A human or agent can build and run CLI commands. |
| L2: Auto boot + CLI health | Yes | `harness boot` provides one-command automated proof (build, test, lint, typecheck, doctor, audit) with a deterministic envelope verdict. |
| L3: Full interaction + evidence | Partial | CLI observation surfaces exist and the observe → record loop now standardizes friction evidence into `.harness/records/`; retro-driven *encoded* improvements have not yet shipped from this loop. |
| L4: Self-healing | No | The harness does not auto-recover from failed builds, stale SDK auth, or broken agent configs. |

Current: **L2** — minih boots and health-checks through one deterministic
command with structured evidence capture; the improvement loop is standing
(observe buffer + committed records) but has not yet shipped a retro-driven
harness change.

## Validation Checklist

### Boot

- [x] Single command starts full proof (`harness boot`)
- [x] Health check endpoint/command exists and returns expected response
- [x] Boot is idempotent and read-only
- [ ] Handles port conflicts (not applicable for the core CLI; server-like commands must fail fast or own cleanup)
- [ ] Clean shutdown on SIGTERM/SIGINT for long-running interactive views

### Interact

- [x] Agent can send input through terminal commands
- [x] Agent can trigger core user-facing actions through the CLI
- [x] Auth is automated or unnecessary for local health paths
- [x] Auth expiry is detected with a clear error message for SDK-backed runs

### Observe

- [x] Agent can read output through CLI JSON envelopes and stderr diagnostics
- [x] Evidence capture works through `harness observe` / `harness record` and redirected CLI output
- [x] Structured output available

### Operate

- [x] Bootstrap doc explains harness to new agents (`harness instructions boot` + this contract)
- [x] Example validation script exists as a committed copy-paste command (modernized into the deep guide — see footer)
- [x] Named commands exist in `justfile` and `package.json`

## Validation Checklist for Agents

Before implementation:

1. Boot: run `harness boot --json` and read the verdict (`degraded` = workable-with-awareness; `error` = fix the named sensor first).
2. Interact: run the narrow CLI/test command for the phase (§ Phase Gates).
3. Observe: capture the command result through stdout/stderr or the active plan's execution log; file friction as `harness observe` the moment it bites.
4. Validate: run the phase's narrow test gate; before commit/push, run `just fft`.

The copy-paste validation block lives in the deep guide (see footer) in its
modernized `harness boot`-based form.

## Injection map

minih's extant flow is the SDD `plan-*` pipeline guided by `the-flow` — a
**self-firing host**: its skills call `/eng-harness-flow --event …` at every
seam, so no extra weaving into flow files is needed. The AGENTS.md harness
block is the cold-start cue for sessions that begin *outside* the flow.

| Seam event | Fires from | What fires it |
|------------|-----------|---------------|
| `session-start` | `the-flow` entry / `/plan-1a` | the flow's session-start seam step; outside the flow, the AGENTS.md cold-start cue (`harness boot` at session start) covers it |
| `post-spec` | `the-flow` at `awaiting-1b` — the backpressure seam | recommended pre-architect step: `/eng-harness-flow --event post-spec --spec <path>` |
| `pre-implement` | `/plan-6` step 2a (the plan's T-row N.0 / T000) | self-fired before any task starts |
| `phase-end` | `/plan-6` step 7 (the plan's T-row N.z / T012) | self-fired after all tasks and outputs |
| `plan-complete` | `/plan-8` after the merge executes | long-horizon reflection |

(`task-pause` exists in the router's seam vocabulary; here it is manual-only —
an operator fires it at a natural pause when wanted.)

## Legacy read paths

- **`docs/retros/*.md`** — the minih **product** harness's retro ledgers,
  written by minih's runner (auto-append) and `minih harvest`. For the
  engineering harness these are a **READ-only harvest source**, consumed via
  the minihToUniversal mapping at retro-harvest time. **Writers under
  `.harness/` are prohibited from targeting `docs/retros/`** — the product
  harness owns that path; the engineering harness records land in
  `.harness/records/` only.
- **`docs/project-rules/harness.md`** — the previous home of this contract;
  now a dated deprecation pointer to this file.

## History

| Date | Plan | Change | Maturity Before -> After |
|------|------|--------|--------------------------|
| 2026-05-10 | 020-minih-harness-measurement | Created MiniH engineering harness contract for Boot -> Interact -> Observe measurement prerequisite. | L0 -> L2 |
| 2026-05-10 | 020-minih-harness-measurement | Validated Boot with `just build`, Interact with `minih doctor`/`minih list`, and Observe with redirected JSON evidence in `scratch/evidence/`. | L2 -> L2 |
| 2026-05-10 | 020-minih-harness-measurement | Used the engineering harness to validate Phase 1 contracts with focused measurement/schema tests and the full `just fft` gate. | L2 -> L2 |
| 2026-06-11 | 024-core-harness | Migrated governance onto harness-core 0.2.0: composite `harness boot` (5 read-only sensors), observe → record friction loop, injection map, legacy read-path declaration; old doc reduced to a deprecation pointer. | L2 -> L2 |

---

Deep guide (loop narrative, friction lifecycle, copy-paste validation block):
[`docs/how/engineering-harness.md`](../docs/how/engineering-harness.md)
