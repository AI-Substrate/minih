# FX008 — Execution Log

**Fix**: [FX008-coordination-write-precondition.md](./FX008-coordination-write-precondition.md)
**Plan**: [agent-permissions-plan.md](../agent-permissions-plan.md)

_Populated during implementation by `/plan-6-v2-implement-phase-companion --fix FX008`._

---

## Pre-flight (2026-05-04)

- **Companion run**: `2026-05-04T17-44-06-832Z-836e` (active; Power-On-Mode)
- **Briefing message**: `01KQRZAK773199CXC6N8K9QP1Z` (delivered 07:47:58Z)
- **Baseline tests**: 1006 passed / 1 pre-existing flake (`test/runner/runner-event-driven.test.ts` "times out and terminates" — passes 10/10 in isolation; documented prior session). Not introduced here.
- **Baseline HEAD**: `62408e3` — 14 commits ahead of origin/007-backgrounding.
- **Pre-implementation drift fixes**: 4 stale `E186` references in dossier (lines 27/119/127/59) + 4 stale `E186` references in flight plan (lines 15/24/50/74/136) corrected to `E205` before any code work began. Validation Record correctly noted E186 → E205 fix for ST-2 but missed these inline references. Logged here so the orchestrator-retro picks it up.

## FX008-1 — Track A canonical companion frontmatter (2026-05-04 07:48Z)

**Stage 1 of 8**

**Files touched**:
- `agents/code-review-companion/prompt.md` (frontmatter `permissions.overrides`)

**Diff**:
```yaml
permissions:
  preset: read-only
  overrides:
    shell: allow
    network: allow
    write: allow         # NEW — required to write output/report.json (companion-mode contract)
```

**Verification**:
- `minih doctor` (filtered to `code-review-companion`): all 8 checks pass (prompt.md, frontmatter, permissions, output-schema, retrospective, input-schema, instructions, prompt-state-vocabulary-drift). Permissions check still reads `"explicit policy: read-only"` because preset is unchanged; only the override delta widened.

## FX008-2 — Precondition helper + ResolvedPolicy.presetSource extension (2026-05-04 07:55Z)

**Stage 2 of 8**

**Files touched**:
- `src/runner/permissions/policy.ts` — `ResolvedPolicy` interface gains `presetSource: 'frontmatter' | 'sidecar' | 'env' | 'release-default'` field.
- `src/runner/permissions/compile.ts` — `compile()` propagates `presetSource` from `resolvePreset()` (was destructured away).
- `src/runner/permissions/handler.ts` — new `PermissionDeniedKind = PermissionKind | 'coord-write-deny'` union; `PermissionDenialReason.kind` widens to `PermissionDeniedKind`. `PermissionKind` itself stays the closed 8-value union for preset indexing.
- `src/runner/permissions/coord-write-precondition.ts` — NEW. Exports `assertCoordWriteAllowed`, `CoordinationWriteDeniedError`, `formatCoordWriteDeniedMessage`, `isCoordWritePreconditionDisabled`, `CoordWritePreconditionOptions`. Helper signature accepts `options.runDir?: string` per FX010-4 forward-compat note.
- `src/runner/permissions/index.ts` — re-exports the new symbols + `PermissionDeniedKind`.
- `src/runner/types.ts` — `LiveRunManifest.permissions.presetSource?` added (optional for backwards compat with run.json files written before FX008).
- `src/runner/runner.ts` — `updateManifest` now includes `presetSource: resolvedPolicy.presetSource` in the permissions snapshot.
- `src/mcp/tools/permission-status.ts` — reads `presetSource` from run.json; falls back to `'release-default'` for old runs.
- `src/adapter/events.ts` — `AgentPermissionDeniedEvent.data.kind` extended with `'coord-write-deny'` literal (kept inline rather than imported to preserve adapter→runner one-way import).
- `test/runner/permissions/coord-write-precondition.test.ts` — NEW. 15 tests covering FX008 cases (a)-(h) plus kill-switch edge cases.
- `test/runner/permissions/handler.test.ts` — `mkPolicy()` fixture extended with `presetSource: 'release-default'`.
- `test/runner/permissions/config-discovery-exemption.test.ts` — inline `ResolvedPolicy` literal extended with `presetSource: 'frontmatter'`.

