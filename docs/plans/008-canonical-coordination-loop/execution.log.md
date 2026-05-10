# Execution Log: Canonical Coordination Loop Validator

## T001 - Create coordinated validator agent folder

**Status**: Complete

Started by marking T001 active in the inline plan table and Stage 1 active in the plan-level flight plan. Confirmed the real CLI already has `status` and `tail` commands, so the outside contract can keep the human/outer agent in the loop with existing observability rather than adding runtime surface area.

Completed by adding:

- `agents/coordination-loop-validator/prompt.md`
- `agents/coordination-loop-validator/outside.md`
- `agents/coordination-loop-validator/instructions.md`

Evidence:

- `outside-context coordination-loop-validator` reports a present outside contract.
- `run coordination-loop-validator --dry-run` includes the coordination block, peer contract, and bounded-waiting guidance.

## T002 - Add schemas for harness state and report evidence

**Status**: Complete

Started by marking T002 active in the inline plan table and Stage 2 active in the plan-level flight plan. The key implementation constraint is to keep status enums schema-compatible and encode harness phase/milestone language in `data` and messages.

Completed by adding:

- `agents/coordination-loop-validator/output-schema.json`
- `agents/coordination-loop-validator/inside-state.schema.json`
- `agents/coordination-loop-validator/outside-state.schema.json`

Evidence:

- All three schema files parse as JSON.
- `doctor` includes `coordination-loop-validator` with no failed checks, proving the output schema compiles.

## T003 - Add static CLI regression coverage

**Status**: Complete

Started by marking T003 active in the inline plan table and Stage 3 active in the plan-level flight plan. Test scope is static and CLI-only: no live model calls and no new mocks.

Completed by adding `test/cli/coordination-loop-validator.test.ts`.

Evidence:

- `npm run build`
- `npx vitest run test/cli/coordination-loop-validator.test.ts` -> 7 tests passed.

Discovery:

- The first `outside.md` draft exceeded the 4KB doctor warning threshold. The contract was tightened so the quick outside contract remains healthy and the deeper narrative belongs in `docs/how/coordination-loop-validator.md`.

## T004 - Add deeper worked-example guide

**Status**: Complete

Started by marking T004 active in the inline plan table and Stage 4 active in the plan-level flight plan. `docs/how/` does not exist yet, so this task creates it with the canonical loop guide.

Completed by adding `docs/how/coordination-loop-validator.md`.

Evidence:

- Guide includes the minimal-vs-rich split, clean-slate setup, outside-starts-inside path, already-running variation, `status`/`tail` observation commands, all three milestone commands, final validation, evidence hygiene, and future many-inside boundary.
- `git diff --check` passed for the new guide and related T003/T001 files.

## T005 - Add discoverability pointers

**Status**: Complete

Started by marking T005 active in the inline plan table and Stage 5 active in the plan-level flight plan. Scope is intentionally concise pointers only; the long runbook remains in `docs/how/coordination-loop-validator.md`.

Completed by updating `README.md` and `AGENTS_README.md`.

Evidence:

- README now points coordination-aware users to the canonical rich worked example guide.
- README and AGENTS_README now list both `coordination-smoke-test` as the minimal primitive check and `coordination-loop-validator` as the richer canonical worked example.
- `git diff --check` passed for both documentation files.

## T006 - Validate static and CLI surfaces

**Status**: Complete

Started by marking T006 active in the inline plan table and Stage 6 active in the plan-level flight plan. Validation uses existing commands only.

Evidence:

- `npm run build` passed.
- `node dist/cli/index.js doctor` found `coordination-loop-validator` with no failed checks.
- `node dist/cli/index.js outside-context coordination-loop-validator` exposed all three milestones plus `status`/`tail`.
- `node dist/cli/index.js run coordination-loop-validator --dry-run` included the coordinated prompt, peer contract, bounded waiting, and tail guidance.
- `npx vitest run test/cli/coordination-loop-validator.test.ts` passed.
- AJV compiled `output-schema.json`, `inside-state.schema.json`, and `outside-state.schema.json`.

