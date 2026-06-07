# Minih Skills Config Implementation Plan

**Mode**: Simple
**Plan Version**: 1.0.0
**Created**: 2026-06-05
**Spec**: [minih-skills-config-spec.md](./minih-skills-config-spec.md)
**Status**: READY

## Gate Matrix

| Gate | Check | Status | Notes |
|------|-------|--------|-------|
| G1 | Clarify | PASS | Spec has no critical `[NEEDS CLARIFICATION]` markers; v1 open questions are explicitly deferred. |
| G2 | Constitution | N/A | No `docs/project-rules/constitution.md` present. |
| G3 | Architecture | N/A | No `docs/project-rules/architecture.md` present; domain map/import-direction rules are handled through G7. |
| G4 | ADR Compliance | N/A | No accepted ADRs found for this feature. |
| G5 | Structure | PASS | Required Simple-mode sections are present and populated. |
| G6 | Testing Alignment | PASS | Full TDD is reflected by test-first tasks before implementation/wiring tasks. |
| G7 | Domain Completeness | PASS | All spec domains are listed; Domain Manifest covers every planned task path. |

## Summary

Minih will gain first-class skills configuration by adding a small repo config surface, deterministic alias resolution, discover/doctor CLI diagnostics, and SDK pass-through for resolved `skillDirectories` / `disabledSkills`. The implementation keeps resolution and user-facing diagnostics in the CLI domain, carries only resolved SDK-neutral values through runner contracts, and leaves SDK option/event knowledge inside the adapter. The plan begins with deterministic backpressure sensors because the existing quality gate is strong but feature-specific proof is currently buildable rather than already present.

## Target Domains

| Domain | Status | Relationship | Role |
|--------|--------|--------------|------|
| cli | existing | modify | Own `.minih.json` discovery, skill-source CLI flags, `minih skills` command group, run preflight/help/doctor/inspect docs, and composition wiring. |
| runner | existing | modify | Carry resolved skill config and normalized/preserved skill events without importing SDK-specific types. |
| adapter | existing | modify | Extend the Copilot facade, pass skill config into SDK sessions, and translate or preserve skill events. |
| measurement | existing | consume | Use existing evidence/proof concepts only; no runtime code changes required. |

## Domain Manifest

| File | Domain | Classification | Rationale |
|------|--------|----------------|-----------|
| `src/cli/skills.ts` | cli | internal | Pure config parser, source alias resolver, source scanner, include/exclude merge, and diagnostics builder. |
| `src/cli/commands/skills.ts` | cli | internal | New `minih skills discover` / `minih skills doctor` command group. |
| `src/cli/commands/run.ts` | cli | internal | Add run flags, merge resolved skills into `AgentRunConfig`, and render bounded preflight/help text. |
| `src/cli/commands/resume.ts` | cli | internal | Reuse skills resolution/merge helper for resume-in-place SDK sessions. |
| `src/cli/commands/doctor.ts` | cli | internal | Add `.minih.json` skills audit warnings/errors. |
| `src/cli/commands/inspect.ts` | cli | internal | Show resolved skill config and missing-source diagnostics. |
| `src/cli/index.ts` | cli | internal | Register the `skills` command group. |
| `src/cli/output.ts` | cli | contract | Reserve skills config error codes (`E210`–`E219`). |
| `src/runner/types.ts` | runner | contract | Add SDK-neutral skill config fields to `AgentRunConfig`. |
| `src/runner/runner.ts` | runner | internal | Pass resolved skill config to adapter options and persist/stream skill events unchanged or normalized. |
| `src/runner/display.ts` | runner | internal | Render skills-loaded/invoked events for verbose/tail surfaces. |
| `src/runner/pretty.ts` | runner | internal | Render skills-loaded/invoked events in default pretty mode. |
| `src/adapter/events.ts` | adapter | contract | Extend `AgentRunOptions` and optionally add stable skill event variants. |
| `src/adapter/copilot-types.ts` | adapter | contract | Extend local SDK session config facade with `skillDirectories` and `disabledSkills`. |
| `src/adapter/sdk-copilot.ts` | adapter | internal | Pass skill config to `createSession` / `resumeSession` and translate SDK skill events. |
| `src/templates/AGENTS_README.md` | cli | contract | Add bundled agent-facing skills guidance if this template exists in source tree; otherwise update the source used by `agent-readme`. |
| `scripts/copy-schemas.js` | cli | internal | Copy any updated bundled agent-readme/help artifact if needed. |
| `README.md` | cli | contract | Add human quick-start skills section and alias table. |
| `.agents/skills/minih-test-skill/SKILL.md` | cli | internal | Committed repo-local skill fixture proving portable `.agents` source loading. |
| `agents/test-skills/prompt.md` | cli | internal | Committed minih agent that invokes the repo-local sample skill for deterministic smoke evidence. |
| `agents/test-skills/output-schema.json` | cli | internal | Output schema for the portable skill smoke agent. |
| `agents/skills-smoke-test/prompt.md` | cli | internal | Optional global-skill smoke agent prompt expectations once skills are wired. |
| `agents/skills-smoke-test/output-schema.json` | cli | internal | Optional global-skill smoke output schema aligned with loaded/invoked skill assertions. |
| `test/cli/skills.test.ts` | cli | internal | CLI command/envelope tests for `skills discover` and `skills doctor`. |
| `test/cli/skills-resolver.test.ts` | cli | internal | Pure resolver/config merge tests with temp skill dirs. |
| `test/cli/run-help.test.ts` | cli | internal | Help text regression for skills flags/discovery hints. |
| `test/cli/run-skills.test.ts` | cli | internal | Run/resume composition tests proving resolved skill options flow to runner/adapter without implicit globals. |
| `test/cli/doctor-skills.test.ts` | cli | internal | Doctor skills-config diagnostics. |
| `test/cli/inspect-skills.test.ts` | cli | internal | Inspect resolved skills block. |
| `test/cli/agent-readme.test.ts` | cli | internal | Bundled agent-readme mentions skills discovery/config. |
| `test/runner/runner-skills.test.ts` | runner | internal | Runner passes skill options and streams/persists skill events. |
| `test/runner/display-skills.test.ts` | runner | internal | Verbose/tail display for skill events. |
| `test/runner/pretty.test.ts` | runner | internal | Pretty-mode skill event rendering regression. |
| `test/adapter/sdk-copilot.test.ts` | adapter | internal | Adapter pass-through and skill event translation tests. |
| `test/adapter/sdk-skill-shapes.test.ts` | adapter | internal | Narrow SDK drift sentinel for skill option/event names if feasible. |
| `docs/plans/022-minih-skills-config/backpressure-coverage.md` | measurement | cross-domain | Advisory proof matrix already produced; informs test-first tasks. |

