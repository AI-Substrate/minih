# `agent-readme` Command + Companion Coverage Implementation Plan

**Mode**: Simple
**Plan Version**: 1.0.0
**Created**: 2026-04-30
**Spec**: [agent-readme-command-spec.md](./agent-readme-command-spec.md)
**Workshop**: [workshops/001-cli-flow-and-bundle.md](./workshops/001-cli-flow-and-bundle.md)
**Status**: DRAFT

## Summary

Ship a `minih agent-readme` CLI verb that dumps the bundled `AGENTS_README.md` to stdout (raw markdown — deliberate deviation from the JSON-envelope rule, documented in `--help`). Bundle the doc into the npm package via a one-line addition to `scripts/copy-schemas.js`. Signpost the verb from `--help`. Second goal in the same plan: expand the README's `## Companion mode` section into a self-contained walkthrough so agents reading the dumped content can implement and operate companions correctly without GitHub access.

## Target Domains

| Domain | Status | Relationship | Role |
|--------|--------|-------------|------|
| cli | existing | **modify** | New `agent-readme` subcommand at `src/cli/commands/agent-readme.ts`; new error code `E160 README_NOT_FOUND` in `src/cli/output.ts`; `--help` postscript edit in `src/cli/index.ts`. |
| docs | existing | **modify** | `AGENTS_README.md`'s thin `### Companion mode` subsection (currently ~7 lines under § Coordination) is promoted to a top-level `## Companion mode` section with a self-contained walkthrough. |
| build | existing | **modify** | `scripts/copy-schemas.js` gains a one-line copy of repo-root `AGENTS_README.md` → `dist/AGENTS_README.md`. |

No new domain. No new contract category. No domain registry or domain map change.

## Domain Manifest

| File | Domain | Classification | Rationale |
|------|--------|---------------|-----------|
| `/Users/jordanknight/substrate/minih/src/cli/commands/agent-readme.ts` | cli | internal | NEW. The command handler: resolve bundled doc path via `import.meta.url`; if found, write bytes to stdout (with SIGPIPE silenced); if missing, write JSON error envelope to stderr + exit 1. |
| `/Users/jordanknight/substrate/minih/src/cli/output.ts` | cli | contract | Add `README_NOT_FOUND: 'E160'` to the `ErrorCodes` const. |
| `/Users/jordanknight/substrate/minih/src/cli/index.ts` | cli | internal | Register the new command via `registerAgentReadmeCommand(program)`; update the `addHelpText('after', ...)` postscript to add `or run: minih agent-readme`. |
| `/Users/jordanknight/substrate/minih/scripts/copy-schemas.js` | build | internal | One-line `copyFileSync('AGENTS_README.md', 'dist/AGENTS_README.md')` addition. |
| `/Users/jordanknight/substrate/minih/AGENTS_README.md` | docs | internal | Promote `### Companion mode` (currently inside § Coordination) to a top-level `## Companion mode` section; expand to self-contained walkthrough per AC-14/15. |
| `/Users/jordanknight/substrate/minih/test/cli/agent-readme.test.ts` | cli (test) | internal | NEW. **Single home for all plan-015 test cases**: command behaviour (success / SIGPIPE / missing-doc), help-text (commands list + footer signpost + own --help description), build-bundle byte-equality, README content structure. Sub-describes per concern. |
| `/Users/jordanknight/substrate/minih/docs/domains/cli/domain.md` | cli | internal | History row referencing plan 015. |

## Key Findings

