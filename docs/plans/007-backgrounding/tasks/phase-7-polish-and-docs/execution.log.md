# Execution Log: Phase 7 — Polish & Docs

**Plan**: [coordination-plan.md](../../coordination-plan.md)
**Phase**: Phase 7: Polish & Docs
**Started**: 2026-04-27T09:25:13+10:00
**Status**: Complete

---

## Harness Validation

No `docs/project-rules/harness.md` exists. Phase 7 uses the standard plan harness from the dossier: build/CLI smoke checks, targeted vitest commands, opt-in coordination gates where relevant, manual markdown link checks, and final whitespace/quality checks.

---

## Task Entries

### T001 — Audit MCP domain doc

**Status**: Complete
**Started**: 2026-04-27T09:25:13+10:00

**Plan**: Audit `docs/domains/mcp/domain.md` for final inside-only six-tool server wording, hidden baked context, spawn config, dependencies, leak-validation provenance, no-public-server boundary, and stale Phase 5 wording.

**Completed**: 2026-04-27T09:27:44+10:00

**Evidence**:

- Removed stale “outside CLI surface (future Phase 5)” wording from `docs/domains/mcp/domain.md`.
- Added the final CLI-owned outside command boundary, explicit no-public-server lifecycle boundary, all six MCP tools as a contract, hidden baked context narrative, private spawn wording, and leak-regression provenance.
- Logged workshop 009 as future probe-harness design only, not a supported command.

### T002 — Update domain registry

**Status**: Complete
**Started**: 2026-04-27T09:28:05+10:00

**Plan**: Audit `docs/domains/registry.md` so the four active domains and final purpose wording match Phase 7 source truth: `adapter`, `runner`, `mcp`, and `cli`.

**Completed**: 2026-04-27T09:29:21+10:00

**Evidence**:

- Confirmed the registry has exactly the four active domains: `adapter`, `runner`, `mcp`, and `cli`.
- Tightened purpose wording to mention final coordination contracts and boundaries, including `SessionSender`, runner daemon-light/snapshots, MCP private six-tool server, and CLI composition-root wiring.

### T003 — Update domain map

**Status**: Complete
**Started**: 2026-04-27T09:29:43+10:00

**Plan**: Update `docs/domains/domain-map.md` so graph labels, dependency narrative, and health summary match final import direction: `cli -> {mcp, runner, adapter}`, `mcp -> runner`, `runner -> adapter`, with no upward imports and no runner-to-MCP dependency.

**Completed**: 2026-04-27T09:30:50+10:00

**Evidence**:

- Replaced the terse dependency block with a mermaid graph carrying final responsibilities and edges.
- Added narrative bullets that separate outside peer commands from inside MCP tool calls and preserve the runner-no-MCP boundary.
- Added a health summary table for `cli`, `runner`, `mcp`, and `adapter`.

### T004 — Audit runner domain docs

**Status**: Complete
**Started**: 2026-04-27T09:31:14+10:00

**Plan**: Audit `docs/domains/runner/domain.md` against P1-P6 source truth, especially atomic writes, ULID ordering, file watchers/forwarders, identity block, peer contract section, run snapshots, coordination feedback, and the no-rule-engine/no-MCP-ownership boundaries.

**Completed**: 2026-04-27T09:32:47+10:00

**Evidence**:

- Clarified runner excludes CLI envelopes, MCP implementation, SDK details, and peer policy/rule-engine orchestration.
- Added concepts for coordinated identity blocks, peer-contract framing, and atomic state write failure semantics.
- Added a test/validation matrix covering runner primitives, event-driven/MCP seams, daemon-light forwarders, prompt assembly, and coordination feedback.

### T005 — Audit CLI domain docs

**Status**: Complete
**Started**: 2026-04-27T09:33:12+10:00

**Plan**: Audit `docs/domains/cli/domain.md` for final command registration, outside command behavior, inside-context blocking, `init --coordinated` scaffold files, `doctor` outside contract checks, `run --dry-run` prompt parity, and composition-root MCP wiring.

**Completed**: 2026-04-27T09:34:36+10:00

**Evidence**:

- Updated the CLI boundary to list the complete command family, including `status`, `inspect`, and outside coordination commands.
- Documented `outside-context` `system-only`/`absent`/`empty`/`present` statuses and the distinction between outside CLI file operations and inside MCP tools.
- Added CLI validation coverage for outside commands, coordinated scaffold/dry-run, doctor outside checks, and MCP composition wiring.

### T006 — Audit adapter domain docs

**Status**: Complete
**Started**: 2026-04-27T09:35:03+10:00

