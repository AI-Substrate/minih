# Phase 5: Registry seed + dogfood — Execution Log

**Plan**: [`../../agent-pack-install-plan.md`](../../agent-pack-install-plan.md)
**Phase**: Phase 5: Registry seed + dogfood — `code-review-companion` end-to-end
**Started**: 2026-05-03T15:04:50+10:00
**Mode**: Full + Companion (Power-On-Mode)
**Companion run**: `code-review-companion` run `2026-05-03T15-04-50-212Z-e6ee`
**Testing**: Hybrid (Full TDD for T002b/T007/T009/T009b; integration tests for T008; manual for T003/T006)
**Harness**: N/A (no `docs/project-rules/harness.md`; spec § Clarifications Q6)

---

## Pre-Phase Validation

| Check | Status | Notes |
|---|---|---|
| Boot | N/A | No harness |
| Interact | N/A | No harness |
| Observe | N/A | No harness |
| `git status` clean | ✅ | Only the new phase-5 dossier directory pending |
| Branch | `007-backgrounding` | Carrying through from prior phases |
| Baseline | 907 passed / 12 skipped (commit `073b339`) | Phase 3 shipped |
| Companion booted | ✅ | run `2026-05-03T15-04-50-212Z-e6ee`, briefed at 15:05:51Z |

---

## Task Log

### T001 — Audit prompt + instructions for fresh-project portability — DONE 2026-05-03

**Audit method**: grep'd both files for hard-coded paths (`docs/plans`, `scratch`, `dist/`, `/Users/`, `substrate/minih`).

**Findings**:
- `prompt.md:15-27` — `$MINIH_PROJECT_ROOT` used correctly; portable.
- `prompt.md:130-131` — `docs/plans/` referenced with explicit "empty/missing fallback"; gracefully degrades. Portable as-is.
- `prompt.md:183-188` — drift-audit checklist mentions minih-specific paths (`agents/_shared/preamble.md`, `src/templates/shared-preamble.md`). These are graceful: if files don't exist, no finding. **Soft edit applied** — line 186 reworded to clarify the rule is project-specific (minih example) so a non-minih reader doesn't think it's a hard requirement.
- `instructions.md:27` — domain-direction example explicitly prefixed "For minih:" — pedagogical, portable.

**Edit applied**: `prompt.md:186` — softened "(these MUST match — bundled to dist)" → "(in minih: bundled to dist via `scripts/copy-schemas.js` — these MUST match. If the project doesn't have either, skip.)"

**Commit ping**: pending T001 commit + companion review-request.


### T002 — Author agent.json — DONE 2026-05-03

- Authored `agents/code-review-companion/agent.json` with 4 manifest-listed files + version `0.1.0` + tags `[companion, review, coordination, exemplar, quality]`.
- Per-file descriptions written to be reference-quality (future authors copy this as a template).
- Validation via T002b confirmed `validateManifest()` accepts the file.

### T002b — TDD validateManifest unit test — DONE 2026-05-03

- New `test/runner/agent-pack/companion-manifest.test.ts` (9 tests; ~120 LOC).
- Positive cases: parses, validates, lists prompt.md, every file exists on disk, has companion tag, version 0.1.0.
- Negative regression cases: traversal/runtime-dir/missing-prompt all rejected.
- All 9 green in 2ms.
- **Discovery (decision)**: 9 tests is the right size — covers both happy path AND ensures the security guard hasn't regressed since Phase 1 (negative cases are belt-and-braces but cheap).

### T003 — Verify FX001 local-install round-trip — DONE 2026-05-03

Manual test against existing built `dist/` (already includes FX001+FX002+P3):

```bash
TMP=$(mktemp -d); cd $TMP
node <repo>/dist/cli/index.js agent install <repo>/agents/code-review-companion --as crc-test --agents-dir agents
# → action: 'installed', source.type: 'local', 5 files (4 manifest + agent.json itself)
node <repo>/dist/cli/index.js agent info crc-test --agents-dir agents
# → manifestVersion: '0.1.0', source.type: 'local', all files status: 'unchanged'
node <repo>/dist/cli/index.js agent install <repo>/agents/code-review-companion --as crc-test --agents-dir agents
# → action: 'unchanged' (idempotent)
node <repo>/dist/cli/index.js agent list --agents-dir agents
# → ["crc-test"]
```

All 4 round-trip assertions pass.

**Discovery 1 (consistency)**: prompt.md frontmatter `tags: [review, quality, coordination, exemplar]` was missing `companion` (the most identifying tag). agent.json had it; prompt.md didn't. `agent info` reads from prompt.md frontmatter for tags, so a fresh install would surface inconsistent tags. **Fix applied**: prompt.md frontmatter tags aligned to `[companion, review, quality, coordination, exemplar]`.

**Discovery 2 (cosmetic, not blocking)**: `agent info` includes `agent.json` itself in the files list with `description: null` because the manifest doesn't list itself. Future Phase 6 docs note: this is by-design (the manifest is auto-shipped by the installer but doesn't self-reference); a future enhancement could surface `description: 'Agent pack manifest (auto-shipped)'`.

