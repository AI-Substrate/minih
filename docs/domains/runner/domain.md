# Domain: runner

**Purpose**: Orchestrates agent execution from prompt assembly through artifact capture. Owns the folder convention, schema validation, display formatting, and run lifecycle.

## Boundary

**Owns**: Agent discovery, prompt assembly, run folders, frozen inputs, coordination snapshots, NDJSON event streaming, output validation, completion metadata, magic wand feedback capture, frontmatter parsing

**Excludes**: SDK communication (adapter), CLI argument parsing and JSON envelopes (cli), SDK-specific event types (adapter), MCP server/tool implementation (mcp), peer policy/rule-engine orchestration

## Composition

| File | Classification | Purpose |
|------|---------------|---------|
| `src/runner/types.ts` | contract | AgentDefinition, AgentRunConfig, CompletedMetadata, AgentRunResult |
| `src/runner/folder.ts` | internal | Agent discovery, slug validation, run folder creation (Phase 2) |
| `src/runner/validator.ts` | internal | AJV 2020-12 schema validation (Phase 2) |
| `src/runner/display.ts` | internal | Verbose terminal output formatting (Phase 2) |
| `src/runner/pretty.ts` | internal | Pretty streaming display — clean output with delta accumulation (002-pretty-mode) |
| `src/runner/preamble-builder.ts` | contract | Pure inside-prompt assembly with coordinated identity, MCP tools, output-validation fallback, checklist, and peer-contract injection (007/P2 + P6 + 008 FX003) |
| `src/runner/runner.ts` | internal | Core orchestration (Phase 2) |
| `src/runner/index.ts` | contract | Barrel export |
| `src/schemas/retrospective.json` | contract | Reusable retrospective schema fragment; includes optional coordination feedback (Phase 2 + 007 P6) |
| `src/schemas/system-output.json` | contract | Required system output schema; includes `magicWandTarget: coordination` and optional `retrospective.coordination` (007 P6) |
| `src/templates/shared-preamble.md` | contract | Canonical scaffolded shared preamble copied to `dist/templates` for `init`/`quickstart` (007 P6) |
| `src/runner/state.ts` | contract | Coordination state types + helpers (`readStateLazy`, `writeState`, `appendHistory`); pure data layer, no rule engine (007 P1) |
| `src/runner/context.ts` | contract | `detectContext()` + coordination env-var contract (`MINIH_ENV_KEYS_COORDINATION`, `MINIH_ENV_KEYS_ALL`) (007 P1) |
| `src/runner/atomic-write.ts` | internal | POSIX write-then-rename helper (sync + async) for state files (007 P1) |
| `src/runner/ulid.ts` | internal | In-tree Crockford-base32 ULID with monotonicity guarantees (007 P1) |
| `src/runner/file-watcher.ts` | internal | Debounced native `fs.watch` wrapper for single-file change hints, missing-file startup, watcher errors, and close semantics (007 P3) |
| `src/runner/forwarder-watermark.ts` | internal | Private SDK forwarder progress in `runs/<runId>/state/sdk-watermark.json`; durable inbox byte offset + state fingerprint with symlink containment (007 P3 + FX001) |
| `src/runner/inbox-forwarder.ts` | internal | Outside inbox NDJSON drain + live watcher delivery into `SessionSender.send` (007 P3) |
| `src/runner/state-forwarder.ts` | internal | Outside-state meaningful-change fingerprinting + live watcher delivery into `SessionSender.send` (007 P3) |
| `src/runner/run-lock.ts` | legacy contract | Per-agent live-run ownership guard retained for compatibility; active coordinated runs now rely on run-scoped isolation instead of blocking overlapping same-agent runs (FX001) |
| `src/schemas/inbox-message.json` | contract | Inbox NDJSON envelope shape (007 P1) |
| `src/schemas/outside-state.json` | contract | DEFAULT outside state shape (overridable per-agent in P6) |
| `src/schemas/inside-state.json` | contract | DEFAULT inside state shape (overridable per-agent in P6) |
| `src/schemas/state-history-entry.json` | contract | Append-only history NDJSON entry (007 P1) |

## Contracts

