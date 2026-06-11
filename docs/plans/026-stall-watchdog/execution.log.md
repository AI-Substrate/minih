# Execution Log — 026 stall-watchdog (Simple mode, single phase)

**Plan**: [stall-watchdog-plan.md](./stall-watchdog-plan.md) · **Testing**: Full TDD · **Branch**: `026-stall-watchdog`

---

## T000 — Harness pre-flight (pre-implement seam)

- Router probe: installed (`~/.agents/skills/eng-harness-flow/SKILL.md`).
- Seam fired: `harness boot --json` (the boot adoption built — biome check, tsc --noEmit, just check, minih doctor, npm audit).
- Envelope: `status: "degraded"` → boot vocabulary **SLOW — proceed with note**.
  - lint / typecheck / build+test: **pass** (clean).
  - minih-doctor: **warn** — pre-existing unharvested retros + dead companion peers + outside.md sizes; 0 errors.
  - audit: **warn** — pre-existing dev-dep advisories (vitest <3.2.6 critical, fast-uri high, hono/qs moderate). None touch `@github/copilot-sdk`. Out of scope for this plan; noted, not acted on.
- Decision: proceed to tasks.

## T001 — SDK bump 1.0.0 → 1.0.1

- `npm install --save-dev --save-exact @github/copilot-sdk@1.0.1` — package.json devDep now `"1.0.1"`, lockfile updated.
- Evidence: `just sdk-check` → `✓ @github/copilot-sdk: 1.0.1 (latest)`; `sdk-permission-shapes.test.ts` 4/4 green; full adapter suite 35/35 green; `tsc --noEmit` clean.
- **Drift found** (the reason T001 runs first): 1.0.1 **removed `session.destroy()`** — replacement is `client.deleteSession(sessionId)` (client.d.ts:318). Our mirror (`copilot-types.ts:91`) still declares it, so tsc stayed green while the runtime call in `terminate()` (sdk-copilot.ts:314) would throw TypeError (silently absorbed by its try/catch). `client.forceStop(): Promise<void>` confirmed present (client.d.ts:192). Minor: 1.0.1 `exports` no longer exposes `./package.json`.
- Action routed to T003: drop the destroy rung, align the mirror, add optional `forceStop?()`.

## T002 — `withDeadline` helper (TDD)

- RED: `test/adapter/deadline.test.ts` written first — 7 cases (resolve/reject passthrough, timer cleared on settle via `vi.getTimerCount()`, sentinel on expiry, `onTimeout` exactly-once, no-`onTimeout`-on-settle, late-rejection swallowed). Run failed: module not found.
- GREEN: `src/adapter/deadline.ts` — `withDeadline(promise, ms, onTimeout?)` resolves to `DEADLINE_EXPIRED` sentinel on expiry (never throws raw), passes through settle, clears + `unref()`s its timer, attaches a noop catch to the abandoned promise so late rejections can't surface unhandled. 7/7 green.

## T003 — bounded adapter cleanup + forceStop escalation (TDD)

