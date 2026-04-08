# Research Report: CI Pipeline & Versioning Strategy

**Generated**: 2026-04-08T08:45:00Z
**Research Query**: "CI setup, release-please vs semver, GitHub-only releases (no npm publish)"
**Mode**: Plan-Associated (004-ci-versioning)
**Findings**: 25 across 3 subagents

## Executive Summary

### What We Have
- GitHub Actions CI (`ci.yml`) with 3 jobs: quality-gate (Node 20+22), agent-doctor, pack-check
- Version `0.1.0` in package.json, no git tags, no CHANGELOG.md
- Conventional commit history (`feat:`, `fix:`, `docs:`, `ci:`) — release-please compatible
- Distribution via `npx github:AI-Substrate/minih` and `npm install github:AI-Substrate/minih`
- No npm registry publish — GitHub-only

### What We Need
1. Automated versioning from conventional commits
2. GitHub Releases with changelogs
3. Git tags (`v0.1.0`, `v0.2.0`, etc.) — enables `npm install github:AI-Substrate/minih#v0.2.0`
4. CHANGELOG.md generation
5. package.json version bumps
6. No npm publish step

### Recommendation
**release-please** — it's the best fit for GitHub-only releases with conventional commits.

## Current State

### CI Pipeline (`.github/workflows/ci.yml`)
- **Triggers**: push to `main`/`ci-setup`, PRs to `main`
- **quality-gate** (Node 20 + 22 matrix): biome check → build → typecheck → vitest → audit → verify dist artifacts
- **doctor**: validates all agents pass convention checks
- **pack-check**: `npm pack --dry-run` + bin entry verification
- All green, ~25s total

### Versioning State
- `package.json` version: `0.1.0`
- Git tags: **none**
- CHANGELOG.md: **does not exist**
- Commit messages: conventional commits already in use ✅

### Package Distribution
- `files: ["dist", "LICENSE"]` — agents/ excluded from package
- `bin.minih: "./dist/cli/index.js"`
- `prepare: "npm run build"` — builds on install from GitHub
- `npx github:AI-Substrate/minih` installs from default branch HEAD (not version-aware)
- `npm install github:AI-Substrate/minih#v0.2.0` would use git tag — **requires tags to exist**

## release-please: How It Works

### Mechanism
1. On push to `main`, release-please scans conventional commits since last release
2. Opens a **Release PR** that:
   - Bumps `package.json` version
   - Generates/updates `CHANGELOG.md`
   - Title: `chore(main): release 0.2.0`
3. When you merge the Release PR:
   - Creates git tag (`v0.2.0`)
   - Creates GitHub Release with changelog
4. **Does NOT publish to npm** unless you add a separate step

### Commit → Version Mapping
| Commit Prefix | Version Bump | Example |
|--------------|-------------|---------|
| `fix:` | patch (0.1.0 → 0.1.1) | `fix: CRLF frontmatter parsing` |
| `feat:` | minor (0.1.0 → 0.2.0) | `feat: minih status command` |
| `feat!:` or `BREAKING CHANGE:` | major (0.1.0 → 1.0.0) | `feat!: new output format` |
| `docs:`, `ci:`, `chore:` | no bump | `docs: update README` |

### Proposed Workflow
```yaml
name: Release Please
on:
  push:
    branches: [main]

permissions:
  contents: write
  pull-requests: write

jobs:
  release-please:
    runs-on: ubuntu-latest
    steps:
      - uses: googleapis/release-please-action@v4
        with:
          release-type: node
```

### Pre-1.0 Considerations
- `0.x.y` is fine — semver allows breaking changes in minor bumps before 1.0
- Keep using patch/minor until API stabilizes
- First release would be `v0.2.0` (or `v0.1.1` if only fixes since 0.1.0)

## Alternatives Considered

| Tool | Pros | Cons | Verdict |
|------|------|------|---------|
| **release-please** | PR-based, conventional commits, GitHub-native, no npm needed | Extra merge step (the release PR) | ✅ Recommended |
| **semantic-release** | Fully automated, no PR needed | Heavier config, assumes npm publish by default | ❌ Overkill |
| **changesets** | Good for monorepos | Manual changeset files, designed for npm publish | ❌ Wrong fit |
| **Manual tags** | Simple | No automation, no changelog | ❌ Doesn't scale |

## Prior Learnings

### PL-01: rootDir gotcha (001-setup, Phase 1)
`rootDir: "."` emitted `dist/src/`, breaking the bin path. Fixed with `rootDir: "src"`. **Action**: CI already validates dist artifacts — keep that check.

### PL-02: Schema omission from package (001-setup, Phase 2+5)
`retrospective.json` was missing from the published package. `npm pack --dry-run` caught it. **Action**: pack-check CI job already validates this.

### PL-03: SDK version risk (001-setup, handover)
Event types may change across SDK versions. **Action**: Peer dep already widened to `>=0.1.32`. Consider pinning in lockfile.

### PL-04: npx cache issues (session history)
`npx github:AI-Substrate/minih` can have stale permission-denied cache. **Action**: Git tags enable `npx github:AI-Substrate/minih@v0.2.0` for pinned installs.

## Implementation Plan

### Phase 1: release-please workflow
- Add `.github/workflows/release.yml` with release-please action
- Add `release-please-config.json` (optional, for customization)
- Initial release will scan all conventional commits since repo creation

### Phase 2: CI trigger on tags
- Update `ci.yml` to also trigger on `v*` tags (release validation)
- Ensures every release is tested before the GitHub Release is created

### Phase 3: Documentation
- Update CONTRIBUTING.md with release process
- Update AGENTS_README.md install docs with tagged versions
- Update README.md quickstart with version pinning option

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| First release scans all history — might pick wrong version | Can set initial version in release-please config |
| Release PR merge triggers CI again | CI on `main` push is fine — validates the release |
| `npx` still defaults to HEAD not latest tag | Document `npx github:AI-Substrate/minih@v0.2.0` for pinning |

## Next Steps

1. Run `/plan-1b-specify` to create formal spec
2. Or go straight to implementation — this is small enough for Simple mode

---

**Research Complete**: 2026-04-08T08:45:00Z
**Report Location**: docs/plans/004-ci-versioning/research-dossier.md
