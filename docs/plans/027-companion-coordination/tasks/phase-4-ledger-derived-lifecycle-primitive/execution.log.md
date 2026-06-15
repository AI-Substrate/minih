# Execution Log — Phase 4: Ledger-derived lifecycle primitive (#36 + #32 findings home)

**Plan**: companion-coordination · **Phase**: 4 (CS-4, crown jewel) · **Mode**: Full · **Companion**: code-review-companion (`--companion`)
**Started**: 2026-06-15

---

## T000 — Harness pre-flight (`--event pre-implement`)

- **Seam fired** via `/eng-harness-flow --event pre-implement --phase "Phase 4…" --plan-dir docs/plans/027-companion-coordination --json`.
- **Router decision**: `route` → boot validation (minih has the harness adopted; S0+S2+S4 hold from Phases 1–3).
- **Boot verdict**: `minih doctor` → `status: degraded`, summary `{total:17, healthy:12, warnings:75, errors:0}`.
  - **0 errors** — hard sensors (lint/typecheck/build/test) clean. Warnings are the known baseline: oversized `outside.md` (8181 B), `outside.md-drift`, 50+ unharvested legacy retros, dead historical peer runs.
  - `prompt-state-vocabulary-drift: pass` on every coordinated agent — **Phase 3's pin holds**.
  - Maps to harness vocab **SLOW → proceed with note**. Proceeding.

## Companion (C0) — boot + brief

- Booted `code-review-companion` (`GH_TOKEN=$(gh auth token) minih run code-review-companion &`).
- **Active**: `runId 2026-06-15T13-38-10-236Z-a23d`, verdict `active`.
- Briefed once (type=briefing) with plan/spec/phase, the per-task ping protocol, hazards, and domain context.

---

## Tasks

### T001 — Enumerate ledger fields against real lanes (4.1)

Field-map confirmed **all lane-derivable** from `InboxMessage` + `state/inside.json` + the frozen `prompt.md` frontmatter — no additive persistence needed (recon expectation held). Vantage = the inside companion's coordination lifecycle.

| `CompanionLedger` field | Source | Derivation |
|---|---|---|
| `coordinationMode: 'enabled'\|'disabled'` | frozen `prompt.md` frontmatter | `parseFrontmatter().coordination.enabled` (PIC-B: pinned to the binary source) |
| `state: string\|null` | `state/inside.json` | `.status`; missing ⇒ null |
| `statePublished: boolean` | `state/inside.json` + `state/history.ndjson` | state file present OR history non-empty |
| `reviewedIds: string[]` | both lanes | inbound `type:'task'` ids that appear in inside `ack.ackOf` |
| `ackedIds: string[]` | inside lane | unique `ack.ackOf` set (the acknowledged Set, P2 model) |
| `findingsCount` / `summariesCount` | inside lane | count of `type:'finding'` / `type:'summary'` |
| `unresolvedPeerRequests: number` | outside lane | inbound non-`ack`/non-`briefing` messages not in `acknowledged` (matches the `system-output.json` `retrospective.coordination` key — PIC-J) |
| `idleElapsedMs: number\|null` | outside lane | `now − max(inbound ts)`; null when no inbound yet (PIC-J: ms duration, the name Phase 5/AC-11 destructures) |
| `lastTaskId: string\|null` | outside lane | id of the last appended `type:'task'` |

Decision: derive over **raw `folder.ts` lanes** (PIC-A), reusing only the unread/ack *model* from `inbox-poll.ts:170-178`, never the `listUnackedVisible` export (its doc-comment forbids ledger consumers). Throw-on-corrupt convention (P2); missing/empty ⇒ safe defaults.

### T002 — `CompanionLedger` type + `deriveCompanionLedger(location)` (4.2) · AC-8 ✅

- **RED**: `test/runner/companion-ledger.test.ts` (4 tests, mkdtemp lane fixtures) — failed (module missing).
- **GREEN**: `src/runner/companion-ledger.ts` — pure `deriveCompanionLedger(location, {now?})` over raw `inboxLanePath`/`stateFilePath`/`historyPath` + the run's frozen `prompt.md` (for `coordinationMode`). Reuses only the unread/ack **model** (PIC-A); strict `readLane` throws `CompanionLedgerError` on a torn line (P2 convention), safe-defaults on missing/empty.
- **Type** added to `src/runner/types.ts` (coordination block); **barrel** `src/runner/index.ts` carries the type in the `export type` block **and a separate runtime line** `export { CompanionLedgerError, deriveCompanionLedger } from './companion-ledger.js'` (PIC-I).
- **Evidence**: 4/4 vitest green; `tsc --noEmit` exit 0; `biome check --write` clean.
- **Purity**: no MCP/CLI/SDK imports — only `node:fs`/`node:path` + `folder.js`. `now` injectable for deterministic `idleElapsedMs`.

