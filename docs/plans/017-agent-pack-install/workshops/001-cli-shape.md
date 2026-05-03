# Workshop 001 — Agent Pack CLI Shape

**Plan**: 017-agent-pack-install
**Status**: Draft for review
**Generated**: 2026-05-03T11:35:00+10:00
**Informed by**: `research-dossier.md` + `external-research/distribution-standards.md`

> The user said "we will workshop the exact CLI for this." This document presents the strawman shape for review, with explicit options where decisions remain.

---

## Design constraints (from research)

1. **GitHub-only distribution** (Plan 004) — every install reduces to "fetch git tree-ish, place files."
2. **Folder = agent** (existing convention) — `<agentsDir>/<slug>/` with `prompt.md` mandatory; schemas/instructions/outside.md optional; runtime dirs `runs/`/`inbox/`/`state/` are sacrosanct.
3. **Subcommand-group pattern** (`outside <verb>`, `inside <verb>`, `state <verb>`) — `agent <verb>` follows the same shape.
4. **JSON envelope on stdout, human output on stderr** — universal CLI contract.
5. **Closest analog is Claude Code Plugin Marketplaces** — adopt its conceptual model: per-agent `agent.json` + per-repo `.minih/marketplace.json` catalog.
6. **Both registry-slug and raw-URL inputs** — well-known shortcuts AND arbitrary git URL.
7. **`--agents-dir` global flag must be honored** as the install destination.

---

## Verbs (proposed)

```
minih agent install <ref>           # install OR upgrade — same operation under the hood
minih agent remove <slug>           # uninstall (with safety prompt unless --yes)
minih agent info <slug>             # show what an agent does + files + source
minih agent list [--available]      # list installed (default) or installable (registry catalog)
minih agent search <query>          # search registry by description/tags (deferred to v2?)
```

**Five verbs.** Per user direction (2026-05-03): **install and upgrade are the same operation**. The semantic is "ensure this agent is installed from this source at this ref" — first time it's a fresh install, second time it's a re-pull. Either way the behavior is identical: download, validate, atomic-swap source files, preserve runtime dirs (`runs/`/`inbox/`/`state/`).

This is the `npm install` model: one verb, idempotent, knows whether it's adding or updating from local state. It also dodges a whole class of UX foot-guns ("do I run install or upgrade?").

`search` is **deferred to v2** — listed for naming-collision avoidance.

---

## `minih agent install <ref>` — the headline command

### Three input forms (auto-detected)

| Form | Example | Resolution |
|---|---|---|
| **Registry slug** | `minih agent install code-review-companion` | Look up in baked-in registry → resolve to `{url, ref, subpath}` → fetch + extract |
| **Shorthand git URL** | `minih agent install github:AI-Substrate/minih#main:agents/code-review-companion` | npm-style — parse `host:owner/repo[#ref][:subpath]` → fetch + extract |
| **Full HTTPS URL** | `minih agent install https://github.com/AI-Substrate/minih.git#main:agents/code-review-companion` | Same parser, just permissive |

**Detection rule:**
- Starts with `http://`/`https://` → URL form.
- Starts with `github:`/`gitlab:`/`bitbucket:` → shorthand.
- Otherwise → registry slug. Validate via `validateSlug()`. If miss in registry → E180 (with "did you mean" Levenshtein hint).

### Flags

| Flag | Purpose | Default |
|---|---|---|
| `--ref <branch\|tag\|sha>` | Override default ref (HEAD of default branch) | repo's default branch |
| `--subpath <path>` | Override repo subpath (overrides URL fragment if both given) | URL-derived or registry-derived |
| `--as <slug>` | Install under a different local slug (for collision avoidance / aliasing) | source slug |
| `--check` | Resolve + report install/upgrade status; no writes (replaces `--dry-run`) | false |
| `--force` | DANGER — overwrite even runtime dirs (rarely needed; emergency reset) | preserve runtime |
| `--yes` | Skip confirmation prompts (CI mode) | prompt for non-registry sources |
| `--from <url>` | Use a custom registry URL/catalog file (advanced) | bundled minih registry |

**No `--upgrade` flag needed** — `install` is idempotent. If the slug already exists locally, behavior depends on local state:
- `.minih-source.json` exists AND `source.url` matches → re-pull at requested ref → atomic swap, preserve runtime dirs. (This is the upgrade case.)
- `.minih-source.json` exists AND `source.url` mismatches → E184 SOURCE_MISMATCH; user can `--force` to override or rename their local install.
- No `.minih-source.json` AND folder exists → user has hand-rolled an agent at that slug. E183 ALREADY_INSTALLED; user can `--force` to overwrite or `--as <new-slug>` to install alongside.

