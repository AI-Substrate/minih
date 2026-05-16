# FX001 — Schema Location Pivot (state/ → root)

**Plan**: [021-coordinated-install-resilience](../coordinated-install-resilience-plan.md)
**Status**: **Executing** — § 5 steps 1-7a complete (2026-05-16); commit pending; companion second-eyes pass scheduled for commit boundary

## 10. Execution evidence (FX001 step 1-7a complete; awaiting step 8-9 commit)

- `git mv agents/code-review-companion/state/inside-state.schema.json agents/code-review-companion/inside-state.schema.json` — done
- `mv agents/code-review-companion/state/outside-state.schema.json agents/code-review-companion/outside-state.schema.json` — done
- `rmdir agents/code-review-companion/state` — done
- `agents/code-review-companion/agent.json` updated to 7 root-level paths, version `0.2.0` — done
- `validateManifest()` now accepts the manifest: `npx vitest run test/runner/agent-pack/companion-manifest.test.ts` → 8/9 pass; only failure is the `version='0.1.0'` assertion (explicit T002 work) — done
- Spec ACs 1, 4, 6, 12 updated with root-path text + FX001 cross-references — done
- Plan T001/T003/T004/T005 updated (T003 collapsed to docs-only with semantic-flip note: root is canonical, `state/` is back-compat) — done
- Docs drift grep audit: **1 operational hit found** at `src/templates/shared-preamble.md:221` and its mirror `agents/_shared/preamble.md:221` (the load-bearing twin pair per `code-review-companion/prompt.md § 6a`). Both updated to explain both valid schema locations + install-manifest constraint. All other hits (22 in `docs/plans/009-human-agent-view/` + `docs/plans/016-a2a-companion-protocol/`) are archive plan dossiers — not rewritten (would be history-revision) — done
- `execution.log.md` updated with full FX001 narrative + 2 new discoveries (D3 architecture, D4 companion lifecycle) — done

### Outstanding work for FX001 to be considered DONE

- Step 8 (commit): land as `fix(021): pivot schema location from state/ to agent root (FX001)`.
- Step 9 (companion ping): send review-request for the commit SHA so the second-eyes pass happens.
- T002 will assert the new file count + version inside its own commit (per the workstream-revertable design).

### Honest residual risk

- I did not run the full `npx vitest run test/runner/agent-pack/` (only the companion-manifest test). Other install-related tests may have implicit assumptions about schema location — specifically `install.test.ts` might have fixtures referencing `state/` paths. T002+T004 cover this; if a surprise lands there, capture it as a sub-finding under T002.
**Filed**: 2026-05-16 (during T001 implementation)
**Scope**: Re-scopes T001, T002, T003 and the related spec ACs to ship per-agent state schemas at the agent directory root rather than under `state/`
**Effort**: ~30 min (one file rename, agent.json update, AC text edits, test fixture update) — strictly net-negative complexity vs. the original plan

---

## 1. Trigger

While executing T001 (FX003b authoring — author the missing schemas + outside.md, bump `agent.json` to 0.2.0), `npx vitest run test/runner/agent-pack/companion-manifest.test.ts` failed 5 tests with `manifest invalid`. Root cause: `validateManifest()` in `src/runner/agent-pack/manifest.ts` rejects any file path inside the `state/` directory because `state/` is a member of the `RUNTIME_DIR_NAMES` denylist (alongside `runs/`, `inbox/`, `.git/`).

```ts
// src/runner/agent-pack/manifest.ts:18
export const RUNTIME_DIR_NAMES: readonly string[] = [
  'runs',
  'inbox',
  'state',     // ← blocks state/inside-state.schema.json from manifest
  '.git',
] as const;
```

The denylist was hardened during plan 017 (agent-pack install) as a security-critical guard against path-traversal and runtime-dir overwrites. It is correctly enforced; the bug is that the spec and FX003b dossier both assumed `state/` would be a valid install destination when it cannot be without weakening that guard.

## 2. Why the original spec assumed `state/`

The runtime's MCP `state.ts` tool resolves the inside-state schema via a 3-level fallback (`src/mcp/tools/state.ts:172-191`):

1. `<agentDir>/state/inside-state.schema.json` — "preferred convention, groups state-related files under state/"
2. `<agentDir>/inside-state.schema.json` — legacy fallback (preserves `coordination-loop-validator` and pre-`state/` agents)
3. `DEFAULT_INSIDE_STATE_SCHEMA` — built-in default

The spec authors saw the runtime call `state/` "preferred" and wrote the FX003b deliverables to match. But "preferred" here means *lookup precedence*, not *install destination* — the validator was authored under a separate constraint (deny all writes into runtime directories) and the two concerns were never reconciled.