### T003 — Draft farewell strict-validate-before-write (4.3) · AC-9 ✅

- **RED→GREEN**: 4 new tests in `companion-ledger.test.ts` (now 8/8).
- `assembleDraftFarewell(ledger)` builds a `CompanionDraftFarewell` (system-output-shaped); stub prose authored to satisfy minLengths (no false-malformed).
- `validateDraftFarewell(draft)` validates against **both** the canonical `system-output.json` (read from disk via AJV 2020) **and** a strict inline sub-schema (`additionalProperties:false`, **coordination required**).
- `buildDraftFarewell(ledger)` returns the draft **only if valid**, else **null** (the safe-null that guarantees a malformed draft never reaches `report.json`).
- **Finding-04 proof** (the discriminating tests): a draft *missing the coordination block* and a draft *with junk extra keys* both **pass** the permissive `system-output.json` contract but are **rejected** by the strict gate. `parseReportJson` (runner.ts:1821) already safe-nulls on corrupt — confirmed, no change needed there.
- `CompanionDraftFarewell` type added to `types.ts`; barrel exports the 3 fns + type.
- **Evidence**: 8/8 vitest; `tsc --noEmit` exit 0; biome clean.

### T004 + T005 — `coordination_status` MCP tool (8→9) + count test (4.4)

- New `src/mcp/tools/coordination-status.ts` mirrors `permission-status.ts`: handler takes only `context`, builds `coordinationRunLocation(agentSlug, agentsDir, runId)`, calls the **same** `deriveCompanionLedger` + `buildDraftFarewell`, returns `{ agentSlug, coordinationMode, ledger, draftFarewell }` as `{content, structuredContent}`. A `CompanionLedgerError` is re-thrown as `McpToolError('MCP_INBOX_CORRUPT', …)`.
- Registered: `MCP_TOOL_NAMES` + `TOOL_CONTRACTS` (`coordination_status`, empty input schema), `server.ts` dispatch case (the switch is exhaustive over `McpToolName`, no `default` — PIC-D: this was a compile gate), `mcp/index.ts` barrel (PIC-E deviation, for test importability).
- **T005**: `test/mcp/types.test.ts` hard array 8→9 + title "eight"→"nine"; `server.test.ts` real-stdio manifest test title 8→9.
- **`coordinationMode` pinned** `'enabled' | 'disabled'` on the result type (PIC-B).
- **Gotcha (T005)**: `server.test.ts` spawns the **built** stdio server (`buildInsideMcpServerConfig` → `dist/`), so it returned 8 tools until `npm run build` rebuilt dist (PIC-F applies to the integration server test too, not just the CLI). Rebuilt → 9.
- **Evidence**: 43/43 across `companion-ledger` + `types` + `coordination-status` + `coordination-contract` + `server-dispatch` + `server` (real JSON-RPC manifest now lists 9). `tsc --noEmit` exit 0; biome clean.

### T006 — `minih companion status [--json]` CLI verb (4.5)

- New `src/cli/commands/companion.ts` — `registerCompanionCommand(program)` (parent `companion` + child `status <slug>`, mirrors `commands/runs.ts`). Over the **same** `deriveCompanionLedger` (cli→runner, legal).
- `--run <id>` explicit, else defaults to the **newest run dir** under `agents/<slug>/runs` (lexical sort = chronological — a status snapshot wants the most recent run; `resolveRun`'s active/ambiguous semantics are for attach/view, not a read-only ledger). `--json` suppresses the human stderr table.
- Envelope: `formatSuccess('companion.status', { slug, runId, ledger, draftFarewell })` → stdout. Unknown run → `formatError(… RUN_NOT_FOUND/E171)`; torn lane → `INBOX_CORRUPT/E148`.
- Registered in `src/cli/index.ts`.
- **Evidence**: 3/3 CLI integration tests against **dist/** (PIC-F) — conforming envelope, default-latest picks the newer run, E171 on unknown. `tsc` exit 0; biome clean; `npm run build` exit 0.

_(Detailed per-task entries appended below as work lands.)_
