# Minih Skills Config

**Mode**: Simple
**Created**: 2026-06-05
**Status**: Draft spec — ready for architecture

## Research Context

📚 Specification incorporates findings from the completed workshop: [`workshops/001-cli-config-and-discovery.md`](./workshops/001-cli-config-and-discovery.md).

Relevant evidence from prior SDK experiments and repo inspection:

- `@github/copilot-sdk` supports `skillDirectories`, `disabledSkills`, and `enableConfigDiscovery` session options.
- SDK events include `session.skills_loaded` and `skill.invoked`.
- Passing a **parent skills directory** such as `~/.agents/skills` loads all immediate skills under it.
- Passing a **direct skill directory** such as `~/.agents/skills/grill-me` loads only that skill plus builtin SDK skills.
- Minih currently passes model/reasoning/permissions/MCP/runtime config through the adapter, but does not yet pass skill config.
- Minih domain boundaries are healthy and must remain intact: `cli → runner → adapter`, with the adapter remaining the only SDK wrapper.

## Summary

Minih should let agents load local Copilot/Claude/agent-harness skills through first-class config and CLI flags, without hardcoding absolute machine paths into prompts or agent definitions.

The feature adds:

- a repo config file, `.minih.json`, with a `skills` block;
- friendly source aliases such as `global:agents`, `global:copilot`, `global:claude`, `repo:.agents`, and `.github`;
- named skill inclusion so a run can load only `grill-me` instead of an entire global skills pack;
- CLI discovery/doctor/help surfaces that make skill configuration obvious to humans and external agents;
- pass-through of resolved `skillDirectories` and `disabledSkills` to the Copilot SDK;
- visible skill load/invocation events in minih run surfaces.

## Goals

- Enable repo-level skill defaults using `.minih.json` without absolute paths.
- Support one-off run overrides using simple `minih run` flags.
- Resolve common Copilot/Claude/pi/agent-harness skill locations deterministically inside minih.
- Support loading all skills from a source or only named skills from one or more sources.
- Keep global skill loading explicit; never silently load user-global skills by default.
- Make missing sources and missing included skills discoverable through CLI diagnostics before a user starts an SDK-backed run.
- Preserve existing domain boundaries and SDK isolation.
- Add tests and docs that make the feature understandable to agents on other machines.

## Non-Goals

- No automatic recursive search of arbitrary home directories.
- No implicit SDK `enableConfigDiscovery` by default.
- No skill installation or synchronization across machines.
- No editing or validation of skill contents beyond detecting `SKILL.md` and, where useful, parsing lightweight metadata.
- No durable database or persisted global skill index.
- No change to minih agent prompt frontmatter as a required v1 surface; agent-level skill config may be a follow-up.
- No bypass of minih's existing permission model; skills are prompt instructions, while tool execution remains permission-gated.

## Target Domains

| Domain | Status | Relationship | Role in This Feature |
|--------|--------|--------------|----------------------|
| cli | existing | **modify** | Own `.minih.json` discovery, skill-source CLI flags, `minih skills` commands, run preflight rendering, help text, doctor checks, and SDK runtime composition wiring. |
| runner | existing | **modify** | Carry resolved `skillDirectories` / `disabledSkills` through `AgentRunConfig` and event/report surfaces while staying SDK-independent. |
| adapter | existing | **modify** | Add Copilot SDK facade fields and pass resolved skill options to `createSession` / `resumeSession`; translate or preserve skill events. |
| measurement | existing | consume | Use existing evidence vocabulary for discoverability/proof; no runtime dependency or new measurement domain work required. |

### Domain Boundary Notes

- CLI may read `.minih.json`, resolve aliases, and render diagnostics.
- Runner may receive already-resolved skill config and emit/record normalized run events.
- Adapter may know SDK option names and SDK event names.
- Runner must not import SDK-specific skill types or inspect SDK config discovery behavior.

## Testing Strategy

**Approach**: Full TDD

**Rationale**: This feature changes config parsing, command-line UX, filesystem resolution, cross-domain pass-through, and SDK event observability. Those surfaces are easy to regress unless resolver and pass-through behavior are locked with focused tests.

