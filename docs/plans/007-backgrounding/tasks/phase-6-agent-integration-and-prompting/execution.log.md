# Execution Log: Phase 6 — Agent Integration & Prompting

## Pre-phase validation

| Check | Result | Evidence |
|-------|--------|----------|
| Harness | Unavailable | `docs/project-rules/harness.md` is absent; proceeding with standard repository tests. |

## Task Entries

### T001 — Identity block

- Status: Complete.
- Evidence: `npx vitest run test/runner/preamble-builder.test.ts --silent` passed with coordinated snapshots containing slug, run id, and outside/peer awareness while non-coordinated assembly remains byte-identical.

### T002 — Tools checklist

- Status: Complete.
- Evidence: `npx vitest run test/runner/preamble-builder.test.ts --silent` passed with all six MCP tool names and the coordination checklist before final output instructions.

### T003 — Peer contract

- Status: Complete.
- Evidence: `npx vitest run test/runner/preamble-builder.test.ts --silent` passed with `outside.md` injected under `## Peer's Contract (from outside.md)` and the non-stub `coordination.peer-contract` marker.

### T004 — Schema and type widening

- Status: Complete.
- Evidence: `npx vitest run test/runner/schema-compat.test.ts --silent` passed with bundled system-output and retrospective schemas accepting `magicWandTarget: "coordination"` and optional `retrospective.coordination`.

### T005 — Validator support

- Status: Complete.
- Evidence: `npx vitest run test/runner/validator.test.ts test/runner/schema-compat.test.ts --silent`, `npm run build --silent`, and `npx vitest run test/cli/commands.test.ts --silent -t "check"` passed.
- Decision: `validateSystemOutput()` remains intentionally permissive for `magicWandTarget`; bundled schemas carry the canonical enum while the system gate preserves older/future reports.

### T006 — Coordination env vars

- Status: Complete.
- Evidence: `npx vitest run test/runner/runner.test.ts test/runner/context.test.ts --silent` and `npm run build --silent` passed; preamble growth is 112 chars (≤ 200).

### T007 — Coordinated init scaffold

- Status: Complete.
- Evidence: `npm run build --silent` and `npx vitest run test/cli/init-coordinated.test.ts test/cli/commands.test.ts --silent -t "init|coordinated"` passed.

### T008 — Doctor outside.md checks

- Status: Complete.
- Evidence: `npm run build --silent` and `npx vitest run test/cli/doctor-outside-md.test.ts test/cli/commands.test.ts --silent -t "doctor|outside"` passed.

### T009 — Run-folder coordination snapshots

- Status: Complete.
- Evidence: `npm run build --silent` and `npx vitest run test/runner/run-folder-snapshot.test.ts test/runner/runner-event-driven.test.ts --silent` passed.

### T010 — Coordination smoke-test agent

- Status: Complete.
- Evidence: `agents/coordination-smoke-test/` contains exactly `prompt.md`, `outside.md`, `instructions.md`, and `output-schema.json`; prompt/instructions cover all six MCP tools; `node dist/cli/index.js doctor --agents-dir agents` reports the agent healthy.

### T011 — Two-agent coordination e2e

- Status: Complete.
- Evidence: `npx vitest run test/e2e/two-agent-coordination.test.ts --silent` skips by default, and `MINIH_E2E=1 npx vitest run test/e2e/two-agent-coordination.test.ts --silent` passes with outside CLI writes, inside reply/state/report evidence, and snapshot assertions.

## Discoveries & Learnings

| Task | Discovery | Impact |
|------|-----------|--------|
| Pre-phase | No project harness document exists. | Phase 6 uses the standard minih test/build loop rather than harness boot/interact/observe checks. |
| T005 | The runtime system validator intentionally stays looser than the bundled schemas. | This preserves old/future reports at the fast system gate while published schemas define the strict coordination enum. |
| T006 | Coordinated env vars are runtime-only and need explicit cleanup. | Runner tests now assert they are visible during coordinated execution and removed afterward. |
| T008 | Doctor success and error envelopes expose agent details through different envelope branches. | Focused tests read `data.agents` or `error.details.agents`, matching existing CLI conventions. |
| T009 | Snapshot finalization is part of a successful coordinated run. | Corrupt present state fails finalization instead of producing a misleading complete run. |

## Phase landing

- Status: Landed.
- Domain docs updated: `docs/domains/runner/domain.md`, `docs/domains/cli/domain.md`, `docs/domains/domain-map.md`, and `docs/domains/registry.md`.
- Plan-level flight plan updated: `docs/plans/007-backgrounding/coordination.fltplan.md`.

## Code review follow-up

- Minih code-review run: `agents/code-review/runs/2026-04-26T20-52-42-365Z-4cfa`, verdict `APPROVE` with three medium follow-ups.
- Addressed F001: scaffolded `_shared/preamble.md` now comes from the canonical copied template asset instead of a drifted inline string.
- Addressed F002: `run --dry-run` now calls `buildInsidePreamble()` and includes the assembled prompt in the JSON envelope, so coordinated previews match real prompt assembly.
- Addressed F003: T010 evidence is narrowed to the four-file smoke-agent/static `doctor` validation actually performed; the fake-adapter opt-in e2e remains the Phase 6 full-loop proof.
- Evidence after fixes: `npm run build --silent && npx vitest run test/cli/commands.test.ts test/cli/init-coordinated.test.ts test/runner/preamble-builder.test.ts test/runner/schema-compat.test.ts --silent` passed; `just fft` passed with 43 test files passing, 4 skipped, 406 tests passing, 9 skipped, and 0 audit vulnerabilities.
