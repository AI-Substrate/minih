# Agent Packs

Install, inspect, list, and upgrade `minih` agents from a curated registry, any public git URL, or a local filesystem path. Each install is **idempotent**, **provenance-tracked** via a sidecar, and **drift-detected** so you can tell at a glance whether an installed agent matches its source.

This guide is the surface reference. For the broader companion-mode protocol, see [`companion-mode.md`](./companion-mode.md).

---

## What is an agent pack?

An **agent pack** is a folder of agent files (prompt, instructions, schemas, anything else the agent ships) plus an `agent.json` manifest that lists exactly which files are part of the pack. `minih agent install` copies those listed files into your project's `agents/<slug>/` directory and writes a provenance sidecar (`.minih-source.json`) so future runs know where the agent came from and whether it's drifted from upstream.

Three install sources are supported in v1:

| Source | Syntax | Use when |
|---|---|---|
| **Registry slug** | `minih agent install code-review-companion` | The agent is curated in the bundled registry (`agent list --available`). |
| **Git URL** | `minih agent install github:owner/repo[#ref][:subpath]` | Installing any public agent from any GitHub repo. Pinning `ref` works like npm `#branch` or uv `@branch`. |
| **Local path** | `minih agent install /abs/path/to/agent-folder` | Local development; sharing across projects on the same machine. |

All three end up in the same place on disk: `<cwd>/agents/<slug>/` (or wherever `--agents-dir` points), with `.minih-source.json` recording the source so re-running `install` either upgrades, no-ops, or reports drift.

---

## Quick start

Install the canonical companion agent into the current project:

```bash
minih agent install code-review-companion
```

List what the bundled registry knows about:

```bash
minih agent list --available
```

Inspect what's installed (including per-file drift status):

```bash
minih agent info code-review-companion
```

List installed agents in this project (including hand-rolled ones):

```bash
minih agent list
```

Re-install to pull upstream changes (idempotent — `action: 'unchanged'` if nothing moved):

```bash
minih agent install code-review-companion
```

---

## The three install sources

### Registry slug

The bundled catalog (`dist/templates/agents-registry.json`) lists curated agents that ship with the `minih` CLI. Install by bare slug:

```bash
minih agent install code-review-companion
# → resolves slug → fetches github:AI-Substrate/minih#main:agents/code-review-companion
# → action: installed, source.type: registry
```

If the slug isn't in the catalog, you get **E180** with up-to-3 Levenshtein "did you mean" suggestions:

```text
agent install: slug "code-review-companin" not in the bundled registry catalog (E180).
Did you mean: code-review-companion?
Run `minih agent list --available` to see installable agents,
or use a full git URL like `github:owner/repo#ref:subpath`.
```

The registry is **curated by PR**: only agents explicitly added to `src/templates/agents-registry.json` (and shipped via the build pipeline) appear here. Auto-discovery of repo-local `agents/` is intentionally NOT supported — see [Curation](#curation) below.

### Git URL

Install any public GitHub agent by URL. npm-style shorthand and full HTTPS both work:

```bash
# npm-style: github:owner/repo with optional #ref and :subpath
minih agent install github:AI-Substrate/minih#main:agents/code-review-companion --yes

# full HTTPS
minih agent install https://github.com/AI-Substrate/minih.git#v1.0.0 --yes
```

> **Note**: `--yes` is currently a no-op flag accepted for forward-compatibility — v1 does NOT prompt for confirmation on non-registry URLs. The interactive trust prompt is a deferred enhancement; until it lands, all URL installs proceed without prompting. Set `--yes` anyway in CI scripts so they keep working when the prompt arrives.

URL-form sidecar `source.type` is `'url'`. The slug defaults to the subpath leaf (`agents/code-review-companion` → `code-review-companion`) or the repo name when no subpath is given. Override with `--as <new-slug>`.

### Local path

Install from any local agent folder. Useful for cross-project development without round-tripping through GitHub:

```bash
# Install a local agent into the current project
minih agent install /path/to/your/local-agent-folder