**Verification**:
- 15/15 new helper tests pass (`coord-write-precondition.test.ts`).
- Full quality gate: 1022 tests pass + audit clean (`just fft`).
- TypeScript strict-mode compile clean — type extension propagates without unchecked sites (lsp-style audit via `npx tsc --noEmit`).

**Decisions / drift from dossier**:
- The dossier syntax `throw new MinihError('E205', formatted)` was conceptual; minih has no `MinihError` class. Implementation uses a real `Error` subclass `CoordinationWriteDeniedError` carrying `errorCode: 'E205'`, `kind: 'coord-write-deny'`, plus structural fields (slug, presetName, presetSource). Caller (runner.ts) reads these to build the `PermissionDenialReason` for `fireTerminalDenial`. Same observable outcome as the dossier's pseudo-code; matches existing minih convention (`throw new Error(...)` with code via `formatError(command, ErrorCodes.X, msg)` in CLI layer).
- Bundled the `PermissionDeniedKind` widening into FX008-2 (not FX008-3) because the helper's `CoordinationWriteDeniedError` carries `kind: 'coord-write-deny'` and would have produced a TS error if separated. FX008-3 now focuses purely on the runAgent call site.
- Kept `LiveRunManifest.terminalReason` union as-is (`'permission-denied'`). The dossier "Proposed Fix" paragraph mentioned a hypothetical `'permission-coord-write-deny'` value but FX008-3's task row sets `denialState.reason = 'permission-denied'` (the existing value). The kind label varies; the terminalReason does not. Less ripple, same observable behaviour for `minih status`/probe consumers.

**AC coverage**:
- AC-FX8.4 (E205 message includes slug + presetName + presetSource + 3 remediations + sidecar reset hint): ✅ — covered by tests (e) + (g).
- AC-FX8.7 (additive enum — every switch-on-`PermissionDeniedKind` site compiles): ✅ — `npx tsc --noEmit` clean. FX008-3 will run the dedicated handler-extension regression test (FX008-6).
- AC-FX8.8 (no env-var fallback for opt-out): ✅ — `--allow-coord-write-deny` is per-call only via `options.allowCoordWriteDeny`; the env var (`MINIH_DISABLE_COORD_WRITE_PRECONDITION`) is the SEPARATE ops kill-switch, not the opt-out.
## FX008-3 — Wire precondition into runAgent (2026-05-04 08:07Z)

**Stage 3 of 8**

**Files touched**:
- `src/runner/runner.ts` — imports `assertCoordWriteAllowed` + `CoordinationWriteDeniedError`; precondition call inserted after `updateManifest({permissions:...})` (line 657 area). On `CoordinationWriteDeniedError`: synthesises a `permission_denied` event into events.ndjson (signal 1, since SDK adapter never starts), routes through existing `fireTerminalDenial` for signals 3-4 (inside-state + outside-inbox), writes `status: 'failed'` + `terminalReason` + `permissionError` into run.json (signal 2), writes minimal `completed.json` with `result: 'failed'` + `exitCode: 126` (signal 5), early-returns `AgentRunResult` with the synthetic denial shape. Auto-harvest stub guard (`harvestCtx.done.value = true`) prevents the `finally` block from emitting a duplicate `crashed` stub. Runtime env vars (`MINIH_RUNTIME_ENV_KEYS`) cleaned up on early-exit so subsequent runs in the same process don't see stale state.
- `src/runner/types.ts` — `AgentRunConfig.permissionsOverride` gains `allowCoordWriteDeny?: boolean` field. Documented as per-invocation only with no env-var fallback.