## 3. Decision

**Ship per-agent state schemas at the agent directory root** (`inside-state.schema.json`, `outside-state.schema.json`), not under `state/`. This matches the existing pattern used by `agents/coordination-loop-validator/`.

### Why option 2 (root) instead of options 1 or 3

Three alternatives were considered (full discussion lives in chat transcript 2026-05-16; codified here for the record):

| Option | Summary | Verdict |
|--------|---------|---------|
| **1. Narrow exemption** in the denylist | Allow exactly `state/inside-state.schema.json` and `state/outside-state.schema.json` through `checkManifestPath()` while keeping arbitrary `state/foo` blocked | **Rejected** — adds a special case to a security-critical check; whitelist-by-exact-filename complicates audit ("why is this path safe?"); benefit is purely cosmetic |
| **2. Schemas at agent root** | Ship both schemas at `<agentDir>/inside-state.schema.json` and `<agentDir>/outside-state.schema.json`; the runtime's level-2 fallback finds them; no validator changes | **CHOSEN** — zero validator changes, zero migration of existing legacy agents, runtime cost is two `fs.existsSync()` syscalls per state mutation (microseconds, zero LLM tokens), matches existing `coordination-loop-validator` convention |
| **3. New `schemas/` subdirectory** | Move per-agent definition files to `schemas/inside-state.schema.json`; update `state.ts` lookup; migrate `demo-companion` + `coordination-loop-validator` | **Deferred** — architecturally cleanest (separates definitional from runtime), but scope creep for this plan; re-opens spec/clarify decisions resolved 2026-05-15; deserves its own spec because the same question applies to all per-agent definition files (input-schema, output-schema, custom validators), not just state schemas |

### Runtime cost of option 2

The runtime cost concern was raised and dismissed: the 3-level fallback in `state.ts` is server-side Node.js code, invisible to the model. Per state mutation it adds **2 `fs.existsSync()` syscalls (microseconds on local disk) and 0 prompt/response tokens**. The cost is at the harness, not the agent.

### Honest downside of option 2

**Convention drift**: half the coordinated agents in this codebase (`demo-companion` already, future authors who copy the canonical companion as a template) will ship at `state/`; the other half (`coordination-loop-validator`, post-FX001 `code-review-companion`) ship at root. Authors reading the codebase will see two patterns and have to know which is current. This is a documentation/onboarding cost, not a runtime cost. **It is the right cost to accept for this PR** because the alternative is scope creep that re-opens settled design questions; a follow-up plan can consolidate.

## 4. Affected artifacts

### Spec acceptance criteria (text-only edits)

- **AC1 (AC-COMPANION-INSTALL-SHIPS-SCHEMA)**: "`state/inside-state.schema.json`" → "`inside-state.schema.json`" and "`state/outside-state.schema.json`" → "`outside-state.schema.json`". Enum stays the same.
- **AC2 (AC-COMPANION-INSTALL-OUTSIDE-MD)**: unchanged (outside.md location was always agent root).
- **AC3 (AC-COMPANION-VERSION-BUMP)**: file count 7 unchanged (the structure shifts but not the count).
- **AC4 (AC-COMPANION-UPGRADE-DETECTION)**: changedFiles set wording updated to reflect root paths.
- **AC6 (AC-IMPLICIT-MANIFEST-SHIPS-STATE-SCHEMAS)**: the "fixture with `state/inside-state.schema.json`" pivots to "fixture with `inside-state.schema.json` at agent root". Rationale: the implicit-manifest gap is independent of where the schemas live — the bug is that `CANONICAL_AGENT_FILES` did not include the per-agent state schemas at all. T003 patches the list to add them at root.
- **AC12 (AC-SCHEMA-DESCRIPTION-ACCURATE)**: the file being edited is now `agents/code-review-companion/inside-state.schema.json`, not `state/inside-state.schema.json`.

### Plan task edits (T001, T002, T003)

- **T001**: paths change from `agents/code-review-companion/state/inside-state.schema.json` → `agents/code-review-companion/inside-state.schema.json` (and same for outside). The currently-on-disk file at `state/inside-state.schema.json` is **moved**, not deleted, so the existing schema content survives. The new `state/outside-state.schema.json` and `outside.md` I authored earlier today move likewise. `agent.json` `files[]` entries change to root paths.
- **T002**: tests reference the new root paths in fixture data; the existing companion-manifest test's "7 files" assertion is unaffected; the upgrade-detection regression test asserts the 3 new files at root paths.
- **T003**: `CANONICAL_AGENT_FILES` in `src/runner/agent-pack/manifest.ts` already includes `inside-state.schema.json` and `outside-state.schema.json` at root (verified: lines 33-37). No code change needed. **T003 becomes documentation-only** — verify that the canonical list is already correct, update test fixtures to use root paths, update the doctor copy in T005 to reference root locations.

