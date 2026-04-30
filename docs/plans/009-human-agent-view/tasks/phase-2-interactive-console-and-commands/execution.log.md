# Phase 2 Execution Log

**Phase**: Phase 2: Interactive Console & Commands
**Started**: 2026-04-30
**Mode**: Full (Lightweight testing per spec)

---

## Pre-Phase Validation

No `docs/project-rules/harness.md` configured. Standard testing applies (Vitest + `just fft`).

## T001 — Add ink/react deps + tsconfig — DONE

- `package.json`: added `ink: ^7.0.1`, `react: ^19.2.5` (deps), `@types/react: ^19.2.14` (devDeps).
- `tsconfig.json`: added `"jsx": "react-jsx"` and extended `include` to `["src/**/*.ts", "src/**/*.tsx"]`.
- `npm install` clean. `npm run build` clean. `npm audit` clean (0 vulnerabilities).
- 47 new packages added (Ink + React + transitive). Acceptable footprint.

## T002 — run-feed.ts — DONE

- Created `src/cli/human/run-feed.ts` (~280 LOC) with `createRunFeed({ runDir, onUpdate, eventsTailLines?, debounceMs? })` returning `{ stop(), readSnapshot() }`.
- Initial emit fires synchronously inside `createRunFeed` BEFORE returning the handle (per Phase 2 contract for `--human` mode).
- Reused `readRecentEventLines` from `src/cli/commands/tail.ts` (decision per validation).
- Inbox lanes: direct JSONL read via `fs.readFile` (no canonical one-shot reader exists in runner).
- State files: direct JSON read (`readStateLazy` would synthesise a default — we want `null` for view-only).
- History: direct JSONL read.
- `readManifest` from `src/runner/index.ts`.
- `fs.watch` non-recursive on a fixed set of known files (events.ndjson, run.json, completed.json, inbox/{lane}/messages.ndjson, state/*.json, state/history.ndjson, output/report.json) plus the dirs themselves for new-file detection. Errors on watcher are swallowed (file may not exist yet).

Discovery: TS choked on `inbox/*/messages.ndjson` inside a JSDoc block comment because `*/` ended the comment. Worked around by rephrasing to `inbox/<lane>/messages.ndjson`.

## T003 — input-bridge.ts — DONE

- Created `src/cli/human/input-bridge.ts` (~110 LOC).
- `createInputBridge({ sender?, attached, runStatus })` returns a frozen `InputBridge` with `capability`, optional `reason`, `submit(text)`, and `withRunStatus(next)` for transitions.
- Three states: `input available` (sender + !attached + !terminal), `input read-only` (attached or no sender + !terminal), `completed` (runStatus ∈ {completed, failed}).
- Terminal status overrides attached — even attached completed runs read `completed`.
- `withRunStatus` re-derives the bridge from updated input — clean transition path; React parent swaps reference on each call.

## T004 — Ink panes + app.tsx — DONE

- 5 panes:
  - `panes/header.tsx` — borderStyle="round", colored status + capability + counts.
  - `panes/transcript.tsx` — actor-labeled rows, streaming/collapsed/error badges.
  - `panes/tools.tsx` — compact lifecycle rows with running/ok/error glyphs (◐/✓/✗).
  - `panes/workbench.tsx` — state snapshot + coordination timeline (inbox + transitions + validation + control + diagnostic) + output pane. Inbox rows render `↳ in reply to <id>` for `ackOf`-set messages (plan 013 + AC-6).
  - `panes/footer.tsx` — capability label + colored prompt + `useInput` text input + last-result line + `Pause scroll`/`Resume follow` (Workshop 003 copy).
- `app.tsx`:
  - `mountHumanApp({ feed, bridge, initial })` returns `{ unmount, waitUntilExit, updateBridge }`.
  - Ink configured `exitOnCtrlC: false` — caller owns SIGINT for Phase 3.
  - `unmount()` calls `feed.stop()` (single source of cleanup).
  - Split-layout state (`'transcript' | 'workbench' | 'reset'`) toggled by Tab / Shift-Tab / Esc.
  - Module-level `pushHumanModel(model)` setter for the run-feed `onUpdate` callback to drive React state without prop-drilling the feed.
- Discovery: `useInput` covers basic typing/backspace; multi-line and paste handling deferred (would need `ink-text-input` package — see decisions).

## T005 — view command — DONE

- Created `src/cli/commands/view.ts`. `minih view <slug> [--run <id>] [--agents-dir <dir>]`.
- Resolver fallback: `--run <id>` → `by-id`; otherwise `latest-active` → `latest-completed`.
- `MultipleActiveRunsError` → E170 envelope with `details.candidates`.
- Resolver miss / errors → E171 envelope with `details.tried`.
- New error codes E170 AMBIGUOUS_RUN_ID + E171 RUN_NOT_FOUND added to `src/cli/output.ts`.
- Mount path: `createRunFeed(...)` → `feed.readSnapshot()` → `buildHumanViewModel` → `createInputBridge({ attached: true })` → `mountHumanApp(...)`.
- `process.once('SIGINT', () => handle.unmount())` registered; `await handle.waitUntilExit()` blocks the action.
- Registered in `src/cli/index.ts` alongside existing commands.

## T006 — --human flag on run.ts — DONE

- Added `--human` boolean option with mutually-exclusive validation against `--verbose` (E108 INVALID_ARGS).
- EXTENDED `AgentRunConfig` (in `src/runner/types.ts`) with `onSessionReady?: (sender, { runDir, runId }) => void` hook.
- WIRED in `src/runner/runner.ts:startForwarders` — fires the caller hook BEFORE the existing forwarder logic; errors surface via `handleForwarderError`.
- run.ts `--human` path: dynamic-imports the human-view modules from `onSessionReady`, calls `feed.readSnapshot()` BEFORE `mountHumanApp` (initial-snapshot-before-paint constraint), creates `InputBridge` with `attached: false` + sender, mounts, registers SIGINT/SIGTERM.
- Pretty mode and `displaySummary` are suppressed when `--human` is active (`pretty = opts.human || useVerbose ? null : new PrettyDisplay()`).
- `humanHandle.ref` ref-pattern works around TS closure-narrowing limitation.

## T007 — Tests — DONE

- `test/cli/human-input-bridge.test.ts` — 12 tests covering all three capability states, sender error handling, transitions (active → completed, attached read-only across status changes).
- `test/cli/view-command.test.ts` — 8 tests covering help signposting, error envelopes (E171), stdout-clean discipline (no ANSI CSI in stdout), `--human` + `--verbose` mutual exclusion, completed-run resolver fallback.
- 20/20 passing.
- Discovery: minih's CLI convention puts JSON envelopes on **stdout** (not stderr); the AC-13 stdout-clean test enforces "no ANSI control bytes leak from Ink" — the JSON envelope itself is legitimate stdout. Test asserts `/\x1b\[/` absence via `String.fromCharCode(27)` (Biome's `noControlCharactersInRegex` rule).

## T008 — just fft — DONE

- Initial run: 17 lint errors + 9 warnings (mostly auto-fixable formatting + 1 unused param + 1 control-char regex).
- `npx biome check --write src/ test/` resolved 9 files.
- Hand fixes: removed unused `feed` prop from `App` component (it's consumed only via `pushHumanModel` ref now); rewrote ANSI regex test using `String.fromCharCode(27)` to satisfy `noControlCharactersInRegex`.
- Final: `just fft` exits 0. **Tests: 682 passed | 10 skipped (was 662 before; +20 from Phase 2)**. Audit: 0 vulnerabilities.

## Phase 2 Summary

- 8 tasks complete.
- 9 new files: `src/cli/commands/view.ts`, `src/cli/human/{app.tsx, run-feed.ts, input-bridge.ts, panes/header.tsx, panes/transcript.tsx, panes/tools.tsx, panes/workbench.tsx, panes/footer.tsx}` plus 2 test files.
- 5 modified: `src/cli/commands/run.ts`, `src/cli/index.ts`, `src/cli/output.ts`, `src/runner/types.ts`, `src/runner/runner.ts`, `tsconfig.json`, `package.json`.
- New runtime deps: `ink`, `react`. New devDep: `@types/react`. 0 audit findings.
- New error codes: `E170 AMBIGUOUS_RUN_ID`, `E171 RUN_NOT_FOUND`.
- 20 new tests (12 input-bridge unit + 8 view-command integration).
- Domain history rows added to `cli/domain.md` and `runner/domain.md`.

**ACs covered**: 1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 13, 15. ACs 10/12/14 deferred to Phase 3 (snapshot mode, terminal cleanup, docs).

**Phase 3 forward-compat seam preserved**: `mountHumanApp({ unmount, waitUntilExit })` + `exitOnCtrlC: false` + `feed.readSnapshot()` (one-shot reuse) all in place.
