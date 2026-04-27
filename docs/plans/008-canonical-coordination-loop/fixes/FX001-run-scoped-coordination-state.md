# Fix FX001: Run-Scoped Coordination State

**Created**: 2026-04-27
**Status**: Complete
**Plan**: [canonical-coordination-loop-plan.md](../canonical-coordination-loop-plan.md)
**Source**: User post-implementation correction after the first live messaging run: inbox, state, and related coordination artifacts should belong to a run, not to an agent.
**Domain(s)**: runner contract change; mcp and cli consumers

---

## Problem

The implemented coordination surface stores mutable inbox, state, state history, and SDK forwarder watermark files at `agents/<slug>/{inbox,state}/`. That shape worked for the first single-run dogfood harness, but it makes the agent folder the conversation boundary and breaks down when two runs of the same agent overlap.

The corrected product model is that a run is the conversation boundary. Mutable coordination artifacts should live under the specific run folder that owns the outside/inside exchange, so concurrent same-agent runs cannot see, acknowledge, or overwrite each other's messages and state.

## Proposed Fix

Move coordination inbox/state paths from agent-scoped folders to run-scoped folders under `agents/<slug>/runs/<runId>/`. Keep agent-level files as definitions and defaults only: `prompt.md`, `outside.md`, local schemas, and docs. Update runner path helpers and state helpers first, then wire runner env, forwarders, private MCP context/tools, and outside CLI commands to target a run.

Because this changes a domain contract, implementation should preserve a clear compatibility story: generated historical agent-scoped artifacts do not need migration, but current commands/docs/tests must stop treating `agents/<slug>/inbox` and `agents/<slug>/state` as the canonical mutable location.

## Domain Impact

| Domain | Relationship | What Changes |
|--------|--------------|--------------|
| runner | Contract owner | Coordination path helpers, state helpers, forwarder watermark location, env setup, and snapshots move to run-scoped paths. |
| mcp | Consumer | Hidden baked context validates run-scoped `MINIH_INBOX_DIR` and `MINIH_STATE_DIR`; inside tools read/write only the active run's files. |
| cli | Consumer | Outside commands resolve a run target before reading/writing inbox/state/retros; docs and envelopes expose run-scoped semantics. |
| adapter | Indirect consumer | No API change expected; live forwarding still uses the existing `SessionSender` seam. |

## Tasks

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|--------|-----|------|--------|---------|-----------|-------|
| [x] | FX001-1 | Introduce the run-scoped coordination path contract | runner | `/Users/jordanknight/substrate/minih/src/runner/folder.ts`; `/Users/jordanknight/substrate/minih/src/runner/state.ts`; `/Users/jordanknight/substrate/minih/src/runner/forwarder-watermark.ts`; `/Users/jordanknight/substrate/minih/src/runner/index.ts` | Path helpers and state helpers can address `agents/<slug>/runs/<runId>/{inbox,state}` without callers hand-building paths; path containment checks still reject traversal/symlink escapes; forwarder watermark is scoped to the run. | Existing helpers currently hard-code `agents/<slug>/inbox`, `agents/<slug>/state`, and `agents/<slug>/state/sdk-watermark.json`; this is the primary contract break. Prefer a typed run-scoped location over optional positional params. |
| [x] | FX001-2 | Wire runner and private MCP to the run-scoped directories | runner/mcp | `/Users/jordanknight/substrate/minih/src/runner/runner.ts`; `/Users/jordanknight/substrate/minih/src/runner/inbox-forwarder.ts`; `/Users/jordanknight/substrate/minih/src/runner/state-forwarder.ts`; `/Users/jordanknight/substrate/minih/src/mcp/spawn.ts`; `/Users/jordanknight/substrate/minih/src/mcp/context.ts`; `/Users/jordanknight/substrate/minih/src/mcp/tools/inbox.ts`; `/Users/jordanknight/substrate/minih/src/mcp/tools/state.ts` | Fresh coordinated runs set `MINIH_INBOX_DIR` and `MINIH_STATE_DIR` to folders under that run; MCP context rejects agent-scoped paths; inside MCP tools and runner forwarders read/write only the active run's inbox/state. | `McpServerContext` already carries `runId` and `runDir`; use that as the authority. Keep the server private and do not add a public MCP mode. |
| [x] | FX001-3 | Make outside coordination commands target a specific run | cli/runner | `/Users/jordanknight/substrate/minih/src/cli/coordination.ts`; `/Users/jordanknight/substrate/minih/src/cli/commands/outside-send.ts`; `/Users/jordanknight/substrate/minih/src/cli/commands/outside-inbox-list.ts`; `/Users/jordanknight/substrate/minih/src/cli/commands/state.ts`; `/Users/jordanknight/substrate/minih/src/cli/commands/outside-retro.ts`; `/Users/jordanknight/substrate/minih/src/cli/commands/retros.ts`; `/Users/jordanknight/substrate/minih/src/cli/commands/status.ts`; `/Users/jordanknight/substrate/minih/src/cli/commands/tail.ts`; `/Users/jordanknight/substrate/minih/src/cli/commands/validate.ts` | Mutable outside commands accept or resolve a run target and never write shared agent-level inbox/state; read-only run commands continue to support explicit `--run`; JSON envelopes include the target `runId` where coordination data is read or written. | Proposed UX: add `--run <runId>` to outside mutable commands and allow a safe latest-run default only when unambiguous. If ambiguity exists, fail with an actionable envelope rather than guessing. |
| [x] | FX001-4 | Update tests to prove same-agent run isolation | cli/runner/mcp | `/Users/jordanknight/substrate/minih/test/cli/*.test.ts`; `/Users/jordanknight/substrate/minih/test/mcp/*.test.ts`; `/Users/jordanknight/substrate/minih/test/runner/*.test.ts`; `/Users/jordanknight/substrate/minih/test/e2e/two-agent-coordination.test.ts` | Tests cover run-scoped path output, MCP context validation, outside command `--run` targeting, two same-agent runs with isolated inbox/state/history/watermarks, and no regression in status/tail/validate latest-run behavior. | The e2e now waits for the created run id before issuing outside writes. Targeted coordination suite passed: 18 files passed, 185 tests passed, 2 expected e2e skips. |
| [x] | FX001-5 | Update docs, agent runbooks, and domain history | cli/runner/mcp | `/Users/jordanknight/substrate/minih/docs/domains/runner/domain.md`; `/Users/jordanknight/substrate/minih/docs/domains/mcp/domain.md`; `/Users/jordanknight/substrate/minih/docs/domains/cli/domain.md`; `/Users/jordanknight/substrate/minih/docs/domains/domain-map.md`; `/Users/jordanknight/substrate/minih/docs/how/coordination-loop-validator.md`; `/Users/jordanknight/substrate/minih/agents/coordination-loop-validator/outside.md`; `/Users/jordanknight/substrate/minih/agents/coordination-smoke-test/outside.md`; `/Users/jordanknight/substrate/minih/docs/plans/008-canonical-coordination-loop/our-first-run-with-the-messaging-system.md`; `/Users/jordanknight/substrate/minih/README.md`; `/Users/jordanknight/substrate/minih/AGENTS_README.md` | Current docs describe the run as the coordination boundary, show `agents/<slug>/runs/<runId>/{inbox,state}`, and mark the first live run's agent-scoped artifact assumption as a learned correction. | Historical 007 docs may stay historical if clearly not current guidance; current user-facing docs and prompts no longer teach agent-scoped mutable coordination state. |