**`--check` replaces `--dry-run`** — it's a single read-only resolve that says "would this install/upgrade/no-op?" and exits. Maps cleanly to common pre-flight CI use cases.

### Confirmation UX (security-conscious)

For **registry sources** (curated by us): no prompt — they're trusted.

For **arbitrary git URLs**: print summary + require confirmation:

```
$ minih agent install github:somebody/sketchy-agent

  Source:    github:somebody/sketchy-agent
  Ref:       main (commit 4a2f819...)
  Files:     prompt.md (4.2 KB), instructions.md (1.1 KB), output-schema.json (820 B)
  Total:     6.1 KB
  Verified:  ⚠️  no — this is not a curated registry agent

  Install to: /path/to/cwd/agents/sketchy-agent/

Proceed? [y/N]
```

`--yes` skips the prompt (CI mode). The prompt always shows source URL + commit sha + total size (DoS sanity check at 10 MB).

### Output (success — JSON envelope + human stderr)

**Action verb in output reflects what actually happened**: `installed` (fresh), `upgraded` (replaced existing), `unchanged` (commit sha matched local). Same command, different verbs in the report.

**stderr (human, fresh install):**
```
✓ Installed code-review-companion
  Source:    github:AI-Substrate/minih@main:agents/code-review-companion
  Commit:    6cab913ab40
  Files:     prompt.md, instructions.md, outside.md, output-schema.json, inside-state.schema.json, outside-state.schema.json
  Location:  /path/to/cwd/agents/code-review-companion/

  Next: minih run code-review-companion
```

**stderr (human, upgrade case):**
```
✓ Upgraded code-review-companion
  Source:    github:AI-Substrate/minih@main:agents/code-review-companion
  Commit:    6cab913ab40 → a1b2c3d4e5f (3 commits ahead)
  Files:     6 source files swapped
  Preserved: runs/ (87 entries), inbox/, state/

  Next: minih run code-review-companion
```

**stderr (human, no-op case):**
```
✓ code-review-companion already at requested ref (commit 6cab913ab40 — main HEAD)
  No changes.
```

**stdout (envelope):**
```json
{"command":"agent install","status":"ok","timestamp":"2026-05-03T11:30:00Z","data":{"slug":"code-review-companion","action":"installed","source":{"type":"registry","url":"github:AI-Substrate/minih","ref":"main","subpath":"agents/code-review-companion","commitSha":"6cab913ab40"},"previousCommitSha":null,"installedFiles":["prompt.md","instructions.md","outside.md","output-schema.json","inside-state.schema.json","outside-state.schema.json"],"installPath":"/path/to/cwd/agents/code-review-companion","sourceManifestWritten":".minih-source.json"}}
```

`action` ∈ `"installed" | "upgraded" | "unchanged"` lets scripts branch on what actually happened. `previousCommitSha` is non-null only on `upgraded`.

### Errors

| Code | Trigger | Resolution hint |
|---|---|---|
| E108 | Bad slug (`validateSlug` rejects) | Use `[a-zA-Z0-9_-]{1,64}` |
| E180 | Registry miss + not a URL | `minih agent list --available` to see installable |
| E181 | Network/git error | Check connectivity / `--ref` validity |
| E182 | Downloaded archive missing `prompt.md` | Verify URL points at agent root or use `--subpath` |
| E183 | Folder exists locally with no `.minih-source.json` (hand-rolled agent) | `--force` to overwrite, or `--as <new-slug>` to install alongside |
| E184 | `.minih-source.json` source URL mismatch | `--force` to override (emergency only) |

---

## `minih agent info <slug>`

Read-only inspector. Combines:
- `.minih-source.json` (source URL + commit + install date)
- `agent.json` (the manifest — file list with descriptions, version, etc.)
- `prompt.md` frontmatter via `parseFrontmatter()` (description/tags/coordination)
- File on-disk presence/size check (matches manifest? any drift?)

