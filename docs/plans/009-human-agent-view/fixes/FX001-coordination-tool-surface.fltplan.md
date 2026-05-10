# Flight Plan: Fix FX001 — Coordination Tool-Surface Bugs

**Fix**: [FX001-coordination-tool-surface.md](./FX001-coordination-tool-surface.md)
**Plan**: [009-human-agent-view](../human-agent-view-plan.md) (Phase 1 follow-up)
**Generated**: 2026-04-28
**Status**: Landed (2026-04-28)

---

## What → Why

**Problem**: The companion-agent dogfood smoke surfaced two silent contract failures: (1) the MCP `state` tool resolves `<agentDir>/inside-state.schema.json` only (not `state/inside-state.schema.json`), so the companion's custom enum is never enforced and `state/inside.json`/`state/history.ndjson` are never written; (2) the MCP `inbox_send` tool has no `ackOf` parameter, so Workshop 007's reply-correlation contract is unenforceable through the tool surface.

**Fix**: Update `src/mcp/tools/state.ts` to prefer `state/`-located inside-state schemas with back-compat fallback; add optional `ackOf?: string` to `inbox_send` inputSchema + parser; add the missing end-to-end coordination contract test the code-review's magic-wand asked for.

---

## Domain Context

| Domain | Relationship | What Changes |
|--------|-------------|-------------|
| `mcp` | modify | `inbox_send` accepts optional `ackOf`; `state` resolves `state/`-located schema first. |
| `runner` | consume — no change | `InboxMessage.ackOf` and forwarder round-trip already in place. |
| `agents/code-review-companion` | benefits, no edits | Existing layout becomes honored; smoke proves it. |

---

## Stages

- [x] **Stage 1: Failing test** — write `coordination-contract.test.ts` covering `state_transition` against `state/inside-state.schema.json` AND `inbox_send` with `ackOf` (`test/mcp/coordination-contract.test.ts` — new file)
- [x] **Stage 2: state.ts schema resolution** — prefer `state/inside-state.schema.json`, legacy fallback, then default (`src/mcp/tools/state.ts`)
- [x] **Stage 3: inbox_send ackOf** — schema + parser + propagate to InboxMessage (`src/mcp/types.ts`, `src/mcp/tools/inbox.ts`)
- [x] **Stage 4: Test + workshop sync** — update existing `inbox_send` schema assertion; tighten Workshop 007 wording (`test/mcp/types.test.ts`, workshop 007)
- [x] **Stage 5: Companion re-smoke** — verify state files + ackOf-linked findings live
- [x] **Stage 6: just fft gate**
- [x] **Stage 7: Tighten coordination-smoke-test prompt** — verify-not-just-call: each tool call reads back the artifact it produced and records file-level evidence (`agents/coordination-smoke-test/prompt.md`)
- [x] **Stage 8: Tighten coordination-smoke-test output schema** — `toolChecks[].evidence` required + new `artifacts.{stateFile,historyFile,inboxInsideFile}` existence flags (`agents/coordination-smoke-test/output-schema.json`)
- [x] **Stage 9: Re-smoke `coordination-smoke-test`** — verdict all-pass; every toolCheck.evidence references a real file; artifact existence flags all true (manual)

---

## Acceptance

- [x] `state_transition` writes state files when schema lives at `state/inside-state.schema.json`.
- [x] `inbox_send({ ackOf })` persists the field.
- [x] Companion re-smoke shows live state pane + linked findings.
- [x] `just fft` exit 0; no existing-test regressions.
