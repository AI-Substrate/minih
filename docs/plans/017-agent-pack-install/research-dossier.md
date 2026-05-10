# Research Dossier: Agent Pack — Install / List / Info / Upgrade

**Generated**: 2026-05-03T11:20:00+10:00
**Research Query**: "agent pack — minih agent install <slug|git-url>, minih agent list (installable), minih agent info — baked-in registry for well-known agents like code-review-companion, also raw git URL install/upgrade"
**Mode**: Pre-Plan
**Plan folder**: `docs/plans/017-agent-pack-install/`
**FlowSpace**: Not invoked — agent had deep current-session context for the minih codebase
**Findings**: ~25 (focused; no parallel subagents launched)

---

## Executive Summary

### What the user wants

A **distribution mechanism for agents**. Today every agent is hand-authored or hand-copied per-project. The user wants:

1. **`minih agent install <slug>`** — pull from a baked-in registry of well-known agents (e.g. `code-review-companion`) → resolves to a git URL → downloads → drops a folder into the local `<agentsDir>/<slug>/`.
2. **`minih agent install <git-url>`** — direct install from any raw git URL (no registry needed).
3. **`minih agent install --upgrade <slug>`** (or similar verb) — re-pull and replace, preserving `runs/`, `inbox/`, `state/` subdirectories.
4. **`minih agent list`** — show the baked-in registry catalog of installable agents.
5. **`minih agent info <slug>`** — show what an agent does, what files it has, what its source URL is, install date, current ref.

The user explicitly said **"we will workshop the exact CLI for this"** — so the surface is open.

### Business purpose

> **Velocity compounding.** Right now adopting `code-review-companion` in a new project means hand-copying files. With `minih agent install code-review-companion`, you get the canonical version in 2 seconds, and `minih agent upgrade` keeps you current. **The harness becomes shareable.**

This is the natural next step after Plan 016's companion-mode work: now that companions are mature and load-bearing in our workflow, distributing them needs to be one command, not git-clone-and-cp.

### Key insights

1. **All the foundations exist.** `listAgents`, `resolveAgent`, `validateSlug`, `--agents-dir`, the JSON envelope, error codes, and the subcommand-group pattern (`minih outside ...`, `minih inside ...`, `minih state ...`) are all in place. This is purely additive — no refactor of existing surfaces.
2. **There's no remote-fetch code in src/ yet.** Adding HTTP/git fetch is a first-of-its-kind capability. Minimum new dependencies: ideally zero — Node has `fetch` built in (≥20.19); GitHub tarball download via REST is keyless for public repos.
3. **The "baked-in registry" is small enough to be inline.** ~5-10 well-known agents at most. A TS const map or a JSON file copied into `dist/templates/agents-registry.json` (matching the existing `dist/templates/` pattern for `shared-preamble.md` and `retros-readme.md`) is sufficient. No remote registry server needed.
4. **CLI namespace `agent <verb>` is well-precedented.** `minih outside <verb>`, `minih inside <verb>`, `minih state <verb>` already exist via Commander.js subcommand groups (see `src/cli/commands/outside.ts:1-30`). New `agent.ts` follows the same pattern.
5. **Agent folders are simple file collections.** Just `prompt.md` (with frontmatter for description/tags) + optional schemas + optional `instructions.md` + optional `outside.md`. Zero compiled artifacts. Perfect for tarball-extract install.
6. **Installation must NOT clobber `runs/`, `inbox/`, `state/`.** These are runtime artifacts, not source. Upgrade/reinstall must preserve them.
7. **GitHub is the canonical distribution channel** — confirmed by Plan 004 (no npm publish). The agent-pack feature aligns: well-known agents will likely live in the AI-Substrate org or be subpaths of minih itself (e.g. `agents/code-review-companion/` already lives in the minih repo).