**Focus Areas**:

- `.minih.json` parser accepts valid `skills` config and rejects malformed `skills` blocks.
- Source aliases resolve deterministically for repo-relative, home-relative, global, and explicit `path:` forms.
- `include` resolves named skills to direct skill directories and respects source precedence.
- `exclude` becomes SDK `disabledSkills` when loading parent source directories.
- Missing sources warn; missing explicitly included skills fail with actionable error.
- CLI envelopes for `skills discover`, `skills doctor`, and `run` preflight include machine-readable resolution facts.
- Adapter passes `skillDirectories` and `disabledSkills` to SDK session creation and resume.
- SDK `session.skills_loaded` and `skill.invoked` are visible through minih events or run summaries.
- A committed repo-local sample skill under `.agents/skills/` can be loaded and invoked by a minih test agent without depending on machine-global skill installs.
- The optional smoke-test agent can also load and invoke `grill-me` from `global:agents` on machines where the skill exists.

**Excluded**:

- End-to-end network installation of skills.
- Deep validation of arbitrary `SKILL.md` content.
- Recursive scanning outside configured source aliases.

**Mock Usage**: Targeted mocks

Use real temp directories and fixture `SKILL.md` files for resolver/config tests. Use fakes or mocks only around SDK session creation/event streams and CLI composition seams where real SDK calls would be slow, credentialed, or flaky.

## Documentation Strategy

**Location**: Hybrid — README quick-start plus detailed built-in CLI/help/doctor/agent-readme surfaces.

**Rationale**: The user specifically wants skill config to “light up like a Christmas tree.” External agents should discover the feature through `minih --help`, `minih run --help`, `minih skills discover`, `minih skills doctor`, `minih inspect`, and `minih agent-readme`, while humans should have a concise README example.

Required documentation surfaces:

- `README.md`: short “Skills” section with `.minih.json` example and alias table.
- `minih run --help`: mention `--skill-source`, `--skill`, `--disable-skill`, `--no-skills`, and `minih skills discover`.
- `minih skills --help`: discovery and doctor guidance.
- `minih doctor`: warnings/errors for `.minih.json` skill config.
- `minih inspect <slug>`: resolved skill block.
- `minih agent-readme`: bundled agent-facing explanation.

## Complexity

**Score**: CS-3 (medium)

**Breakdown**:

- S=2 — Multiple user-facing surfaces: config file, run flags, new skills subcommands, doctor/inspect/help/docs.
- I=2 — Cross-domain pass-through through CLI, runner, and adapter to the SDK.
- D=1 — Small config shape and deterministic filesystem discovery; no durable database.
- N=1 — SDK skill loading is already proven experimentally, but minih-specific resolver UX is new.
- F=1 — Portability/discoverability requirements matter, but no high-scale performance concern.
- T=1 — Full TDD over resolver/CLI/adapter with optional smoke test.

**Confidence**: 0.86

**Assumptions**:

- SDK v1.0.0 continues accepting direct skill directories via `skillDirectories`.
- Skill directories use `SKILL.md` as the canonical marker.
- Repo root is available to CLI command composition when resolving `.minih.json`.
- Existing CLI output discipline remains: JSON envelopes on stdout, human-readable diagnostics on stderr.
- Existing L2 engineering harness is sufficient for implementation validation.

**Dependencies**:

- `@github/copilot-sdk` dev dependency already updated to `^1.0.0`.
- Existing minih command composition in `src/cli/commands/run.ts` and `resume.ts`.
- Existing adapter facade in `src/adapter/copilot-types.ts` and `sdk-copilot.ts`.
- Existing test patterns for CLI envelopes, FakeAgentAdapter, and SDK adapter pass-through.

**Risks**:

- SDK event payload shapes for skills may differ from experiment assumptions; tests should preserve raw payloads if normalization is uncertain.
- Loading entire global skill directories could inflate context or alter agent behavior unexpectedly; docs and examples should prefer `include`.
- Duplicate skill names across sources could be surprising; `skills doctor` must report precedence.
- Missing global sources are common across machines; missing sources should warn, not fail, unless an included skill is explicitly required.
- Adding `.minih.json` must not collide with or obscure `.mcp.json` behavior.