# Use a different slug to avoid collision
minih agent install /path/to/your/local-agent-folder --as my-alias
```

Sidecar `source.type` is `'local'` with the absolute path recorded. Re-running `install` against a changed local source detects content drift and atomic-swaps.

---

## The `agent.json` manifest

Every installed agent has an `agent.json` at its root. The manifest declares **exactly** which files are part of the pack — anything else in the source tree is ignored on install. The canonical reference example lives at [`agents/code-review-companion/agent.json`](../../agents/code-review-companion/agent.json).

Schema:

```json
{
  "name": "code-review-companion",
  "version": "0.1.0",
  "description": "Long-running coordinated code-review companion that pairs alongside a human or supervising agent...",
  "author": "AI-Substrate",
  "tags": ["companion", "review", "coordination", "exemplar", "quality"],
  "minihVersion": ">=0.3.0",
  "type": "minih-agent",
  "files": [
    { "path": "prompt.md",          "description": "Identity, coordination loop, output contract." },
    { "path": "instructions.md",    "description": "Per-task review checklists." },
    { "path": "input-schema.json",  "description": "Optional initialTask input schema." },
    { "path": "output-schema.json", "description": "Farewell envelope schema." }
  ]
}
```

Field reference:

| Field | Required | Notes |
|---|---|---|
| `name` | yes | Stable identity. Conventionally matches the install slug. |
| `version` | yes | Semver-style; surfaced as `manifestVersion` in `agent info`. |
| `description` | yes | One-paragraph human-readable description. |
| `author` | no | Attribution string. |
| `tags` | no | Discovery tags surfaced in `agent info`/`agent list --available`. |
| `minihVersion` | no | Minimum minih CLI version (semver range). |
| `type` | no | Always `'minih-agent'` for v1; reserved for future artifact types. |
| `files` | yes | Every file shipped by the pack. **`prompt.md` MUST appear**. |

### Implicit manifest fallback

If the source has **no `agent.json`**, the installer synthesizes an implicit manifest from a canonical file set: `prompt.md` (required) plus any of `instructions.md`, `output-schema.json`, `input-schema.json`, `outside.md`, `inside-state.schema.json`, `outside-state.schema.json` that exist. Anything else is ignored. This is the path most older agents flow through.

For new agents, **author an explicit `agent.json`** — it's your manifest control surface and it surfaces per-file descriptions in `agent info`.

---

## The `.minih-source.json` sidecar

After every install, `minih` writes a provenance sidecar inside the installed agent folder. This is **load-bearing** for re-install-as-upgrade, drift detection, and `agent info`.

Example (registry source):

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
    "commitSha": "071b6a0a1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f"
  },
  "installedAt": "2026-05-03T05:57:10.607Z",
  "manifestVersion": "0.1.0",
  "fileChecksums": {
    "prompt.md":          "sha256:9f1e...",
    "instructions.md":    "sha256:3c4d...",
    "input-schema.json":  "sha256:7a8b...",
    "output-schema.json": "sha256:5e6f...",
    "agent.json":         "sha256:0a1b..."
  }
}
```

| Field | Notes |
|---|---|
| `schemaVersion` | Always `'1'` for v1. Reader tolerates unknown fields for forward-compat. |
| `slug` | The folder name under `agentsDir`. May differ from `source.registrySlug` if `--as` was used. |
| `source` | Discriminated union: `'local'` / `'url'` / `'registry'`. URL/registry carry `commitSha` for provenance + upgrade detection. |
| `installedAt` | ISO-8601 timestamp of the install/upgrade that wrote this sidecar. |
| `manifestVersion` | Mirror of `agent.json#version` at install time. |
| `fileChecksums` | sha256-hex per shipped file. Drives drift detection in `agent info`. |

### Drift detection

`agent info <slug>` recomputes per-file checksums and compares them to the sidecar:

| Status | Meaning |
|---|---|
| `unchanged` | File matches the recorded checksum. |
| `modified` | File on disk differs from what was installed. You edited it locally. |
| `missing` | File listed in the manifest is no longer on disk. |

This lets you answer "have I edited the prompt locally?" or "did upstream change?" offline, without re-fetching.

---

## Security model

`minih agent install` runs against arbitrary public git URLs. The security guards exist so **`minih agent install <random URL>` cannot damage your filesystem outside the install destination**.

### Manifest-level guards

`validateManifest()` rejects every named attack vector before any files are copied into the installed agent folder:

- **Path traversal**: `..` segments anywhere in `files[].path` → reject.
- **Absolute paths**: leading `/` → reject.
- **Backslashes**: any `\` in a path → reject (Windows separator confusion).
- **Null bytes**: → reject.
- **Reserved first segments**: paths starting with `runs/`, `inbox/`, `state/`, `.git/` → reject. These directories carry runtime state and are never overwritten by install.
- **Missing `prompt.md`**: every manifest MUST list `prompt.md`. Else reject.
- **Duplicate paths in `files[]`**: → reject.
- **Reserved single-segment paths** (`.`, `..`): → reject.

> **Note on extraction order**: For URL/registry sources the tarball is extracted to a temp directory FIRST, and the manifest is validated from the extracted tree before anything is copied into the final `agents/<slug>/` install target. The manifest guard protects the install target — the tarball-level guards below protect the extraction step itself. Drive-letter / Windows-absolute path coverage lives at the tarball-level guard, not the manifest-level guard.

### Tarball-level guards

For URL/registry sources, the extractor (`src/runner/agent-pack/extractor.ts`) layers additional defense on the extraction step (running BEFORE the manifest validator sees the staged tree):

- **Total size cap**: 10 MB. Tarballs above this are rejected pre-extract via `Content-Length` AND mid-stream byte-count.
- **Per-entry cap**: 2 MB per file.
- **Entry count cap**: 5000 files (defends against tarbomb floods; the entire `minih` repo has ~191 files).
- **Path length cap**: 255 bytes per entry.
- **Expansion ratio**: max 100x (defends against zip-bomb-style decompression amplification).
- **Gunzip wall-clock**: 5 s.
- **Network wall-clock**: 30 s (`AbortController`-driven).
- **Symbolic links / hard links / devices / FIFOs / sparse files**: rejected.
- **Setuid / setgid / sticky bits**: rejected.
- **Unicode-normalized `..`**: NFKC-normalized path segments containing `..` → rejected.
- **Windows drive letters / UNC**: `C:`-style absolute paths and `\\server\` UNC prefixes → rejected at the extractor (these are tarball-format-level concerns, not manifest concerns).
- **Top-level prefix**: GitHub tarballs ship as `<repo>-<sha>/...`; the extractor strips this single prefix and rejects mid-stream divergence (e.g. an attacker injecting a second top-level dir).

### Production-safe injection seam

The CLI supports `MINIH_AGENT_PACK_FETCHER=fake:<json>` for test injection of a fake fetcher. **Production-safe by default**:

- Hard-fails with **E181** if the env var is set without `NODE_ENV=test`.
- Hard-fails on malformed JSON or missing internal `\u0001` separator.
- ALWAYS prints a stderr warning when active: `[minih] using FakeAgentPackFetcher (NODE_ENV=test, MINIH_AGENT_PACK_FETCHER set)`.

You should never see this in non-test sessions. If you do, something is wrong.

### What we do NOT do

- **No code execution at install time.** Even if a manifest lists `scripts/install.sh`, the file is copied — never run.
- **No interactive confirmation prompt** on non-registry URL installs (yet). The trust UX is "you trust the curated registry + you trust the URL you typed". A confirmation prompt for non-registry sources is a deferred Phase 4 task — see [Phase 4 partial in the plan](../plans/017-agent-pack-install/agent-pack-install-plan.md). `--yes` is accepted today as a no-op for forward-compat with that future prompt.
- **No mode-bit honoring** during stream copy — files land as the running user's umask.
- **No retry on 5xx** — fetch is one-shot. Retry policy is the caller's choice.
- **No verification tier yet** (e.g. signed metadata). The v1 trust UX is curated registry entries + the URL you typed + post-install provenance display (`agent info` shows `commitSha` so you can audit what landed); non-registry URL installs do NOT prompt yet.

---

## Error reference

| Code | Name | Trigger | Recovery |
|---|---|---|---|
| **E180** | `AGENT_PACK_REGISTRY_MISS` | Bare slug doesn't resolve in the bundled registry catalog. | Run `minih agent list --available` for the canonical list, or use a full git URL: `minih agent install github:owner/repo#ref:subpath`. The error includes up-to-3 Levenshtein "did you mean" suggestions. |
| **E181** | `AGENT_PACK_FETCH_FAILED` | Network failure (timeout, 4xx/5xx, DNS), or production safety check fired (MINIH_AGENT_PACK_FETCHER set without `NODE_ENV=test`). | Check connectivity; verify the URL is correct; for env-var case, unset `MINIH_AGENT_PACK_FETCHER`. |
| **E182** | `AGENT_PACK_INVALID` | Tarball/manifest violates a security guard (path traversal, missing `prompt.md`, oversized, runtime-dir entry, etc.) OR subpath not found in tarball OR malformed `agent.json`. | The error message names the specific violation. For "subpath not found", the registry catalog may point at a stale subpath — file an upstream issue. |
| **E183** | `AGENT_PACK_ALREADY_INSTALLED` | Target slug folder exists locally without `.minih-source.json` — looks hand-rolled. | Use `--as <new-slug>` to install alongside, or `--force` to overwrite (DESTRUCTIVE — preserves only `runs/`/`inbox/`/`state/`). |
| **E184** | `AGENT_PACK_SOURCE_MISMATCH` | Reserved for "re-install hits a sidecar whose source disagrees with the new install" (e.g. swapping registry slug for a URL). **Not yet emitted in v1** — current behavior reports `action: 'upgraded'` instead. The error code is reserved + documented so future work can plug in a strict-mode guard without renumbering. | Once enforced: use `--as <new-slug>` for the new source, or remove the existing install and reinstall. |