```
$ minih agent info code-review-companion

  Slug:         code-review-companion
  Description:  Power-On-Mode companion that reviews each commit live
  Tags:         companion, review, coordination
  Coordinated:  ✓ enabled
  Version:      0.1.0

  Source:       github:AI-Substrate/minih (registry)
  Ref:          main
  Subpath:      agents/code-review-companion
  Commit:       6cab913ab40
  Installed:    2026-05-03T11:30:00Z (1 hour ago)
  Modified:     ✓ unchanged since install (checksum match)

  Files (from manifest):
    ✓ prompt.md                          4.2 KB   Agent prompt with frontmatter — REQUIRED
    ✓ instructions.md                    1.1 KB   System instructions appended after prompt
    ✓ outside.md                         2.8 KB   Outside-side coordination contract
    ✓ output-schema.json                 820 B    AJV schema validating the agent's report envelope
    ✓ inside-state.schema.json           640 B    Schema for inside coordination state
    ✓ outside-state.schema.json          720 B    Schema for outside coordination state
    ✓ scripts/post-install.sh            220 B    Optional post-install hook (informational only)
    ✓ examples/sample-briefing.md        1.4 KB   Example briefing message for first-time users
    ✓ README.md                          3.6 KB   Human-facing overview of this companion's protocol

  Runtime data (not part of agent definition):
    runs/    87 entries   (most recent: 2026-05-03T10:00Z)
    inbox/   present
    state/   present
```

The `✓` indicates each file is present + matches install-time checksum; `⚠️` would indicate a drift (file modified locally) or `✗` for missing.

**Open question Q3**: Should `info` also show "available upgrade" by checking the source remote? (Recommendation: only with `--check-remote` flag; default offline-only for speed.)

---

## `minih agent list [--available]`

Default = list installed agents (matches existing `minih list` behavior; `agent list` is just the namespaced version).

`--available` = list installable agents from the baked-in registry.

`--all` = list both with status column (installed / available / upgrade-available / source-mismatch).

```
$ minih agent list --available

  Slug                          Description                                   Source
  ──────────────────────────────────────────────────────────────────────────────────────────
  code-review-companion         Power-On-Mode companion (reviews each commit) github:AI-Substrate/minih
  coordination-loop-validator   Validates two-agent coordination flows         github:AI-Substrate/minih
  demo-companion                Demo companion for FX008/FX009 verification    github:AI-Substrate/minih
  feedback-digest               Aggregates retros across runs                  github:AI-Substrate/minih
  smoke-test                    Minimal one-shot smoke test                    github:AI-Substrate/minih
```

**Open question Q4**: Existing `minih list` already exists. Do we deprecate it in favor of `minih agent list`, or keep both? (Recommendation: keep `minih list` as a top-level alias for `minih agent list` — backward compat. Mention in plan-016 changelog.)

---

## `minih agent remove <slug>`

```
$ minih agent remove smoke-test

  ⚠️  About to remove agent 'smoke-test':
      Location: /path/to/cwd/agents/smoke-test/
      Files:    prompt.md, instructions.md, output-schema.json
      Runtime:  runs/ (12 entries), inbox/, state/

  Runtime data WILL be deleted. To preserve it, move the runs/ folder first.

Proceed? [y/N]
```

Flags:
- `--keep-runtime` — preserve `runs/`/`inbox/`/`state/` even though folder is being deleted (move them to `<agentsDir>/.archived/<slug>-<ts>/`).
- `--yes` — skip prompt.

Errors:
- E121 AGENT_NOT_FOUND if slug doesn't resolve.
- E143 INSIDE_READ_ONLY (or new code) if there's an active run for that slug.

---

## Agent pack contents — arbitrary files via manifest

**Per user direction (2026-05-03)**: agent packs **may carry any arbitrary files** — not just `prompt.md` + schemas. Scripts, examples, READMEs, helper docs, sample data, anything an agent author wants to ship alongside their agent.

The **`agent.json` manifest is the source of truth** for what files come in the pack. Each entry has:
- `path` — relative to agent root
- `description` — one-line description (surfaced in `agent info`)

```json
{
  "name": "code-review-companion",
  "version": "0.1.0",
  "description": "Power-On-Mode companion",
  "files": [
    { "path": "prompt.md",                  "description": "Agent prompt with frontmatter — REQUIRED" },
    { "path": "instructions.md",            "description": "System instructions appended after prompt" },
    { "path": "outside.md",                 "description": "Outside-side coordination contract" },
    { "path": "output-schema.json",         "description": "AJV schema validating the agent's report" },
    { "path": "scripts/post-install.sh",    "description": "Optional post-install hook (NOT executed automatically; informational only)" },
    { "path": "examples/sample-briefing.md","description": "Example briefing message for first-time users" },
    { "path": "README.md",                  "description": "Human-facing overview of this companion's protocol" }
  ]
}
```

### Install behavior