| Contract | Type | Consumers |
|----------|------|-----------|
| `AgentDefinition` | Type | cli (discovery, listing) |
| `AgentRunConfig` | Type | cli (run configuration) |
| `InsideMcpServerFactoryContext` | Type | cli/mcp composition seam (P4 inside MCP merge without runner importing mcp) |
| `AgentRunResult` | Type | cli (result display) |
| `CompletedMetadata` | Type | cli (history, validate) |
| `MagicWandTarget` / `RetrospectiveCoordination` | Type | cli envelopes, agent schemas, retros aggregation |
| `ValidationResult` | Type | cli (validation display) |
| `listAgents(agentsDir)` | Function | cli (list, doctor) |
| `resolveAgent(slug, agentsDir)` | Function | cli (run, validate, history) |
| `runAgent(adapter, def, config, onEvent?, agentsDir?)` | Function | cli (run command) |
| `buildInsidePreamble(input)` / `PreambleAssemblyInput` | Function/Type | runner (fresh-run prompt assembly), coordinated-agent prompt wiring including inside MCP `waitMs`/`waitForAny` guidance and literal output-path validation fallback |
| `findRunSession(slug, agentsDir, runId?)` | Function | cli (resume, connect — session lookup from completed.json) |
| `RunSession` | Type | cli (resume, connect — session lookup result) |
| `validateInput(schemaPath, params)` | Function | cli (check --input), runner (pre-execution) |
| `validateOutput(schemaPath, outputPath)` | Function | cli (validate, check), runner (post-execution) |
| `displayEvent(event)` | Function | cli (run --verbose display, tail) |
| `displayHeader(slug, runId, model?)` | Function | cli (run display) |
| `displaySummary(result)` | Function | cli (run display) |
| `PrettyDisplay` | Class | cli (run command — default display mode) |
| `parseFrontmatter(content)` | Function | cli (doctor frontmatter checks) |
| `retrospective.json` | JSON Schema | Agent output schemas (via $ref), cli (doctor checks) |
| `VelocityData` | Type | cli (history trend display) |
| `ParsedReport` | Type | cli (run envelope surfacing, including optional coordination retro block) |
| `computeVelocity(durationMs, agentDir, runId)` | Function | runner (post-run velocity computation) |
| `Side` / `InboxMessage` / `OutsideState` / `InsideState` / `SideState` / `StateHistoryEntry` | Type | mcp (P4 tools), cli (P5 outside surface), adapter (P2 events) |
| `CoordinationFrontmatter` | Type | runner (`AgentDefinition.coordination`), preamble-builder (P2) |
| `detectContext()` | Function | cli (P5 preAction context-block hook), preamble-builder (P2) |
| `MINIH_ENV_KEYS_COORDINATION` / `MINIH_ENV_KEYS_ALL` | Const | mcp (P4 spawn config), runner env cleanup/coordination contract |
| `getCoordinationEnv()` | Function | mcp (P4 server), cli (P5 inside-detection) |
| `CoordinationRunLocation` / `coordinationRunLocation(slug, agentsDir, runId)` / `coordinationRunDir(...)` | Type/Function | cli/mcp/runner shared run-scoped coordination path contract |
| `readStateLazy(location, side)` / `writeState(location, side, state)` / `appendHistory(location, entry)` | Function | mcp (P4 state_* tools), cli (P5 state subcommands), runner (P2 finalize snapshot) |
| `inboxLanePath(location, side)` / `stateFilePath(location, side)` / `historyPath(location)` / `watermarkPath(location)` / `outsideMdPath` / `hasOutsideMd` | Function | cli (P5 outside-send), mcp (P4 inbox/state tools), runner (P3 file-watcher + forwarders) |
| `writeFileAtomic` / `writeFileAtomicAsync` / `AtomicWriteCrossFsError` | Function/Class | mcp (P4 state writes), runner (P3 watermark fsync) |
| `ulid()` | Function | mcp (P4 inbox_send), cli (P5 outside-send) |
| `StateCorruptError` / `HistoryLineTooLargeError` / `InvalidSlugError` / `InvalidCoordinationFrontmatterError` / `OutsideAgentsDirError` | Error | mcp + cli (typed error handling) |
| `RunLockHeldError` / `RUN_LOCK_HELD` | Error/Const | legacy compatibility; not used to prevent overlapping run-scoped coordination |
| `AgentRunConfig.insideMcpServerFactory` / `reservedMcpToolPrefixes` | Config seam | cli supplies mcp-domain spawn config; runner merges user/internal MCP servers and detects reserved collisions |
| `AgentDefinition.outsideContract` / `AgentDefinition.coordination` | Type field | preamble-builder (P2 — peer contract injection), cli (P5 outside-context, init --coordinated) |
| `inbox-message.json` / `outside-state.json` / `inside-state.json` / `state-history-entry.json` | JSON Schema | mcp (P4 AJV input/output validation), cli (P5 outside-send validation) |

