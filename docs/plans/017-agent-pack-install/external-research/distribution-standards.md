# External Research: Competing Standards for Agent Distribution

**Generated**: 2026-05-03T11:32:00+10:00
**Question**: "Are there competing standards for distributing AI-agent definitions like ours (folder of prompt.md + schemas)?"
**Tool**: Perplexity search + Perplexity ask (web-grounded synthesis)
**Plan**: 017-agent-pack-install

---

## TL;DR

**Yes, there are competing standards — and one is a near-perfect fit.**

| Standard | Origin | What it is | Fit for minih |
|---|---|---|---|
| **🥇 Claude Code Plugin Marketplaces** | Anthropic, late 2025 | Git-repo-based catalog (`.claude-plugin/marketplace.json` + per-plugin `plugin.json`); folder = plugin; supports SKILL.md + agents/*.md | **Excellent — directly analogous** |
| **AWS ARA** (AI Registry for Agents) | AWS, Feb 2026 | Open spec for AI artifacts; `package.json`-style manifest; multi-source (git/npm/pypi); platform-agnostic | Good — but heavier than we need for v1 |
| **MCP Registry** | Anthropic, 2025 | `mcp.json` centralized metaregistry; GitHub OAuth + DNS TXT publish flow | **Poor fit** — for MCP servers, not folder packages |
| **A2A Agent Cards** | Google | JSON via well-known URI — runtime discovery + capabilities | **Poor fit** — runtime, not packaging |
| **ANP** (AgentNode Package) | AgentNode | npm-like package format with verification trust tiers; complementary to MCP | Moderate — adds verification complexity |
| **NANDA Index AgentFacts** | NANDA | Crypto-verifiable, signed metadata | Overkill — enterprise/decentralized scope |

**Recommendation**: **Adopt the Claude Code Plugin Marketplace pattern**, mapped to our existing folder layout. Cleanest folder-based git-distribution pattern in the ecosystem, has momentum, and we stay 95% interop-ready by writing a tiny `agent.json` (analogous to `plugin.json`).

---

## What Each Standard Actually Does

### 🥇 Claude Code Plugin Marketplaces (best fit)

> *"A plugin marketplace is a catalog that lets you distribute plugins to others. Marketplaces provide centralized discovery, version tracking, automatic updates, and support for multiple source types (git repositories, local paths, and more)."*
> — code.claude.com/docs/en/plugin-marketplaces (Apr 2026)

**Shape:**
```
my-marketplace/
├── .claude-plugin/
│   └── marketplace.json          # catalog of plugins in this repo
├── quality-review-plugin/
│   ├── .claude-plugin/
│   │   └── plugin.json           # per-plugin manifest
│   ├── skills/
│   │   └── quality-review/
│   │       └── SKILL.md          # the actual capability
│   └── README.md
```

**Properties matching our needs almost exactly:**
- A "plugin" is a **folder of files** (no compiled artifact, no runtime).
- Body is **markdown with YAML frontmatter** — *literally* what our `prompt.md` already is.
- Source types: **git** (default), local path, file. We've already designed for git.
- Distribution: push to GitHub, share `owner/repo`. Aligns with Plan 004.
- Install: `/plugin marketplace add owner/repo` then `/plugin install <name>`. Maps to our `minih agent install <slug-or-git-url>`.
- State: `~/.claude/plugins/known_marketplaces.json`. Maps to our `.minih-source.json` sidecar.
- Trust controls: `allowedMarketplaces` / `blockedMarketplaces` allowlist.
- Stable/latest channels via separate marketplaces pointing at different refs.

**Real example**: `mhattingpete/claude-skills-marketplace` — production marketplace with multiple plugins, each plugin = folder with `.claude-plugin/plugin.json` containing `agents/*.md` and `skills/<name>/SKILL.md`. **Functionally identical to what we want.**

### AWS ARA (open spec, broader scope)

> *"Similar to how package.json standardized Node.js packages, ARA defines a common format for AI development artifacts that work across tools, registries, and teams."*
> — aws.amazon.com/blogs/opensource (Feb 2026)

**Manifest example:**
```json
{
  "$schema": "https://raw.githubusercontent.com/ara-registry/spec/refs/heads/main/ara.schema.json",
  "name": "acme/weather-server",
  "version": "1.2.0",
  "description": "MCP server for weather data access",
  "type": "mcpserver",
  "sources": [
    { "type": "npm", "package": "@acme/weather-mcp", "version": "1.2.0", "preferred": true },
    { "type": "pypi", "package": "weather-mcp-server", "version": "1.2.0" }
  ]
}
```

**Tenets** (community discovery, platform-agnostic, convention-over-config, transparent governance) **all match our values**. Supports artifact types: Kiro Custom Agents, MCP Servers, Context (prompts/templates), Skills (SKILL.md).

**Why not first choice for v1**: Broader scope (npm/pypi/git multi-source, lockfiles, auth patterns, ownership models). **But**: ARA's manifest schema is a good north star — write our `agent.json` so it's easily upgradeable to ARA shape later.

### MCP Registry, A2A, ANP, NANDA (different problems)

- **MCP Registry**: For MCP *servers*, not packaged folders. Centralized + DNS verification. Not our problem.
- **A2A Agent Cards**: Runtime agent-to-agent discovery, not packaging.
- **ANP**: npm-style packaging *with* verification trust tiers. Conceptually closest after Claude Code, but adds verification pipeline complexity. Worth watching.
- **NANDA AgentFacts**: Crypto-verifiable metadata for decentralized AI agent ecosystems. Enterprise/research scope; overkill.

Per AgentNode's analysis: **MCP and ANP are complementary** ("ANP is npm; MCP is HTTP"). We're solving the ANP/Claude-marketplace problem, not the MCP problem.

---

## Implications for Plan 017

### Decisions this research informs

1. **Adopt Claude-Code-marketplace-style structure as the conceptual model.** Mirror their layout where sensible:
   - Per-agent **manifest sidecar** = `agent.json` (analogous to `plugin.json`).
   - Optional **catalog file** `.minih/marketplace.json` for repos bundling multiple agents (e.g., minih repo itself). The bundled registry we ship in `dist/templates/agents-registry.json` is a special case of this.
2. **Don't reinvent the manifest schema.** Use a minimal shape compatible with both Claude `plugin.json` AND ARA. Field-name overlap = free interop wins.
3. **Per-agent vs per-repo manifest**: support BOTH.
   - **Single-agent repo** (raw URL points at agent root) → `prompt.md` is enough; `agent.json` is optional metadata enrichment.
   - **Multi-agent repo** (URL points at root containing many `agents/*/`) → repo has top-level `.minih/marketplace.json` listing slugs + relative paths.
4. **Keep `prompt.md` as the body.** Don't rename to `SKILL.md` for cosmetic interop. Frontmatter shape is similar enough; conversion is trivial either direction.
5. **No verification tiers in v1.** ANP/NANDA trust mechanisms are interesting but out of scope. Show source URL + commit sha to user; that's it.

### Suggested minimal manifest schemas

**`agent.json`** (per-agent, **the manifest of what files the pack carries** — the source of truth for install/upgrade/info):

```json
{
  "$schema": "https://github.com/AI-Substrate/minih/blob/main/schemas/agent.schema.json",
  "name": "code-review-companion",
  "version": "0.1.0",
  "description": "Power-On-Mode companion that reviews each commit live",
  "author": "AI-Substrate",
  "tags": ["companion", "review", "coordination"],
  "minihVersion": ">=0.3.0",
  "type": "minih-agent",
  "files": [
    { "path": "prompt.md",                  "description": "Agent prompt with frontmatter — REQUIRED" },
    { "path": "instructions.md",            "description": "System instructions appended after prompt" },
    { "path": "outside.md",                 "description": "Outside-side coordination contract" },
    { "path": "output-schema.json",         "description": "AJV schema validating the agent's report envelope" },
    { "path": "inside-state.schema.json",   "description": "Schema for inside coordination state" },
    { "path": "outside-state.schema.json",  "description": "Schema for outside coordination state" },
    { "path": "scripts/post-install.sh",    "description": "Optional post-install hook (NOT executed automatically; informational only)" },
    { "path": "examples/sample-briefing.md","description": "Example briefing message for first-time users" },
    { "path": "README.md",                  "description": "Human-facing overview of this companion's protocol" }
  ]
}
```

**Key design points (per user direction 2026-05-03):**
- **Agent packs may carry ANY arbitrary files** — scripts, examples, READMEs, helper docs, sample data, anything. Not just the canonical `prompt.md` + schemas.
- **The manifest's `files[]` array is the complete pack contents.** Each entry has `path` (relative to agent root) + `description` (one-line, surfaced in `agent info`).
- **Install copies exactly the files listed in the manifest.** Anything else in the source repo (or in the user's working tree) is ignored. This keeps installs deterministic and prevents accidental copy of `.git/`, build artifacts, or surprises.
- **`prompt.md` is REQUIRED to be in `files[]`.** Validated at install time; missing it → E182.
- **Runtime dirs (`runs/`, `inbox/`, `state/`) are forbidden in `files[]`.** Validated at install time. A malicious manifest cannot claim to "install" runtime data over yours; reject E182.
- **Field overlap with ARA/Claude `plugin.json`**: `name`, `version`, `description`, `author`, `tags`, `type` are ARA-compliant. The `files[].path`/`description` shape is ours; can be projected into Claude's plugin.json equivalent later if interop is desired.

**`.minih/marketplace.json`** (per-repo catalog, optional — for repos bundling multiple agents):
```json
{
  "$schema": "https://github.com/AI-Substrate/minih/blob/main/schemas/marketplace.schema.json",
  "name": "minih-canonical-agents",
  "owner": "AI-Substrate",
  "agents": [
    { "slug": "code-review-companion", "path": "agents/code-review-companion", "description": "Power-On-Mode companion" },
    { "slug": "demo-companion",         "path": "agents/demo-companion",         "description": "Demo companion for FX008/FX009 verification" }
  ]
}
```

Field overlap: `name`, `agents[].slug`/`path`/`description` mirror Claude's `plugins[].name`/`source`/`description`.

### Install manifest sidecar (`.minih-source.json`) revised

```json
{
  "source": {
    "type": "registry|git|local",
    "url": "github:AI-Substrate/minih",
    "ref": "main",
    "subpath": "agents/code-review-companion"
  },
  "installedAt": "2026-05-03T11:30:00Z",
  "commitSha": "6cab9134...",
  "version": "0.1.0",
  "agentJsonChecksum": "sha256:..."
}
```

`agentJsonChecksum` lets `info`/`upgrade` cheaply detect "user has modified files since install."

---

## Citations

1. AWS ARA spec announcement — https://aws.amazon.com/blogs/opensource/introducing-ai-registry-for-agents-spec-a-standard-for-ai-agent-artifacts/
2. MCP Specification — https://modelcontextprotocol.io/specification/2025-06-18
3. arXiv: A Survey of AI Agent Registry Solutions (2508.03095) — https://arxiv.org/html/2508.03095v1
4. AgentNode: MCP vs ANP comparison — https://agentnode.net/blog/mcp-vs-anp-ai-agent-tool-standards-compared
5. Claude Code Plugin Marketplaces — https://code.claude.com/docs/en/plugin-marketplaces
6. mhattingpete/claude-skills-marketplace — https://github.com/mhattingpete/claude-skills-marketplace
7. ClickHouse: 12-framework MCP comparison — https://clickhouse.com/blog/how-to-build-ai-agents-mcp-12-frameworks
