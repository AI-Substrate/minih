# Phase 6: Docs + release notes — Execution Log

**Plan**: [`../../agent-pack-install-plan.md`](../../agent-pack-install-plan.md)
**Phase**: Phase 6: Docs + release notes
**Started**: 2026-05-03T16:08:00+10:00
**Mode**: Full + Companion (Power-On-Mode)
**Companion run**: `code-review-companion` run `2026-05-03T16-08-00-909Z-ca43` (PID 40242)
**Testing**: Manual (docs-only — `just fft` final gate; companion review for accuracy)
**Harness**: N/A

---

## Pre-Phase Validation

| Check | Status | Notes |
|---|---|---|
| Boot | N/A | No harness |
| Companion booted | ✅ | run `2026-05-03T16-08-00-909Z-ca43` (briefed at 16:08:09Z) — using `mode: async, detach: true` lesson from Phase 5 debug |
| `git status` clean | ✅ | Only Phase 6 dossier dir pending |
| Branch | `007-backgrounding` | |
| Baseline | 930 passed / 16 skipped (commit `071b6a0`) | Phase 5 + companion fixes shipped |

---

## Task Log

(per-task entries appended as work progresses)


### T6.1 — docs/how/agent-pack.md authored — DONE 2026-05-03 (commit 1518953)

~520 LOC. Sections: what is an agent pack, quick start, three install sources, agent.json schema, implicit manifest fallback, .minih-source.json sidecar, drift detection, security model (manifest-level + tarball-level guards), production-safe injection seam, error reference E180-E184, curation, agent info, agent list installed-vs-available, common pitfalls. Cross-link to companion-mode.md throughout to avoid duplication.

### Companion review of T6.1 — 3 findings shipped — DONE 2026-05-03 (commit ab53691)

Companion fired 3 doc-vs-code drift findings before T6.2 even started — proving the inline review value:
- **F001 HIGH** (ackOf 01KQP7G876YJ5CEKDF41JJ06KE): how-to claimed `--yes` skipped a confirmation prompt for non-registry sources, but no prompt exists in v1. **Fix**: rewrote URL section + What-we-do-NOT-do to say `--yes` is currently a forward-compat no-op; interactive prompt is a deferred Phase 4 task.
- **F002 HIGH**: error table presented E184 `AGENT_PACK_SOURCE_MISMATCH` as active behavior, but no throw site exists; sidecar/source mismatch currently returns `action: 'upgraded'`. **Fix**: reframed E184 row as "reserved + documented for future strict-mode guard" so users don't expect a refusal that won't arrive.
- **F003 MEDIUM**: security model claimed `validateManifest()` rejects Windows drive letters AND that all checks fire before any file is written/extracted. Neither accurate — drive-letter coverage is at tarball/extractor layer, and tarballs are extracted to a tmp dir before manifest validation runs against the staged tree. **Fix**: rewrote manifest-level guards to "before any files are copied into the installed agent folder" + added Note on extraction order + moved drive-letter/UNC bullet to tarball-level guards.

All 3 fixed inline before T6.2 — total cycle from finding to fix: ~5 min. This is exactly what Power-On-Mode is for.

### T6.2 — README Agent Packs section — DONE 2026-05-03 (commit 982af5c)

New H2 placed AFTER "Quick Start" — discoverable in first-glance README browse. 3-line demo + cross-link.

### T6.3 — AGENTS.md companion-mode install — DONE 2026-05-03 (commit 26e3184)

Companion preflight now includes `minih agent install code-review-companion` as a one-time conditional install (idempotent on re-run).

### T6.4 — AGENTS_README.md getting-started — DONE 2026-05-03 (commit f213720)

Paragraph after Prerequisites table introducing `minih agent <verb>`. dist/AGENTS_README.md rebuilt + verified byte-identical via `diff`.

### T6.5 — runner Concepts table refresh — DONE 2026-05-03 (commit 828f979)

Updated existing "Agent pack install" concept to reflect Phase-5 reality (registry no longer a Phase-4 stub, includes companion-fix F001+F002 guarantees). New "Bundled agent registry" concept covers catalog read + Levenshtein hint + curation principle.

### T6.6 — plan progress + flight log + final commit — DONE 2026-05-03

- Phase Index Status for Phase 6 → ✅ Complete
- Plan-level Flight Plan Phases Table updated; Flight Log entry appended
- Phase 6 dossier marked Landed; flight plan checklist all ✓; Mermaid all green
- Final fft validation + push pending

