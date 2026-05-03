# Fix FX003: Post-Phase-5 follow-ups — `MINIH_E2E_PREMERGE` flip + `outside.md` authoring

**Created**: 2026-05-03
**Status**: Proposed (deferred — to be implemented post-merge)
**Plan**: [`../agent-pack-install-plan.md`](../agent-pack-install-plan.md)
**Source**: Phase 5 T011 follow-up registration
**Domain(s)**: `runner` (test) + `runner` (data — companion outside contract)

---

## Problem

Phase 5 shipped the bundled agent registry seed and the canonical `agents/code-review-companion/agent.json` end-to-end, but two follow-ups were intentionally deferred:

1. **Pre-merge → post-merge `MINIH_E2E_PREMERGE` flip.** The MINIH_E2E headline e2e (`test/e2e/agent-pack-real-fetch.test.ts` T008) currently uses `MINIH_E2E_PREMERGE=1` to install via the URL form against the `007-backgrounding` branch, because `code-review-companion/agent.json` doesn't yet exist on `main`. Once Phase 5 merges to `main`, the env switch becomes obsolete — the slug-based path should activate by default.

2. **`outside.md` + state schemas authoring.** Phase 5's `agent.json` lists 4 files (`prompt.md`, `instructions.md`, `input-schema.json`, `output-schema.json`). The plan task 5.1 originally specified 6 files including `outside.md`, `inside-state.schema.json`, `outside-state.schema.json`. The companion runs fine without them today (`coordination: enabled` triggers MCP tools regardless), but for the **canonical reference example** the formal outside contract should exist. Reference: `agents/coordination-loop-validator/` has the full outside contract pattern.

## Proposed Fix

Two scoped follow-ups (could land as separate sub-fixes):

### FX003a: post-merge e2e flip

Once `code-review-companion/agent.json` is on `main`:
- Remove the `MINIH_E2E_PREMERGE` branching in `test/e2e/agent-pack-real-fetch.test.ts`
- The default MINIH_E2E run uses the slug-based form against `main`
- Drop the now-unused pre-merge guard test
- Verify spec AC1 still met (<5s soft, <10s hard) against `main`

### FX003b: outside contract authoring

- Author `agents/code-review-companion/outside.md` documenting the companion-mode protocol from outside's perspective (when to send briefing, task, control:stop; how to read findings; etc.). Reference: `docs/how/companion-mode.md` and `agents/coordination-loop-validator/outside.md`.
- Author `agents/code-review-companion/inside-state.schema.json` for the companion's inside-state vocabulary (`reading`, `reviewing`, `reporting`, `idle`, `blocked`).
- Author `agents/code-review-companion/outside-state.schema.json` for the outside actor's state vocabulary.
- Update `agents/code-review-companion/agent.json` to list 7 files; bump `manifestVersion: '0.2.0'`.
- Update `test/runner/agent-pack/companion-manifest.test.ts` to assert 7 files exist.
- Update `test/cli/agent-list-baseline.test.ts` snapshot.
- Verify upgrade detection works for users on `0.1.0`: re-install reports `action: 'upgraded'` with the 3 new files in `changedFiles[]`. (Phase 1 install logic keys upgrade detection on per-file checksums + `commitSha`, NOT on `manifestVersion`, so the 3 new files trigger an `upgraded` action correctly.)

## Domain Impact

| Domain | Relationship | What Changes |
|---|---|---|
| `runner` (test) | modify | Drop pre-merge branching in e2e |
| `runner` (data) | extend | Author 3 coordination scaffold files for `code-review-companion`; bump `agent.json` |
| `runner` (test) | modify | Update companion-manifest.test.ts + agent-list-baseline.test.ts |
| `cli` | not involved | n/a |

## Tasks

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|---|---|---|---|---|---|---|
| [ ] | FX003a-1 | Drop `MINIH_E2E_PREMERGE` branching in T008 e2e | runner (test) | `test/e2e/agent-pack-real-fetch.test.ts` | Default `MINIH_E2E=1` runs slug-based path; pre-merge guard test removed | Post-merge only |
| [ ] | FX003b-1 | Author `agents/code-review-companion/outside.md` | runner (data) | `agents/code-review-companion/outside.md` | Reviewed vs `agents/coordination-loop-validator/outside.md`; portable wording | Reference example |
| [ ] | FX003b-2 | Author `agents/code-review-companion/inside-state.schema.json` | runner (data) | same | JSON schema validates; status enum covers `reading\|reviewing\|reporting\|idle\|blocked` | |
| [ ] | FX003b-3 | Author `agents/code-review-companion/outside-state.schema.json` | runner (data) | same | JSON schema validates | |
| [ ] | FX003b-4 | Update `agent.json`: 7 files; bump to `0.2.0` | runner (data) | `agents/code-review-companion/agent.json` | `validateManifest()` accepts; companion-manifest.test.ts updated to assert 7 files | |
| [ ] | FX003b-5 | Update `test/cli/agent-list-baseline.test.ts` snapshot | runner (test) | same | `MINIH_REGRESSION=1 npm test` green | Curation-gate baseline updated |
| [ ] | FX003b-6 | Verify upgrade path: install `0.1.0` → re-install with `0.2.0` reports `action: 'upgraded'` with 3 new files in `changedFiles` | runner (test) | manual or e2e test | Recorded in FX003 log | Validates Phase 1 upgrade-detection invariant |

## Acceptance

- [ ] FX003a: Default `MINIH_E2E=1` against post-merged `main` runs the slug-based headline scenario, no env switches
- [ ] FX003b: `agent info code-review-companion` shows 7 files with correct descriptions
- [ ] FX003b: `agent.json` `version: '0.2.0'`; existing `0.1.0` installs correctly upgrade
- [ ] FX003b: Companion's outside contract is authored at the same quality bar as `coordination-loop-validator`'s
- [ ] `just fft` green