### Runtime: no changes needed

- `src/mcp/tools/state.ts` 3-level fallback already finds root-level schemas (level 2). The level-1 `state/` check costs 1 syscall per state op and harms nothing. **Do not remove it** — it preserves the pij agent's workaround (they manually dropped a schema into `state/` and confirmed clean orient flow at run `2026-05-15T16-05-38-307Z-3761`), which we should not invalidate mid-flight. **It also keeps `demo-companion` working unchanged**: that agent ships `state/inside-state.schema.json` in its source tree (not via the install-payload path), and the level-1 fallback finds it as today; nothing about FX001 alters demo-companion's behavior.

### Existing on-disk state to clean up

- `agents/code-review-companion/state/inside-state.schema.json` (existed pre-this-PR; needs to move to root)
- `agents/code-review-companion/state/outside-state.schema.json` (authored earlier today during T001; needs to move to root)
- `agents/code-review-companion/state/` directory itself (removed after files move out)

### Affected tests (enumerated)

The following test files are touched (or potentially touched) by FX001 + the resumed T001/T002/T003 sequence. Listed here so a `just fft` run after FX001 surfaces no surprise failures:

- `test/runner/agent-pack/companion-manifest.test.ts` — path assertions + `version: '0.2.0'` + 7-file count (T002 work).
- `test/runner/agent-pack/install.test.ts` — implicit-manifest fixture pivots to root paths (T004).
- `test/cli/doctor-state-vocabulary.test.ts` — if T005's doctor copy rewrite names schema locations, this test's asserted strings move with it (per MW-003, copy should reference BOTH valid locations).
- `test/cli/agent-list-baseline.test.ts` — the snapshot does NOT reference schema paths (verified 2026-05-16 during T001 wall-analysis). Unaffected by FX001 itself, but T002's `version` bump may force a snapshot refresh independently.

### Documentation drift audit (mandatory step in § 5)

FX001 changes the canonical companion's schema location; in-tree documentation may still cite the pre-FX001 `state/` path. Before commit, run:

```bash
grep -rn 'state/inside-state\|state/outside-state' docs/ AGENTS.md AGENTS_README.md src/templates/ 2>/dev/null
```

Surface hits for review. Likely candidates: `docs/how/coordination-loop-validator.md`, `docs/how/companion-mode.md`, `src/templates/shared-preamble.md`, `AGENTS_README.md` companion-mode section. Update or annotate ("see MW-002 for legacy fallback"). If audit returns no hits, mark the step ✅ in execution log.

## 5. Tasks (operational sequence)

| Step | Action | File(s) | Status |
|------|--------|---------|--------|
| 1 | Move `state/inside-state.schema.json` → `inside-state.schema.json` (root) | `agents/code-review-companion/` | Pending |
| 2 | Move `state/outside-state.schema.json` → `outside-state.schema.json` (root) | `agents/code-review-companion/` | Pending |
| 3 | Remove empty `state/` directory | `agents/code-review-companion/state/` | Pending |
| 4 | Update `agent.json` `files[]` entries to root paths (still 7 files total) | `agents/code-review-companion/agent.json` | Pending |
| 5 | Re-run `npx vitest run test/runner/agent-pack/companion-manifest.test.ts` → expect ≤2 failures (version=`0.2.0` and any future-7-file test) | — | Pending |
| 6 | Update spec ACs (AC1, AC4, AC6, AC12 text-only) | `coordinated-install-resilience-spec.md` | Pending |
| 7 | Update plan T001, T002, **T003** (semantic flip — see below) paths + verify T003 is now documentation-only | `coordinated-install-resilience-plan.md` | Pending |
| 7a | Run docs drift audit grep (see § 4); update hits or annotate them | various under `docs/`, `src/templates/`, root `AGENTS*.md` | Pending |
| 8 | Update execution.log.md with FX001 discovery + validation record | `execution.log.md` | Pending |
| 9 | Commit as `fix(021): pivot schema location from state/ to agent root (FX001)` | — | Pending |

### Note on T003's semantic flip

The original T003 description in the plan says "Keep the legacy root-level `'inside-state.schema.json'` / `'outside-state.schema.json'` entries for back-compat (existing legacy installs)." Post-FX001 the root entries are **canonical**, not legacy — the term "legacy" now applies to the `state/` location (used today only by `demo-companion`, via its own source tree, not the install path). Step 7 must update T003's wording to reflect this flip: root is the canonical install path; the runtime's level-1 `state/` lookup is the back-compat path. **Without this wording fix, a reader of the post-FX001 plan would invert the convention's polarity.**