All error messages embed the error code in parentheses (`(E182)`) so log-grepping and automated parsing work uniformly.

---

## Curation

The bundled registry (`src/templates/agents-registry.json` → `dist/templates/agents-registry.json`) is **curated by PR**, not auto-discovered. Internal/dogfood agents (`smoke-test`, `convention-check`, `coordination-smoke-test`, etc.) intentionally stay out — adding an agent to the registry is a deliberate "we want users to install this" signal, reviewed in code.

To propose a new curated agent, open a PR that:

1. Authors the agent's `agent.json` at its source location.
2. Adds an entry to `src/templates/agents-registry.json` with `slug`, `url`, `ref`, `subpath`, `description`, `tags`, `since`, `minihVersion`.
3. Updates the `MINIH_REGRESSION` baseline test snapshot.

The default install path for un-curated agents is the URL form (`github:owner/repo#ref:subpath`) — works immediately, no PR required.

---

## `agent info` drift inspector

```bash
minih agent info <slug>
```

Output (JSON envelope on stdout, human table on stderr):

- `slug`, `description`, `tags`, `coordination` — pulled from `prompt.md` frontmatter (falls back to `agent.json` if absent).
- `source` — verbatim from `.minih-source.json` (`local` / `url` / `registry`).
- `installedAt`, `manifestVersion` — from sidecar.
- `files[]` — each file with `description` (from manifest) + `status` (`unchanged` / `modified` / `missing`).
- `handRolled` — `true` if no sidecar exists (the agent was hand-copied into `agents/<slug>/` rather than installed).

Returns **E121** if the slug doesn't resolve to an installed folder.

---

## `agent list` — installed vs available

Two modes:

```bash
minih agent list              # what's installed in this project
minih agent list --available  # what the bundled registry knows about
```

**Installed mode** distinguishes source types via icons: 📦 local, ☁ url, 🏪 registry, 👋 hand-rolled. The hand-rolled icon flags agents you copied in by hand (no `.minih-source.json`) — useful before promoting them to managed installs.

**Available mode** lists the bundled catalog with installed/not-installed status per row, plus install-with hint at the bottom.

---

## Common pitfalls

### Self-install collision (E183)

Running `minih agent install code-review-companion` from inside the `minih` source repo (where `agents/code-review-companion/` already exists as the canonical source) refuses with E183. The companion's prompt + manifest are the source-of-truth files in that repo; overwriting them via install would be destructive.

**Fix**: use `--as <new-slug>` to install alongside under a different name, or skip the install entirely (you already have the source).

### "Why isn't my dogfood agent in `agent list --available`?"

Curation gate. Internal/dogfood agents (`smoke-test`, `convention-check`, etc.) are intentionally NOT in the bundled registry — they're for developing minih itself, not for end users. To make a dogfood agent installable, open a curation PR (see [Curation](#curation)).

### Re-install does nothing (`action: 'unchanged'`)

By design — the installer is idempotent. If the source files are byte-identical to what's installed, no work happens. The `.minih-source.json` `commitSha` IS refreshed when the upstream commit advances even on no-op file content (post-Phase-5 fix), so re-installing always rolls the provenance forward to the latest sha.

### Edited the prompt locally; want to keep my edits

The drift detector (`agent info`) reports `modified` for any file you've edited. A subsequent `agent install` reports `action: 'upgraded'` (with `changedFiles[]` listing what's different) and atomic-swaps. Your edits are overwritten by the new source. To preserve local edits, copy them to a new slug (`--as my-fork-of-crc`) before re-installing the canonical version.

### `--force` exists but is destructive

`--force` overrides E183 collision and overwrites the existing folder. Runtime dirs (`runs/`, `inbox/`, `state/`) are preserved; everything else is wiped. Use only when you're sure the existing content is replaceable.

---

## Reference

- **Source**: [`src/runner/agent-pack/`](../../src/runner/agent-pack/) — manifest, registry, source sidecar, fetcher, extractor, install orchestration.
- **CLI**: [`src/cli/commands/agent.ts`](../../src/cli/commands/agent.ts).
- **Canonical example**: [`agents/code-review-companion/agent.json`](../../agents/code-review-companion/agent.json).
- **Companion mode runbook**: [`companion-mode.md`](./companion-mode.md).
- **Domain doc**: [`docs/domains/runner/domain.md`](../domains/runner/domain.md) — see "Agent pack install" concept.