## T007 - Execute and document the real manual live run

**Status**: Complete

Started by marking T007 active in the inline plan table and Stage 7 active in the plan-level flight plan. The live run will use the real CLI, real agent files, real shared inbox/state files, and the real SDK-backed minih run.

The first live attempts failed with CAPI 400 immediately after MCP server loading and before any model turn. A control run with the existing `coordination-smoke-test` failed the same way, proving the blocker belonged to the shared coordinated MCP manifest rather than the new validator prompt.

Implemented a targeted unblock:

- exposed underscore MCP tool names in the manifest: `inbox_list`, `inbox_send`, `inbox_ack`, `state_get`, `state_set`, `state_transition`;
- kept legacy dotted names as dispatcher-only aliases for in-process compatibility;
- updated coordinated prompts, smoke/validator agents, docs, reserved-prefix checks, and tests.

Evidence for the unblock:

- `npm run build`
- `npx vitest run test/mcp/types.test.ts test/mcp/server-dispatch.test.ts test/mcp/server.test.ts test/mcp/coexist.test.ts test/runner/preamble-builder.test.ts test/cli/init-coordinated.test.ts test/cli/coordination-loop-validator.test.ts test/e2e/two-agent-coordination.test.ts` -> 40 passed, 1 skipped.

Completed the real live run with `node dist/cli/index.js run coordination-loop-validator --timeout 900 --model gpt-5.5`.

Evidence:

- Run `2026-04-27T15-25-51-655Z-a767` completed in 363.8s with 5372 events and 45 tool calls.
- `minih status coordination-loop-validator` reported `completed`.
- `minih tail coordination-loop-validator` exited with `Result: completed` and `Validated: yes`.
- Ready message: `01KQ6PDXF73HYHP61RV5CAGDFX`.
- Milestone messages: `01KQ6PEGBP6T44RA3Q9J7V28FR`, `01KQ6PFHMCVC3GAEDR3NSFESQ0`, `01KQ6PGQAD06DS9PSV5VR1H7ED`.
- Ack messages: `01KQ6PF82S684X59C6DNFQV7PC`, `01KQ6PGEG8Q7MPETAM4WC4R6YX`, `01KQ6PHM7BQRS70FC8G6DJWC96`.
- Feedback messages: `01KQ6PF82TX1Y74GM6QNXXC7VZ`, `01KQ6PGEG96ZS3JRPM9E056AH0`, `01KQ6PHM7BQRS70FC8G6DJWC97`.
- Completion message: `01KQ6PHX7NYBFJRY04WN6AZHKN`; inside complete message: `01KQ6PJZREJJJ5VMCYZTAZTMB2`.
- `node dist/cli/index.js validate coordination-loop-validator` returned `validated: true`.
- `node dist/cli/index.js retros --agent coordination-loop-validator --target coordination` returned the inside coordination retro.
- `node dist/cli/index.js outside-retro coordination-loop-validator ...` recorded outside retro `01KQ6PS73A35K8622JVQFDRTV0`.
- Detailed evidence is recorded in `manual-live-run-evidence.md`.

## T008 - Final quality gate and plan artifact alignment

**Status**: Complete

Started by marking T008 active in the inline plan table and Stage 8 active in the plan-level flight plan. The final gate will run the repository quality gate, then close out plan status, acceptance criteria, and domain history.

Evidence:

- First `just fft` attempt failed on Biome formatting for new authored schema/test files and on generated live-run `state/` files.
- Removed generated `agents/coordination-loop-validator/{inbox,state,runs}` after evidence capture so per-run artifacts are not committed.
- Ran `npx biome check --write` for authored schema/test files.
- Reran `just fft`; it passed:
  - `npx biome check .`
  - `npx biome format --write .`
  - `npm run build`
  - `npx tsc --noEmit`
  - `npm test` -> 414 passed, 9 skipped
  - `npm audit --audit-level=high || true` -> 0 vulnerabilities
- Updated plan status, flight plan status, acceptance criteria, flight log, domain histories, and manual evidence cleanup notes.
