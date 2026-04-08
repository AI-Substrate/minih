# Execution Log — 004 CI/Versioning

## T001: Create release-please workflow

**Started**: 2026-04-08T10:03:00Z

Created `.github/workflows/release.yml` with:
- Trigger: push to main only
- Action: `googleapis/release-please-action@v4`
- Permissions: `contents: write`, `pull-requests: write`
- Release type: `node`
- No npm publish step

**Evidence**: File created, committed.

---

## T002: Update CI triggers — add `v*` tags

**Started**: 2026-04-08T10:03:00Z

Added `tags: ['v*']` to push triggers in `ci.yml`. Kept `004-ci-versioning` branch trigger for testing.

**Evidence**: File updated, committed.

---

## T003: Verify CI passes on branch

**Verified**: 2026-04-08T10:08:00Z

All 3 CI runs on `004-ci-versioning` branch passed:
- `ci: add release-please workflow + v* tag triggers` → ✅ success
- `docs: version pinning...` → ✅ success
- PR #3 checks → ✅ success

---

## T004: Update README install docs

**Completed**: 2026-04-08T10:05:00Z

Added pinned version examples using `#ref` syntax (DYK #1).

---

## T005: Update AGENTS_README install docs

**Completed**: 2026-04-08T10:05:00Z

Added pinned version examples to all 3 install options.

---

## T006: Update CONTRIBUTING with release process

**Completed**: 2026-04-08T10:05:00Z

Added "Releasing" section with release-please workflow, commit→version mapping table, and important notes (don't rename PRs, don't edit CHANGELOG manually).

---

## T002b: Clean stale branch triggers

**Completed**: 2026-04-08T10:08:00Z

Removed `004-ci-versioning` from ci.yml triggers. Now triggers on `main` + `v*` tags + PRs to main only.

---
