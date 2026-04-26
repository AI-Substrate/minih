# Contributing to minih

Thanks for your interest in improving minih! Contributions come in many forms — bug reports, magic wand feedback from agent runs, feature ideas, prompt improvements, new dogfood agents, or code changes. Every contribution makes the self-improving loop better for everyone.

---

## Ways to Contribute

### 🪄 Magic Wand Feedback

The most valuable contributions often start as a `magicWand` in an agent's retrospective. If you're running minih agents and they report friction with minih itself (not your project), that feedback is gold. You can:

1. **Just let it accumulate** — run `minih run feedback-digest` periodically to surface patterns across runs
2. **Promote to an issue** — if a magic wand describes a concrete, high-impact improvement, file it as a feature request so it gets tracked and discussed
3. **Fix it yourself** — if you know how, submit a PR that references the magic wand that inspired it

### 🐛 Bug Reports

Found something broken? File it with the **Bug Report** template:

```bash
gh issue create --repo AI-Substrate/minih --template bug_report.md
```

Good bug reports include:
- **Environment**: OS, Node.js version, minih version
- **Reproduction steps**: Exact commands to reproduce
- **Expected vs actual behavior**: What should happen vs what did happen
- **Agent context**: If the bug happened during an agent run, include the slug and any relevant output

### 💡 Feature Requests & Ideas

Have an idea? File it with the **Feature Request** template:

```bash
gh issue create --repo AI-Substrate/minih --template feature_request.md
```

Great sources of feature ideas:
- **Magic wand patterns** — the same wish showing up across multiple agent runs
- **Workflow friction** — something that's possible but takes too many steps
- **Missing observability** — "I couldn't tell what the agent was doing because..."
- **Integration needs** — CI, other tools, different models, custom adapters

### 📝 Documentation & Prompt Improvements

The preamble, agent prompts, and docs are all first-class artifacts. If you:
- Found unclear instructions that confused an agent → improve the preamble
- Wrote a prompt pattern that works well → share it as an example agent
- Noticed docs that are wrong or stale → submit a fix

### 🤖 New Dogfood Agents

minih dogfoods itself. New agents that test or validate minih are always welcome. Browse [agents/](https://github.com/AI-Substrate/minih/tree/main/agents) for examples. Good candidates:
- Agents that exercise untested CLI commands or edge cases
- Agents that validate conventions across the codebase
- Agents that aggregate or analyze run history

### Agent-Filed Issues

minih agents can file issues automatically when they discover bugs or critical improvements. The shared preamble includes instructions for agents with `gh` CLI access. These issues are tagged and triaged just like human-filed issues.

---

## Development Setup

```bash
git clone https://github.com/AI-Substrate/minih.git
cd minih
npm install
```

### Build & Test

```bash
# Full quality gate (recommended before PRs)
just fft          # lint → format → build → typecheck → test → audit

# Individual commands
npm run build     # tsc + copy schemas
npm test          # vitest run
npm run clean     # remove dist/
```

#### Optional daemon-light e2e gate

Phase 007 includes an opt-in cross-process coordination test that exercises native file watching plus live inbox/state forwarding. It is skipped by default; run it explicitly when touching runner coordination lifecycle code:

```bash
MINIH_E2E=1 npx vitest run test/e2e/daemon-light.test.ts
```

### Project Structure

```
src/
├── adapter/      # SDK wrapper (IAgentAdapter interface)
├── runner/       # Orchestration (prompt assembly, execution, validation)
└── cli/          # Commands (run, status, inspect, etc.)
    └── commands/

agents/           # Dogfood agents (not shipped in npm package)
test/             # Vitest tests (mirror src/ structure)
docs/             # Domain docs, plans, ADRs
scripts/          # Build helpers
```

**Import direction**: `cli → runner → adapter` — never upward. The runner is adapter-agnostic via `IAgentAdapter`.

### Code Style

- **Biome** for linting and formatting (single quotes, 2-space indent)
- ESM-only, TypeScript strict mode
- Comment only when clarification is needed — not for obvious code
- Hand-roll simple utilities rather than adding dependencies (e.g., frontmatter parser, YAML parser)

---

## Submitting Changes

1. **Fork and branch** from `main`
2. **Make your changes** — keep PRs focused on one thing
3. **Run the quality gate**: `just fft` (or `npm run build && npm test` at minimum)
4. **Test with dogfood agents** if your change affects the runner or CLI:
   ```bash
   minih run smoke-test    # Tests all CLI commands
   minih run hello-world   # Quick sanity check
   ```
5. **Submit a PR** with a clear description of what changed and why

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add minih status command for liveness checks
fix: normalize CRLF line endings in frontmatter parser
docs: expand AGENTS_README with monitoring section
```

---

## Dogfood Agents

minih dogfoods itself — the [agents/](https://github.com/AI-Substrate/minih/tree/main/agents) folder contains agents that test and validate minih. These are the primary reference implementations for how to build agents.

When contributing new features, consider:
- Does the smoke-test agent need updating?
- Should a new dogfood agent be created to exercise this feature?
- Did any agent's magic wand feedback inform this change? Reference it in the PR.

---

## Releasing

minih uses [release-please](https://github.com/googleapis/release-please) for automated releases. No manual version bumps or changelog edits needed.

### How It Works

1. **Push conventional commits** to `main` (you're already doing this)
2. **release-please opens a Release PR** automatically — it bumps `package.json` version and updates `CHANGELOG.md` based on your commits
3. **Merge the Release PR** → git tag (`v0.2.0`) + GitHub Release created automatically

### Commit → Version Mapping

| Prefix | Bump | Example |
|--------|------|---------|
| `fix:` | patch (0.1.0 → 0.1.1) | `fix: CRLF frontmatter parsing` |
| `feat:` | minor (0.1.0 → 0.2.0) | `feat: minih status command` |
| `feat!:` | major (0.1.0 → 1.0.0) | `feat!: new output format` |
| `docs:`, `ci:`, `chore:` | no bump | `docs: update README` |

### Important

- **Don't rename release-please PRs** — it uses the commit prefix to avoid infinite loops
- **Don't manually edit `CHANGELOG.md`** — release-please owns it
- **Don't manually bump `package.json` version** — release-please handles this
- Users install specific releases via: `npm install github:AI-Substrate/minih#v0.x.y`

---

## Architecture Notes

- **Session isolation**: Agent CWD is the run folder, not the project root. This prevents SDK session artifacts from polluting the user's project.
- **Output convention**: JSON envelopes on stdout, human-readable on stderr. All commands follow this pattern.
- **Validation**: Three layers — input schema (pre-run), output schema (post-run), system output (summary + retrospective).
- **Fuzzy matching**: Validation errors suggest near-match property names using substring containment and Levenshtein distance.
- **Cross-platform**: Build scripts use Node.js APIs instead of Unix shell commands (works on Windows cmd.exe).

---

## Questions?

Open an issue or check the [AGENTS_README.md](./AGENTS_README.md) for detailed usage docs.