| # | Impact | Finding | Action |
|---|--------|---------|--------|
| 01 | High | `AGENTS_README.md` H1 is `# Building Agents with minih` (verified line 1), NOT `# Minih Agents Quick Reference` as the spec assumed at AC-2. | Fix AC-2 wording at implementation time: assert stdout's first non-empty line is `# Building Agents with minih`, not the speculative title. |
| 02 | High | `src/cli/output.ts` `ErrorCodes` last entry is `DEAF_PEER: 'E150'`. `E160` is unallocated and is the next round number per project convention. | Add `README_NOT_FOUND: 'E160'` as planned. |
| 03 | High | `scripts/copy-schemas.js` already uses `copyFileSync` and `join` from `node:path` for schema copies. The one-line addition is structurally trivial: `copyFileSync('AGENTS_README.md', 'dist/AGENTS_README.md')`. | Reuse existing imports; no new dependencies. |
| 04 | Medium | The `agent-readme` command file lives at `dist/cli/commands/agent-readme.js` post-build; `dist/AGENTS_README.md` is at `dist/AGENTS_README.md`. The relative path from command to README is `../../AGENTS_README.md` (up two dirs: `commands/` → `cli/` → `dist/`). | Use `path.resolve(fileURLToPath(import.meta.url), '..', '..', '..', 'AGENTS_README.md')` — three `..` because the file resolves to `dist/cli/commands/agent-readme.js` and we need `dist/AGENTS_README.md`. **Verify the count at implementation by inspecting the post-build file location.** |
| 05 | Medium | The current `### Companion mode` subsection sits inside `## Coordination` (around line 450). Promoting to H2 means moving it OUT of the coordination subsection. The current sibling `### Reply chains` (plan 013) and `### Wait for any` (plan 014) stay inside coordination. | Re-anchor: insert new `## Companion mode` H2 AFTER the `## Coordination` section block ends, not inside it. Remove the current 7-line `### Companion mode` subsection from inside coordination to avoid duplication. |
| 06 | Medium | `docs/how/companion-mode.md` (~250 lines) is the source of truth for the README expansion. Per spec's drift-control note, both files must stay in sync; companion review's § 6a clause already covers this surface. | Author the expanded README section by **summarising** the how-doc, not copy-pasting it verbatim. Cross-link both ways. The companion review will catch wording drift between the two if it slips. |
| 07 | Low | Existing CLI commands all use the JSON-envelope output convention. `agent-readme` deviates by design (raw markdown to stdout). | Document the deviation in (a) the command's own `--help` description, (b) the new `## Companion mode` section's "key rule" sub-bullet if relevant (it isn't directly), and (c) a one-line note in the program-level `--help` postscript. |
| 08 | Low | SIGPIPE handling pattern is `process.stdout.on('error', err => { if (err.code === 'EPIPE') process.exit(0); throw err; })`. Standard Node CLI idiom; not currently used elsewhere in this repo. | Add to `agent-readme.ts` only; don't generalise to other commands in this plan. |
| 09 | Low | The README expansion is the primary scope-creep risk per spec's risk section. | Implementation task explicitly limits the README diff to the `## Companion mode` section + the `### Companion mode` subsection removal under `## Coordination`. PR diff should show no other touched lines in `AGENTS_README.md`. |
| 10 | Low | Test for byte-equality of `dist/AGENTS_README.md` and source needs the build to have run. | Test file uses `npm run build` is assumed-already-run (other tests in this repo follow the same pattern); CI invokes `npm run build` before `vitest`. |

## Harness Strategy

Existing minih harness (`just fft`) sufficient. No harness work required. Per-phase validation = `just fft` plus the new test files in this plan.

## Implementation

**Objective**: Ship `agent-readme` end-to-end (command + bundle + signpost + error path) AND expand the README's companion-mode coverage into a self-contained walkthrough.

**Testing Approach**: Lightweight (per spec).
- Integration tests via `execFileSync` against the built `dist/cli/index.js` for command behaviour.
- Structural tests over `AGENTS_README.md` for the content expansion (presence + length bounds).
- Byte-equality test for the bundle copy.
- `just fft` is the gate.

### Tasks

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|--------|-----|------|--------|---------|-----------|-------|
| [ ] | T001 | Add `README_NOT_FOUND: 'E160'` to `ErrorCodes` const in `src/cli/output.ts`. Re-export through the existing barrel. | cli | `/Users/jordanknight/substrate/minih/src/cli/output.ts` | `ErrorCodes.README_NOT_FOUND === 'E160'` resolves and is exported. | Per finding 02. |
| [ ] | T002 | Implement `src/cli/commands/agent-readme.ts`. Resolve bundled doc path via `path.resolve(fileURLToPath(import.meta.url), '..', '..', '..', 'AGENTS_README.md')`; verify post-build placement before settling on the `..`-count. SIGPIPE handler at the top of the action; `fs.existsSync` check; `fs.readFileSync` + `process.stdout.write(buffer)` on success; `formatError(...)` JSON envelope to stderr + `process.exit(1)` on missing. Export `registerAgentReadmeCommand(program: Command)`. The Commander description must explicitly note "raw markdown — does NOT use the JSON envelope." | cli | `/Users/jordanknight/substrate/minih/src/cli/commands/agent-readme.ts` | File compiles; description text mentions raw-markdown deviation; post-build path resolution lands at `dist/AGENTS_README.md`. | Per findings 04, 07, 08. |
| [ ] | T003 | Wire the new command into `src/cli/index.ts`: import and call `registerAgentReadmeCommand(program)` alongside the existing command registrations. Update the existing `addHelpText('after', ...)` postscript to append `or run: minih agent-readme` on a new indented line under the `Docs:` URL. | cli | `/Users/jordanknight/substrate/minih/src/cli/index.ts` | `node dist/cli/index.js --help` lists `agent-readme` and footer contains `or run: minih agent-readme`. | |
| [ ] | T004 | Add one line to `scripts/copy-schemas.js` after the existing schema copies: `copyFileSync('AGENTS_README.md', 'dist/AGENTS_README.md')`. Use the existing `copyFileSync` import. | build | `/Users/jordanknight/substrate/minih/scripts/copy-schemas.js` | After `npm run build`, `dist/AGENTS_README.md` exists and is byte-identical to the repo-root file. | Per finding 03. |
| [ ] | T005 | Promote `AGENTS_README.md`'s `### Companion mode` subsection (currently inside `## Coordination`, ~7 lines) into a NEW top-level `## Companion mode` section AFTER the `## Coordination` block ends. **Remove** the current 7-line subsection to avoid duplication. The new H2 section covers the eight content elements from AC-14 (what / when / Power On Mode protocol with shell snippets / control signals / farewell envelope JSON snippet / wait_for_any pairing / key rule / pointers). Section length must be ≥100 lines and <1000 lines. Source-of-truth = `docs/how/companion-mode.md` — summarise, don't paste verbatim. | docs | `/Users/jordanknight/substrate/minih/AGENTS_README.md` | New `## Companion mode` H2 present after `## Coordination`. Old subsection removed. Length within bounds. Cross-link both ways with the how-doc. | Per findings 05, 06, 09. |
| [ ] | T006 | Write all plan-015 tests in a single new file `test/cli/agent-readme.test.ts` using `execFileSync` against the built CLI. **Sub-describe blocks for separation:**<br>(a) `command behaviour` — exits 0 + stdout starts with `# Building Agents with minih` + byte count matches `dist/AGENTS_README.md`; SIGPIPE silenced for `\| head -1`; missing-doc returns exit 1 + JSON envelope on stderr with `error.code: 'E160'` and `details.expectedPath` populated; restore the file after the negative test.<br>(b) `help signposting` — `node dist/cli/index.js --help` stdout includes `agent-readme` line in commands list AND footer contains `or run: minih agent-readme`; `node dist/cli/index.js agent-readme --help` mentions raw-markdown deviation.<br>(c) `bundle byte-equality` — reads both `AGENTS_README.md` and `dist/AGENTS_README.md` and asserts byte-identical; skip with informative message if `dist/` doesn't exist.<br>(d) `README companion section structure` — `## Companion mode` H2 exists exactly once; required subsection markers present (`What companion mode is`, `When to use`, `Power On Mode protocol`, `Control signals`, `Farewell envelope`, `Pairing with`, `Key rule` — implementation has authorial latitude on exact phrasing); section length ≥100 lines and <1000 lines; ≥1 fenced code block per protocol phase keyword (`boot`, `brief`, `review`, `stop`). | cli (test) | `/Users/jordanknight/substrate/minih/test/cli/agent-readme.test.ts` | All four sub-describes pass; covers ACs 1-15. AC-16 (consistency with how-doc) verified by manual diff sweep at implementation, not test. | Per finding 01 (correct H1 text), finding 10 (build assumed run before test). Single test file is the right home — see plan-4 validation record below for why. |
| [ ] | T007 | Append a history row to `docs/domains/cli/domain.md` referencing plan 015. One-line summary describing: new `agent-readme` subcommand, new `E160 README_NOT_FOUND` error code, `--help` postscript signpost, build-script copy, README expansion. | cli | `/Users/jordanknight/substrate/minih/docs/domains/cli/domain.md` | History row present; row references plan 015 explicitly. | Covers AC-20. |
| [ ] | T008 | Run `just fft`. Fix any lint/format/typecheck/test/audit findings as ours, no deferrals. | all | repo root | `just fft` passes end-to-end. | Covers ACs 17-19. Project rule: own every finding. |

### Acceptance Criteria

Direct mapping from spec:

- [ ] AC-1 (`agent-readme` exits 0 + dumps README) — T002, T006(a)
- [ ] AC-2 (raw markdown, starts with `# Building Agents with minih`, NOT `{`) — T002, T006(a) (corrected per finding 01)
- [ ] AC-3 (stderr empty on success) — T006(a)
- [ ] AC-4 (SIGPIPE silenced for `| head -1`) — T002, T006(a)
- [ ] AC-5 (byte count matches) — T006(a)
- [ ] AC-6 (`--help` lists agent-readme) — T003, T006(b)
- [ ] AC-7 (footer signpost) — T003, T006(b)
- [ ] AC-8 (own `--help` mentions raw-markdown deviation) — T002, T006(b)
- [ ] AC-9 (post-build `dist/AGENTS_README.md` byte-identical) — T004, T006(c)
- [ ] AC-10 (vitest dist/-resolution test) — T006(c)
- [ ] AC-11 (runtime path lands at `dist/AGENTS_README.md`) — T002, T006(a)
- [ ] AC-12 (missing-doc → E160 envelope on stderr, exit 1) — T002, T006(a)
- [ ] AC-13 (error case stdout empty) — T006(a)
- [ ] AC-14 (`## Companion mode` H2 with required subsections) — T005, T006(d)
- [ ] AC-15 (self-contained: ≥100 lines, shell snippet per phase) — T005, T006(d)
- [ ] AC-16 (consistency with how-doc) — T005 (manual diff sweep)
- [ ] AC-17 (no regression on existing verbs) — T008 (full suite)
- [ ] AC-18 (`package.json files` unchanged) — T008 (lockstep — implementation must NOT modify it)
- [ ] AC-19 (`just fft` passes) — T008
- [ ] AC-20 (domain history row) — T007

### Implementation Order Notes

Suggested order: T001 → T002 → T003 → T004 → (now `npm run build` succeeds and `dist/AGENTS_README.md` exists) → T006(a)+(b)+(c) → T005 → T006(d) → T007 → T008. Reasoning:
- T001-T004 are the **shippable code path** in dependency order: error code → command → wiring → bundle.
- T006 sub-describes (a), (b), (c) verify the code path before we touch the README.
- T005 is the **editorial work** — kept toward the end because it's open-ended and easiest to scope-creep.
- T006(d) verifies T005 structurally.
- T007 + T008 are end-of-phase.

Companion review pings at every commit boundary per Power On Mode (now formalised in `docs/how/companion-mode.md`).

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| T002 path-resolution `..`-count wrong, command resolves to a non-existent path | Medium | Low | Verify post-build placement empirically before committing T002; integration test (T006) catches it on first run |
| T005 README expansion drifts beyond the locked depth (>1000 lines) or under-delivers (<100 lines) | Medium | Low | Length bounds in T008 are mechanical guards; companion review's § 6a drift sweep catches editorial drift between README and how-doc |
| T005 modifies AGENTS_README sections OTHER than the companion section | Low | Medium | T005 is explicitly scoped to two diff sites: new H2 insertion + old subsection removal. PR diff shape: only those two regions touched. Companion review verifies. |
| T007 breaks an existing `--help` snapshot test | Medium | Low | Project rule: own every finding. Update snapshot in the same commit; flag in commit message. |
| `dist/cli/commands/agent-readme.js` post-build location differs from expectation | Low | Medium | Test file lookup is empirical, not assumed; T002 verifies the exact `..`-count works at build time |
| `process.stdout.write(Buffer)` writes async and the process exits before draining | Low | Medium | Node 18+ flushes stdout on normal exit; explicit `await once(process.stdout, 'drain')` only if test surfaces a race. Standard CLI dump pattern. |
| Bundle adds ~30+ KB to install size | Very low | Very low | Acceptable; markdown is small. |

---

**Validation Record**

### plan-4-v2-complete-the-plan — 2026-04-30

| Validator | Status | HIGH | MED | LOW |
|---|---|---|---|---|
| Structure | PASS | 0 | 0 | 0 |
| Testing Alignment | FIXED | 0 (was 3) | 0 | 0 |
| Domain Completeness | PASS | 0 | 0 | 0 |
| Doctrine | PASS | 0 | 0 | 0 |
| ADR | N/A | — | — | — |

**HIGH (3, all fixed)**: Original plan placed tests in `test/build/`, `test/docs/`, and a new `test/cli/help-signpost.test.ts` — none of those directories/files exist, and the repo convention is `test/{adapter,cli,e2e,mcp,runner}/`. Fix: consolidate ALL plan-015 test cases into a single new file `test/cli/agent-readme.test.ts` with sub-describes per concern (command behaviour, help-text, bundle byte-equality, README structure). Saves 3 new test files, 2 new top-level dirs, and matches existing conventions. Net task count drops from T001-T011 to T001-T008.

**Verdict**: READY (after fix).

---

## Validation Record (2026-04-30) — validate-v2 (narrow inline)

| Agent | Lenses Covered | Issues | Verdict |
|---|---|---|---|
| Source Truth (inline) | Accuracy, Concept Documentation | 0 | ✅ |
| Cross-Reference (inline) | Cross-Reference, Hidden Assumptions | 1 LOW (cosmetic) | ✅ |
| Forward-Compatibility (inline) | Forward-Compatibility, System Behavior, Edge Cases | 0 | ✅ |

**Lens coverage**: 8/12 — above the 8-floor for narrow scope on CS-2 Simple plan.

### Forward-Compatibility Matrix

| Consumer | Requirement | Failure Mode | Verdict | Evidence |
|---|---|---|---|---|
| `/plan-6` implementor | Unambiguous file paths + done-when criteria | encapsulation lockout | ✅ | All 8 tasks list absolute paths; T002 explicitly flags `..`-count for empirical verification |
| Workshop 001 design | Raw-markdown deviation locked + signposted | contract drift | ✅ | AC-2 + AC-8 + T002 description text all reference the deviation; T003 wires the `--help` postscript |
| Plan 014 (wait_for_any) | inbox/state APIs unchanged | contract drift | ✅ | No coordination/runner/mcp files in domain manifest |
| Plan 013 (reply chains) | Inbox semantics unchanged | contract drift | ✅ | No coordination files touched |
| Future `agent-readme <topic>` | Bundle pattern extensible to how-docs | shape mismatch | ✅ | `dist/AGENTS_README.md` v1 → `dist/docs/how/*.md` v2 via same `copyFileSync` mechanism |
| Companion review (Power On Mode) | Reviewable in commit-sized chunks | test boundary | ✅ | T001-T008 each map cleanly to one logical commit; T005 (editorial) isolated late so review focuses on it independently |

**Outcome alignment**: The plan, as shipped, advances the Outcome — T001-T004 ship the verb that lets agents on any project read the bundled doc without internet; T005 ensures the dumped doc actually answers companion-mode questions self-contained (per AC-15); T006(d) structurally gates the editorial expansion; T007 records the change in domain history. Together they make canonical agent-facing docs locally accessible on any project that has minih installed.

**Standalone?**: No — `/plan-6` implementor + workshop 001 design are named upstream/downstream consumers.

### Issues
| Sev | Lens | Issue | Action |
|---|---|---|---|
| LOW | Cross-Reference | Plan-4 validation record sentence "Net task count drops from T001-T011 to T001-T008" reads as past-tense history rather than current state. Cosmetic. | Leave alone or tighten at implementation. |

**Overall**: ✅ VALIDATED — no fixes needed beyond plan-4 corrections (test paths) already applied. Ready for `/plan-6-v2-implement-phase`.

---

**Next steps**:
- Optional: `/plan-4-complete-the-plan` for validation
- Implement: `/plan-6-v2-implement-phase --plan "/Users/jordanknight/substrate/minih/docs/plans/015-agent-readme-command/agent-readme-command-plan.md"`