### Quick stats
- **Components affected**: `cli` (add new command file), `runner` (maybe `agent-source.ts` for install bookkeeping)
- **New domain?**: Likely no — fits existing `cli` + `runner`. Could be its own concept if it grows; for v1, keep it tight.
- **External research opportunities**: 2 (GitHub tarball API best practices, npm-style "install manifest" conventions)
- **Prior learnings**: Plan 015 (agent-readme bundled-into-dist pattern); Plan 004 (GitHub-only distribution)
- **Domains touched**: `cli`, `runner`

---

## How It Currently Works (the parts this feature builds on)

### Agent folder convention

Agent definitions live at `<agentsDir>/<slug>/`. Default `<agentsDir>` is `./agents` relative to cwd; overridden via global `--agents-dir <path>` flag.

| Required | File | Purpose |
|---|---|---|
| ✅ | `prompt.md` | Frontmatter (description, tags, model, coordination) + body |
| optional | `instructions.md` | System instructions |
| optional | `output-schema.json` | AJV validation for the agent's report |
| optional | `input-schema.json` | AJV validation for `--param` inputs |
| optional | `outside.md` | Outside-side coordination contract |
| optional | `inside-state.schema.json` / `outside-state.schema.json` | Coordinated agents only |
| **runtime** | `runs/` | Per-execution artifacts — **must survive upgrade** |
| **runtime** | `inbox/` | Coordination messages — **must survive upgrade** |
| **runtime** | `state/` | Coordination state — **must survive upgrade** |

**Key code**: `src/runner/folder.ts:422` (`listAgents`), `src/runner/folder.ts:481` (`resolveAgent`), `src/runner/folder.ts:21` (`SLUG_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/`).

### CLI subcommand-group pattern (the install verb will follow this)

`src/cli/commands/outside.ts:13-21`:

```
outside inbox send  <slug> --type --subject --body
outside inbox list  <slug> [--wait <ms>]
outside state get   <slug> [--key <dot.path>]
outside state set   <slug> --status ...
outside context     <slug>
outside retro add   <slug> --body
```

This is the exact pattern `agent <verb>` should follow: one `commands/agent.ts` file, registered via `registerAgentCommand(program)`, internally creating subcommands `install`, `list`, `info`, `upgrade`, `remove`.

### JSON envelope + error codes (universal CLI contract)

Every command writes a JSON envelope to stdout and human-readable output to stderr. See `src/cli/output.ts:35-68` for `ErrorCodes`. Existing relevant codes:

| Code | Name | Meaning |
|---|---|---|
| E108 | INVALID_ARGS | Bad slug, missing param |
| E121 | AGENT_NOT_FOUND | Slug doesn't resolve to an installed agent |
| E130 | INIT_ALREADY_EXISTS | Agent folder already exists at that slug |

**New error codes likely needed:**

| Suggested Code | Name | Meaning |
|---|---|---|
| E180 | AGENT_PACK_REGISTRY_MISS | Slug not in baked-in registry (and not a git URL) |
| E181 | AGENT_PACK_FETCH_FAILED | Network/git error pulling source |
| E182 | AGENT_PACK_INVALID | Downloaded archive missing `prompt.md` or has wrong shape |
| E183 | AGENT_PACK_ALREADY_INSTALLED | Slug already installed; require `--upgrade` flag |
| E184 | AGENT_PACK_SOURCE_MISMATCH | Trying to upgrade from a different source URL than originally installed |

### Distribution model (Plan 004)

minih itself is **GitHub-only**: `npm install github:AI-Substrate/minih`. No npm registry publish. Anything bundled in the npm package needs to be under `dist/` (per `package.json#files = ["dist", "LICENSE"]`). The `scripts/copy-schemas.js` already shows the pattern for shipping non-TS assets via the build (`shared-preamble.md`, `retros-readme.md` in `src/templates/` → `dist/templates/`).

A baked-in agent registry naturally lives at `src/templates/agents-registry.json` → `dist/templates/agents-registry.json`.

### Existing fetch / network code

**Zero.** A grep for `fetch|http|download|archive|tarball` returns only references to filesystem `archive` (run history). Adding HTTP fetch is a first-of-its-kind capability for this codebase.