## Key Findings

| # | Impact | Finding | Action |
|---|--------|---------|--------|
| 01 | Critical | Skills resolution belongs in CLI, not runner. The CLI domain owns user-facing config, flags, envelopes, help, doctor, and SDK composition; runner should receive resolved SDK-neutral values only. | Create a CLI-owned resolver/config module and pass `{skillDirectories, disabledSkills, diagnostics}` into existing run/resume config seams. |
| 02 | High | Run and resume share the SDK-session composition risk. Wiring only `run` would miss `resumeSession`; duplicating resolution in both commands would drift. | Build one shared CLI helper used by both `run.ts` and `resume.ts`; test both create and resume paths. |
| 03 | High | The adapter facade is the correct SDK boundary. Existing `copilot-types.ts` and `sdk-copilot.ts` already isolate SDK session config and pass-through options. | Add skill fields to facade/config types and forward them in both `createSession` and `resumeSession`; do not expose SDK config discovery by default. |
| 04 | Critical | Skill events may currently be persisted as raw events but invisible to humans. `displayEvent()` and pretty mode tend to ignore raw events. | Add normalized `skills_loaded` / `skill_invoked` events or special-case the SDK raw names in adapter/display/pretty tests. |
| 05 | High | The “Christmas tree” requirement is a CLI contract, not prose only. It must show up in help, doctor, inspect, envelopes, README, and agent-readme. | Extend existing Commander/envelope/help/doctor patterns; reserve explicit error codes and add structure tests. |
| 06 | High | Existing quality gates are strong, but feature-specific proof is buildable and not yet present. | Implement the backpressure survey's sensor tasks first: resolver matrix, CLI envelopes, adapter pass-through, event visibility, docs/help tests, and a committed repo-local sample skill + test agent. |

## Implementation

**Objective**: Implement first-class minih skills config end-to-end, with deterministic resolver diagnostics and SDK pass-through, while preserving existing behavior when no skills are configured.

**Testing Approach**: Full TDD with targeted mocks. Use real temp directories and fixture `SKILL.md` files for resolver and CLI tests; use fakes/mocks for SDK boundaries.

