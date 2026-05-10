# `agent-readme` Command + Companion Coverage in AGENTS_README

**Mode**: Simple

📚 This specification is derived from the authoritative design in [`workshops/001-cli-flow-and-bundle.md`](./workshops/001-cli-flow-and-bundle.md). The workshop nails the CLI verb name + shape, output contract (raw markdown, deliberate deviation from JSON envelope), bundle-into-`dist/` strategy, error code, and SIGPIPE handling. This spec restates the user-facing WHAT/WHY and adds the **second goal**: tightening AGENTS_README's companion-mode coverage so the doc that ships is actually worth dumping.

ℹ️ No `research-dossier.md` was produced — the gap was surfaced live by the user (*"is there a `minih --agents-readme` command?"*) followed by the realisation that the npm package ships only `dist/` + `LICENSE`, so docs written for "use on other systems" don't actually reach those systems today.

## Summary

Ship a `minih agent-readme` CLI verb that dumps the bundled `AGENTS_README.md` to stdout, and bundle the doc into the npm package via `scripts/copy-schemas.js`. Signpost it from `--help`. Closes the gap where minih-using projects today can't read minih's own docs locally — they have to fetch from GitHub. **Second goal**: while the doc is being made shippable, beef up its companion-mode coverage so the dumped content actually answers "what is companion mode and how do I use one" without forcing readers to follow a link to `docs/how/companion-mode.md` (which still won't be in the package in v1).

## Goals

- A coordinated agent on any project can run `minih agent-readme` and read the canonical agent-facing docs without an internet connection or hand-distributed file.
- The output is raw markdown to stdout — pipeable into `less`, `glow`, `cat`, or shell variables. No JSON envelope wrapping.
- `minih --help` signposts the new verb so an operator browsing the help text discovers it.
- The bundled `AGENTS_README.md` adequately covers **companion mode** — what it is, how to write one, the lifecycle, control signals, farewell envelope contract, and the orchestrator-side Power On Mode protocol — at sufficient depth that a reader who never visits GitHub can implement and operate companions correctly.
- Companion-mode docs in `docs/how/companion-mode.md` remain the deeper reference; the README points at them for the full runbook.
- Backwards compatible: existing CLI commands and outputs unchanged. `package.json` `files` array unchanged (we ship into `dist/` instead).
- Error path is graceful: corrupted install (no bundled doc) returns a JSON envelope to stderr with the new `E160 README_NOT_FOUND` code and exits 1.
- SIGPIPE is handled silently for `| head -50`-style pipelines.

## Non-Goals

- **No `agent-readme <topic>` subcommand** for `docs/how/` content in v1. Workshop O1 deferred. Future-extensible via the same envelope shape.
- **No `--list` flag** for discovering how-doc topics — same rationale.
- **No `--agents-readme-path <path>` override flag** for projects wanting custom forks of the README. Workshop O7 deferred.
- **No JSON envelope variant** (`agent-readme --json`) — minih's project rule explicitly says "no `--json` flag" (per `CLAUDE.md`). This deviation is intentional and limited to documentation-dump verbs.
- **No paging built into the command** — operators pipe to `less` if they want paging.
- **No automatic AGENTS_README rebuild from sub-docs** — the README is hand-edited; this plan only edits it once to add companion coverage.
- **No copying of `docs/how/companion-mode.md` into `dist/`** in v1. The README beefs up enough that dumped content is sufficient on its own; the how-doc stays a GitHub-link reference until/unless `agent-readme <topic>` ships in a future plan.
- **No changes to `--version`, `--help`, or any other existing meta-info commands** — `agent-readme` is purely additive.
- **No CLI behaviour change for any existing verb** — purely additive.

## Target Domains

| Domain | Status | Relationship | Role in This Feature |
|--------|--------|-------------|---------------------|
| cli | existing | **modify** | New `agent-readme` subcommand: `src/cli/commands/agent-readme.ts`; new error code `E160 README_NOT_FOUND` in `src/cli/output.ts`; `--help` postscript edit in `src/cli/index.ts`. |
| docs | existing | **modify** | `AGENTS_README.md` gains a substantially expanded `## Companion mode` section (currently a single sub-subsection ~7 lines) covering the full protocol so the bundled doc is self-contained reference. |
| build | existing | **modify** | `scripts/copy-schemas.js` gains a one-line copy of `AGENTS_README.md` into `dist/AGENTS_README.md`. |

No new domain. No new contract category. No domain registry change. No domain map change.

## Complexity

- **Score**: CS-2 (small)
- **Breakdown**: S=1, I=0, D=0, N=0, F=0, T=1 → P=2 → **CS-1 by raw points; bumping to CS-2** because the README rewrite is open-ended editorial work that's hard to scope tight without scope creep.
- **Confidence**: 0.90
- **Assumptions**:
  - `scripts/copy-schemas.js` continues to be the canonical place to copy non-TS assets into `dist/`.
  - `dist/cli/commands/*.js` is the post-build location for command files (i.e., `import.meta.url`-relative path resolution to `dist/AGENTS_README.md` is `../../AGENTS_README.md`).
  - `ErrorCodes.README_NOT_FOUND = 'E160'` is the next free code (E150 = DEAF_PEER from plan 012; E160 is the next round number).
  - The companion-mode coverage in `docs/how/companion-mode.md` (just shipped) is the source of truth — the README expansion summarises it, doesn't duplicate it.
- **Dependencies**: none.
- **Risks**:
  - **README rewrite scope creep** — easy to over-edit other sections "while we're here". Mitigated by an explicit non-goal: only `## Companion mode` is touched in this plan.
  - **Version drift between README and how-doc** — once the README has substantial companion content, the two could diverge. Mitigated by treating the how-doc as the deeper-reference and the README as the summary; both link to each other; future plan touches both together if companion behaviour changes.
  - **`dist/` path resolution differs across Node versions or symlinked installs** — `import.meta.url` is the standard ESM pattern; `npx` symlinking is handled via `fileURLToPath`. Mitigated by an integration test that runs `npx minih agent-readme | head -1` from a `pack`+`install` smoke.
  - **Bundle size growth** — `AGENTS_README.md` is ~30 KB; doubling it would still leave the package small. Acceptable.
- **Phases**: single implementation phase (Simple Mode). T-tasks roughly: README expansion → command file → error code → build script → help signpost → tests → npm-pack smoke → fft.

## Acceptance Criteria

### CLI surface

1. `minih agent-readme` (no flags, no args) exits 0 and writes the contents of the bundled `AGENTS_README.md` to stdout, byte-for-byte, with the file's trailing newline preserved.
2. Stdout output is raw markdown — NOT a JSON envelope. Specifically: stdout starts with `# Minih Agents Quick Reference` (or whatever the README's H1 is) on the first non-empty line; it does NOT start with `{`.
3. Stderr is empty on success.
4. `minih agent-readme | head -1` exits 0 (SIGPIPE handled silently); the head command receives the README's first line.
5. `minih agent-readme | wc -c` returns a byte count matching the bundled `AGENTS_README.md` file size exactly.

### Discoverability

6. `minih --help` includes `agent-readme` in the alphabetical Commands list with a one-line description identifying it as the bundled-docs dump.
7. `minih --help` postscript footer includes the line `or run: minih agent-readme` adjacent to the existing `Docs: https://...` link.
8. `minih agent-readme --help` shows the command's description and explicitly notes the raw-markdown deviation from the JSON-envelope rule.

### Bundle

9. After `npm run build`, `dist/AGENTS_README.md` exists and is byte-identical to the repo-root `AGENTS_README.md`.
10. `npm pack` (dry-run or actual) includes `dist/AGENTS_README.md` in the published tarball.
11. `npx minih agent-readme` (or equivalent invocation through the published bin) works after a clean install — the binary resolves the bundled doc relative to `import.meta.url`, not relative to the user's CWD.

### Error path

12. When `dist/AGENTS_README.md` is missing (simulated by deleting it after build), `minih agent-readme` exits 1 and writes a JSON error envelope to stderr containing `error.code: 'E160'`, a human-readable `message`, and `details.expectedPath` pointing at the resolved-but-missing path.
13. In the error case, stdout is empty (no partial markdown).

### Companion-mode coverage in AGENTS_README

14. `AGENTS_README.md` has a `## Companion mode` top-level section (promoted from the current sub-subsection) covering at minimum:
    - **What companion mode is** — long-lived watcher pattern, vs one-shot agents.
    - **When to use it** — review, audit, watcher use cases.
    - **The Power On Mode protocol** — boot → brief → review-at-each-commit → drain → control:stop → read-farewell. Brief but with one concrete shell example per phase.
    - **Control signals** — `control: stop` (with body `^stop\b` regex), brief mention of future `control: drain`.
    - **Farewell envelope shape** — pointer to the schema + a JSON snippet showing the canonical `{ session, findings[], summary, retrospective }` shape.
    - **Pairing with `wait_for_any`** — companions can long-poll on inbox + state with one call (plan 014 reference).
    - **The key rule** (already documented): always send `control:stop` and read the farewell BEFORE reporting back to your operator.
    - **Pointer to** `docs/how/companion-mode.md` for the full runbook.
    - **Pointer to** `agents/code-review-companion/` as the canonical implementation.
15. The expanded section is self-contained enough that an agent dumping the README via `agent-readme` and reading only that section (no GitHub access) can implement a working companion.
16. The expanded section is consistent with `docs/how/companion-mode.md` — same vocabulary, no contradictions on protocol details, same key rule wording.

### Convention preservation

17. No existing CLI verb behaves differently after this change (no regression on `run`, `list`, `outside`, `inside`, `state`, `retros`, `connect`, `history`, `inspect`, `validate`, `last-run`, `status`, `tail`, `doctor`, `difficulties`, `check`, `init`, `harvest`, `quickstart`, `resume`).
18. `package.json` `files` array is unchanged (`["dist", "LICENSE"]`) — the README ships via `dist/`, not as a sibling of `dist/`.
19. `just fft` passes (lint, format, build, typecheck, tests, audit).
20. Domain history rows added to `docs/domains/cli/domain.md` referencing plan 015.

## Risks & Assumptions

- **Scope creep on the README rewrite**: editorial work attracts "while we're here" edits. **Mitigation**: implementation task explicitly limits the touch to `## Companion mode`. PR diff for the README should show changes confined to one section + footer signpost; companion review must call out any unrelated edits as drift.
- **Path resolution under symlinked `npx` installs**: `import.meta.url` returns the realpath of the symlinked binary on most Node versions, but edge cases exist (e.g., older npm symlink behaviour). **Mitigation**: integration test does a `npm pack` → `npm install -g <tarball>` → `npx minih agent-readme | head` smoke check (or a tmpdir equivalent that doesn't pollute global). If the smoke fails on any supported Node version, escalate to a workshop on package layout.
- **`AGENTS_README.md` doubles in size, hurts npm install speed**: very small risk; markdown is highly compressible and the file is ~30 KB now, expanding to maybe ~50 KB. **Mitigation**: none needed.
- **Drift between README and how-doc going forward**: future plans that change companion behaviour must touch both. **Mitigation**: doc-drift sweep clause in `agents/code-review-companion/prompt.md` § 6a (already shipped — covers preamble × 3 and AGENTS_README explicitly).
- **`E160` may collide with a future error code**: `E150` is the latest; `E160` is the next round number. Mitigation: pre-allocate by editing `src/cli/output.ts` first, before any other plan.
- **Assumption**: workshop O1 (`agent-readme <topic>` for how-docs) genuinely is YAGNI for v1. If usage shows the gap quickly, that's a small future plan, not a re-architecture.

## Open Questions

None blocking — workshop resolved the design questions; the README expansion is editorial and bounded by the locked depth target (Option B — self-contained walkthrough, see Clarifications).

## Clarifications

### Session 2026-04-30

- **Q (companion-mode depth)**: How deep should the README's `## Companion mode` section go?
  **A**: Option B — **self-contained walkthrough** so README readers don't need GitHub access to implement a working companion. The expanded section duplicates the structural content of `docs/how/companion-mode.md` (with appropriate prose adaptation), not just summary + pointer. The how-doc remains the deeper-reference + canonical implementation pointer; the README is now first-class enough to ship without it. AC-15 holds: an agent reading only the dumped README can implement and operate a companion correctly. Drift control: `docs/project-rules/idioms.md` (or equivalent) gains a note that companion behaviour changes must touch BOTH files; companion review's § 6a drift-sweep clause already covers this surface.
- **Q (npm pack smoke test in scope?)**: AC-10/11 reference `npm pack` and clean-install verification. Is that needed?
  **A**: NOT in scope for v1 — too heavy for CS-2. Replace with a vitest-level integration test that resolves `dist/AGENTS_README.md` via the same `import.meta.url` pattern the command uses, asserts byte-equal to the source `AGENTS_README.md`, and asserts the bundled file size is non-zero. AC-10 and AC-11 reworded accordingly (see Acceptance Criteria diffs below). The full `npm pack` + global install flow becomes a follow-up if symlink edge cases ever surface in practice.
- **Mode**: Pre-set to Simple in spec header; no Q1 needed.
- **Testing Strategy**: Lightweight (default for Simple+CS-2). Settlement-of-AC pattern.
- **Mock Usage**: Project default — avoid mocks (real fs + tmpdir + execFileSync against built dist).
- **Documentation Strategy**: The README expansion IS the documentation deliverable (Stream 2). Plus `--help` text edits. No new how-doc in this plan.
- **Domain Review**: Confirmed — `cli` (modify: new tool + error code), `docs` (modify: README expansion), `build` (modify: copy-schemas.js one-line addition). No new domain.
- **Harness Readiness**: Existing minih harness (`just fft`) sufficient.

## Testing Strategy

**Approach**: Lightweight (per Simple Mode + CS-2 + clarification).

**Rationale**: The command is a small file-read-and-stdout-write. The bundle path is one line of build script + one path-resolution test. The README expansion is editorial — covered by structural assertions (presence of subsections by anchor) plus a consistency test diff against `docs/how/companion-mode.md`. No need for full TDD cycles or cross-platform integration coverage.

**Focus Areas**:
- Unit + integration tests over the built `dist/` (real `node dist/cli/index.js`):
  - `agent-readme` exits 0, stdout starts with the README's H1 line, byte count matches `dist/AGENTS_README.md`
  - `agent-readme | head -1` exits 0 (SIGPIPE handled)
  - `agent-readme` with `dist/AGENTS_README.md` deleted → exits 1, stderr is a parseable error envelope with `error.code: 'E160'`
- Schema/structure tests over `AGENTS_README.md`:
  - `## Companion mode` H2 section exists
  - Subsections exist by name (What companion mode is, When to use, Power On Mode protocol, Control signals, Farewell envelope, Pairing with wait_for_any, Key rule, Pointers)
  - Section length within bounds (e.g., > 100 lines so we know it's expanded; < 1000 lines so we know it didn't drift into a full guide)
- Build-script test:
  - Run `npm run build`, assert `dist/AGENTS_README.md` exists and is byte-identical to the repo-root file
- Help-text tests:
  - `node dist/cli/index.js --help` output contains `agent-readme` in commands list AND `or run: minih agent-readme` in footer
  - `node dist/cli/index.js agent-readme --help` mentions raw-markdown deviation
- No-regression sweep: `just fft` is the gate (covers AC-17, AC-19, AC-20).

**Excluded**:
- No `npm pack` + global install smoke — replaced with vitest-level dist/-resolution test (per clarification).
- No e2e companion-orchestrated test — the README content is asserted structurally, not by running a companion.
- No mocks; real fs + tmpdir + child_process.execFileSync.

## Acceptance Criteria

### CLI surface

1. `minih agent-readme` (no flags, no args) exits 0 and writes the contents of the bundled `AGENTS_README.md` to stdout, byte-for-byte, with the file's trailing newline preserved.
2. Stdout output is raw markdown — NOT a JSON envelope. Specifically: stdout starts with `# Minih Agents Quick Reference` (or whatever the README's H1 is) on the first non-empty line; it does NOT start with `{`.
3. Stderr is empty on success.
4. `minih agent-readme | head -1` exits 0 (SIGPIPE handled silently); the head command receives the README's first line.
5. `minih agent-readme | wc -c` returns a byte count matching the bundled `AGENTS_README.md` file size exactly.

### Discoverability

6. `minih --help` includes `agent-readme` in the alphabetical Commands list with a one-line description identifying it as the bundled-docs dump.
7. `minih --help` postscript footer includes the line `or run: minih agent-readme` adjacent to the existing `Docs: https://...` link.
8. `minih agent-readme --help` shows the command's description and explicitly notes the raw-markdown deviation from the JSON-envelope rule.

### Bundle

9. After `npm run build`, `dist/AGENTS_README.md` exists and is byte-identical to the repo-root `AGENTS_README.md`.
10. A vitest-level integration test resolves `dist/AGENTS_README.md` via the same `import.meta.url` pattern the command uses, and asserts byte-equal to the source file. (Reworded from npm-pack-style smoke per Clarifications.)
11. The runtime path resolution in `agent-readme.ts` lands at `dist/AGENTS_README.md` after build — verified by reading the resolved path in a test that exercises the command's resolution code path. (Reworded from clean-install smoke per Clarifications.)

### Error path

12. When `dist/AGENTS_README.md` is missing (simulated by deleting it after build), `minih agent-readme` exits 1 and writes a JSON error envelope to stderr containing `error.code: 'E160'`, a human-readable `message`, and `details.expectedPath` pointing at the resolved-but-missing path.
13. In the error case, stdout is empty (no partial markdown).

### Companion-mode coverage in AGENTS_README (Option B — self-contained walkthrough)

14. `AGENTS_README.md` has a `## Companion mode` top-level (H2) section (promoted from the current sub-subsection) covering:
    - **What companion mode is** — long-lived watcher pattern, vs one-shot agents.
    - **When to use it** — review, audit, watcher use cases.
    - **The Power On Mode protocol** — boot → brief → review-at-each-commit → drain → control:stop → read-farewell. With one concrete shell snippet per phase showing the exact commands an operator runs.
    - **Control signals** — `control: stop` (with body `^stop\b` regex), brief mention of future `control: drain`.
    - **Farewell envelope shape** — JSON snippet showing the canonical `{ session, findings[], summary, retrospective }` shape with field-by-field annotations.
    - **Pairing with `wait_for_any`** — companions can long-poll on inbox + state with one call (plan 014 reference + worked example).
    - **The key rule** — always send `control:stop` and read the farewell BEFORE reporting back to your operator.
    - **Pointer to** `docs/how/companion-mode.md` for the full runbook.
    - **Pointer to** `agents/code-review-companion/` as the canonical implementation.
15. The expanded section is **self-contained**: an agent dumping the README via `agent-readme` and reading only that section (no GitHub access, no other docs) can implement a working companion correctly. Operationally: section length ≥ 100 lines and contains at least one shell snippet for every protocol phase.
16. The expanded section is consistent with `docs/how/companion-mode.md` — same vocabulary, no contradictions on protocol details, same key rule wording. Verified by an idiom-level cross-doc consistency check during implementation (manual diff sweep).

### Convention preservation

17. No existing CLI verb behaves differently after this change (no regression on `run`, `list`, `outside`, `inside`, `state`, `retros`, `connect`, `history`, `inspect`, `validate`, `last-run`, `status`, `tail`, `doctor`, `difficulties`, `check`, `init`, `harvest`, `quickstart`, `resume`).
18. `package.json` `files` array is unchanged (`["dist", "LICENSE"]`) — the README ships via `dist/`, not as a sibling of `dist/`.
19. `just fft` passes (lint, format, build, typecheck, tests, audit).
20. Domain history rows added to `docs/domains/cli/domain.md` referencing plan 015.

---

**Next step**: `/plan-2-v2-clarify` for ≤8 high-impact questions before architecture (probably 1–2 questions: test scope + README detail level), or skip and go straight to `/plan-3-v2-architect` if confident — workshop covers the technical surface and the README expansion is bounded by the current how-doc content.

## Workshop Opportunities

| Topic | Type | Why Workshop | Key Questions |
|-------|------|--------------|---------------|
| _(none — workshop 001 is the authoritative design source; clarifications resolved depth + test scope)_ | — | — | — |

---

**Next step**: `/plan-3-v2-architect`.