**Implication**: keep it simple. Use Node 20+ built-in `fetch()` for GitHub REST API tarball downloads. No new npm dependency required.

---

## Key Findings

### Finding F-01: Subcommand-group pattern is ready to clone — `cli` domain
**Source**: `src/cli/commands/outside.ts`, `src/cli/commands/inside.ts`, `src/cli/commands/state.ts`
**Description**: Three existing commands use the `<group> <verb>` pattern via Commander's `subcommand` mechanism. Each has its own file under `src/cli/commands/`. New `agent.ts` adds 4-5 verbs (install, list, info, upgrade, remove?) and registers via `registerAgentCommand(program)` from `src/cli/index.ts`.
**Action**: Pattern-match — copy `outside.ts` skeleton, swap verbs.

### Finding F-02: `--agents-dir` global flag is the install destination — `cli`
**Source**: `src/cli/index.ts:65-67`
**Description**: The CLI resolves `--agents-dir` to absolute path once at startup via `program.hook('preAction')`. Default is `'agents'` relative to cwd. **The install command MUST honor this** — `minih --agents-dir /custom/path agent install <slug>` should write to `/custom/path/<slug>/`.
**Action**: Read `program.opts().agentsDir` in the install action (same as `init.ts:226`).

### Finding F-03: `validateSlug` is the gatekeeper — `runner`
**Source**: `src/runner/folder.ts:23-39`
**Description**: All slug input goes through `validateSlug(slug)` returning `null | error string`. SLUG_PATTERN: `/^[a-zA-Z0-9_-]{1,64}$/`, blocks `..`, `/`, `\`, null bytes. Same regex applies whether slug came from registry OR from a git URL's last path segment.
**Action**: Validate the slug **before** any network call. Reject early with E108.

### Finding F-04: Agent folder existence check pattern — `cli`
**Source**: `src/cli/commands/init.ts:240-251`
**Description**: `init` rejects with E130 INIT_ALREADY_EXISTS if `<agentsDir>/<slug>` exists. Install must do the same — but with an `--upgrade` flag that bypasses (with a different code path that preserves `runs/`, `inbox/`, `state/`).
**Action**: New error E183 AGENT_PACK_ALREADY_INSTALLED. Distinct from E130 because the resolution is `--upgrade`, not `--force-overwrite-init`.

### Finding F-05: `prompt.md` frontmatter parsing is reusable — `runner`
**Source**: `src/runner/folder.ts:422-470` (`listAgents` calls `parseFrontmatter`)
**Description**: After install, the `info` command reads frontmatter via existing `parseFrontmatter()` to surface description/tags/model. Zero new parsing code needed.
**Action**: `info <slug>` = `resolveAgent(slug, agentsDir)` + read source-of-truth metadata file (see F-08) + format envelope.

### Finding F-06: Node ≥20.19 has built-in `fetch()` — no new dependency — `runner`
**Source**: `package.json#engines.node` (Node 20.19+ is the project minimum), `package.json#dependencies` (no `node-fetch`/`undici`/`got`)
**Description**: GitHub REST API supports tarball download for any public ref: `GET /repos/{owner}/{repo}/tarball/{ref}` returns a redirect → tar.gz blob. Combined with `node:zlib.createGunzip()` and a tiny tar parser, install becomes ~50 lines of code.
**Action**: Keep zero dependencies if possible. If a tar parser is needed, evaluate `tar-stream` (popular, small) — but first check if Node has anything built in (it doesn't currently, so this is the one new dep candidate).

**External research opportunity**: Best-practice tarball-extract pattern in modern Node (built-in `fetch` + a minimal tar reader). See "External Research Opportunities" below.

### Finding F-07: `dist/templates/` is the canonical "ship a static asset" location — `cli`
**Source**: `scripts/copy-schemas.js`, `src/templates/shared-preamble.md`, `src/templates/retros-readme.md`, `src/cli/commands/init.ts:155-170` (`fileURLToPath(new URL('../../templates/...'))` pattern)
**Description**: Plan 015 and the init scaffolder both ship static markdown via `dist/templates/`. The baked-in agent registry is the same shape: a JSON file checked into `src/templates/agents-registry.json` and copied to `dist/templates/` by the build.
**Action**: Use this exact pattern. The registry is small enough that **inline TypeScript const** is also viable (`src/runner/agent-pack/registry.ts` exporting a `BUILTIN_AGENTS` const). Slightly less ergonomic for non-coders to update, but type-safe.

### Finding F-08: Need an "install manifest" sidecar file — NEW concept
**Source**: No existing pattern in minih
**Description**: After install, we need to know **where this agent came from** so `info` and `upgrade` work. Options:
- **Option A**: Sidecar file `<agentsDir>/<slug>/.minih-source.json` containing `{ source: { type: 'registry'|'url', slug?, url, ref }, installedAt, commitSha, version? }`. Pros: self-contained, easy to grep. Cons: clutters folder.
- **Option B**: Top-level `<agentsDir>/.minih-installed.json` map of slug → source. Pros: cleaner agent folder. Cons: easy to drift if someone deletes a folder by hand.
- **Option C** (recommended): Both — sidecar is canonical, top-level is a derived index for fast `agent list --installed`.

**Action**: Decide in plan-1b/clarify. Recommendation: Option A as canonical (matches "agent folder is self-contained" philosophy from runner/folder.ts).

### Finding F-09: Must preserve `runs/`, `inbox/`, `state/` on upgrade — `runner`
**Source**: `src/runner/folder.ts:486-512` (`createRunFolder`), Plan 016 inbox/state writers
**Description**: Upgrade replaces source files (prompt.md, schemas, instructions.md, outside.md) but MUST NOT touch runtime subdirectories. Implementation: download to a temp dir, swap files atomically, leave subdirs alone.
**Action**: Define a "source files" allowlist (or an "always-preserve" denylist) in the install logic. The denylist is shorter: `['runs', 'inbox', 'state']`.

### Finding F-10: `minih doctor` validates installed agents — wire up `runner`
**Source**: `src/cli/commands/doctor.ts:1-40`
**Description**: After install, doctor should pick up the new agent automatically (since it scans agentsDir). No new doctor work needed for v1. **But**: doctor could grow a check "does this installed agent's commit sha match its source?" → punt to follow-up.
**Action**: No work in v1. Note as MW (magicWand) for the plan.

### Finding F-11: GitHub `subpath` install case — design choice
**Source**: User said "raw git URL install"
**Description**: A real-world case is "install just the `agents/code-review-companion/` folder from `github.com/AI-Substrate/minih`." Two design options:
- **Option A**: Treat the URL as the agent's root repo (whole repo IS the agent — has `prompt.md` at root).
- **Option B** (more flexible): URL syntax supports subpath, e.g. `github:AI-Substrate/minih#main:agents/code-review-companion` (npm-style spec). Or query param: `?path=agents/code-review-companion`.
- **Option C** (auto-detect): If the URL points to a repo with multiple `agents/<slug>/` folders, error E180 unless `--subpath` provided.

**Action**: Decide in plan-2-clarify. Recommendation: support both flat repos AND subpath, since the canonical baked-in agents (`code-review-companion`, etc.) live as subpaths of `github.com/AI-Substrate/minih` itself. The registry entries can encode the subpath; raw URL syntax can use a `:` or `?path=` separator.

### Finding F-12: Pin to ref or take HEAD?
**Source**: User didn't specify
**Description**: For reproducibility, install should pin to a specific commit. For ergonomics, default should be "latest stable" (i.e., the repo's default branch HEAD).
**Action**: Default to default branch HEAD; record commit sha in `.minih-source.json` so upgrade can show diff. Support `--ref <branch|tag|sha>` flag.

### Finding F-13: List output must distinguish installable vs installed
**Source**: User said "cli should be able to list installable ones" + existing `minih list` shows installed
**Description**: Avoid command collision. Two clean approaches:
- **Approach A**: New verb `minih agent list` (shows registry catalog) ≠ existing `minih list` (shows installed). Slight UX risk: users confuse them.
- **Approach B**: Extend existing `minih list` with `--available` flag → registry catalog. `minih list` (default) = installed; `minih list --available` = registry; `minih list --all` = both with status column.

**Action**: Decide in plan-2-clarify. Recommendation: B — extends a familiar surface and shows status (installed yes/no/upgrade-available) in one table. Less new vocabulary.

### Finding F-14: The minih repo itself contains the canonical agents
**Source**: `agents/code-review-companion/`, `agents/coordination-loop-validator/`, `agents/feedback-digest/`, etc. all in the current minih repo
**Description**: The baked-in registry's URLs likely all point to subpaths of `github.com/AI-Substrate/minih`. The same repo that ships the CLI ships the canonical agents. **No new repo creation needed** for v1.
**Action**: Registry v1 entries: `{ slug: 'code-review-companion', url: 'github:AI-Substrate/minih', ref: 'main', subpath: 'agents/code-review-companion' }`. Future: registry can reference other repos.

### Finding F-15: --no-companion / disable / dry-run patterns in CLI
**Source**: `src/cli/commands/init.ts` (--with-input, --coordinated, --no-output flags)
**Description**: Useful flags for `agent install`: `--dry-run` (resolve + show what would be installed, no writes), `--ref <ref>`, `--upgrade`, `--force` (overwrite without preserving runtime dirs — escape hatch).
**Action**: Spec these in plan-1b.

### Finding F-16: Trust model — currently zero-trust for arbitrary URLs
**Source**: User said "raw git URL install" — implies allowing untrusted sources
**Description**: Installing from an arbitrary git URL means downloading and placing files that the user will then execute as agent prompts. Risks:
- Malicious `prompt.md` with prompt injection
- Filesystem-pathy slugs hidden in repo (mitigated by `validateSlug`)
- Extremely large tarballs (DoS)

**Action**: For v1, mitigations:
- Show source URL + commit sha + file list before writing — require confirm unless `--yes`.
- Cap tarball size (e.g. 10 MB) — reject larger.
- Validate slug before extract.
- No code execution during install — pure file copy.
- Document in `info` output: "this agent's prompt has not been audited by minih maintainers" for non-registry sources.

### Finding F-17: Existing `minih agent-readme` is a "dump bundled doc" pattern
**Source**: `src/cli/commands/agent-readme.ts` (Plan 015)
**Description**: Plan 015 added `minih agent-readme` which dumps the bundled `dist/AGENTS_README.md` to stdout. It's a precedent for "ship a static asset in dist/, expose via CLI." Same pattern for the registry catalog (`agent list --available` reads `dist/templates/agents-registry.json`).
**Action**: Confirm naming — `minih agent-readme` (dash, no subgroup) is established. New `minih agent <verb>` (subgroup) is a different surface; no conflict, but mention in changelog so users notice the asymmetry.

---

## Prior Learnings

### 📚 PL-01: GitHub-only distribution is the established model
**Source**: `docs/plans/004-ci-versioning/ci-versioning-spec.md`
**Original Type**: decision
**What They Decided**:
> Users can install specific versions via `npx github:AI-Substrate/minih@v0.2.0`. No npm registry publish — GitHub is the sole distribution channel.

**Why it matters**: The agent-pack registry should follow the same convention — git URLs, no npm. Don't introduce a new distribution mechanism.

**Action**: Registry entries use `github:owner/repo` shorthand or full HTTPS URLs.

### 📚 PL-02: Bundling static assets via dist/templates/ + scripts/copy-schemas.js
**Source**: Plan 015 (`agent-readme` command) + init scaffolder
**Original Type**: pattern
**What They Did**:
> Static markdown lives in `src/templates/`, copied to `dist/templates/` by the build. Code reads via `fileURLToPath(new URL('../../templates/foo.md', import.meta.url))`.

**Why it matters**: This is the path for shipping the baked-in agent registry. Reuse the pattern; don't reinvent.

**Action**: `src/templates/agents-registry.json` → bundled. Or inline TypeScript const if registry is small.

### 📚 PL-03: Companion-mode is now load-bearing — distribution is the next bottleneck
**Source**: Plan 016 (`a2a-companion-protocol`) + AGENTS.md "Companion-mode is mandatory"
**Original Type**: insight
**What we know**:
> The companion is now required for code-editing sessions. We have one canonical implementation. Other projects want it. Hand-copying is painful.

**Why it matters**: This plan's value prop is "one command to share `code-review-companion` to any project." That's the killer demo.

**Action**: Make `minih agent install code-review-companion` the headline scenario in plan-1b spec. Test it end-to-end as the v1 acceptance criterion.

---

## Domain Context

### Existing domains relevant to this research

| Domain | Relationship | Relevant Contracts | Key Components |
|--------|-------------|-------------------|----------------|
| `cli` | directly relevant | New `agent <verb>` subcommand group | New `src/cli/commands/agent.ts` |
| `runner` | directly relevant | Existing `validateSlug`, `listAgents`, `resolveAgent` (consumed) + maybe new `agent-pack/` module for source bookkeeping + tarball extract | Possibly `src/runner/agent-pack/install.ts`, `src/runner/agent-pack/registry.ts`, `src/runner/agent-pack/source.ts` |
| `adapter` | NOT involved | n/a | n/a |
| `mcp` | NOT involved | n/a | n/a |

### Domain map position

```
cli
 └── agent.ts (new)
       └── runner/agent-pack/* (new, internal)
             ├── registry.ts (read baked-in catalog)
             ├── source.ts (manage .minih-source.json sidecar)
             ├── fetch.ts (HTTP tarball download via Node fetch)
             └── extract.ts (tar.gz → temp dir → atomic swap)
```

**No new domain needed.** This is a `cli` feature backed by new internal helpers in `runner`. Optional future extraction: if remote-fetch + extract grows beyond ~300 lines, extract `agent-pack` as its own domain. For v1, fold it under `runner`.

### Domain dependency direction
- `cli` → `runner` (existing direction, no violation)
- `runner` → external network (new — first time runner does HTTP). Consider: should the network call be behind an interface (like `IAgentAdapter` for the SDK)? For v1, probably overkill — it's just `fetch()`. Revisit if testing shows pain.

---

## Critical Discoveries

### 🚨 CD-01: First HTTP code in src/ — testing strategy needs care
**Impact**: High
**What**: minih has no existing HTTP/network code. Install introduces it.
**Why it matters**: Tests that hit real GitHub will be flaky and rate-limited. Need a fake/injection seam (à la `IAgentAdapter` for SDK).
**Required action**: In plan-3 architect, design `AgentPackFetcher` interface with a `FakeAgentPackFetcher` for tests. Real implementation uses Node `fetch()`. CI tests use the fake.

### 🚨 CD-02: Atomic swap on upgrade is non-trivial
**Impact**: Medium-High
**What**: An upgrade that fails partway through could leave the agent folder broken (some old files, some new). Atomic-swap pattern: download to temp dir → validate complete → rename source files into place → preserve runtime dirs.
**Why it matters**: A broken `prompt.md` mid-upgrade kills the agent.
**Required action**: Document the atomic-swap algorithm in plan-2c-workshop (this deserves a workshop). Alternative: copy old files to `<slug>/.backup-<ts>/` first, then swap, then delete backup on success.

### 🚨 CD-03: Slug collisions between registry and existing agents
**Impact**: Medium
**What**: User has a project with their own `agents/code-review-companion/` (hand-rolled). Then runs `minih agent install code-review-companion`. What happens?
**Why it matters**: We can't silently overwrite user work.
**Required action**: E183 AGENT_PACK_ALREADY_INSTALLED if `<agentsDir>/<slug>/` exists AND has no `.minih-source.json` (i.e., not previously installed by us). Force user to either rename their local copy or pass `--force`.

---

## Modification Considerations

### ✅ Safe to add
- New file `src/cli/commands/agent.ts` (entirely new, no existing code touched)
- New module `src/runner/agent-pack/*` (entirely new)
- New error codes E180-E184 in `src/cli/output.ts`
- New static asset `src/templates/agents-registry.json`
- New entry in `scripts/copy-schemas.js` to copy registry to dist
- New tests under `test/cli/agent-install.test.ts`, `test/runner/agent-pack/*`

### ⚠️ Modify with caution
- `src/cli/index.ts` — add one `registerAgentCommand(program)` call. Trivial.
- `package.json#files` — already includes `dist`, no change.
- `scripts/copy-schemas.js` — add registry to copy list.

### 🚫 Do NOT change
- `src/runner/folder.ts` `listAgents`/`resolveAgent`/`validateSlug` — these are consumers, not modified.
- Existing CLI commands — purely additive feature.
- Coordination protocol (inbox/state/MCP) — completely orthogonal.

---

## External Research Opportunities

### Research Opportunity 1: GitHub tarball download + minimal tar extraction in modern Node
**Why needed**: First HTTP code in the project. Want zero (or minimal) deps. Need to download `GET /repos/{owner}/{repo}/tarball/{ref}` (302 redirect → gzipped tar) and extract to a temp dir.

**Source findings**: F-06, CD-01

**Ready-to-use prompt**:
```
/deepresearch "Best practices for downloading and extracting GitHub repository tarballs in modern Node.js (≥20.19) with zero or minimal dependencies. Context: building a CLI tool that needs to:
1. Call GitHub REST API: GET /repos/{owner}/{repo}/tarball/{ref}
2. Handle the 302 redirect to a temporary tarball URL
3. Download tar.gz response (10MB cap)
4. Extract to a temp directory
5. Optionally extract only a subpath of the tarball (e.g., agents/code-review-companion/*)
6. Move into final location with atomic rename

Specific questions:
- Built-in Node fetch + zlib.createGunzip + ??? for tar parsing — is there a built-in? Or is tar-stream / tar-fs the small popular choice?
- How to handle the 302 redirect cleanly (follow vs read Location header)?
- Streaming vs buffer — at 10MB cap, is buffer-then-extract simpler with negligible memory cost?
- Common gotchas: tarball top-level dir naming (GitHub adds <repo>-<sha>/ prefix), symlinks in archive (security), file mode preservation
- Authentication — using GH_TOKEN for private repos vs anonymous public

Please contrast 'tar-stream' vs 'tar-fs' vs writing a minimal tar reader, with code snippets for each."
```

**Save to**: `docs/plans/017-agent-pack-install/external-research/tarball-extract.md`

### Research Opportunity 2: Install manifest patterns — npm/pnpm/cargo conventions
**Why needed**: F-08 design choice (sidecar `.minih-source.json` vs top-level index). Want to reuse industry conventions where they fit.

**Source findings**: F-08

**Ready-to-use prompt**:
```
/deepresearch "Install manifest file conventions in popular package managers. Compare how npm (package-lock.json), pnpm (pnpm-lock.yaml), cargo (Cargo.lock), pip (requirements.txt + .dist-info/), homebrew, and apt store 'where did this come from' metadata for installed packages.

Context: building a per-folder install system for AI agent definitions. Each agent is a folder of static files (prompt.md, schemas). Want to track:
- Source URL (git or registry)
- Git ref / commit sha
- Install timestamp
- Whether locally modified after install

Specific questions:
- Sidecar inside the package vs central lockfile — when does each pattern win?
- How to detect 'user has modified the installed files since install' — checksum vs git-aware vs ignore?
- Versioning conventions for install manifests — what format minimizes future churn?
- Trust/verification: storing commit sha for tamper detection — is this worth it?

Recommend a minimal manifest schema for our use case (per-folder JSON sidecar tracking source URL + commit sha + install date)."
```

**Save to**: `docs/plans/017-agent-pack-install/external-research/install-manifest.md`

---

## Workshop Opportunities

These warrant `/plan-2c-workshop` deep-dives during planning:

1. **Atomic-swap upgrade algorithm** (CD-02) — temp dir + rename vs copy-aside-and-restore. Tradeoffs around partial-failure recovery.
2. **Trust & confirmation UX** (F-16) — what does the install flow look like? Show file list + commit sha before proceeding? `--yes` to skip? How loud is "this is from an unverified source"?
3. **Subpath URL syntax** (F-11) — npm-style `github:owner/repo#ref:subpath`, query string, separate flag, or auto-detect?
4. **Versioning + ref pinning** (F-12) — default to HEAD vs latest tag? Auto-tag-detection? Semver constraints?

---

## Recommendations

### If proceeding to plan-1b-specify
1. **Frame the headline scenario**: `minih agent install code-review-companion` works in 2 seconds in any project. That's the demo.
2. **Mention v1 scope explicitly excludes**: signature verification, npm-style version constraints, multi-source mirroring, private-repo flow polish.
3. **Decide naming early**: `minih agent <verb>` vs extend `minih list --available`. Suggest C: BOTH — `agent install/info/upgrade/remove` AND `list --available` flag, since `list` is the existing surface users know.
4. **Acceptance criteria** must include: install preserves `runs/`, `inbox/`, `state/` (the live-runtime directories).

### If skipping plan-1b and going straight to architect
Don't. The trust/confirmation UX (F-16) and subpath syntax (F-11) need clarification first.

### Watch for in clarify (plan-2)
- Q: Where does the registry live — bundled JSON or inline TS?
- Q: Subpath URL syntax?
- Q: Default ref behavior (HEAD vs latest tag)?
- Q: How to handle slug collision with hand-rolled local agent (E183 vs prompt vs auto-suffix)?
- Q: `agent list` vs `list --available` namespace decision?

---

## Appendix: File Inventory (anticipated)

### New files
| File | Purpose | Domain |
|---|---|---|
| `src/cli/commands/agent.ts` | Subcommand group: install/list/info/upgrade/remove | cli |
| `src/runner/agent-pack/index.ts` | Public exports | runner |
| `src/runner/agent-pack/registry.ts` | Read baked-in registry catalog | runner |
| `src/runner/agent-pack/source.ts` | Read/write `.minih-source.json` sidecar | runner |
| `src/runner/agent-pack/fetch.ts` | GitHub tarball fetch + size cap | runner |
| `src/runner/agent-pack/extract.ts` | tar.gz → temp dir + atomic swap | runner |
| `src/templates/agents-registry.json` | Baked-in catalog | shipped asset |
| `test/cli/agent-install.test.ts` | CLI install tests | test |
| `test/runner/agent-pack/*.test.ts` | Unit tests with FakeAgentPackFetcher | test |

### Modified files
| File | Change | Domain |
|---|---|---|
| `src/cli/index.ts` | + `registerAgentCommand(program)` | cli |
| `src/cli/output.ts` | + E180-E184 error codes | cli |
| `scripts/copy-schemas.js` | + copy registry.json | build |
| `docs/domains/cli/domain.md` | + agent install/info/upgrade history row | docs |
| `docs/domains/runner/domain.md` | + agent-pack composition + history row | docs |

### Untouched (confirms blast radius)
- `src/adapter/*` — unchanged
- `src/mcp/*` — unchanged
- `src/runner/folder.ts` (consumer only) — unchanged
- `src/runner/runner.ts` — unchanged
- All existing commands — unchanged

---

**Research Complete**: 2026-05-03T11:20:00+10:00
**Report Location**: `docs/plans/017-agent-pack-install/research-dossier.md`