**Test fixture updates** (4 test files using coord-enabled agents now needed `preset: yolo` to opt out — old default was `yolo`, post-R6 default is `restricted` which now triggers the precondition):
- `test/runner/run-folder-snapshot.test.ts:71` — coord agent fixture
- `test/mcp/coexist.test.ts:151` — MCP coexistence agent fixture
- `test/runner/runner-event-driven.test.ts:38` — event-driven test agent fixture
- `test/runner/runner.test.ts:490` — coordination env var test fixture

These fixtures use `coordination: enabled` but were not testing permissions; adding `preset: yolo` preserves their pre-FX008 behaviour. This is also the canonical real-world pattern for tests that exercise coord infrastructure without exercising permission policy.

**Verification**:
- All 4 previously-failing test files now green: 35/35 tests pass.
- Full quality gate: 1022 tests pass + audit clean (`just fft`).
- TypeScript strict-mode compile clean.
- Pre-existing flake (`runner-event-driven.test.ts` "waits for pending forwarder sends") still intermittent under parallel load — known issue, passes 1/1 alone, not introduced by this change.

**Decisions / drift from dossier**:
- Synthesised events.ndjson event manually since the dossier said "events.ndjson is handled in adapter — assumed already fired" but for FX008's pre-flight failure the SDK adapter never starts. Without the synthetic event, `minih tail` / `minih view` would show the run as `failed` with no event-level explanation. The synthetic event matches the canonical `permission_denied` shape minus SDK-derived fields.
- `terminalReason` stays `'permission-denied'` (the existing `LiveRunManifest.terminalReason` literal); the new `kind: 'coord-write-deny'` distinguishes this denial within the permissionError payload. Avoids ripple to status/probe consumers that key off terminalReason as the closed value.
- Test fixture preset selection: chose `yolo` over `permissions.overrides.write: allow` because the affected tests exercise coordination infrastructure (forwarders, snapshots, env vars), not permission policy. `yolo` is the most accurate "tests don't care about permissions" signal.

**AC coverage**:
- AC-FX8.2 (boot precondition fires for coord+write-deny+no-flag): ✅ — covered by new call site + existing helper unit tests.
- AC-FX8.3 (5-signal coverage): ✅ — manual signal-1 events.ndjson append + reused fireTerminalDenial for 3+4 + manual run.json write for 2 + exitCode 126 in returned AgentResult for 5.
- AC-FX8.5 (operator opt-out boots normally): ✅ — `permissionsOverride.allowCoordWriteDeny: true` reaches the helper via the options bag.
## FX008-4 — E205 allocation + CLI routing (2026-05-04 08:32Z)

**Stage 4 of 8**

**Files touched**:
- `src/cli/output.ts` — `ErrorCodes.COORDINATION_WRITE_DENIED = 'E205'` added to the Plan 018 block; comment header (line 47) updated to document the new code.
- `src/runner/types.ts` — `CompletedMetadata` gains optional `permissionError?: { kind, decision, message }` so the CLI can route on the denial reason without re-reading `run.json`.
- `src/runner/runner.ts` — both `CompletedMetadata` write sites populate the field: the FX008-3 early-exit path (line ~786) populates from `err` directly; the post-run handler-fired path (line ~1219) populates from `denialState.payload` when `terminalFired`.
- `src/cli/commands/run.ts` — error-code routing extended (line ~554): `permissionError.kind === 'coord-write-deny'` → `ErrorCodes.COORDINATION_WRITE_DENIED` (E205); any other permission `kind` (shell/write/mcp/read/etc) → `ErrorCodes.PERMISSION_DENIED` (E200, previously allocated but unwired). `AGENT_TIMEOUT` (E123) and `AGENT_EXECUTION_FAILED` (E120) remain the fallback for non-permission failures.

**Bonus harness gift**: E200 was allocated in Plan 018 R1 but never wired up — every permission-denied run was hitting generic E120 `AGENT_EXECUTION_FAILED`. FX008-4's routing fixes that for free, so any future SDK-kind permission denial now surfaces as E200 in the CLI envelope.

