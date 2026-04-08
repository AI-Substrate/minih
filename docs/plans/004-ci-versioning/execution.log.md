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