## Concepts

| Concept | Definition |
|---------|-----------|
| Folder convention | An agent IS a folder. prompt.md with frontmatter = agent exists. |
| Frozen inputs | Every run copies its inputs into the run folder for reproducibility. |
| Degraded vs Failed | Invalid output = "degraded" (agent worked, schema didn't match), not hard failure. |
| Prompt assembly | `buildInsidePreamble` preserves the legacy preamble -> instructions -> output hint -> params -> prompt join for non-coordinated agents, and inserts real coordinated identity, tool, output-validation, checklist, wait guidance, and peer-contract sections only when `coordination.enabled` is true. Frontmatter stripped. |
| Coordinated output validation fallback | Coordinated prompts treat the literal output path as authoritative and tell agents to use `minih check <slug> --file <literal-output-path>` if the shell cannot see `$MINIH_OUTPUT_PATH`. |
| Coordination identity block | `buildInsidePreamble` injects `<!-- coordination.identity-block -->` with the agent slug, run id, and outside-peer framing for coordinated fresh runs only. Resume turns skip prompt assembly. |
| Peer contract framing | `outside.md` content is quoted under `<!-- coordination.peer-contract -->` / `## Peer's Contract (from outside.md)`. Optional absence means no peer-contract section; an empty file is still a present empty contract. |
| Event-driven terminal condition | `runAgent` relies on adapter idle completion, then waits for `awaitTerminalCondition(adapterResult, pendingForwarderCount)` with a live inbox/state forwarder drain counter so queued `session.send` work settles before the run completes. |
| Magic wand | Every agent output MUST include retrospective with magicWand feedback. |
| Velocity tracking | Per-agent velocity data computed at run end, stored in completed.json. Chains from prior runs for O(1) computation. |
| Difficulty ledger | Agents report structured friction in `retrospective.difficulties`. Pipeline: agents report → `minih difficulties` aggregates → human curates preamble. |
| Parsed report surfacing | Runner parses report.json after run to extract summary/magicWand/difficulties for CLI envelope. |
| Outside / inside contexts | `detectContext()` reads `MINIH=1` (strict equality). Coordination is opt-in per agent via `coordination:` frontmatter. |
| Run-scoped coordination state | Mutable inbox, state, history, and forwarder watermark files live at `agents/<slug>/runs/<runId>/{inbox,state}/`. Agent-level files are definitions/defaults only. Atomic writes via `writeFileAtomic` (POSIX rename); overlapping same-agent runs stay isolated by run id. |
| Atomic state writes | `writeFileAtomic` / `writeFileAtomicAsync` write temp files, fsync, then rename on the same filesystem; `EXDEV` becomes a typed `AtomicWriteCrossFsError` instead of falling back to non-atomic writes. |
| State as data, not rules | `state.ts` is pure helpers — no rule engine, no transition gates. Per-agent enums (P6) provide constraint at MCP `state_transition` time; outside negotiates via inbox if it disagrees (workshop 002 + didyouknow #2). |
| Lazy state default | `readStateLazy` returns synthetic `{status: 'idle', ...}` when file absent — never persisted. Corruption (invalid JSON, missing fields) throws `StateCorruptError` — never silently masked as a default. |
| Append-only history | `appendHistory` enforces line ≤ PIPE_BUF (4096 bytes) so single-call POSIX `appendFile` is atomic against concurrent appenders. Auto-populates `peerStateAtTime` from peer side's lazy-read state when caller omits it. |
| Outside contract layer | `outside.md` (plain markdown, body only — no frontmatter parsing) carries the peer contract for coordinated agents. Loaded by `listAgents` into `AgentDefinition.outsideContract`. P2 preamble-builder injects under a Peer's Contract section in the inside prompt. |
| ULID monotonicity contract | `ulid()` preserves lex-sort order under sub-millisecond bursts (increments randomness suffix) AND under clock rewind (NTP step-backward — reuses prior timestamp + increments). Crockford-base32 alphabet; 48-bit ms + 80-bit randomness. |
| Session resume | Resume sends follow-up message directly — skips prompt assembly and system output validation. SDK conversation history provides context. |
| Daemon-light forwarders | For `coordination: enabled` runs, runner-owned inbox/state forwarders cold-drain the active run's files, watch for cross-process updates, send rendered changes through the live `SessionSender`, and commit private run-scoped watermarks only after successful sends. |
| Overlapping run isolation | Coordinated runs no longer acquire per-agent live-run ownership. Multiple runs of the same slug can overlap because each run owns its own inbox, state, history, and watermark files. |
| Internal MCP merge seam | `runAgent` accepts a generic factory that can add per-run MCP servers after runId/runDir exist. The runner owns merging/collision checks but never imports the mcp domain. |
| Run-folder coordination snapshots | Coordinated runs freeze run-scoped `inbox` lanes and side states into `inbox-snapshot/{outside,inside}.ndjson` and `state-snapshot.json` before artifact enumeration. Missing lanes become empty files, missing states become `null`, malformed NDJSON is copied byte-for-byte, and corrupt present state files fail finalization. |
| Coordination feedback | `magicWandTarget` now includes `"coordination"` and reports may include `retrospective.coordination` for peer updates, unresolved requests, state publication, and notes. Runtime system validation stays permissive; bundled schemas carry the canonical enum. |
| Shared preamble template | The source-controlled default preamble lives in `src/templates/shared-preamble.md`; `agents/_shared/preamble.md` is the dogfood copy and scaffolded agents receive the built template asset. |

## Tests & Validation

| Area | Tests |
|------|-------|
| Agent discovery, frontmatter, outside contracts | `test/runner/folder.test.ts`, `test/cli/doctor-outside-md.test.ts`, `test/cli/outside-inbox-wait.test.ts` |
| Coordination data primitives | `test/runner/state.test.ts`, `test/runner/atomic-write.test.ts`, `test/runner/ulid.test.ts`, `test/runner/context.test.ts`, `test/runner/schemas.test.ts` |
| Event-driven run and MCP merge seam | `test/runner/runner-event-driven.test.ts`, `test/runner/mcp.test.ts`, `test/runner/run-folder-snapshot.test.ts` |
| File watchers and daemon-light forwarders | `test/runner/file-watcher.test.ts`, `test/runner/forwarder-watermark.test.ts`, `test/runner/inbox-forwarder.test.ts`, `test/runner/state-forwarder.test.ts`, `test/e2e/daemon-light.test.ts` |
| Prompt assembly and coordination feedback | `test/runner/preamble-builder.test.ts`, `test/runner/schema-compat.test.ts`, `test/e2e/two-agent-coordination.test.ts` |

## History

| Phase | Changes |
|-------|---------|
| Phase 1 | Created domain. Type definitions extracted with frontmatter additions. |
| Phase 2 | Added folder.ts (discovery + frontmatter), validator.ts (AJV), display.ts (terminal), runner.ts (orchestration), retrospective.json schema. 61 tests. |
| Phase 5 | System output enforcement: every run validates summary + retrospective. Two-stage validation (system then user). 14 MINIH_* env vars. Deleted then restored retrospective.json alongside new system-output.json. Exported SYSTEM_OUTPUT_INSTRUCTIONS. |
| 002-pretty-mode | Added pretty.ts — clean streaming display with delta accumulation, thinking suppression, inline intent. PrettyDisplay exported from barrel. |
| FX002-agent-ux | Added tool elapsed timer to pretty mode. Added fuzzy property name suggestions to validator error messages (substring + Levenshtein matching). |
| 003-resume-prompt | Added `sessionId`, `resumedFromRunId`, `promptOverride` to `AgentRunConfig`. Added `resumedFromRunId` to `CompletedMetadata`. Added `findRunSession()` helper. Resume path in `runAgent()` skips system validation and sends follow-up message directly. |
| 006-compounding-value | Added `VelocityData`, `ParsedReport` types. `computeVelocity()` computes per-agent velocity at run end. Report.json parsed after run for envelope surfacing. `magicWandTarget` + `difficulties` added to retro/system-output schemas. SYSTEM_OUTPUT_INSTRUCTIONS updated with difficulty reporting guidance. |
| 007/P2 (2026-04-26) | Added `preamble-builder.ts`; switched `runAgent` prompt assembly to the builder; added event-driven terminal-condition helper and gated doctor/list baseline regression. |
| 007-backgrounding P1 | Coordination foundations (pure addition). NEW: `state.ts` (pure helpers, no rule engine), `context.ts` (`detectContext` + composed env-key array), `atomic-write.ts` (POSIX write-then-rename + typed errors), `ulid.ts` (in-tree, monotonic). 4 NEW JSON schemas: inbox-message, default outside-state, default inside-state, state-history-entry. EXTENDED `folder.ts`: 6 path helpers (all absolute, slug-validated), outside.md discovery (truncate at 16KB, symlink-out-of-tree guard), `parseFrontmatter` recognizes `coordination` field (3 valid forms, 4 typed-error cases). EXTENDED `AgentDefinition` with `outsideContract` + `coordination`. EXPORTED `MINIH_ENV_KEYS` from runner.ts. Added `ajv-formats@^3.0.1` (decision logged — needed for live `format: date-time` validation). 230/230 tests pass; baseline diff against pre-P1 dist exit=0; zero behavior change to existing 9 agents. P2 unlocked. |
| 007-backgrounding P3 | Added daemon-light file watcher and forwarders in runner: debounced `fs.watch`, private SDK watermark, outside inbox/state forwarders, live pending-drain terminal condition, per-agent run lock, opt-in cross-process e2e gate, and `RunLockHeldError` export. |
| 007-backgrounding P4 | Added generic inside MCP merge seam (`insideMcpServerFactory`, reserved tool-prefix collision checks) so CLI can supply the mcp-domain server while runner remains mcp-independent. |
| 007-backgrounding P6 | Replaced coordinated prompt stubs with real identity/tool/checklist/peer-contract sections; widened coordination feedback schemas/types; set coordinated run env vars; added run-folder coordination snapshots, canonical shared-preamble template asset, and the four-file `coordination-smoke-test` dogfood agent. |
| 007-backgrounding P7 | Finalized runner documentation for coordinated identity/peer-contract framing, atomic write semantics, test provenance, and the explicit no-MCP/no-rule-engine boundary. |
| 008-canonical-coordination-loop | Updated coordinated prompt guidance to teach inside agents the backend-safe underscore MCP tool names and documented the live `coordination-loop-validator` evidence path. |
| 008 FX001 | Moved mutable coordination state from agent-scoped folders to `agents/<slug>/runs/<runId>/{inbox,state}`; runner/MCP/CLI now share `CoordinationRunLocation` and overlapping same-agent runs are isolated by run id. |
| 008 FX002 | Updated coordinated preamble guidance to teach bounded `inbox_list` long-poll waits with `waitMs` for outside signals. |
| 008 FX003 | Added coordinated output-path validation fallback guidance and refreshed system output instructions so shell env visibility is best-effort, not assumed. |
| 009-human-agent-view P1 | Added live-run identity, shared run resolver, and pure HumanViewModel reducer. NEW: `run-manifest.ts` (`writeManifest`/`readManifest`/`updateManifest`/`flushThrottled` with throttled atomic writes via `writeFileAtomicAsync`), `run-resolver.ts` (`resolveRun({ slug, mode })` for `by-id`/`latest-active`/`latest-completed`/`latest-any`, `MultipleActiveRunsError`, per-candidate fault tolerance, configurable stale detection), `human-view-model.ts` (pure `buildHumanViewModel({ events, manifest, completed, inbox, state, history, output, validation })` returning Workshop 004 `HumanViewModel`), `human-view-errors.ts` (`MultipleActiveRunsError`, `ManifestSchemaVersionError`), `human-view-fixtures.ts` (test/fixture builders). EXTENDED `runner.ts` to write `runs/<runId>/run.json` at folder-create / `session_start` (immediate) / event tick (throttled 250ms) / terminal condition / completion (status `starting → active → completing → completed/failed`). EXTENDED `types.ts` and `index.ts` re-exports for `LiveRunManifest`, `LiveRunStatus`, `RunResolveMode`, `ResolvedRun`, full `HumanViewModel` family + all `CoordinationTimelineEntry` union members. 30 new tests; 468/477 (9 pre-existing skipped). |
| 010 HF-001 | Extracted shared inbox polling primitive into `runner/inbox-poll.ts`: `pollInboxLane(location, readLane, opts)` with caller-passed `maxWaitMs` cap (MCP=30s, CLI=5min). Preserves filter chain order (unread → type → waitForAny → after), single-settle cleanup, file-watch + debounce settlement, and `nextAfter` watermark exactly as the inside MCP `inbox_list` had them. Re-exported from `runner/index.ts` so the CLI domain can consume directly without going through MCP. `mcp/tools/inbox.ts:inboxList` refactored to delegate to the shared helper, mapping `InboxPollError` codes back to MCP error codes. New `InboxPollError` + `InboxPollErrorCode` in the public type surface. |
| 010 HF-003 | Added resume-in-place semantics. NEW: `runner/run-eligibility.ts` (`detectRunState(runDir)` classifies active/stale/completed/failed/nonexistent via filesystem + pid-liveness, with injectable `isProcessAlive` for tests). NEW: `runner/resume-lock.ts` (`resume-intent.lock` lifecycle — `acquireResumeLock`/`clearResumeLock`/`readResumeLock`/`waitForResumeLock`; force-clears stale locks when age ≥ 30s AND owner pid dead). EXTENDED `runner.ts` with resume-in-place branch: when `config.resumeInPlace=true` + `resumedFromRunId` is set, skip `createRunFolder`, reuse the original runDir, mutate `run.json` (append `resumes[]` entry with `fromState`/`previousPid`/`kind`), rename `completed.json` → `completed-N.json` BEFORE rewriting `run.json` (crash-recovery write order), and append a synthetic `{type:'resume'}` event to `events.ndjson` instead of truncating. EXTENDED `AgentRunConfig` with `resumeInPlace`, `resumeFromState`, `resumePreviousPid`, `resumeKind`. New shared template section "On Resume" in `agents/_shared/preamble.md` + `src/templates/shared-preamble.md` teaching agents to recognize the `[SYSTEM RESUME]` envelope. 32 new runner tests (eligibility/lock/resume-in-place). |
| 011-retro-harvest-loop | NEW `runner/retro-ledger.ts` — append-only writer for `docs/retros/<slug>.md` (and per-plan dual-write when `planId` set). Exports `appendRetroEntry`, `appendRetroStub`, `RetroLedgerError`, `RetroResult`, `RetrospectiveLike`. Idempotent on `runId` (scans for `runId: <id>` line); atomic-rename via `writeFileAtomicAsync`; in-process write queue (`Map<filePath, Promise>`) serializes parallel same-target writes; 3-attempt retry-on-conflict for cross-process best-effort. Stub entries use `> ⚠️` blockquote prefix. EXTENDED `runner.ts` with auto-append branch at every terminal site (success/degraded/timeout/failed/input-invalid) plus a top-level try/finally that emits a `crashed` stub on uncaught exceptions. Honors `MINIH_NO_AUTO_HARVEST=1` and `MINIH_PLAN_ID` (read at runAgent entry — captured BEFORE the env scrub at runtime cleanup, since `MINIH_PLAN_ID` is intentionally NOT in `MINIH_ENV_KEYS`). New `looksLikeMinihProject()` heuristic requires `config.cwd` be explicitly set + cwd has `agents/` to avoid polluting unrelated projects. New `formatMagicWandHint(wand)` exported from `display.ts` (first non-empty line, collapse whitespace, 100-char + `…` truncation). New shared-template "## For Operators" section taught to orchestrators. 24 new runner tests (retro-ledger, runner-auto-harvest, display-magic-wand). |