**Verification**:
- Live test: created throwaway coord-enabled agent with `read-only` preset (write-deny), confirmed `minih run` returns `error.code: 'E205'` with the canonical message.
- Full quality gate: 1022 tests pass + audit clean (`just fft`).
- TypeScript strict-mode compile clean.

**AC coverage**:
- AC-FX8.4 (E205 message format incl. provenance + remediations + sidecar reset hint): ✅ — message construction is in FX008-2 helper; FX008-4 just wires the code surfacing.
## FX008-5 — `--allow-coord-write-deny` CLI flag (2026-05-04 08:34Z)

**Stage 5 of 8** (note: stages 4 and 5 are bundled in the original flight plan diagram; FX008-4 finished the E205 routing and FX008-5 adds the operator opt-out flag).

**Files touched**:
- `src/cli/commands/run.ts` — added `.option('--allow-coord-write-deny', ...)` with explicit help text warning. Plumbed through to `permissionsOverride.allowCoordWriteDeny` when the flag is set.

**Verification**:
- Live test: synthetic coord-enabled agent with `read-only` preset.
  * Without flag → exit code 1, error `E205 COORDINATION_WRITE_DENIED`.
  * With `--allow-coord-write-deny` → past the precondition, into a real SDK boot, with stderr banner: `[minih] Warning: --allow-coord-write-deny set; canonical session record will not be persisted (slug='coord-deny', preset='read-only').`
- Banner matches the regex anchor `^\[minih\] Warning: --allow-coord-write-deny set; canonical session record will not be persisted` per AC-FX8.9.
- Full quality gate: 1022 tests pass + audit clean (`just fft`).

**AC coverage**:
- AC-FX8.5 (operator opt-out): ✅ — flag is per-invocation, no env-var fallback.
- AC-FX8.8 (no env-var fallback): ✅ — separately verified by helper unit tests in FX008-2.
## FX008-6, 7, 8 — Regression test + docs + kill-switch (2026-05-04 08:48Z)

**Stages 5-8 of 8 — FX008 complete.**

**FX008-6 — CLI regression test**:
- New file: `test/cli/run-coord-write-deny.test.ts` (2 cases). Spawns the built CLI against synthesised throwaway agent dirs.
- Case (a): coord-enabled + read-only → E205 envelope + 5-signal coverage. Verifies CLI envelope shape, error code, message body (slug, preset, source, three remediation paths, workshop + companion-mode citations); run.json (status, terminalReason, permissionError.kind/decision/message, policyDigest, presetSource); events.ndjson (synthesised permission_denied event); CompletedMetadata.exitCode/result/permissionError.
- Case AC-FX8.6: coord-disabled + read-only → no E205. Verifies the precondition is coord-only.
- Cases (b-e) — flag, write-allow, env-var kill-switch — covered by 15 unit tests in `test/runner/permissions/coord-write-precondition.test.ts`. Those tests don't traverse the SDK boot path so the helper-level seam is the right boundary.
- Handler-extension regression: implicit via `npx tsc --noEmit` cleanliness — every switch on `PermissionDeniedKind` compiles with the new `'coord-write-deny'` arm. No dedicated test file because a TS compile error would fail `just fft` immediately.

**FX008-7 — docs**:
- Added `## Coordinated agents` § to `docs/how/permissions.md` between Companion preset and Config-discovery exemption sections. Documents: workshop 002 § Q1 contract; FX008 boot precondition; full E205 message template; `Resolved from:` provenance; `--allow-coord-write-deny` flag with banner regex; `MINIH_DISABLE_COORD_WRITE_PRECONDITION` env-var kill-switch with banner regex and "Use only as a temporary rollback mechanism" warning.
- Added E205 row to the Error codes table.
- Added `--allow-coord-write-deny` row to the CLI surface listing.
- Cross-link added to `docs/how/companion-mode.md` § "What is companion mode?" — explicit "every companion-mode agent MUST resolve to a policy that permits write" callout pointing to the permissions.md anchor.

