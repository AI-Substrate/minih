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
- AC-FX8.10 (kill-switch banner + bypass): ✅ — covered by test (h) + (h-true) + (h-other).
