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