## 6. Acceptance Criteria for FX001 itself

- **FX001-AC1**: `agents/code-review-companion/inside-state.schema.json` exists with the original enum `[idle, reading, reviewing, reporting, blocked, stopping]` (the existing content survives the move).
- **FX001-AC2**: `agents/code-review-companion/outside-state.schema.json` exists with the standard outside enum `[idle, in-progress, paused, done, error]`.
- **FX001-AC3**: `agents/code-review-companion/state/` directory does not exist after the pivot.
- **FX001-AC4**: `agent.json` lists 7 files, all with root-level paths; `validateManifest()` accepts the manifest (the `companion-manifest.test.ts` validation tests pass; only the version-bump-related assertions remain as expected T002 work).
- **FX001-AC5**: spec ACs (1, 4, 6, 12) reference root paths and no longer mention `state/inside-state.schema.json` or `state/outside-state.schema.json`.
- **FX001-AC6**: plan T001, T002, T003 paths updated; T003 description amended to "verify CANONICAL_AGENT_FILES already includes root schema paths; update test fixtures to root paths" (documentation-only).
- **FX001-AC7**: A test run of `installAgentPack` against the post-FX001 `code-review-companion` source folder copies the schemas to root in the install target. (Verified during T002 upgrade-detection regression test.)

## 7. Deferred follow-ups (NOT part of FX001)

- **MW-001**: "Consolidate per-agent definition files (input-schema, output-schema, state schemas) under a non-runtime subdirectory" — option 3 from the decision matrix. Out of scope here; deserves its own spec because it affects all per-agent definition files and re-shapes the canonical agent layout.
- **MW-002**: `demo-companion` ships `state/inside-state.schema.json` today. After FX001 lands, demo-companion is the *only* in-tree agent shipping state schemas under `state/`. It still works (the install-implicit-manifest path won't ship them — they're already disk-resident from the source tree, not the install). Consider whether to migrate `demo-companion` to root in a follow-up dossier or leave it as the example of the legacy fallback path.
- **MW-003**: The doctor copy rewrite (T005) should mention BOTH valid schema locations (root + `state/`) so authors who copy from `demo-companion` and authors who copy from the post-FX001 `code-review-companion` both get accurate guidance. Encoded as an addition to T005's scope.

## 8. Validation hooks

- **Pre-execute**: run `validate-v2` against this dossier (proof target: Implementation; vector consumers: `/plan-6-v2-implement-phase-companion` resuming T001, future fix-dossier authors).
- **Companion notification**: send a `briefing`-typed update to `code-review-companion` (run `2026-05-16T12-51-35-391Z-c8e3`) noting FX001 supersedes the original T001 paths, before any code edits land.
- **Post-execute**: companion-manifest tests green after FX001 step 5; full `MINIH_REGRESSION=1 npm test` green after T002 lands.

---

## References