1. **Read `agent.json` from source** (the manifest). If absent → fall back to "implicit manifest" (just `prompt.md` + canonical optional files: `instructions.md`, `output-schema.json`, `input-schema.json`, `outside.md`, `inside-state.schema.json`, `outside-state.schema.json`). This keeps trivial agents zero-config.
2. **Validate the manifest:**
   - Must contain `prompt.md` — else E182.
   - **MUST NOT contain runtime dir paths** (`runs/...`, `inbox/...`, `state/...`) — else E182. Hard guard against malicious manifests overwriting user runtime data.
   - All paths must be relative + path-traversal-safe (no `..`, no leading `/`, no null bytes). E108 on violation.
3. **Copy each file listed.** Any file in the source not listed in the manifest is **ignored** (deterministic installs; no `.git/`, no build artifacts).
4. **Compute checksums per file** and write `.minih-source.json` with the manifest's checksums baked in.
5. **No code execution.** Even if the manifest lists a `scripts/install.sh`, we copy the file but never run it. The `description` may indicate "informational only" or "run manually after install."

### Implications

- **`info` displays the manifest's file list with descriptions** (see updated `info` output above).
- **`upgrade` (= `install` again) computes a manifest diff**: added files (new in upstream), removed files (no longer in upstream — deleted from local), changed files (checksum diff — replaced).
- **Drift detection**: post-install, if the on-disk checksum of any tracked file differs from the manifest's recorded checksum, `info` reports `⚠️` (modified locally). Useful for spotting accidental edits.
- **Implicit-manifest agents** (no `agent.json` in source) get a synthesized manifest at install time using the canonical-files convention. Stored in `.minih-source.json` for upgrade fidelity.

### Out-of-scope for v1

- **Post-install hooks** (auto-running `scripts/post-install.sh`) — security/footgun; punt.
- **File templating** at install time (e.g., `{{slug}}` substitution) — keep installs as bytewise copies.
- **Pre-install dependency resolution** (e.g., "this agent needs MCP server X") — note in description, no programmatic enforcement.

---



## Registry shape & distribution model (`dist/templates/agents-registry.json`)

### How are the "baked-in" agents stored? — DECISION (2026-05-03)

> **We bake the GitHub URL only, not the agent files.** This decouples agent updates from CLI releases — push a fix to `main`, every minih user gets it on their next `minih agent install <slug>`. No re-ship of the CLI.

#### What ships in the npm package

**Just one tiny file** — `dist/templates/agents-registry.json`. Initial v1 ships with exactly one canonical agent; we grow the list deliberately (see "Inclusion criteria" below).

```json
{
  "$schema": "...",
  "version": "1",
  "agents": [
    {
      "slug": "code-review-companion",
      "url": "github:AI-Substrate/minih",
      "ref": "main",
      "subpath": "agents/code-review-companion",
      "description": "Power-On-Mode companion that reviews each commit live",
      "tags": ["companion", "review", "coordination"],
      "since": "0.4.0",
      "minihVersion": ">=0.3.0"
    }
  ]
}
```

Future entries (post-v1, as agents generalize) might include `feedback-digest`, `coordination-loop-validator`, or third-party pointers like:
```json
{
  "slug": "third-party-example",
  "url": "github:someone-else/their-agents",
  "ref": "main",
  "subpath": "agents/example",
  "description": "Example of a third-party registry entry",
  "tags": ["example"]
}
```

`since` records minih version when the agent was added — surfaced in `agent list --available`.
`minihVersion` is a semver range — install warns if the user's CLI is too old.

There is **no `bundled` flag**. There is **no `dist/templates/agents/<slug>/`** directory. Install always fetches.

#### Why URL-only (not bundled)

