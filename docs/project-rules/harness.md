# Engineering Harness

**Version**: 1.0.0
**Created**: 2026-05-10
**Maturity Level**: L2
**Project Type**: cli

## Purpose

This harness defines MiniH's engineering feedback loop: Boot -> Interact -> Observe -> Validate. It is agent-operable, but it is not merely an "agent harness"; it is the project contract for proving MiniH itself can be built, exercised through supported CLI surfaces, and observed without reading private run files directly.

## Boot

- **Command**: `just build`
- **Health Check**: `minih doctor`
- **Expected Response**: A JSON envelope on stdout with a successful doctor result, plus any human-readable diagnostics on stderr.
- **Boot Time**: target 30-60s
- **Idempotent**: Yes - `just build` rebuilds `dist/`, and the globally linked `minih` binary points at this checkout's `dist/cli/index.js`.

## Interact

- **Primary**: Terminal CLI
- **Endpoints / Commands**:
  - `minih doctor` - validates agent conventions and project health surfaces.
  - `minih list` - lists available agents through the public CLI envelope.
  - `minih check <slug> --file <path>` - validates explicit files against agent schemas.
  - `minih status <slug> --run <runId>` - inspects run status without reading run-directory files directly.
  - `minih tail <slug> --run <runId> --snapshot --lines N` - observes bounded event output through the CLI.
  - `minih retros --slug <slug>` - reads retrospective evidence through the CLI.
- **Auth Strategy**: None for build, doctor, list, check, status, tail, and retros. Running SDK-backed agents may require `GH_TOKEN=$(gh auth token)` in the spawning shell.
- **Auth Expiry**: N/A for local CLI health; SDK-backed agent runs fail with a clear auth/token error when credentials are absent or expired.
- **Auth Detection**: Prefer CLI error envelopes and `gh auth status`/`gh auth token` for SDK-backed workflows.

## Observe

- **Response capture**: JSON envelopes on stdout; human-readable tables and pretty output on stderr.
- **Screenshots**: N/A for the core CLI harness.
- **Logs**: Use `minih tail`, `minih last-run`, `minih validate`, and `minih retros`. Do not read `agents/<slug>/runs/<runId>/...` files directly.
- **Evidence directory**: `./scratch/evidence/` for ad hoc command captures; committed phase evidence belongs in the active plan's task `execution.log.md`.

## Maturity Assessment

| Level | Status | Notes |
|-------|--------|-------|
| L0: No harness | No | MiniH has named build, test, CLI, and observation commands. |
| L1: Manual boot + CLI | Yes | A human or agent can build and run CLI commands. |
| L2: Auto boot + CLI health | Yes | `just build` plus `minih doctor` provide an automated boot and health check. |
| L3: Full interaction + evidence | Partial | CLI observation surfaces exist, but phase-specific evidence scripts are not yet standardized. |
| L4: Self-healing | No | The harness does not auto-recover from failed builds, stale SDK auth, or broken agent configs. |

Current: **L2** - MiniH can be built and checked through public CLI surfaces, with structured output available for evidence capture.

## Validation Checklist

### Boot

- [x] Single command starts full stack
- [x] Health check endpoint/command exists and returns expected response
- [x] Boot is idempotent
- [ ] Handles port conflicts (not applicable for the core CLI; server-like commands must fail fast or own cleanup)
- [ ] Clean shutdown on SIGTERM/SIGINT for long-running interactive views

### Interact

- [x] Agent can send input through terminal commands
- [x] Agent can trigger core user-facing actions through the CLI
- [x] Auth is automated or unnecessary for local health paths
- [x] Auth expiry is detected with a clear error message for SDK-backed runs

### Observe

- [x] Agent can read output through CLI JSON envelopes and stderr diagnostics
- [x] Evidence capture works through redirected CLI output and `scratch/evidence/`
- [x] Structured output available

### Operate

- [x] Bootstrap doc explains harness to new agents
- [x] Example validation script exists as a committed copy-paste command
- [x] Named commands exist in `justfile` and `package.json`

## Phase Gates

Use the narrowest gate that proves the phase's contract, then run `just fft` before commit or push.

| Domain / Work Type | Boot | Interact | Observe | Narrow Gate |
|--------------------|------|----------|---------|-------------|
| docs / planning | N/A | Read linked plan/domain docs | `git --no-pager diff --check` | `git --no-pager diff --check` |
| runner | `just build` | Focused runner tests | Vitest output | `npx vitest run test/runner/<file>.test.ts` |
| cli | `just build` | Built `minih ...` command | JSON envelope stdout + stderr diagnostics | `npx vitest run test/cli/<file>.test.ts` |
| mcp | `just build` | MCP server/spawn tests | Vitest output | `npx vitest run test/mcp/<file>.test.ts` |
| adapter | `just build` | Fake adapter tests unless SDK behavior is required | Vitest output | targeted adapter test |
| measurement contracts | `just build` | Schema/proof/registry tests | AJV/Vitest output | `npx vitest run test/runner/schemas.test.ts test/runner/measurement/*.test.ts` |
| release / pre-commit | `just build` | Full pipeline | CLI/test/audit output | `just fft` |

## Dogfood Rules

- Use the MiniH CLI to inspect MiniH runs. Do not `cat`, `tail`, `grep`, or `jq` files under `agents/<slug>/runs/<runId>/` directly.
- If a needed run artifact has no CLI surface, record the CLI gap before using emergency direct file access.
- Treat JSON envelopes as the machine contract and stderr as human-readable diagnostics.
- For source-code phases, start or verify code-review-companion before editing source code.
- Keep measurement work local-first and evidence-backed: runner facts are authoritative; agents and companions may only add cited interpretation.

## Validation Checklist for Agents

Before implementation:

1. Boot: run `just build`.
2. Interact: run the narrow CLI/test command for the phase.
3. Observe: capture the command result through stdout/stderr or the active plan's execution log.
4. Validate: run the phase's narrow test gate; before commit/push, run `just fft`.

Copy-paste harness validation:

```bash
set -e
just build
mkdir -p scratch/evidence
minih doctor > scratch/evidence/harness-doctor.json 2> scratch/evidence/harness-doctor.stderr
minih list > scratch/evidence/harness-list.json 2> scratch/evidence/harness-list.stderr
test -s scratch/evidence/harness-doctor.json
test -s scratch/evidence/harness-list.json
```

## History

| Date | Plan | Change | Maturity Before -> After |
|------|------|--------|--------------------------|
| 2026-05-10 | 020-minih-harness-measurement | Created MiniH engineering harness contract for Boot -> Interact -> Observe measurement prerequisite. | L0 -> L2 |
| 2026-05-10 | 020-minih-harness-measurement | Validated Boot with `just build`, Interact with `minih doctor`/`minih list`, and Observe with redirected JSON evidence in `scratch/evidence/`. | L2 -> L2 |

<!-- USER CONTENT START -->
<!-- Project-specific harness notes, custom boot sequences, domain-specific setup -->
<!-- USER CONTENT END -->