- RED: MockSession gained opt-in `hangAbort`/`hangDisconnect`; MockClient gained `forceStopCalls`/`hangResume`; new `MockClientWithoutForceStop` covers the forceStop-absent risk row. 6 new tests (graceful ladder, abort-hang, resume-hang, rung-rejection, no-forceStop, run-finally disconnect-hang) — all failed for the right reason (5s vitest timeouts on hangs; TypeError on the removed `destroy()` in the graceful path).
- GREEN: `SdkCopilotAdapter` gained `options.cleanupRungTimeoutMs` (default 5000ms; tests inject 20ms) + private `_boundedRung()` (settled-cleanly boolean; hang OR rejection → false). `terminate()` rewritten as the bounded ladder resume → abort → disconnect with escalation to `client.forceStop?.()`; destroy rung dropped per SDK 1.0.1 (session state stays on disk for post-mortem). run() and compact() `finally` disconnects bounded. Mirror: `ICopilotSession.destroy()` removed, `ICopilotClient.forceStop?()` added.
- Behavior note: `terminate()` no longer throws on resume/abort failure — it escalates and still returns `killed` (the runner's try/catch treated those throws as noise anyway).
- Evidence: adapter suite 48/48 green; `tsc --noEmit` clean; only construction site (`sdk-runtime.ts:105`) keeps default 5s rungs.

## T004 — runner timeout path: bounded terminate + terminalReason 'timeout' (TDD)

- Prerequisite type work (per plan + validate-v2 fix): `terminalReason` union widened with `'timeout' | 'stalled-stream' | 'max-turns'`; `LiveRunManifest.budgets?` added; `DEFAULT_TIMEOUT_SEC = 900` exported from types.ts (CD-05 single source); `AgentRunConfig` gained `stallTimeout`/`maxTurns`/`cleanupGraceMs` (the last is the internal cleanup-bound test seam). `FakeAgentAdapter` gained opt-in `hangOnTerminate` + `setTerminateHang()`.
- RED: two new tests — (b+c) timeout writes `terminalReason:'timeout'` in the final patch + message reports configured seconds (failed: no reason in run.json); (a) hung-terminate still terminalizes bounded (failed: 5s vitest timeout). One test-shape fix: result field is `agentResult`, not `result`.
- GREEN: runner computes `timeoutSec = config.timeout ?? DEFAULT_TIMEOUT_SEC` once (race arm + both messages share it; `?? 300` hardcodes gone); `await adapter.terminate()` bounded via `withDeadline(…, cleanupGraceMs=10s default)`; final manifest patch writes the budget reason guarded by the preservation invariant (`!denialState.terminalFired && !streamAborted`).
- Evidence: runner.test.ts 19/19 green; `tsc --noEmit` clean.

## T005a/T005b — stall watchdog (TDD)

- RED (T005a): new `test/runner/runner-stall.test.ts` with a local `ScriptedAdapter` (emits events at real-clock offsets; no `settleAtMs` → run() never settles — the exact #44 shape). 5 cases: silent stall terminalizes (failed/stalled-stream/run_stalled×1/exit 124/completed.json, bounded <5s); any-event no-false-trigger (tool/thinking/total-runtime > budget but gaps < budget); `--stall-timeout 0` disables (wall-clock backstop proves it); idle-before-stall clean; timeout-beats-stall precedence. Only the silent-stall case was red (5s vitest timeout) — exactly the missing watchdog. One helper fix: tolerate absent events.ndjson for zero-event runs.
- GREEN (T005b): `AgentStalledEvent` (`run_stalled`) added to the adapter event union; runner gained `stalled` flag + `resetStallDeadline()` (re-arms on EVERY handleEvent; initial arm at race assembly so a fully-silent run still stalls) + third race arm. The synthetic event is emitted from the race arm (NDJSON append + onEvent + stats.total++), bypassing handleEvent so it cannot self-reset. Parity with `timedOut` everywhere: handleEvent guard, all `.then()` early-returns, catch (bounded terminate + killed/124), finally (stallHandle cleared), final-patch reason precedence (timeout > stalled-stream, both behind denial/abort). Timeout callback now guards `if (stalled) return` so a late wall-clock fire can't relabel a stall. `pretty.ts` renders `run_stalled` loudly; handleEvent has a defensive arm. `DEFAULT_STALL_TIMEOUT_SEC = 300` exported from types.ts.
- Evidence: stall suite 5/5; FULL suite 1285 passed / 16 skipped in 12.2s (no false triggers, no leaked timer hangs); tsc clean.

## T006a/T006b — max-turns budget (TDD)

- RED (T006a): 3 cases appended to runner-stall.test.ts — breach (3 messages vs maxTurns 2, flowing stream, never settles → failed/max-turns/124, bounded); at-budget unaffected with deltas/tool/thinking interleaved (turn = one consolidated message, chunking-independent); 0 = unlimited. Only the breach case was red (hang → 5s timeout).
- GREEN (T006b): `turnsExceeded` flag + 4th race arm; breach check at the `stats.messages` increment (`maxTurns > 0 && stats.messages > maxTurns`); refactor — `budgetBreached()` helper replaces the growing `timedOut || stalled || …` guards everywhere (handleEvent, .then() chain, all fire-guards, catch) and `budgetMessages` Record (PL-05 idiom) is the single source for the three trigger messages (race rejections + agentResult.output share it).
- Evidence: runner suite 838/838 green; tsc clean.

## T007 — CLI budget flags + shared defaults (TDD)

- RED: new `test/cli/run-budget-flags.test.ts` (built-CLI subprocess, 14 cases) — help surfaces on run+resume; E108 matrix (NaN/negative/fractional max-turns/zero timeout) on run, plus resume validating BEFORE run resolution; threading proven via a new dry-run `budgets` echo; shared defaults 900/300/0; frontmatter `timeout: 42` wins; `0` accepted for stall (disable) and turns (unlimited). All 14 red.
- GREEN: NEW `src/cli/budget-flags.ts` — `parseBudgetFlag(command, flag, raw, kind)` with kinds positive-seconds / non-negative-seconds / non-negative-count; strict `Number()` + integer check (the old `parseInt` accepted '300abc' and NaN/negative silently — finding 04). run.ts: `--stall-timeout`/`--max-turns` flags, early validation, local `DEFAULT_TIMEOUT` removed in favor of `DEFAULT_TIMEOUT_SEC`/`DEFAULT_STALL_TIMEOUT_SEC` (exported from runner index), `budgets` in the dry-run envelope + stderr stats line. resume.ts: same flags, early E108 validation, the `'300'` commander default + `parseInt(opts.timeout ?? '300')` hardcodes GONE — frontmatter-aware shared default. runner.ts: `budgets` computed once, written into the initial manifest AND the resume-in-place rewrite, and reused by the race arms.
- Deviations from manifest (logged): added `src/cli/budget-flags.ts` (not in the original Domain Manifest — added to it); threading proof via dry-run echo instead of a real subprocess run (the CLI has no fake-adapter seam — a real `minih run` needs GH_TOKEN + the Copilot CLI; the budgets-in-run.json proof lives in runner-stall.test.ts instead).
- Behavior notes: `--timeout 0` now E108 (previously silently fell through to the default on run; on resume `0` produced an instant-fire timer); `--timeout 300abc` now E108 (was parsed as 300).
- Evidence: 14/14 green; FULL suite 1302 passed / 16 skipped; tsc clean.

## T008 — status surfacing (TDD)

- RED: new `test/cli/status-terminal-reason.test.ts` (4 cases) — envelope passthrough for a seeded `stalled-stream` run (green already — passthrough is generic, exactly as the plan predicted); TTY `Reason:` line via the plan-025 forced-TTY wrapper precedent (red); clean run prints no Reason line (green); E170 remedy mentions `--latest` (red, seeded two live-pid active runs).
- GREEN: status.ts TTY arm prints `Reason:   <terminalReason>` (red chalk) under Result; E170 message + remedies now include `minih status <slug> --latest`.
- Evidence: 4/4 green via built CLI.

## T009 — docs + vocabulary guard

- README: run/resume flag tables gained `--stall-timeout`/`--max-turns`; the stale "default: 300" timeout rows corrected to "agent frontmatter or 900" (the CD-05 drift lived in the docs too); new **§ Run budgets** (budget table, any-event reset, turn definition, three-trigger artifact matrix, budgets-recorded note, tool-silence limitation, Windows stance).
- docs/how/run-liveness.md: terminalReason vocabulary row widened to all six values; new **§ Run budgets** section framing budgets as the pre-mortem guarantee (reconcile becomes the backstop) + the terminal-artifact-first invariant.
- CHANGELOG: plan-026 block (features + the stricter-flag-validation note: `--timeout 0`/`300abc` now E108 instead of silent).
- AGENTS_README: polling-hosts note on the three budget reasons (+ tool-silence caveat); dist copy refreshed via rebuild (freshness guard green).
- Vocabulary guard: new `run-budget vocabulary (plan 026)` describe — README flags/reasons/0-semantics/tool-silence/Windows, run-liveness all six reasons, CHANGELOG, AGENTS_README. 11/11 green.
- Drafted the #44 closing comment (corrects CD-06's "no --timeout exists" claim) at `docs/plans/026-stall-watchdog/issue-44-comment.md` — to be posted at merge with Jordan's go, not before.

## T010 — domain docs + close-out gate

- Domain docs: 026 History rows appended to runner/adapter/cli domain.md. adapter: Composition row for `deadline.ts`, Contracts rows (`withDeadline`/`DEADLINE_EXPIRED`, `SdkCopilotAdapterOptions`, SDK-1.0.1 mirror note, `AgentStalledEvent`), new "Bounded cleanup ladder" Concept, Tests rows (deadline + shape-pin). runner: Contracts rows for the `DEFAULT_*` consts and the new config/manifest fields. cli: Contracts rows for the budget flags + dry-run budgets echo. domain-map: runner→adapter edge label + prose gain `withDeadline` (direction unchanged — no topology change).
- Barrel: `src/adapter/index.ts` exports `withDeadline`/`DEADLINE_EXPIRED`/`DeadlineExpired`, `AgentStalledEvent`, `SdkCopilotAdapterOptions`.
- Gate: biome `check --write` reflowed 7 files (formatting only), then **`just fft` exit 0** — lint, format, build, typecheck, **1310 tests passed / 16 skipped (122 files)**, audit (pre-existing advisories, non-blocking by design), `sdk-check ✓ 1.0.1 (latest)`.

## T011 — phase-end harness seam

- Captured two real frictions into the observe buffer before firing the seam:
  - `DL-001` (difficulty / project-sensor / degrading): SDK 1.0.1 removed `session.destroy()` invisibly — mirror types kept tsc green, runtime call would TypeError; the shape pin covers permission shapes only, not the session/client method surface. Suggested encoding: extend `sdk-permission-shapes.test.ts` to pin the method surface.
  - `SUGG-001` (improvement-suggestion / project-sensor / annoying): no CLI fake-adapter seam — built-CLI tests can't run an agent end-to-end (GH_TOKEN + Copilot CLI required); threading proven via dry-run echo instead. Suggested encoding: `MINIH_FAKE_ADAPTER` env seam in `sdk-runtime.ts`.
- Seam outcome: buffer non-empty → router route = **drain**; the `[s/t/p/e/d/a]` menu is presented to Jordan at the seam (soft prompt, never blocks). Harvest follows once drained.

---

## Phase complete — summary

All tasks T000–T011 done; all 11 acceptance criteria met (checked in the plan with evidence pointers).

- **The #44 fix shipped in three layers**: (1) terminal artifacts can never be blocked — every SDK cleanup await is deadline-bounded with `forceStop` escalation (CD-01); (2) silent stalls are detected — any-event-reset inactivity watchdog, third race arm, synthetic `run_stalled`, `terminalReason: 'stalled-stream'` (CD-02); (3) budgets are operator-tunable and recorded — `--stall-timeout`/`--max-turns` on run+resume, strict E108 validation, `budgets` in run.json, shared frontmatter-aware 900s default (CD-03/04/05).
- **Final gate**: `just fft` exit 0 — 1310 tests passed / 16 skipped (122 files; +42 new tests this phase), biome clean, tsc clean, `sdk-check ✓ 1.0.1 (latest)`.
- **Discoveries**: SDK 1.0.1 `destroy()` removal (logged, handled in T003); two manifest deviations logged in T007 (new `src/cli/budget-flags.ts`, dry-run-echo threading proof); behavior notes — stricter flag validation (`--timeout 0`/garbage now E108), `terminate()` no longer throws (escalates instead).
- **Not done on purpose**: #44 closing comment is DRAFTED (`issue-44-comment.md`), not posted; nothing committed — everything awaits Jordan's review + the review stage.
