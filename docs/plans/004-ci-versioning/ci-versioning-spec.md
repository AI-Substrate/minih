# CI Pipeline & Automated Versioning

**Mode**: Simple

📚 This specification incorporates findings from research-dossier.md

## Research Context

- CI pipeline already exists with 3 jobs (quality-gate, doctor, pack-check) on Node 20+22
- Version is `0.1.0` with no git tags, no CHANGELOG.md, no releases
- Conventional commit history already in use (`feat:`, `fix:`, `docs:`, `ci:`)
- Distribution is GitHub-only (`npx github:AI-Substrate/minih`) — no npm publish
- release-please identified as best fit: PR-based, conventional commits, GitHub-native

## Summary

Add automated versioning and release management to minih so that every meaningful change produces a versioned GitHub Release with a changelog, git tags, and a bumped `package.json`. Users can install specific versions via `npx github:AI-Substrate/minih@v0.2.0`. No npm registry publish — GitHub is the sole distribution channel.

## Goals

- **Automated releases**: Conventional commits drive version bumps without manual intervention
- **GitHub Releases**: Every release gets a tagged GitHub Release with auto-generated changelog
- **Version pinning**: Users can install specific versions via git tags (`#v0.2.0`)
- **CI on releases**: Every release tag is validated by the full quality gate before the release is published
- **Changelog**: Auto-generated `CHANGELOG.md` maintained in the repository
- **Clean CI triggers**: Remove stale `ci-setup` branch trigger, add tag triggers
- **Documentation**: Install docs show both HEAD and pinned version options

## Non-Goals

- Publishing to npm registry
- Monorepo release tooling (changesets, lerna)
- Pre-release channels (alpha, beta, rc)
- Automated deployment or CDN distribution
- Branch protection rules or required reviewers (repo admin concern)

## Target Domains

| Domain | Status | Relationship | Role in This Feature |
|--------|--------|-------------|---------------------|
| cli | existing | **consume** | No code changes — CI validates CLI commands |
| runner | existing | **consume** | No code changes — CI runs tests |
| adapter | existing | **consume** | No code changes — CI runs tests |

No new domains. This feature is pure infrastructure — GitHub Actions workflows, package metadata, and documentation. No changes to minih source code (adapter/runner/cli).

## Complexity

- **Score**: CS-2 (small)
- **Breakdown**: S=1, I=1, D=0, N=0, F=0, T=0
- **Confidence**: 0.90
- **Assumptions**:
  - release-please works with GitHub-only repos (no npm token needed)
  - Conventional commits are already consistently used
  - `GITHUB_TOKEN` has sufficient permissions for release PRs
- **Dependencies**: googleapis/release-please-action@v4
- **Risks**: First release may scan all history and pick unexpected version
- **Phases**: Single phase — all tasks are independent workflow/docs changes

## Acceptance Criteria

1. **AC1**: A `release.yml` workflow exists that runs release-please on push to `main`
2. **AC2**: When conventional commits are pushed to `main`, release-please opens a Release PR with version bump in `package.json` and updated `CHANGELOG.md`
3. **AC3**: When the Release PR is merged, a git tag (`vX.Y.Z`) and GitHub Release are created automatically
4. **AC4**: The GitHub Release includes an auto-generated changelog from conventional commits
5. **AC5**: `ci.yml` triggers on `v*` tag pushes, validating releases with the full quality gate
6. **AC6**: The stale `ci-setup` branch trigger is removed from `ci.yml`
7. **AC7**: `AGENTS_README.md` install docs show both HEAD and pinned version (`@v0.2.0`) options
8. **AC8**: `CONTRIBUTING.md` documents the release process (merge Release PR → tag → release)
9. **AC9**: `README.md` install section includes version pinning option
10. **AC10**: `npm install github:AI-Substrate/minih#vX.Y.Z` works with released tags
11. **AC11**: No npm publish step exists in any workflow

## Risks & Assumptions

| Risk | Impact | Mitigation |
|------|--------|-----------|
| First release-please run scans entire commit history | May produce unexpected version | Set `last-release-sha` or initial version in config |
| Release PR merge triggers CI again | Extra CI run (harmless) | CI on main push is fine — validates the release commit |
| `npx github:...` defaults to HEAD not latest tag | Users get unreleased code | Document `@vX.Y.Z` pinning; this is expected for GitHub installs |
| `GITHUB_TOKEN` permissions for PRs | Release PR creation may fail | Workflow declares `pull-requests: write` permission |

## Open Questions

None — all resolved in Clarifications session below.

## Testing Strategy

- **Approach**: Manual only
- **Rationale**: Pure infrastructure — YAML workflows and docs. Verify by pushing to branch and checking GitHub Actions results.
- **Focus**: Confirm workflows trigger, pass, and produce expected artifacts (tags, releases, changelog)
- **Mock Usage**: N/A

## Documentation Strategy

- **Location**: Hybrid — README.md + AGENTS_README.md + CONTRIBUTING.md
- **Rationale**: Install docs need version pinning in both READMEs; release process goes in CONTRIBUTING

## Workshop Opportunities

None identified — release-please is well-documented and the implementation is straightforward workflow + docs changes.

## Clarifications

### Session 2026-04-08

**Q1: Workflow Mode** → Simple (confirmed — CS-2, infrastructure only)

**Q2: Testing Strategy** → Manual only — verify workflows trigger and pass on branch, check GitHub Actions results. No unit tests for YAML files.

**Q3: Documentation Strategy** → Hybrid — README.md + AGENTS_README.md + CONTRIBUTING.md. Install docs get version pinning, CONTRIBUTING gets release process.

**Q4: First Release Version** → Let release-please figure it out from commits (will likely produce 0.2.0 given the volume of `feat:` commits since 0.1.0). No explicit `initial-version` override.

**Q5: CI Trigger Cleanup** → Yes — after merge, clean branch triggers to just `main` + `v*` tags + PRs to main. Remove stale `ci-setup` and temporary `004-ci-versioning`.