| Concern | URL-only | Bundled |
|---|---|---|
| Update agent without CLI release | ✅ push to `main` → next install picks it up | ❌ requires npm publish + user upgrade |
| Network required for install | ⚠️ yes (but it's `npm install`-class, normal) | ✅ no |
| npm package size | ✅ negligible (~5 KB for registry only) | ⚠️ +75-150 KB |
| GitHub uptime dependency | ⚠️ install-time only | ✅ none at install time |
| Reproducibility | ✅ commit sha pinned in `.minih-source.json` post-install | ✅ same |
| Velocity | ✅ canonical agents iterate freely | ❌ updates ride CLI release cadence |

**The user's call** (2026-05-03): URL-only wins because **canonical agents will iterate faster than the CLI**. Forcing a CLI release for every prompt tweak in `code-review-companion` would be a step backward from the harness-improvement velocity we already have.

**Mitigation for the network-at-install concern**: it only matters once. After install, the agent files live in `<user-cwd>/agents/<slug>/`. The runtime never touches GitHub again unless the user explicitly runs `minih agent install <slug>` to upgrade. `minih run`, `minih view`, `minih outside`, etc. are all fully offline.

### Where canonical agents live in the repo source tree

> **Same place they already do.** `agents/<slug>/` at the repo root.

The minih repo has lots of agents under `agents/` — but most of them are **NOT shipped**. They exist for developing minih itself: test fixtures, minih-meta tools (review your own prompt, audit minih conventions, validate coordination loop), onboarding fixtures specific to this repo. Installing those into a random user's project would be confusing at best, broken at worst.

> **We do NOT auto-discover from `agents/`.** Agents are shipped only by being added explicitly to the registry. This is a deliberate curation decision per user direction (2026-05-03): *"some of them are meant for developing this particular project."*

```
agents/
  _shared/                          # shared preamble (Plan 015 — never installable)

  # 🟢 Canonical — explicitly registered & installable in any project
  code-review-companion/            #   the headline Power-On-Mode companion

  # 🔴 Internal / project-specific — NOT in registry, NOT installable via slug
  smoke-test/                       #   test fixture — exercises minimal one-shot flow
  mcp-smoke-test/                   #   test fixture — exercises MCP server boot
  hello-world/                      #   test fixture — minimal example for development
  coordination-smoke-test/          #   test fixture — exercises coordination protocol
  first-time-experience/            #   onboarding fixture specific to minih repo
  convention-check/                 #   minih-meta — audits minih's own conventions
  prompt-review/                    #   minih-meta — reviews prompt files in minih
  self-review/                      #   minih-meta — internal review pass
  code-review/                      #   superseded by code-review-companion
  feedback-digest/                  #   minih-meta — aggregates minih's own retros
  coordination-loop-validator/      #   minih-meta — validates minih's coordination
  demo-companion/                   #   internal demo for FX008/FX009 verification
```

**No file moves required.** `agents/<slug>/` continues to serve two roles:
1. **Dogfooding**: minih maintainers run all agents (canonical + internal) directly from this repo (`minih run code-review-companion` in cwd `/path/to/minih/`).
2. **The fetch target for canonical entries**: when a user runs `minih agent install code-review-companion` in their own project, minih downloads `agents/code-review-companion/*` (per the manifest) from `github:AI-Substrate/minih@<ref>`.

The repo root is BOTH the development workspace AND the canonical distribution point. No duplication.

### Curation — the registry is the only allowlist

`src/templates/agents-registry.json` is the **single source of truth for "which agents are official."** Anything listed there can be installed by slug; **anything else in `agents/` is invisible to the install path** — `minih agent install hello-world` returns E180 (registry miss), even though `agents/hello-world/` exists in the source repo.

This is enforced by code, not by convention: install only resolves slugs through the registry; it never scans `agents/` of the source repo.

#### Inclusion criteria (when does an agent earn registry status?)

To be promoted from internal-only to registered, an agent should satisfy:

1. **Universally useful** — works in ANY project using minih, not just developing minih itself.
2. **Self-contained** — doesn't depend on minih's internal docs, plans, or domain conventions.
3. **Stable surface** — the agent's `prompt.md` and `output-schema.json` are not in flux.
4. **Owned** — someone (in v1: minih maintainers) commits to keeping it working.
5. **Documented** — `agent.json` description is concrete; tags are accurate; README.md (if present) explains the workflow.

Internal agents stay internal until they meet all five. There's no shame in being internal — most agents in the repo serve their dev purpose perfectly well without being public.

#### Initial registry set (v1)

Start small and grow deliberately:

| Slug | Status | Notes |
|---|---|---|
| `code-review-companion` | ✅ ship in v1 | Headline use case. Power-On-Mode companion. Mature surface (Plans 016, 017). |
| `feedback-digest` | 🟡 candidate | Aggregates retros — universally useful but currently has minih-meta assumptions in its prompt; needs a small generalization PR before registry-ready. |
| `coordination-loop-validator` | 🟡 candidate | Validates coordination flows — useful for anyone building two-sided agents. Same caveat as feedback-digest. |
| `demo-companion` | ❌ stays internal | It's a demo for FX008/FX009 verification specific to minih's own work; not generally applicable. |
| All other current agents | ❌ stay internal | Per the table above. |

**v1 ships with ONE canonical agent** (`code-review-companion`) and a registry framework that lets us promote others on a per-PR basis as they generalize.

### Each canonical agent needs an `agent.json` manifest

The agent's own `agent.json` (with `files[]` and per-file descriptions — see "Agent pack contents — arbitrary files via manifest" above) is what the install fetcher uses to decide which files to download from the source repo. **No `agent.json` ⇒ install falls back to the implicit-manifest convention** (just `prompt.md` + canonical optional files). For canonical agents with extras (scripts, examples, READMEs), the manifest is required.

This is plan 017's "first implementation task": author `agent.json` for each canonical agent we register.

### The build step (tiny — one file copy)

`scripts/copy-schemas.js` extends by one entry: copy `src/templates/agents-registry.json` → `dist/templates/agents-registry.json`. That's it.

```diff
 // scripts/copy-schemas.js
 const filesToCopy = [
   ['src/schemas/...', 'dist/schemas/...'],
   ['src/templates/shared-preamble.md', 'dist/templates/shared-preamble.md'],
   ['src/templates/retros-readme.md', 'dist/templates/retros-readme.md'],
+  ['src/templates/agents-registry.json', 'dist/templates/agents-registry.json'],
 ];
```

There's **no `scripts/copy-agents.js`**. There's **no `dist/templates/agents/<slug>/`**. The build pipeline stays simple.

### Install algorithm (URL-only, all paths fetch)

When a user runs `minih agent install <slug-or-url>`:

1. **Resolve the source**:
   - If input is a registry slug: read `dist/templates/agents-registry.json`, find the entry, get `url + ref + subpath`.
   - If input is a git URL (shorthand or HTTPS): parse it directly into `url + ref + subpath`.
2. **Fetch the source** from GitHub:
   - Use Node 20+ `fetch()` to call `GET /repos/{owner}/{repo}/tarball/{ref}` (302 redirect → tarball).
   - Cap at 10 MB (DoS guard).
   - Extract `<repo>-<sha>/<subpath>/` to a temp dir.
3. **Read `agent.json`** from the fetched temp dir:
   - If present: copy each file in `files[]` to `<user-cwd>/agents/<slug>/<path>`.
   - If absent: synthesize a manifest from the canonical-files convention (`prompt.md` + standard schemas + `instructions.md` etc.) and copy those.
4. **Write `.minih-source.json`** with `source.type: "git"`, source URL, ref, recorded commit sha, file checksums.
5. **Preserve runtime dirs** (`runs/`, `inbox/`, `state/`) on upgrade — they're not in the manifest, never touched.

The `.minih-source.json` sidecar is what makes re-running `minih agent install <slug>` work as upgrade — see "How the easy-upgrade flow works" above.

### Self-install safeguard (dogfooding minih in the minih repo)

If you're working in the minih repo itself and run `minih agent install code-review-companion`, minih would fetch from `github:AI-Substrate/minih@main` and overwrite the LOCAL `agents/code-review-companion/` — which is your unmerged source-of-truth. **That would clobber unstaged work.**

Two safeguards:
1. **Detection**: if `<user-cwd>/agents/<slug>/` is the resolved source path of the registry entry's `url`, AND the cwd is inside the source repo, refuse with: `"Self-install detected. You're in the minih source repo and 'agents/code-review-companion/' is the canonical source for this slug. Installing on top would clobber unstaged work. Use --as <new-slug> if you really need a separate copy."`
2. **`--as <new-slug>`** as the escape hatch — installs under a different local slug.

#### Resulting layout (what users get when they `npm install minih`)

```
dist/
  cli/
    index.js
    ...
  runner/
  adapter/
  mcp/
  schemas/
  templates/
    agents-registry.json             # ← the only new file
    shared-preamble.md               # (existing, Plan 015)
    retros-readme.md                 # (existing, Plan 011)
```

Total addition to the npm package: **one JSON file (~5 KB)**. No bundled agents.

### Curation rule for v1

**v1 registry contains exactly one agent**: `code-review-companion`. This is deliberate — start small, prove the install path works end-to-end against the headline use case, then promote others (`feedback-digest`, `coordination-loop-validator`, etc.) as they generalize and pass the inclusion criteria above.

Internal-only agents in `agents/` stay where they are. They're not installable via slug, but they remain dogfooded in the minih repo for development.

Third-party registry entries (pointing at non-AI-Substrate repos) are out of scope for v1. v2 considers community contributions; for now, anyone wanting to share an agent uses the raw-URL install path (`minih agent install github:someone/their-agent`).

**Open question Q5**: Should the registry file be JSON (easy to edit) or TS const (type-safe, but PRs from non-coders harder)? (Recommendation: JSON for community-friendliness — and JSON ships easier through the existing `dist/templates/` pattern.)

### `.minih-source.json` — the install-time provenance sidecar

**Every install writes a `.minih-source.json` into the agent folder** (per user direction 2026-05-03 — *"they should contain a reference to where it came from so you can just upgrade it super easy"*). This sidecar is the **single source of truth for "where did this agent come from?"** and is the load-bearing piece that makes `minih agent install <slug>` re-runnable as upgrade.

**Registry-source install** (canonical agent fetched from the registry's URL):
```json
{
  "schemaVersion": "1",
  "slug": "code-review-companion",
  "source": {
    "type": "registry",
    "registrySlug": "code-review-companion",
    "url": "github:AI-Substrate/minih",
    "ref": "main",
    "subpath": "agents/code-review-companion",
    "commitSha": "6cab913ab40"
  },
  "installedAt": "2026-05-03T11:30:00Z",
  "manifestVersion": "0.1.0",
  "fileChecksums": {
    "prompt.md":                  "sha256:abc...",
    "instructions.md":            "sha256:def...",
    "outside.md":                 "sha256:...",
    "output-schema.json":         "sha256:...",
    "inside-state.schema.json":   "sha256:...",
    "outside-state.schema.json":  "sha256:..."
  }
}
```

**Direct-URL install** (user passed a raw git URL, not a registry slug):
```json
{
  "schemaVersion": "1",
  "slug": "third-party-example",
  "source": {
    "type": "url",
    "url": "github:someone-else/their-agents",
    "ref": "main",
    "subpath": "agents/example",
    "commitSha": "a1b2c3d4e5f"
  },
  "installedAt": "2026-05-03T11:30:00Z",
  "manifestVersion": "0.0.1",
  "fileChecksums": { "...": "..." }
}
```

**Why every field is there:**

| Field | Powers what |
|---|---|
| `source.type` | `"registry"` (slug looked up in catalog) vs `"url"` (raw user-provided URL) — affects how `info`/`list` display origin, but install fetch path is the same |
| `source.registrySlug` | (registry only) The slug used at install time — re-runs use `agents-registry.json` to re-resolve, which lets us change the registry's `url`/`ref`/`subpath` over time and the user's installed agents follow on next install |
| `source.url` + `source.ref` + `source.subpath` | Exact "where these specific files came from" — recorded for audit/debugging even on registry installs |
| `source.commitSha` | What we've got locally — diffed against remote HEAD to detect "upgrade available" |
| `installedAt` | Surfaced in `info` ("installed 1 hour ago") |
| `manifestVersion` | Version from the source's `agent.json` — surfaced in `info`, drives "upgrade available" UX |
| `fileChecksums` | Per-file install-time hash — `info` uses these to detect drift (user edits) and re-install-as-upgrade uses them to compute the diff (added/removed/changed) |

### How the easy-upgrade flow works (the headline)

The user's workflow is **dirt simple, by design**:

```bash
# Install once.
$ minih agent install code-review-companion
✓ Installed code-review-companion (registry → github:AI-Substrate/minih@main, commit 6cab913ab40)

# Days later, upstream has popped 4 commits worth of fixes.
# You just run install again — it's idempotent + checks the remote:
$ minih agent install code-review-companion --check
ℹ️ code-review-companion: upgrade available
  Current:    commit 6cab913ab40
  Latest:     github:AI-Substrate/minih@main (commit a1b2c3d4e5f, +4 commits)
  Files:      2 changed, 0 added, 0 removed

# One command to apply:
$ minih agent install code-review-companion
✓ Upgraded code-review-companion
  Source:    github:AI-Substrate/minih@main:agents/code-review-companion
  Commit:    6cab913ab40 → a1b2c3d4e5f
  Files:     prompt.md, instructions.md (2 changed)
  Preserved: runs/ (87 entries), inbox/, state/
```

**This is the magic loop the user asked for.** No new verb. No `upgrade` command. No `--upgrade` flag. Just `minih agent install <slug>` again. The sidecar tells minih where to look; minih fetches the latest commit; if it differs, atomic-swap the source files; runtime dirs are preserved untouched. **No CLI release required for canonical-agent updates** — pushes to `main` flow through to every minih user on their next install.

Flag variants:
- **`install` alone** — fetches HEAD of the recorded `source.ref` (default `main`).
- **`install --ref <branch|tag|sha>`** — pin to a specific upstream point. Sidecar updates to record the new ref.
- **`install --check`** — read-only "would this upgrade?" report. Hits the remote, no writes.

### What `agent info` shows about source

```
Source:       github:AI-Substrate/minih (registry)
Ref:          main
Subpath:      agents/code-review-companion
Commit:       6cab913ab40
Installed:    2026-05-03T11:30:00Z (1 hour ago)
Modified:     ✓ unchanged since install (all checksums match)
Upstream:     ⓘ run `minih agent info code-review-companion --check-remote` to compare against main HEAD
```

With `--check-remote`:
```
Upstream:     ⚠️  4 commits behind main (latest: a1b2c3d4e5f, 2 days ago)
              → run `minih agent install code-review-companion` to upgrade
```

### `minih agent list --available` UX

```
$ minih agent list --available

  Slug                          Source                          Description                                    Status
  ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  code-review-companion         github:AI-Substrate/minih       Power-On-Mode companion (reviews each commit) ✓ installed
  coordination-loop-validator   github:AI-Substrate/minih       Validates two-agent coordination flows         not installed
  demo-companion                github:AI-Substrate/minih       Demo companion for FX008/FX009 verification    not installed
  third-party-example           github:someone-else/their-agents Example of a third-party registry entry        not installed
```

`Source` shows the registry-recorded URL. `Status` is local: `✓ installed` / `not installed`.

With `--check-remote`, the Status column hits the remote per-row (slow but useful for "what needs updating?"):
- `✓ installed (latest)` — local commit matches remote HEAD
- `⚠️ installed (4 behind)` — upgrade available, just run install again
- `⚠️ installed (drift)` — local files modified after install (`fileChecksums` mismatch)

---

## Decisions still open (rolled-up open questions)

| # | Question | Status |
|---|---|---|
| ~~Q1~~ | ~~`upgrade` as separate verb vs `install --upgrade`?~~ | ✅ **RESOLVED 2026-05-03**: Single `install` verb — idempotent. No `upgrade` verb, no `--upgrade` flag. `install` figures out fresh-vs-replace from local state. |
| Q2 | On upgrade-via-install, delete files removed upstream? | **Yes — surgical sync per manifest**: files in old manifest but not new are removed; files outside manifest never touched. Runtime dirs sacrosanct. |
| Q3 | `info` checks remote for upgrades? | **Only with `--check-remote`** flag (offline default) |
| Q4 | Deprecate `minih list` in favor of `minih agent list`? | **Keep both** — `minih list` aliases to `minih agent list` |
| Q5 | Registry as JSON or TS const? | **JSON** for community-friendliness |
| ~~Q6~~ | ~~`agent.json` mandatory or optional?~~ | ✅ **RESOLVED 2026-05-03**: `agent.json` is **the manifest** that lists pack contents with descriptions. Optional ONLY for trivial agents (synthesized from canonical-files convention at install time + persisted into `.minih-source.json`). Non-trivial packs (any extras beyond the canonical set) MUST ship `agent.json`. |
| Q7 | `.minih/marketplace.json` per-repo catalog now or v2? | **v2** — for v1 just registry + raw URL |
| Q8 | Subpath syntax: `#ref:subpath` (npm-style) or `?path=` or `--subpath` flag? | **All three** — fragment for shorthand, `?path=` for HTTPS, flag as override |
| Q9 | `--ref` default: HEAD or latest tag? | **HEAD of default branch** in v1; tag-aware later |
| Q10 | Confirmation prompt for non-registry URLs? | **Yes — bypassable with `--yes`** |
| Q11 | Tarball size cap? | **10 MB** for v1; configurable later |
| Q12 | tar parser dep — `tar-stream` vs hand-written? | Spawn deepresearch (R1 from research-dossier) |

---

## What plan-1b-specify needs to lock down

1. The 5-verb list (`install`, `info`, `list`, `remove`, plus `search` deferred).
2. Q4, Q7 — these affect surface-area shape (`minih list` alias; per-repo catalog timing).
3. Acceptance criterion: `minih agent install code-review-companion` from a fresh checkout works in <5 seconds and ends with `minih run code-review-companion` succeeding.
4. Acceptance criterion: re-running `minih agent install code-review-companion` after manual edits to `runs/` preserves all run data (idempotent install = upgrade).
5. Acceptance criterion: arbitrary git URL install requires confirmation prompt unless `--yes` (security default).
6. Acceptance criterion: agent pack with arbitrary extras (e.g., `examples/sample.md`, `README.md`) installs all manifest-listed files; `info` shows each with description.

---

## What plan-2-clarify must answer

Q2, Q3, Q5, Q8, Q9, Q10, Q11. Q12 may be punted to architect (it's an implementation choice).

---

## Followup workshop opportunities

- **W2 (atomic-swap install/upgrade algorithm)** — Q2 surgical-sync details; partial-failure recovery; checksum strategy.
- **W3 (subpath URL syntax)** — Q8 is the focus; should explore real-world examples.
- **W4 (versioning + ref pinning)** — Q9; semver constraints for v2.
- **W5 (manifest schema design)** — `agent.json` `files[]` shape, validation rules, runtime-dir denylist enforcement, implicit-manifest fallback rules.