**Plan**: Audit `docs/domains/adapter/domain.md` against the final event-driven `run()` contract: `session.send`, `session_idle` resolution, `session_error` failure, `onSessionReady`/`SessionSender`, fake adapter queued-run seams, and explicit exclusion of prompt assembly, MCP implementation, and runner coordination ownership.

**Completed**: 2026-04-27T09:36:12+10:00

**Evidence**:

- Clarified adapter excludes runner terminal-condition policy, coordination file forwarders, CLI SDK bootstrap, and MCP implementation.
- Added concepts for `session_error` failure, subscription cleanup, `SessionSender`, and fake queued-run testing seams.
- Added validation provenance for adapter and runner event-driven tests.

### T007 — Add coordination-aware agent authoring guide

**Status**: Complete
**Started**: 2026-04-27T09:36:49+10:00

**Plan**: Add detailed guidance to `AGENTS_README.md` for coordinated agents: two-sided file layout, `coordination: enabled`, optional/absent/empty `outside.md`, state schemas, `outside-context`, outside commands, coordination retros, and the `agents/coordination-smoke-test` reference.

**Completed**: 2026-04-27T09:39:04+10:00

**Evidence**:

- Added coordinated optional files to the agent folder layout.
- Added a full “Coordination-aware agents” section covering scaffold, frontmatter, `outside.md` absent/empty/present behavior, `outside-context`, outside commands, inside MCP tools, state schemas, and coordination retros.
- Updated the CLI reference with `init --coordinated` and outside/inside coordination commands, using the actual `outside-retro --body` and `retros --agent` syntax.

### T008 — Update README coordination mention

**Status**: Complete
**Started**: 2026-04-27T09:39:37+10:00

**Plan**: Add a concise README mention of coordination and link to the detailed `AGENTS_README.md#coordination-aware-agents` section without duplicating the full guide.

**Completed**: 2026-04-27T09:40:26+10:00

**Evidence**:

- Added a concise coordination-aware agents paragraph near the README overview.
- Linked to `AGENTS_README.md#coordination-aware-agents`.
- Added `minih init my-agent --coordinated` to the README init command examples.

### T009 — Update contributor testing guidance

**Status**: Complete
**Started**: 2026-04-27T09:40:54+10:00

**Plan**: Update `CONTRIBUTING.md` with coordination-specific test tiers for outside CLI, MCP server/spawn behavior, daemon-light, two-agent coordination, and leak regression; keep `MINIH_E2E=1` and `MINIH_PGREP=1` guidance explicit and avoid implying any supported MCP probe harness.

**Completed**: 2026-04-27T09:42:03+10:00

**Evidence**:

- Added a coordination test matrix for outside CLI, MCP server/spawn, runner lifecycle, two-agent smoke, daemon-light forwarders, and MCP cleanup/leak regression.
- Preserved explicit `MINIH_E2E=1` and `MINIH_PGREP=1` opt-in gates.
- Updated import direction to include the `mcp` domain and stated that no supported MCP probe harness command exists today.

### T010 — Update repository agent instructions

**Status**: Complete
**Started**: 2026-04-27T09:42:31+10:00

**Plan**: Update `AGENTS.md` with final import direction, the mcp domain, coordinated optional files, `coordination: enabled`, outside/inside split, targeted coordination test commands, and the concrete `agents/coordination-smoke-test/outside.md` example.

**Completed**: 2026-04-27T09:43:28+10:00

**Evidence**:

- Updated architecture from three domains to four with final import direction: `cli -> {mcp, runner, adapter}`, `mcp -> runner`, `runner -> adapter`.
- Added coordinated optional files, `coordination: enabled`, and a concrete `agents/coordination-smoke-test/outside.md` example.
- Added outside/inside command/tool split guidance and targeted coordination test commands.

---

## Validation

**Completed**: 2026-04-27T09:48:11+10:00

| Check | Result | Evidence |
|-------|--------|----------|
| Build | Pass | `npm run build --silent` |
| Agent health smoke | Pass | `node dist/cli/index.js doctor` |
| Outside context smoke | Pass | `node dist/cli/index.js outside-context coordination-smoke-test` |
| Targeted CLI tests | Pass | `npx vitest run test/cli/outside-context.test.ts test/cli/init-coordinated.test.ts test/cli/doctor-outside-md.test.ts --silent` |
| Whitespace diff check | Pass | `git --no-pager diff --check` |
| Formatting/lint check | Pass | `npx biome check .` |

The first combined validation command also reached `git diff --check`; because Git opened a pager under the interactive shell, the check was rerun with `--no-pager` and passed.
