# Retro Harvest Loop — Closing the Improvement Cycle

**Mode**: Simple
**Plan ordinal**: 011
**Created**: 2026-04-29
**Spec status**: Draft
**Workshop**: [`010/workshops/002-retro-harvest-discipline.md`](../010-coordination-cli-and-resume/workshops/002-retro-harvest-discipline.md) — design source

ℹ️ This plan operationalizes Workshop 002. Workshop is authoritative for design; this spec is the WHAT/WHY for what minih ships.

---

## Research Context

📚 **Source**: Workshop 002 (Retro Harvest Discipline) under plan 010, plus the dogfood lapse it documents (this session's `code-review-companion` run timed out and produced no harvestable retro; nobody noticed until prompted).

**Key findings from Workshop 002**:

1. **Asymmetric teaching**: `agents/_shared/preamble.md` references `magicWand` / `difficulties` 8 times, training agents to *emit* retros. Zero references in minih teach operators to *harvest* them. Producer-only loop.
2. **No retro ledger**: the project ships no `docs/retros/` convention. Retros land in `agents/<slug>/runs/<runId>/output/report.json` and are forgotten when the run dir scrolls past.
3. **No runtime nudge**: `displaySummary` ends with stats and exits. Nothing at the moment of completion points the operator at the retro that was just produced.
4. **Skill-level fixes won't ship**: prior thinking suggested editing planning skills (`plan-3`, `plan-6`) to add a "harvest retro" task. Those skills live in `~/.copilot/skills/` and are NOT in the npm package — minih has to teach this using only the surface it bundles (CLI, runtime output, scaffolded docs, bundled preamble).
5. **The compounding premise**: the harness-is-the-product principle assumes retros surface back into the project. Today they don't — every plan in `docs/plans/` produced retros, and most evaporated. Closing this loop is probably worth more than any single feature plan because it changes the *rate* at which all future plans produce value.

---

## Summary

Make "harvesting an agent's retrospective" a first-class part of every minih run, using **only minih-bundled surface** (CLI commands, runtime output, scaffolded templates, bundled preamble). Today the producer side of the improvement loop is fully built (every agent emits `magicWand` + `difficulties` on farewell); the consumer side is missing. After this plan, every run that produces a retro will:

- nudge the operator at completion time,
- be harvestable with a one-line CLI command,
- (by default) auto-append to a project-level retro ledger,
- be auditable by `minih doctor` if the operator opted out.

External users (humans + orchestrating LLMs) get the loop closed without needing any out-of-band tooling, planning skills, or documentation they haven't installed.

## Goals

- **G1** — Operators see retro existence at the moment a run completes (run-end CLI output makes the retro visible).
- **G2** — A first-class `minih harvest <slug>` command exists for explicit, idempotent, scriptable harvest.
- **G3** — A canonical `docs/retros/` ledger format ships as a bundled template; `minih init` scaffolds it.
- **G4** — Every run's retro lands in the ledger by default at terminal condition (auto-append), with an opt-out for users who want to do it themselves.
- **G5** — Operator-side teaching is bundled in `agents/_shared/preamble.md` (which `init` scaffolds into user projects), so orchestrating LLMs see it whenever they read an agent's preamble.
- **G6** — `minih doctor` reports unharvested retros so operators can audit the gap.
- **G7** — `AGENTS_README.md` (visible on GitHub + via `npm view`) describes the improvement loop end-to-end so a new user understands the contract before writing their first agent.

## Non-Goals

- **NG1** — Editing my personal planning skills (`plan-3`, `plan-6`, etc.). Those don't ship with minih; they're operator tooling. This plan is about minih itself.
- **NG2** — Cross-project / centralized retro aggregation (e.g., a "send retros home to a server" feature). The ledger lives in the user's repo. Cross-project rollup is a future, separate idea.
- **NG3** — Schema changes to the existing `retrospective` shape. Today's `magicWand` / `magicWandTarget` / `difficulties` fields are sufficient. This plan is about *flow*, not *schema*.
- **NG4** — Changing how agents emit retros. Producer side is already correct; only consumer side needs work.
- **NG5** — Building a UI / dashboard for retros. Markdown ledger is enough for v1.
- **NG6** — Versioning or migrating existing run dirs to retroactively populate the ledger. We capture from now forward; older retros remain in run dirs and can be harvested manually if anyone cares.

## Target Domains

| Domain | Status | Relationship | Role in This Feature |
|--------|--------|-------------|---------------------|
| `cli` | existing | **modify** | New `minih harvest <slug>` command; `displaySummary` end-of-run hint; `minih doctor` retro-completeness check; help text on `run` / `resume` mentions the loop |
| `runner` | existing | **modify** | Auto-append retro to ledger at terminal condition (when `output/report.json` is parsed); honor `MINIH_NO_AUTO_HARVEST` opt-out; emit a stub entry when the run terminated before producing a retro |
| `agents/_shared/preamble.md` + `src/templates/shared-preamble.md` | existing template | **modify** | Add "## For Operators" section so orchestrating LLMs see the harvest contract whenever they reason about an agent |
| `src/templates/retros-readme.md` | **NEW** | **create** | Bundled template explaining the ledger format; scaffolded into `<user-project>/docs/retros/README.md` by `minih init` |
| `AGENTS_README.md` | existing doc | **modify** | New section describing the improvement loop; visible on GitHub + via `npm view` |
| `adapter` | existing | **consume** | Untouched; runner reads what the adapter already produced |
| `mcp` | existing | **consume** | Untouched |

### New Surface Sketches

#### `docs/retros/<slug>.md` (per-agent ledger format)
- **Purpose**: Append-only Markdown log of every harvested retro for one agent slug.
- **Boundary owns**: ordering, basic provenance (runId, timestamp), raw `magicWand` + `difficulties` content.
- **Boundary excludes**: triage, prioritization, cross-agent rollup. (Operator does that manually or with future tooling.)

#### `docs/retros/README.md` (scaffolded by `init`)
- **Purpose**: Teach the user what the directory is for, what `minih harvest` does, and how the ledger maps to plans.
- **Boundary owns**: convention documentation; one-liner of the canonical entry format.
- **Boundary excludes**: any code or runtime behavior.

## Complexity

- **Score**: CS-2 (small)
- **Breakdown**: S=2, I=0, D=1, N=0, F=0, T=1 → P=4 → CS-2
- **Confidence**: 0.85
- **Assumptions**:
  - The existing `parsedReport` / `output/report.json` parsing in `runner.ts` already extracts `retrospective` fields (verify in clarify).
  - `MINIH_NO_AUTO_HARVEST=1` opt-out is sufficient — no need for per-agent overrides in v1.
  - Per-agent ledger (`docs/retros/<slug>.md`) is the right grain (vs per-plan or single global file).
  - Stub entries for runs that produced no retro (timeout, crash) are valuable — they signal *something happened* even when there's nothing to learn.
- **Dependencies**: none external. All work is in the existing CLI/runner/template surface.
- **Risks**:
  - Auto-append at terminal condition could fail in edge cases (file-system errors, parallel writes from multiple resumed runs). Mitigated by atomic-append and graceful skip-on-error.
  - Opt-out env var leaking from prior in-process state — must read fresh env each call (mirrors plan 010 § R-003 fix).
  - Bundled template drift: `src/templates/retros-readme.md` and the actual ledger format must stay in sync; verify via a test that compares the template against an example ledger entry.
- **Phases**: 1 phase, 4 fix tiers (HF-A → HF-D), Simple mode candidate.

## Acceptance Criteria

1. **AC-1 — End-of-run hint exists**: After any `minih run <slug>` or `minih resume <slug>` completes (success or degraded), `displaySummary` (pretty mode) prints one line:
   - When retro present: `📝 magicWand: "<wand text>"  (full retro: minih harvest <slug>)`
   - When retro absent: `⚠️ Retrospective not written (run timed out / crashed)`
   - Verifiable via existing `displaySummary` test pattern.

2. **AC-2 — `minih harvest <slug>` works**: Running `minih harvest <slug>` (no flags) reads the latest run's `output/report.json`, extracts `retrospective`, and appends a canonical entry to `docs/retros/<slug>.md`. When the run was launched with `MINIH_PLAN_ID` set, ALSO appends to `docs/retros/<plan-id>.md` (dual-write). Idempotent — re-harvesting the same runId does not create duplicate entries (writer scans for existing `runId: <id>` lines before appending). JSON envelope on stdout per minih convention; pretty output to stderr.

3. **AC-3 — `minih harvest --since <ref>` batch mode**: Operator can harvest every run dir whose `completed.json.completedAt` is newer than `<ref>` (a git ref or ISO timestamp). Useful for pre-commit cleanup.

4. **AC-4 — Auto-append on by default**: When a run completes and produces a retro, the runner appends to `docs/retros/<slug>.md` automatically (and to `docs/retros/<plan-id>.md` when `MINIH_PLAN_ID` is set). The operator does not need to invoke `minih harvest` for the default case. When `docs/retros/` is not writable (no `docs/` dir, read-only fs), the runner emits a `MINIH_AUTO_HARVEST_SKIPPED` debug-level line and continues — never poisons a successful run.

5. **AC-5 — Auto-append opt-out**: Setting `MINIH_NO_AUTO_HARVEST=1` (in env when invoking `minih run`) suppresses the auto-append. The operator can still harvest manually.

6. **AC-6 — Stub entry on terminal failure**: When a run terminates without producing `output/report.json` (timeout, crash, schema fail), the runner appends a lean stub entry to the ledger(s): ISO timestamp + runId + result (`timeout` / `failed` / `crashed`) + run-dir path + a single line of `stderr.log` tail. Stub entries use a `> ⚠️` blockquote prefix so they are visually distinct from real retros. No event-stream embedding (operators chase the run dir for deeper diagnosis).

7. **AC-7 — `minih init` scaffolds the ledger directory**: `minih init` in a new project creates `docs/retros/` with `README.md` (from bundled `src/templates/retros-readme.md`). Idempotent on re-init.

8. **AC-8 — Operator paragraph in scaffolded preamble**: `agents/_shared/preamble.md` (and the bundled `src/templates/shared-preamble.md` it mirrors) contains a "## For Operators" section explaining the harvest contract. The section is present in newly-scaffolded user projects after `minih init`.

9. **AC-9 — `minih doctor` reports unharvested retros**: When auto-append is opt-out OR auto-append failed silently, `minih doctor` lists each run dir with an unharvested retro and suggests the harvest command. Reports `0 unharvested retros` cleanly when up-to-date.

10. **AC-10 — `AGENTS_README.md` describes the loop**: A new "## The Improvement Loop" section explains: (a) every agent emits a retro on farewell; (b) minih harvests it to `docs/retros/<slug>.md`; (c) operators review the ledger before planning the next change. Verifiable by a doc test or manual review.

11. **AC-11 — Help text mentions harvest**: `minih run --help` and `minih resume --help` both mention `minih harvest <slug>` in their "after the run" guidance. Verifiable by snapshot test on help output.

12. **AC-12 — `just fft` baseline maintained**: All existing tests pass; new unit tests for the harvest writer + auto-append + stub-entry path; one CLI integration test for `minih harvest`. No regression in the 513-test baseline.

## Risks & Assumptions

| ID | Risk / Assumption | Mitigation |
|----|-------------------|------------|
| R-1 | Auto-append could race with concurrent runs of the same slug (e.g., parallel test scenarios). | Atomic append via the existing `atomic-write.ts` POSIX rename pattern, OR file-locking. Workshop 002 favors atomic-append. |
| R-2 | Idempotency for `minih harvest`: re-harvesting a runId must not duplicate. | Writer scans the file for `runId: <id>` lines before appending; skips if already present. |
| R-3 | Bundled `src/templates/retros-readme.md` could drift from the actual writer's format. | A test parses the template's "example entry" block and asserts the writer produces matching output. |
| R-4 | Ledger files become huge over time. | Out of scope for v1. Future tooling can split per-plan or per-month. The writer is append-only, so size is monotonic. |
| R-5 | Auto-append in CI runs that don't have a writable `docs/retros/` (e.g., npm install with no project context). | Skip silently when CWD has no `docs/` or no `agents/`; this matches today's tolerance. Log a `MINIH_AUTO_HARVEST_SKIPPED` line at debug level. |
| R-6 | Operator paragraph in preamble adds tokens to every agent prompt. | Keep it ≤12 lines of markdown. The cost is real but minor; the cultural reinforcement is worth it. |
| R-7 | "Stub on failure" entries could mask real problems if operators see them and assume "system noted it". | Stub entries explicitly say `(unavailable — run terminated as <result>)` and suggest investigating events.ndjson. Visually distinct. |
| A-1 | `output/report.json` parsing in `runner.ts` already extracts `retrospective`. | To confirm in clarify (we know `parseReportJson` is called near line 740 of runner.ts in plan 010 changes). |
| A-2 | One ledger file per agent slug is the right grain. | If clarify reveals operators want plan-scoped ledgers (`docs/retros/<plan>.md`), we can dual-write at minimal cost. |

## Clarifications

### Session 2026-04-29

- **Q1 — Workflow Mode**: **Simple**. Single phase, inline tasks, plan-4/plan-5 optional. Matches plan 010's pattern.
- **Q2 — Testing Strategy**: **Hybrid**. TDD (RED → GREEN) for the runner-side writer, auto-append branch, and stub-on-failure path; lightweight assertion-style tests for the CLI surface (harvest verb, doctor check, displaySummary hint). No live SDK round-trip required.
- **Q3 — Ledger grain**: **Per-agent + per-plan dual-write**. Every harvested retro is appended to BOTH `docs/retros/<slug>.md` AND `docs/retros/<plan-id>.md` when `MINIH_PLAN_ID` is set in the env. When `MINIH_PLAN_ID` is unset, only the per-agent file is written. Cost is one extra `fs.appendFile` per retro; benefit is "what's plan X's friction record?" and "what's agent X's friction record?" both grep-able in one shot.
- **Q4 — Auto-append default**: **ON by default**. Setting `MINIH_NO_AUTO_HARVEST=1` in the run's env opts out. CI tolerance: when `docs/retros/` is not writable (or the project has no `docs/`), skip silently with a debug-level log line. Never poison a successful run because of an io error harvesting.
- **Q5 — Documentation Strategy**: **Hybrid**. Three doc surfaces: (a) `AGENTS_README.md` § "The Improvement Loop" — visible on GitHub + via `npm view`; (b) bundled `src/templates/retros-readme.md` scaffolded by `minih init` to `docs/retros/README.md` in the user's project; (c) "## For Operators" paragraph appended to `agents/_shared/preamble.md` + its bundled mirror at `src/templates/shared-preamble.md`. No `docs/how/` content in v1.
- **Q6 — Stub entry on terminal failure**: **Lean stub**. When a run terminates without producing `output/report.json`, the writer appends a stub: ISO timestamp + `runId` + `result` (`timeout`/`failed`/`crashed`) + run-dir path + a single line of the tail of `stderr.log`. No event-stream embedding. Operators with deeper interest can grep the run dir directly.
- **Q7 — Domain Review**: **`cli` + `runner` only**. No new domains. Templates and `AGENTS_README` are docs surface; no domain map change required. The new `src/templates/retros-readme.md` ships under existing `runner` build artifacts (per `scripts/copy-schemas.js`).
- **Pre-locked defaults (not surfaced as questions; recorded for plan-3)**:
  - **Init aggressiveness**: `minih init` always creates `docs/retros/` (with the bundled `README.md`); the directory is a leaf and idempotent re-init is safe.
  - **`minih harvest --since <ref>`**: implemented via filesystem mtime against `completed.json` (no git dependency); accepts ISO timestamps and `HEAD~N` shorthand later if useful.
  - **Per-agent override**: not in v1. Opt-out is global via `MINIH_NO_AUTO_HARVEST=1` only. Frontmatter `autoHarvest: false` deferred to a future plan if needed.
  - **Fail-silent on io error**: yes. Auto-append failures emit a `MINIH_AUTO_HARVEST_SKIPPED` debug line (visible with `--verbose`) but never fail the run.

---

## Testing Strategy

**Approach**: Hybrid (per Clarify Q2)

**Rationale**:
- Runner-side writer (HF-C auto-append, HF-A stub-on-failure, dual-write per plan/agent, idempotency check, race tolerance) is the load-bearing logic and benefits from RED → GREEN iteration.
- CLI surface (`minih harvest`, `minih doctor` retro check, `displaySummary` hint, help text) is straightforward command behavior — assertion-style integration tests against `dist/cli/index.js` are sufficient.
- No live SDK gate needed; the work is observable from filesystem state and CLI envelopes.

**Focus Areas** (RED bar required):
- Writer module: idempotency (no duplicate `runId` lines), atomic-append (no torn writes under parallel runs), per-agent + per-plan dual-write semantics, stub-entry generation when `report.json` missing.
- Runner auto-append branch: `MINIH_NO_AUTO_HARVEST=1` honored, fail-silent on io error, integration with existing `parseReportJson` call site.

**Lightweight (assertion-style)**:
- `minih harvest <slug>` envelope shape, exit codes, stdout/stderr separation.
- `minih harvest --since <ref>` batch behavior.
- `minih doctor` unharvested-retro detection.
- `displaySummary` hint format (snapshot test on stderr output).
- `minih init` scaffolding `docs/retros/` and its README.

**Excluded**:
- Live SDK round-trip (no Copilot calls in this plan).
- Cross-project / network-side rollup (NG2 — out of scope).
- Schema validation tests for `retrospective` (out of scope; producer-side, already covered).

**Mock Usage**: **Avoid mocks** entirely (project standard per memory). Real fs fixtures in tmp dirs; FakeAgentAdapter only where a runner test needs an adapter.

---

## Documentation Strategy

**Approach**: Hybrid (per Clarify Q5)

**Touched docs**:

| Surface | Type | Audience | Reach |
|---------|------|----------|-------|
| `AGENTS_README.md` § "The Improvement Loop" | Existing repo doc, modified | Anyone evaluating minih (GitHub, `npm view`) | Pre-install + onboarding |
| `src/templates/retros-readme.md` (NEW, bundled) → scaffolded as `<user-project>/docs/retros/README.md` by `minih init` | New bundled template | Users in their own projects | Every new minih project |
| `agents/_shared/preamble.md` + `src/templates/shared-preamble.md` § "For Operators" | Existing template, modified | Orchestrating LLMs reading agent preambles + humans reading the file | Every coordinated agent run |
| `minih run --help` and `minih resume --help` | CLI help text | Anyone running `--help` | Runtime discovery |
| `docs/domains/{cli,runner}/domain.md` § History row | Internal repo docs | Future minih contributors | Plan archaeology |

**Excluded**:
- `docs/how/improvement-loop.md` deep guide — deferred. The three primary surfaces above are sufficient for v1; we can add a deeper guide if dogfood reveals confusion.

---

## Workshop Opportunities

Most design is locked by Workshop 002. Remaining questions are small and tractable in plan-2 clarify; no additional workshops anticipated. If clarify surfaces a non-trivial design choice we missed, we can workshop then.

| Topic | Type | Why Workshop | Key Questions |
|-------|------|--------------|---------------|
| _(none — Workshop 002 covers the design)_ | — | — | — |

## Notes for plan-3

- Mode candidate: **Simple** (single-phase fix-mode, ~12-15 tasks total). User has a strong steer toward not-overcomplicating.
- Execute in HF-A → HF-D tiers per Workshop 002 § Recommended Rollout.
- The auto-append and stub-on-failure edges are the highest test-coverage targets; CLI surface (harvest verb + doctor check) is mostly assertion-style.
- One coordinated commit per HF tier is fine; HF-A items can ship together (cosmetic + bundled docs).
- Live smoke not required (no SDK round-trip); standard `just fft` is sufficient.