**Phases**:

Simple mode can implement this as one phase, but architecture may choose internal milestones:

1. Config/resolver + CLI discovery/doctor.
2. Run/resume pass-through + adapter SDK support.
3. Event visibility + smoke-test agent update.
4. Help/README/agent-readme polish.

## Requirements

### Config

- Minih reads `.minih.json` from repo root when present.
- `.minih.json` may contain:

  ```json
  {
    "skills": {
      "sources": ["global:agents"],
      "include": ["grill-me"],
      "exclude": []
    }
  }
  ```

- `skills.sources`, `skills.include`, and `skills.exclude` are optional arrays of non-empty strings.
- Unknown top-level keys are tolerated for forward compatibility, but malformed `skills` values are reported.
- No skills are loaded implicitly when `.minih.json` is absent and no CLI flags are supplied.

### Source Aliases

Support these aliases in v1:

| Alias | Resolves To |
|-------|-------------|
| `.agents` / `repo:.agents` | `<repo>/.agents/skills` |
| `.claude` / `repo:.claude` | `<repo>/.claude/skills` |
| `.github` / `repo:.github` | `<repo>/.github/skills` |
| `global:agents` / `~/.agents` | `~/.agents/skills` |
| `global:copilot` / `~/.copilot` | `~/.copilot/skills` |
| `global:claude` / `~/.claude` | `~/.claude/skills` |
| `global:pi` | `~/.pi/agent/skills` |
| `path:<path>` | explicit repo-relative, absolute, or `~`-relative path |

### Include / Exclude

- Without `include`, existing source parent directories are passed to SDK `skillDirectories`.
- With `include`, minih scans only configured source roots' immediate children for matching skills and passes matched **direct skill directories** to SDK `skillDirectories`.
- Matching should prefer skill metadata name when cheaply available, with folder name fallback. If metadata name and folder name differ, `skills doctor` should warn.
- Duplicate names resolve by source order; earlier configured sources win.
- `exclude` disables skills via SDK `disabledSkills` when parent directories are passed.
- When `include` is present, `exclude` filters the selected direct directories before SDK pass-through.

### CLI

- Add `minih skills discover` to list known/configured sources and discovered skills.
- Add `minih skills doctor` to validate `.minih.json` skill config without starting an SDK session.
- Add run overrides:
  - `--skill-source <alias-or-path>` repeatable;
  - `--skill <name>` repeatable;
  - `--disable-skill <name>` repeatable;
  - `--no-skills` disables config/flags for that invocation;
  - optional `--skills-debug` prints resolved config before session start.
- Add resolved skill information to `minih inspect <slug>`.
- Add warnings/errors with actionable next steps and stable error codes in a reserved skills range, e.g. `E210`–`E219`.

### SDK Pass-Through

- Extend runner and adapter config types with `skillDirectories?: string[]` and `disabledSkills?: string[]`.
- Extend local Copilot SDK facade types accordingly.
- Pass the resolved arrays into `createSession` and `resumeSession`.
- Preserve existing permission, MCP, working-directory, model, and reasoning behavior.

### Events and Reporting

- Surface SDK `session.skills_loaded` and `skill.invoked` events through minih event streams, either as normalized stable events or preserved raw events with clear pretty rendering.
- Pretty/tail output should make skill loading and invocation obvious when present.
- Smoke-test evidence should be able to assert that `grill-me` loaded and was invoked.

## Acceptance Criteria