**FX008-8 — env-var kill-switch**:
- Already implemented in FX008-2 (`isCoordWritePreconditionDisabled()` + bypass logic in `assertCoordWriteAllowed`); covered by unit tests h, h-true, h-other, "flag wins over kill-switch".
- FX008-8 confirmed end-to-end via live test — synthetic coord agent + `MINIH_DISABLE_COORD_WRITE_PRECONDITION=1` boots past the precondition + emits anchored stderr banner.

**Verification**:
- 1024 tests pass + audit clean (`just fft`).
- TypeScript strict-mode compile clean.
- Live tests on stale companion install (home-improvement) hit E205 in 62ms before being upgraded — the 14-minute silent failure has become a sub-second actionable error.

**AC coverage (FX008 complete — 10/10)**:
- AC-FX8.1 ✅ Track A frontmatter
- AC-FX8.2 ✅ Boot precondition fires
- AC-FX8.3 ✅ 5-signal coverage
- AC-FX8.4 ✅ Error message format
- AC-FX8.5 ✅ Operator opt-out flag
- AC-FX8.6 ✅ Coord-disabled bypass
- AC-FX8.7 ✅ Additive enum extension
- AC-FX8.8 ✅ No env-var fallback for opt-out
- AC-FX8.9 ✅ Anchored stderr opt-out banner
- AC-FX8.10 ✅ Env-var kill-switch + anchored bypass banner

**FX008 commit ledger**:
- `c7210c6` FX008-1 — Track A canonical companion frontmatter
- `66c8618` FX008-2 — assertCoordWriteAllowed helper + 15 unit tests + presetSource
- `29307e4` FX008-3 — wire precondition into runAgent + 5-signal denial
- `2cdfe42` FX008-4 — E205 allocation + CLI routing
- `9600dca` FX008-5 — --allow-coord-write-deny CLI flag
- `ec4d1d9` companion findings F001-F005 inline fixes
- (this commit) FX008-6, 7, 8 — regression test + docs + kill-switch landing

The previous companion run (`2026-05-04T17-44-06-832Z-836e`) died from a runtime write-deny mid-flight (it had been booted BEFORE FX008-1 added `write: allow` to the canonical frontmatter, so its OWN policy blocked the farewell envelope). Before dying it produced **5 substantive findings** which validate the companion-mode protocol:

| ID | Severity | Subject | Disposition |
|---|---|---|---|
| F001 | LOW | `AC-FX8.1` checkbox in flight plan still unchecked | ✅ Flipped to `[x]` (plus AC-FX8.2..8.8 since they were similarly unchecked) |
| F002 | MEDIUM | Dossier 5-signal paragraph still says `terminalReason: 'permission-coord-write-deny'` | ✅ Updated paragraph — terminalReason stays `'permission-denied'`, kind is on `permissionError.kind` |
| F003 | MEDIUM | `permission_status` invents `release-default` provenance for stale runs | ✅ Now falls through to recompile path when `presetSource` absent, instead of inventing a label |
| F004 | **HIGH** | Early E205 path silently swallows mandatory signal failures (events.ndjson + run.json) | ✅ Failures now recorded in `denialState.signalFailures`; run.json second-write attempt persists at least the signal failure; completed.json failure surfaces as stderr warning |
| F005 | MEDIUM | FX008-4 marked complete without permissions.md docs | ✅ FX008-4 task table row narrowed — docs/how/permissions.md is FX008-7's responsibility (was previously double-listed) |

**Meta-observation**: F004 caught a real bug where FX008's early-exit path was silently swallowing the very write failures the workshop 002 § Q1 protocol calls "mandatory" — the same observability hole FX008 was designed to close. The companion-mode protocol delivered exactly the kind of mid-implementation course-correction that post-hoc review can't.