### Tasks

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|--------|-----|------|--------|---------|-----------|-------|
| [ ] | T001 | Add resolver fixture tests for source aliases, direct skill dirs, parent source dirs, `include`, `exclude`, missing sources, duplicate precedence, and no recursive scans. | cli | `test/cli/skills-resolver.test.ts` | Tests fail before implementation and cover AC1–AC7 plus survey Phase 0 rows. | Per findings 01, 06. |
| [ ] | T002 | Add CLI command/envelope tests for `minih skills discover` and `minih skills doctor` using temp cwd/HOME fixtures. | cli | `test/cli/skills.test.ts` | Tests assert JSON envelopes, human stderr basics, missing-source warnings, duplicate warnings, and missing-include error hints. | Per findings 05, 06. |
| [ ] | T003 | Add run/resume composition tests proving no implicit globals and proving `--skill-source global:agents --skill grill-me` resolves to a single direct dir. | cli | `test/cli/run-skills.test.ts` | Tests fail before implementation and cover fresh run and resume paths. | Per finding 02. |
| [ ] | T004 | Add adapter pass-through and event tests before implementation. | adapter | `test/adapter/sdk-copilot.test.ts`, `test/adapter/sdk-skill-shapes.test.ts` | Tests assert `skillDirectories` / `disabledSkills` reach `createSession` and `resumeSession`, and synthetic SDK skill events map visibly. | Per findings 03, 04. |
| [ ] | T005 | Add display/pretty tests for skill load/invocation visibility. | runner | `test/runner/display-skills.test.ts`, `test/runner/pretty.test.ts` | Tests prove `session.skills_loaded` / `skill.invoked` become readable output such as “skills loaded: grill-me” and “skill invoked: grill-me”. | Per finding 04. |
| [ ] | T006 | Add docs/help tests for skills discovery surfacing. | cli | `test/cli/run-help.test.ts`, `test/cli/agent-readme.test.ts`, `test/cli/doctor-skills.test.ts`, `test/cli/inspect-skills.test.ts` | Tests prove `run --help`, `agent-readme`, doctor, and inspect mention skills config/discovery. | Per finding 05. |
| [ ] | T007 | Implement CLI-owned skills config parser and resolver. | cli | `src/cli/skills.ts` | `.minih.json` skills block parses; aliases resolve; include/exclude behavior matches tests; diagnostics include warnings/errors with searched sources. | Keep pure and easy to test; do not import runner/adapter. |
| [ ] | T008 | Implement `minih skills discover` / `minih skills doctor`. | cli | `src/cli/commands/skills.ts`, `src/cli/index.ts`, `src/cli/output.ts` | Commands emit JSON envelopes on stdout, human diagnostics on stderr, and stable skills errors in the `E210`–`E219` range. | Follow `agent` command group and doctor patterns. |
| [ ] | T009 | Wire run/resume flags and config merge. | cli | `src/cli/commands/run.ts`, `src/cli/commands/resume.ts` | `--skill-source`, `--skill`, `--disable-skill`, `--no-skills`, and optional `--skills-debug` work; resolved arrays enter `AgentRunConfig`; absent config preserves current behavior. | Shared helper prevents run/resume drift. |
| [ ] | T010 | Extend runner contracts and pass-through. | runner | `src/runner/types.ts`, `src/runner/runner.ts` | `AgentRunConfig` carries `skillDirectories` / `disabledSkills`; adapter options receive them unchanged; no SDK imports added to runner. | Per AC13. |
| [ ] | T011 | Extend adapter contracts and SDK pass-through. | adapter | `src/adapter/events.ts`, `src/adapter/copilot-types.ts`, `src/adapter/sdk-copilot.ts` | Local SDK facade includes skill fields; `createSession` and `resumeSession` receive arrays; fallback behavior unchanged when arrays absent. | Per AC9. |
| [ ] | T012 | Surface skill events in event/display paths. | adapter / runner | `src/adapter/events.ts`, `src/adapter/sdk-copilot.ts`, `src/runner/display.ts`, `src/runner/pretty.ts` | Skill loaded/invoked events are visible in run/tail/pretty output and persisted with enough payload for tests. | Normalize if stable; preserve raw payload as needed. |
| [ ] | T013 | Extend doctor and inspect skills surfaces. | cli | `src/cli/commands/doctor.ts`, `src/cli/commands/inspect.ts` | `doctor` audits `.minih.json`; `inspect` shows source aliases, missing sources, includes/excludes, and resolved directories. | Diagnostics should be bounded. |
| [ ] | T014 | Add docs that light up skills for humans and agents. | cli | `README.md`, `src/templates/AGENTS_README.md`, `scripts/copy-schemas.js` | README and bundled agent-readme show `.minih.json`, alias table, `minih skills discover`, and no-implicit-globals policy. | If the source template path differs, update the actual bundled markdown source used by tests. |
| [ ] | T015 | Add committed repo-local sample skill and portable `test-skills` agent. | cli | `.agents/skills/minih-test-skill/SKILL.md`, `agents/test-skills/prompt.md`, `agents/test-skills/output-schema.json` | A checkout contains a known skill fixture and a minih agent that invokes it through `repo:.agents` / `.agents`, so smoke evidence does not depend on `~/.agents`. | Primary deterministic smoke for AC11. |
| [ ] | T016 | Update optional global `skills-smoke-test` for the `grill-me` positive path. | cli | `agents/skills-smoke-test/prompt.md`, `agents/skills-smoke-test/output-schema.json` | Smoke agent asks for `grill-me` invocation and reports observed loaded/invoked skill evidence; remains safe on machines without that skill via documented gating. | Optional/manual evidence for AC12. |
| [ ] | T017 | Run focused validation gates. | measurement | `docs/plans/022-minih-skills-config/backpressure-coverage.md` | Focused tests for cli/runner/adapter pass, then `npm run build`, `npm test`; before commit/push run `just fft`. | Existing harness is L2 sufficient. |

