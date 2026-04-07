# Contributing to minih

Thanks for your interest in improving minih! Whether you're filing a bug, suggesting a feature, or submitting code — you're helping make the self-improving agent loop better for everyone.

---

## Filing Issues

### Bug Reports

Found something broken? File it with the **Bug Report** template:

```bash
gh issue create --repo AI-Substrate/minih --template bug_report.md
```

Good bug reports include:
- **Environment**: OS, Node.js version, minih version
- **Reproduction steps**: Exact commands to reproduce
- **Expected vs actual behavior**: What should happen vs what did happen
- **Agent context**: If the bug happened during an agent run, include the slug and any relevant output

### Feature Requests

Have an idea? File it with the **Feature Request** template:

```bash
gh issue create --repo AI-Substrate/minih --template feature_request.md
```

The best feature requests come from **magic wand feedback** — real friction from actual agent runs. If your agent's `magicWand` field describes something that would benefit all minih users, that's a great candidate for an issue.

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

## Architecture Notes

- **Session isolation**: Agent CWD is the run folder, not the project root. This prevents SDK session artifacts from polluting the user's project.
- **Output convention**: JSON envelopes on stdout, human-readable on stderr. All commands follow this pattern.
- **Validation**: Three layers — input schema (pre-run), output schema (post-run), system output (summary + retrospective).
- **Fuzzy matching**: Validation errors suggest near-match property names using substring containment and Levenshtein distance.
- **Cross-platform**: Build scripts use Node.js APIs instead of Unix shell commands (works on Windows cmd.exe).

---

## Questions?

Open an issue or check the [AGENTS_README.md](./AGENTS_README.md) for detailed usage docs.
