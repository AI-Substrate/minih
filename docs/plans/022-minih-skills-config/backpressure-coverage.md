# Backpressure Coverage — Minih Skills Config

**Spec**: [minih-skills-config-spec.md](./minih-skills-config-spec.md)
**Generated**: 2026-06-05
**Certainty**: Partial

> Advisory only — informs `plan-3`. Never blocks, never gates, no scores. (See plan-2d-backpressure-survey.)
>
> Computational tier note: `plan-3` Gate G6 checks that test tasks exist and acceptance criteria are measurable. This survey asks earlier whether deterministic sensors can prove the experienced failure modes. `plan-7-v2-code-review` remains the inferential / eyeball tier after implementation.

## Existing Sensors (inventory)

| Sensor | Command | Dimension |
|--------|---------|-----------|
| full quality gate | `just fft` | maintainability |
| lint / format check | `npx biome check .` | maintainability |
| build | `npm run build` / `just build` | maintainability |
| typecheck | `npx tsc --noEmit` / `just typecheck` | maintainability |
| unit + integration tests | `npm test` / `just test` | behaviour |
| dependency audit | `npm audit --audit-level=high || true` / `just audit` | maintainability |
| SDK version freshness check | `just sdk-check` | behaviour |
| CLI doctor | `minih doctor` / CI `node dist/cli/index.js doctor` | behaviour |
| CLI list smoke | `minih list` / CI `node dist/cli/index.js list` | behaviour |
| CLI inspect smoke | CI `node dist/cli/index.js inspect hello-world` | behaviour |
| package bin artifact check | CI `test -f dist/cli/index.js` + `npm pack --dry-run` | behaviour |
| CI matrix | `.github/workflows/ci.yml` on Node 20 and 22 | maintainability |
| adapter focused tests | `npx vitest run test/adapter/sdk-copilot.test.ts` | behaviour |
| CLI focused tests | `npx vitest run test/cli/<file>.test.ts` | behaviour |
| runner focused tests | `npx vitest run test/runner/<file>.test.ts` | behaviour / architecture-fitness |
| domain import boundary discipline | domain docs + existing architecture tests by convention | architecture-fitness |

## Coverage Matrix