### Acceptance Criteria

- [ ] AC1 — A repo can enable skills using `.minih.json` without absolute paths.
- [ ] AC2 — `global:agents`, `global:copilot`, `global:claude`, `global:pi`, `repo:.agents`, `repo:.claude`, `repo:.github`, `.agents`, `.claude`, `.github`, and `path:<path>` resolve deterministically.
- [ ] AC3 — Minih loads no user-global skills unless config or CLI flags request them.
- [ ] AC4 — `include` resolves named skills to direct skill directories and does not load unrelated skills from the same global source.
- [ ] AC5 — `exclude` disables skills via SDK `disabledSkills` or removes selected direct directories when `include` is present.
- [ ] AC6 — Missing configured sources are visible in `skills doctor`, `skills discover`, `inspect`, and run preflight output as warnings, not silent skips.
- [ ] AC7 — Missing explicitly included skills produce an actionable error listing searched sources and suggesting `minih skills discover`.
- [ ] AC8 — `minih run <slug> --skill-source global:agents --skill grill-me` resolves and passes only the `grill-me` skill directory when present.
- [ ] AC9 — Adapter tests prove `skillDirectories` and `disabledSkills` are passed to SDK `createSession` and `resumeSession`.
- [ ] AC10 — `session.skills_loaded` and `skill.invoked` are visible in run events/tail/pretty output sufficiently for tests and humans to observe.
- [ ] AC11 — A committed repo-local sample skill at `.agents/skills/minih-test-skill/SKILL.md` can be loaded and invoked by `agents/test-skills/`.
- [ ] AC12 — `skills-smoke-test` can optionally load and invoke `grill-me` on machines where `global:agents` contains that skill.
- [ ] AC13 — README, `run --help`, `skills --help`, `doctor`, `inspect`, and `agent-readme` mention skills config and discovery.
- [ ] AC14 — CLI owns config resolution; runner remains SDK-independent; adapter remains the only SDK wrapper.
- [ ] AC15 — Runs without skill config behave as before.

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| SDK skill event payload shape differs from local experiments. | Medium | Medium | Preserve raw payloads in normalized events and add a narrow SDK-shape/drift test where feasible. |
| Resolver accidentally loads too many global skills and increases context/behavior drift. | Medium | High | Prefer include examples; test direct-dir include behavior and no recursive scans. |
| Run and resume skill wiring drift. | Medium | High | Use a shared CLI helper and test both paths. |
| Missing global skills on another machine look like minih failures. | High | Medium | Treat missing sources as warnings and missing includes as actionable errors listing searched sources. |
| New `.minih.json` handling interferes with `.mcp.json` or existing no-config runs. | Low | High | Add no-config and config-coexistence tests; no implicit globals. |
| Agent-facing docs are present but not actually clear enough. | Medium | Medium | Structure tests prove presence; human/code review validates clarity. |

## Agent Harness Strategy

- **Current Maturity**: L2 (`docs/project-rules/harness.md`)
- **Target Maturity**: L2 for this feature
- **Boot Command**: `just build`
- **Health Check**: `minih doctor`
- **Interaction Model**: Terminal CLI with JSON envelopes on stdout and human diagnostics on stderr
- **Evidence Capture**: Focused Vitest output, CLI envelopes/stderr captures, and final `just fft`
- **Pre-Phase Validation**: For implementation, start with `just build`, run focused tests for touched domains, then run `npm test`; before commit/push run `just fft`.

No separate agent-harness Phase 0 is required because the user confirmed the existing L2 engineering harness is sufficient. The backpressure survey's recommended Phase 0 is incorporated as test-first tasks T001–T006 rather than a separate blocking phase.
