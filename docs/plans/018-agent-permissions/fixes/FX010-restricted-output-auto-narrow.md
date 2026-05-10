# FX010 — `restricted` preset + `$MINIH_OUTPUT_PATH` auto-narrowing

**Created**: 2026-05-04
**Status**: PROPOSED — DEFERRED (post-FX008; separate spec conversation)
**Plan**: 018-agent-permissions
**Source**: GitHub issue [#25](https://github.com/AI-Substrate/minih/issues/25), suggested fix #1 ("Allow targeted write to `$MINIH_OUTPUT_PATH` in the `restricted` preset"); split out from FX008 per Chainglass agent's recommendation 2026-05-04 ("This is a different design conversation").
**Domain(s)**: runner/permissions (preset semantics + fs-guard allowedRoots injection)

---

## Problem

After FX008, coordinated agents that need to write `output/report.json` must declare `write: allow` in their frontmatter overrides — a global write-allow scope. The override is broader than the actual contract requires: a coordinated agent's only legitimate write target IS `$MINIH_OUTPUT_PATH` (`<runDir>/output/`), which is already enforced by the runner's run-folder isolation.

**The result**: `restricted` (security-by-default) is unusable for the most common coordinated-agent shape (companion-mode), forcing operators to choose between (a) `read-only` + `write: allow` override (works but wider than necessary) or (b) `trusted` (much wider than necessary). Neither expresses the true intent: "deny writes everywhere except the run's own output directory."

## Proposed Fix

Make `restricted` preset implicitly include the run-local `output/` directory in its `allowedRoots` set when the run is `coordination: enabled`. The `decisions.write` value stays `'deny'` at the policy layer; instead, fs-guard's allowedRoots check intercepts each write attempt and:

- ALLOW writes whose canonical path lies under `<runDir>/output/`.
- DENY writes anywhere else — same as restricted today.

Effect: `restricted` becomes "deny writes everywhere except the canonical envelope target", which matches the documented contract semantically and aligns with the security posture the preset name implies.

## Scope (sketch — full scope locked at plan-3 time)

### Preset semantics

Today (`src/runner/permissions/presets.ts:53-67`): `restricted = { write: 'deny', ... }`. After FX010, it remains `write: 'deny'` at the policy-record layer; the change is in fs-guard's resolution.

### fs-guard allowedRoots injection

Add a runner-side path injector that prepends `<runDir>/output/` to `allowedRoots` whenever **ALL FOUR** conditions hold:
1. `definition.coordination?.enabled === true`, AND
2. The resolved preset is one of `restricted` / `read-only` / `network`, AND
3. **The operator hasn't *explicitly* set `allowedRoots` in their frontmatter** (presence check, not overlap check). When `allowedRoots` is explicitly present in frontmatter — *even as an empty array `[]`* — skip auto-injection entirely. Operator's explicit declaration is authoritative; their `allowedRoots: []` means "I want strict-no-output", and FX008's precondition will (correctly) fire to surface the misconfiguration. AND
4. After (3) passes, no existing canonicalized allowedRoot already resolves to `<runDir>/output/` (no double-add). **Path comparison MUST use canonicalized paths** — call `fs.realpathSync.native(root)` on each existing entry (best-effort; fall back to `path.resolve(root)` when the path doesn't yet exist) before comparing against `path.resolve(runDir, 'output')`. Symlink-resolved overlap (e.g. macOS `/var` → `/private/var`) MUST be detected.

Provenance: stamp `runJson.permissions.coordOutputAutoAllowed = true` so it's visible in post-mortem inspection.

### Out of scope for FX010

- Loosening `restricted` for non-coordinated agents.
- Auto-allowing writes outside `output/` (e.g. `state/`, `inbox/` — those are MCP-mediated, not direct-fs writes).
- Removing the FX008 boot precondition. FX010 _replaces_ the need for the `write: allow` override on the canonical companion (the policy-layer `decisions.write === 'deny'` no longer means "no writes at all" for coord-enabled runs); FX008 still fires for coord-enabled agents that resolve to non-restricted-family presets with `write: deny` (e.g. `build-only` future variants).

### Forward-compat with FX008

After FX010, FX008's trigger needs refinement: instead of `decisions.write === 'deny'`, gate on "no path under `<runDir>/output/` is writable". For restricted-family presets after FX010, that condition is FALSE (output/ is allowed via the auto-injected allowedRoot) so FX008 doesn't fire; for any other preset that locks down output/ entirely, FX008 still fires. Implementation note: replace direct `decisions.write` check with a `canWriteUnderOutput(resolvedPolicy, runDir)` helper.

## Domain Impact

| Domain | Relationship | What Changes |
|--------|-------------|-------------|
| `runner/permissions/presets` | semantic refinement | `restricted` preset gets a comment block explaining the coord-enabled exception |
| `runner/permissions/compile` | inject auto-allowed root | New `injectCoordOutputRoot()` step in `compile()` after `canonicalizeRoots` |
| `runner/permissions/fs-guard` | unchanged (it already allowedRoots-checks) | The injection happens upstream in `compile()`; fs-guard sees a normal allowedRoot and enforces it |

## Tasks (preliminary — to be ratified at plan-3 time)

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|--------|-----|------|--------|---------|-----------|-------|
| [ ] | FX010-1 | Add `injectCoordOutputRoot()` helper. | runner/permissions | `src/runner/permissions/compile.ts` | Helper takes `(presetName, coordEnabled, runDir, existingRoots)` and returns the augmented allowedRoots list with provenance entry `{source: 'auto-coord-output', root: '<runDir>/output'}` | Pure function; no IO; tested in isolation |
| [ ] | FX010-2 | Wire injector into `compile()`. | runner/permissions | `src/runner/permissions/compile.ts:106-109` | Called after `canonicalizeRoots`; only fires for `coord-enabled + restricted-family preset`; idempotent if operator already added `<runDir>/output/` explicitly | Workshop 001 § Q5 allowedRoots composition contract preserved |
| [ ] | FX010-3 | Stamp provenance in `run.json`. | runner | `src/runner/runner.ts` after `compile()` | `runJson.permissions.coordOutputAutoAllowed: true` field; visible in `minih status` JSON envelope | Forward-compat: optional field, absent for non-coord runs |
| [ ] | FX010-4 | Refine FX008 precondition trigger. | runner/permissions | `src/runner/permissions/coord-write-precondition.ts` | Replace `decisions.write === 'deny'` with `!canWriteUnderOutput(policy, runDir)`; FX008 still fires for true write-deny situations (e.g. `read-only` preset WITHOUT FX010 enabled — backward compat for any future variant) | Cross-FX dependency — FX010 depends on FX008 lapping; FX008 trigger refinement happens in this fix |
| [ ] | FX010-5 | Tests. | runner-tests | `test/runner/permissions/coord-output-injection.test.ts` (new) | (a) coord-on + restricted → output/ in allowedRoots; (b) coord-off + restricted → output/ NOT in allowedRoots; (c) coord-on + trusted → no injection (allowedRoots semantics unchanged); (d) coord-on + restricted + operator-added explicit `output/` → no double-add; (e) coord-on + restricted + explicit `allowedRoots: []` in frontmatter → auto-injection suppressed (escape hatch honored); FX008 precondition fires (no writable output path); (f) coord-on + restricted + operator allowedRoot that resolves to `<runDir>/output` via symlink → no double-add (canonicalization works) | Cover the six-cell matrix; (e) and (f) are required to pin the CRITICAL-fix logic |
| [ ] | FX010-6 | CHANGELOG + permissions.md update. | docs | `CHANGELOG.md`, `docs/how/permissions.md` § Coordinated agents | Document the auto-injection; note that FX008 + FX010 together obviate the need for `write: allow` override in canonical companion (Track A from FX008 stays for forward-compat with non-coord workflows) | Cross-link from `companion-mode.md` |

## Workshops Consumed

- **Workshop 001 § Q5** (allowedRoots composition) — defines the canonicalization rules; FX010 adds a NEW source layer (`auto-coord-output`) to the composition order.
- **Workshop 002 § Q1** (5-signal denial protocol) — unchanged; FX010 is about preventing the denial from firing for legitimate envelope writes, not changing the denial behavior.

## Acceptance (preliminary)

- **AC-FX10.1**: Coordinated runs under `restricted` preset can write to `<runDir>/output/` without explicit `write: allow` override.
- **AC-FX10.2**: Writes to ANY OTHER PATH from a coordinated run under `restricted` still fire the 5-signal denial.
- **AC-FX10.3**: Non-coordinated runs under `restricted` are unaffected (no auto-injection).
- **AC-FX10.4**: Provenance is recorded in `run.json` (`permissions.coordOutputAutoAllowed: true`) and surfaced in `minih status`.
- **AC-FX10.5**: FX008 precondition correctly handles the post-FX010 case (no false fires when `restricted` + coord-enabled — output/ is now writable).
- **AC-FX10.6**: When operator frontmatter explicitly sets `allowedRoots: []` (or any explicit value), auto-injection is suppressed entirely; FX010-5 case (e) asserts `output/` is NOT in the resolved `allowedRoots` and FX008 precondition fires.
- **AC-FX10.7**: Allowed-root overlap detection uses canonicalized paths (`fs.realpathSync.native` with `path.resolve` fallback) — symlinked roots that resolve to `<runDir>/output` are detected as overlap; FX010-5 case (f) asserts no double-add.

## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Operator confusion: "I declared `restricted` but writes succeed?" | Medium. | Provenance in `run.json`; `minih status` surfaces `coordOutputAutoAllowed: true`; permissions.md documents the rule explicitly. |
| Tightly-coupled tests asserting exact `allowedRoots` length break. | Low. | Test the SHAPE (`output/` is in there) not the size. |
| Future feature decides `restricted` should NOT include output/ for some coord variant. | Low. | Override is one frontmatter line: `permissions.allowedRoots: [<explicit list excluding output/>]`. |

## Out of scope

- **Auto-narrowing for `state/`, `inbox/`** — those are MCP-mediated, not direct-fs writes. The MCP server's `inbox_send` / `state_set` tools are gated by `decisions.mcp` not `decisions.write`.
- **Auto-narrowing for `events.ndjson`, `run.json`** — runner writes those, not the agent. They run with full file-system trust under the runner process.
- **Per-run override of the auto-injection** — if an operator wants strict-no-output, they can manually set `permissions.allowedRoots: []` (empty list). The presence-check at trigger condition 3 detects this and skips auto-injection. FX008's precondition then fires correctly (because policy now denies writes everywhere), surfacing the operator's intent as the same actionable error path. Escape hatch behavior is anchored by AC-FX10.6 + FX010-5 case (e).

## Testing approach

- **Unit tests** (FX010-1, FX010-5): pure-function tests against `compile()` outputs.
- **Integration test**: synthetic coord-enabled run under `restricted` writes `output/report.json` successfully + write to `/tmp/foo` denied → 5-signal protocol fires.
- **Backward-compat test**: existing FX001-FX007 acceptance tests still green.

## Dependencies

- **Depends on FX008** for the precondition refinement (FX010-4). FX010 cannot ship before FX008 lands the precondition surface.
- **Independent of FX011 / FX012**.

## Discoveries & Learnings

_Populated during implementation by plan-6._

| Date | Task | Type | Discovery | Resolution |
|------|------|------|-----------|------------|

---

## Validation Record (2026-05-04)

| Agent | Lenses Covered | Issues | Verdict |
|-------|---------------|--------|---------|
| Source-Truth (Sonnet 4.6) | Factual Accuracy, Hidden Assumptions | 0 CRIT, 0 HIGH (FX010-specific), 0 MED, 1 LOW (preset line range — corrected inline) | ✅ |
| Cross-Reference (Sonnet 4.6) | Integration & Ripple | 0 CRIT, 0 HIGH, 0 MED, 0 LOW | ✅ |
| Completeness (Sonnet 4.6) | Edge Cases, Hidden Assumptions, Technical Constraints | **1 CRIT** (escape-hatch contradicts trigger), 1 HIGH (symlink canonicalization), 1 MED (test case missing) — all fixed inline | ❌ → ✅ |
| Forward-Compatibility (Opus 4.7) | Forward-Compatibility, Technical Constraints | 0 CRIT, 0 HIGH, 0 MED, 0 LOW | ✅ |

### Forward-Compatibility Matrix

| Consumer | Requirement | Failure Mode | Verdict | Evidence |
|----------|-------------|--------------|---------|----------|
| plan-6 FX010 implementer | trigger spec internally consistent (escape hatch reachable) | shape-mismatch | ✅ | After CRITICAL fix: trigger condition 3 now uses presence-check; condition 4 uses canonicalized overlap; AC-FX10.6 anchors escape hatch |
| FX008 cross-FX integration | FX010 builds on FX008's helper without API break | encapsulation-lockout | ✅ | FX010-4 references FX008's `coord-write-precondition.ts` (FX008-2 commits to `runDir?` in options bag) |

**Outcome alignment**: FX010 advances *"Safety-by-default for agents; trust ladder for installed packs; credible answer to 'what can this agent do to my machine?'"* by adding a coord-safe rung to the trust ladder — `restricted` becomes semantically usable for the most common coord shape (companion-mode) without requiring operators to broaden the write-allow scope to the entire filesystem; the security posture matches the contract precisely (deny everywhere except `<runDir>/output/`).

**Standalone?**: No — depends on FX008 and references issue #25 design conversation.

### Fixes applied (CRITICAL + HIGH + MEDIUM)
- COMPL-1 (CRIT) fixed: trigger condition split into presence-check (condition 3) and canonicalized-overlap-check (condition 4); `allowedRoots: []` escape hatch is now reachable; AC-FX10.6 anchors
- COMPL-2 (HIGH) fixed: symlink canonicalization spec — `fs.realpathSync.native` with `path.resolve` fallback; AC-FX10.7 + FX010-5 case (f) anchors
- COMPL-3 (MED) fixed: FX010-5 case (e) added — explicit `allowedRoots: []` test

Overall: ⚠️ **VALIDATED WITH FIXES** — 1 CRIT + 1 HIGH + 1 MED resolved inline; dossier was previously NOT IMPLEMENTABLE; now ready (when FX008 lands) for `/plan-6-v2-implement-phase --fix FX010`.