| Criterion / failure mode | Deterministic sensor | Status | Tier |
|--------------------------|----------------------|--------|------|
| AC1 — `.minih.json` can enable skills without absolute paths | New config parser/resolver unit tests with temp repo `.minih.json` fixtures | BUILDABLE | computational |
| AC2 — all v1 aliases resolve deterministically | New resolver table tests for `global:*`, `repo:*`, short repo aliases, `~` shorthands, and `path:` | BUILDABLE | computational |
| AC3 — no implicit global skills | New run-config merge tests proving empty config/flags produce no `skillDirectories` | BUILDABLE | computational |
| AC4 — `include` loads only named direct skill dirs | New temp-fixture tests with multiple sibling `SKILL.md` dirs proving selected direct paths only | BUILDABLE | computational |
| AC5 — `exclude` becomes `disabledSkills` or filters selected direct dirs | New resolver/config merge tests for parent-source and include modes | BUILDABLE | computational |
| AC6 — missing source UX appears in discover/doctor/inspect/preflight | New CLI envelope tests for missing source warnings plus stderr snapshot/assertions | BUILDABLE | computational |
| AC7 — missing included skill errors with searched sources and discover hint | New CLI error-envelope test with stable `E210`–`E219` code and message assertions | BUILDABLE | computational |
| AC8 — run CLI override resolves `global:agents` + `grill-me` to one direct dir | New run command composition test using temp HOME/source fixtures and fake adapter | BUILDABLE | computational |
| AC9 — adapter passes skill arrays to SDK create/resume | New adapter tests against fake `ICopilotClient` for `createSession` and `resumeSession` configs | BUILDABLE | computational |
| AC10 — skills-loaded/invoked events visible in minih events/tail/pretty | New adapter event translation tests plus runner/display tests for normalized or raw skill events | BUILDABLE | computational |
| AC11 — committed repo-local sample skill loads/invokes via `agents/test-skills` | Add `.agents/skills/minih-test-skill/SKILL.md`, `agents/test-skills/`, and a focused smoke/integration path using repo alias `.agents` | BUILDABLE | computational |
| AC12 — optional `skills-smoke-test` can load/invoke `grill-me` where installed | Optional SDK-backed smoke run with cheap model; existing local experiment already supports feasibility | BUILDABLE | computational |
| AC13 — docs/help surfaces mention skills | New CLI help tests (`run --help`, `skills --help`), README/agent-readme structure tests | BUILDABLE | computational |
| AC14 — domain boundaries preserved | Existing build/typecheck plus targeted import grep/test if new resolver placement risks upward imports | BUILDABLE | computational |
| AC15 — runs without skill config behave as before | Existing full test suite plus new no-skills regression in run/resume config tests | BUILDABLE | computational |
| Failure mode: SDK v1 skill event payload shape differs from experiments | Preserve raw SDK events in adapter tests; optional smoke-test records actual `session.skills_loaded`/`skill.invoked` names | BUILDABLE | computational |
| Failure mode: duplicate skill names across sources resolve surprisingly | Resolver precedence tests and `skills doctor` duplicate warning test | BUILDABLE | computational |
| Failure mode: source scanning accidentally recurses or loads too much context | Fixture test with nested `SKILL.md` proving only immediate children are considered unless direct source is provided | BUILDABLE | computational |
| Failure mode: `.minih.json` conflicts with `.mcp.json` or breaks existing run config | Existing MCP/run tests plus new config coexistence test | BUILDABLE | computational |
| Failure mode: docs wording is discoverable enough for arbitrary external agents | README/help/agent-readme structure tests can prove presence, but qualitative clarity remains review/human judgement | ABSENT | human-judgement |
| Failure mode: a user-global skill on another machine has incompatible prompt contents | Minih can detect presence/path/name, not semantic skill correctness; route to smoke tests and human/AI review | ABSENT | inferential |

## Certainty: Partial

Existing build, lint, typecheck, test, CI, and CLI doctor/list sensors already prove the general minih quality gate, but feature-specific behaviour/architecture coverage is mostly BUILDABLE and must be added with the implementation.

## Recommended Phase 0: Establish Backpressure

| Sensor to build | Proves | Suggested form |
|-----------------|--------|----------------|
| Skill resolver fixture test matrix | AC1–AC5, duplicate precedence, direct-dir support, no recursive scans | Vitest unit tests with temp dirs and `SKILL.md` fixtures |
| Skills config parser validation tests | Malformed `.minih.json` skills blocks fail clearly while unknown top-level keys stay forward-compatible | Vitest unit tests around parser/schema helper |
| CLI `skills discover` / `skills doctor` envelope tests | AC6–AC7 and agent-readable diagnostics | CLI integration tests against built CLI with temp cwd/HOME |
| Run override composition test | AC3, AC8, AC14 — run flags/config merge to resolved adapter options without implicit globals | CLI/run test with FakeAgentAdapter or composition seam |
| Adapter SDK pass-through tests | AC9 — `skillDirectories` / `disabledSkills` reach `createSession` and `resumeSession` unchanged | Adapter unit tests using fake `ICopilotClient` |
| Skill event visibility tests | AC10 — `session.skills_loaded` and `skill.invoked` appear in minih events/display | Adapter + runner/display tests with synthetic SDK events |
| Docs/help structure tests | AC12 — built-in help/agent docs mention skills and discovery commands | Existing `run-help` / `agent-readme` style tests extended for skills |
| Repo-local sample skill + `test-skills` agent | AC11 — actual SDK loads/invokes a committed `.agents` skill on any checkout | Committed fixture skill plus minih agent smoke path using cheap model |
| Optional global SDK smoke evidence | AC12 — actual SDK loads/invokes `grill-me` when present | Opt-in smoke test or manual evidence command using cheap model |