- **AC1 — Config file**: A repo can enable skills using `.minih.json` without absolute paths.
- **AC2 — Alias resolution**: `global:agents`, `global:copilot`, `global:claude`, `global:pi`, `repo:.agents`, `repo:.claude`, `repo:.github`, `.agents`, `.claude`, `.github`, and `path:<path>` resolve deterministically.
- **AC3 — No implicit globals**: Minih loads no user-global skills unless config or CLI flags request them.
- **AC4 — Include by name**: `include` resolves named skills to direct skill directories and does not load unrelated skills from the same global source.
- **AC5 — Exclude support**: `exclude` disables skills via SDK `disabledSkills` or removes selected direct directories when `include` is present.
- **AC6 — Missing-source UX**: Missing configured sources are visible in `skills doctor`, `skills discover`, `inspect`, and run preflight output as warnings, not silent skips.
- **AC7 — Missing include UX**: Missing explicitly included skills produce an actionable error listing searched sources and suggesting `minih skills discover`.
- **AC8 — CLI overrides**: `minih run <slug> --skill-source global:agents --skill grill-me` resolves and passes only the `grill-me` skill directory when present.
- **AC9 — SDK pass-through**: Adapter tests prove `skillDirectories` and `disabledSkills` are passed to SDK `createSession` and `resumeSession`.
- **AC10 — Event visibility**: `session.skills_loaded` and `skill.invoked` are visible in run events/tail/pretty output sufficiently for tests and humans to observe.
- **AC11 — Portable smoke test**: A committed repo-local sample skill at `.agents/skills/minih-test-skill/SKILL.md` can be loaded and invoked by a committed minih agent at `agents/test-skills/`, proving skills support without depending on user-global installs.
- **AC12 — Optional global smoke test**: `skills-smoke-test` can load and invoke `grill-me` on machines where `global:agents` contains that skill.
- **AC13 — Docs light up**: README, `run --help`, `skills --help`, `doctor`, `inspect`, and `agent-readme` mention skills config and discovery.
- **AC14 — Domain boundaries**: CLI owns config resolution; runner remains SDK-independent; adapter remains the only SDK wrapper.
- **AC15 — Existing behavior**: Runs without skill config behave as before.

## Risks & Assumptions

- Direct skill directories are supported by SDK v1.0.0 based on local experiments; adapter tests should still fail loudly if SDK facade assumptions drift.
- External agents may not have the same global skill inventory. Diagnostics must treat that as a machine capability mismatch, not a mysterious runtime failure.
- `.minih.json` should be small and focused in v1 to avoid becoming an unbounded project config surface.
- Skill event normalization can start conservative; preserving raw payloads is acceptable if stable names are not yet clear.

## Open Questions

All critical questions for v1 are resolved.

Follow-up design questions that should not block v1:

- Should agent frontmatter support `skills:` as a per-agent default after repo config lands?
- Should `enableSdkDiscovery` be exposed as an explicit escape hatch later?
- Should `minih skills info <name>` read and summarize `SKILL.md` metadata?
- Should duplicate skill names be displayed in all run preflights or only in `skills doctor`?

## Workshop Opportunities

| Topic | Type | Why Workshop | Key Questions |
|-------|------|--------------|---------------|
| CLI config and discovery | CLI Flow / Storage Design / Integration Pattern | Already completed; authoritative for this spec. | Where config lives, how aliases resolve, include/exclude behavior, and which CLI/docs surfaces should light up. |

## Clarifications

### Session 2026-06-05

- **Workflow Mode**: Simple.
  - Rationale: implement as one coherent feature, while architecture may still split internal milestones.
- **Testing Strategy**: Full TDD.
  - Rationale: resolver, CLI envelopes, adapter pass-through, and event visibility are regression-prone and should be locked down.
- **Mock Usage**: Targeted mocks.
  - Rationale: real temp filesystem fixtures for resolver/CLI behavior; fakes/mocks for SDK session boundaries.
- **Documentation Strategy**: Hybrid.
  - Rationale: README quick-start plus built-in CLI/help/doctor/agent-readme surfaces so humans and agents can discover the feature.
- **Engineering Harness Readiness**: L2 sufficient.
  - Rationale: existing `just build`, focused Vitest gates, CLI envelopes, `minih doctor/list`, and `just fft` cover this feature; no separate Phase 0 harness work is required by the spec.

## Next Steps

- Backpressure note: the primary deterministic smoke should use a committed repo-local sample skill (`.agents/skills/minih-test-skill/SKILL.md`) plus a committed minih agent (`agents/test-skills/`) so CI/other machines do not depend on `~/.agents` inventory.
- Optional but recommended: run `/plan-2d-backpressure-survey` against this spec to identify deterministic sensors before architecture.
- Then run `/plan-3-v3-architect` to produce the implementation plan.