## Workshops Consumed

- [001-manual-event-validation-agent-harness.md](../workshops/001-manual-event-validation-agent-harness.md) - original manual event harness concept and outside/inside boundaries.
- [our-first-run-with-the-messaging-system.md](../our-first-run-with-the-messaging-system.md) - post-run observation that the next product correction is a run-scoped conversation boundary.
- [run-scoped-rerun-evidence.md](../run-scoped-rerun-evidence.md) - post-FX001 live rerun proving run-scoped messaging/state with the real validator agent.

## Acceptance

- [x] A coordinated run writes inbox, state, state history, and forwarder watermark files under `agents/<slug>/runs/<runId>/`, not under `agents/<slug>/{inbox,state}/`.
- [x] Two overlapping runs of the same coordinated agent can exchange outside/inside messages without cross-run visibility, acknowledgement leakage, state overwrite, or watermark interference.
- [x] Inside MCP tools are scoped by hidden run context and cannot read/write another run's coordination files.
- [x] Outside CLI commands can target a run explicitly and fail clearly instead of guessing when multiple candidate runs exist.
- [x] `status`, `tail`, `validate`, `retros`, and the canonical validator runbook still provide outside-visible evidence for a completed messaging loop.
- [x] Current docs and agent prompts describe agent-level files as definitions/defaults and run-level files as mutable conversation state.

## Discoveries & Learnings

_Populated during implementation._

| Date | Task | Type | Discovery | Resolution |
|------|------|------|-----------|------------|
| 2026-04-27 | FX001-2 | Contract | `StateCorruptError` callers still imported `InvalidSlugError` from `state.ts`, but run-scoped validation now occurs in `folder.ts`. | Re-exported the folder `InvalidSlugError` from `state.ts` so public error identity stays stable. |
| 2026-04-27 | FX001-3 | Bug | `state set` had a typed `run?: string` field but was missing the Commander `--run` option, so explicit run targeting was rejected. | Added `.option('--run <runId>')` to `state set` and covered it with same-agent isolation tests. |
| 2026-04-27 | FX001-4 | Behavior | Run folders now intentionally retain live mutable coordination files alongside final snapshots, so artifact lists include both `inbox/*`/`state/*` and `*-snapshot` files. | Updated snapshot expectations to treat live run-scoped coordination files as run artifacts, not pollution. |
| 2026-04-27 | Rerun | UX | The real inside agent had to sleep-poll for outside messages because inbox listing has no blocking wait mode. | Captured `inbox_list --wait <seconds>` as the magic-wand improvement in the rerun evidence. |
| 2026-04-27 | Rerun | Env | Runner output env vars were not available inside agent-launched bash subshells, even though the prompt preamble included the run output path. | The agent used the explicit path from the prompt; follow-up should clarify env propagation or document this boundary. |