- Spec § Goals + AC1, AC4, AC6, AC12: `../coordinated-install-resilience-spec.md`
- Plan W1 tasks T001-T003: `../coordinated-install-resilience-plan.md`
- Denylist source: `src/runner/agent-pack/manifest.ts:18-25`
- Path-check source: `src/runner/agent-pack/manifest.ts:152-179` (`checkManifestPath`)
- Schema resolution: `src/mcp/tools/state.ts:172-191` (3-level fallback)
- Canonical install list: `src/runner/agent-pack/manifest.ts:33-37` (`CANONICAL_AGENT_FILES`) — already lists root-level schema paths; FX001 § 4 "Runtime: no changes needed" claim verified against this.
- Origin bug: [`AI-Substrate/minih#30`](https://github.com/AI-Substrate/minih/issues/30) — root cause unchanged; only the *install destination* shifts

---

## 9. Validation Record (2026-05-16)

### Validation Thesis

**Raison d'être**: Capture the schema-location pivot decision encountered mid-T001 so a coding agent resuming the task can ship without re-asking architectural questions; collapse T003 to docs-only where the canonical install list already does the work; surface convention-drift cost honestly so it isn't invisible.

**Value claim**: Implementation becomes execution again — not design. T003 reduces scope. The runtime's existing 3-level fallback keeps legacy `state/`-shipping agents (`demo-companion`) working unchanged. The pij agent's workaround on issue #30 remains valid.

**Artifact promise**: Every affected spec AC named with old→new text; every affected plan task named with path change; existing on-disk state has a concrete cleanup sequence; runtime behavior demonstrably unchanged; deferred follow-ups (option-3 consolidation; demo-companion migration; doctor copy mentions both locations) explicit.

**Intended beneficiaries**: `/plan-6-v2-implement-phase-companion` resuming T001, PR reviewer, `code-review-companion` (the running peer needing a briefing update), spec author understanding the AC text-edits, future fix-dossier authors using this as a template.

**Proof target**: Implementation.

**Evidence standard**: Each AC mapped to a step; each step has a file path; each file path verifiable against on-disk state; decision matrix reproduced; deferred follow-ups documented; runtime claims grounded in `manifest.ts` line numbers.

**Thesis source**: live chat transcript 2026-05-16 (wall + 3-option discussion + user's choice of option 2), `src/runner/agent-pack/manifest.ts:18` denylist source, `src/mcp/tools/state.ts:172-191` 3-level fallback source. NOT inferred.

**Thesis verdict**: **Advanced** post-fix. Implementation proof level reached.

**Main residual risk**: Self-validation bias — the dossier was authored AND validated by the same agent (no `task` tool for parallel subagent diversity). Mitigation: the running `code-review-companion` should see a briefing update with FX001 link before T001 resumes; a second-eyes pass before commit catches what a single-validator missed.

### Lens summary

| Lens | Issues found | Issues fixed | Open |
|------|--------------|--------------|------|
| A. Coherence + Domain | L-1, L-2 (T003 "legacy" wording flip + § 5 step 7 alignment) | Both fixed via "semantic flip" subsection added to § 5 | none |
| B. Risk + Completeness | M-1, M-2, M-3 (demo-companion explicit assertion; doctor-vocabulary test enumeration; docs drift grep audit) | All three fixed via "§ 4 Affected tests" + "§ 4 Documentation drift audit" + "§ 5 step 7a" | none |
| C. Thesis Alignment | proof target reached; evidence gaps captured as M-findings (now closed) | n/a (no thesis drift) | none |
| D. Forward-Compatibility | `demo-companion` requirement implicit; docs requirement unchecked | both addressed in B's fixes | none |

**Lens coverage**: 4/15 named lenses run (Coherence, Risk, Thesis, Forward-Compat). For a fix-dossier of this scope (single-file, narrow pivot, < 200 lines of edits) the floor is lower than for plan-3 artifacts; 4 is appropriate.

### Forward-Compatibility Matrix

| Consumer | Requirement | Verdict | Evidence |
|----------|-------------|---------|----------|
| `/plan-6-v2-implement-phase-companion` resuming T001 | Concrete file paths + executable steps | ✅ | § 5 has 9 numbered steps with file paths |
| PR reviewer | Decision rationale visible | ✅ | § 3 reproduces the 3-option matrix + verdicts |
| `code-review-companion` (running peer) | One-paragraph FX001 brief for inbox briefing update | ⚠️ | Dossier is long; the briefing update needs a separate ~3-sentence summary at § 8 send-time. Not a dossier bug; called out in § 8 already. |
| Spec author | AC text-edits with before/after | ✅ | § 4 enumerates AC1, AC4, AC6, AC12 explicitly |
| Future fix-dossier authors | Template clarity | ✅ | Sections: Trigger / Why spec assumed / Decision / Affected artifacts / Tasks / FX's own ACs / Deferred / Validation — reusable shape |
| `demo-companion` runtime | State schema still found by level-1 fallback | ✅ (post-fix) | § 4 "Runtime" now explicitly asserts demo-companion unaffected |
| In-tree documentation under `docs/`, `src/templates/`, `AGENTS*.md` | Up-to-date schema-location wording | ✅ (post-fix) | § 5 step 7a runs grep audit; § 4 "Documentation drift audit" makes audit mandatory |

**Overall**: ⚠️ **VALIDATED WITH FIXES** — 0 HIGH/CRITICAL, 3 MEDIUM fixed, 2 LOW fixed; 0 open. Dossier reaches Implementation proof level.

### Honest limitations

- Ran as **single serial validator**, no parallel subagents (no `task` tool in this harness). Lost: perspective diversity.
- **Self-validation bias**: I authored the dossier and validated it. Fixes landed are real (verified against `manifest.ts` line numbers + on-disk state), but a fresh validator might catch a class I'm blind to. **Recommended mitigation**: ping `code-review-companion` (run `2026-05-16T12-51-35-391Z-c8e3`) with a `briefing`-typed update linking FX001 BEFORE T001 resumes; companion review at the FX001 commit boundary is the second-eyes pass validate-v2 would normally provide.
