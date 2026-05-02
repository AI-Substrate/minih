# Execution Log — FX008: `minih attach` cross-process read+write TUI

**Fix**: [FX008 dossier](./FX008-minih-attach-cross-process-tui.md)
**Started**: 2026-05-02T13:18Z
**Companion**: code-review-companion run `2026-05-02T12-29-45-055Z-6ab1`

## Pre-flight context

- Test approach: per-task unit tests in `test/cli/human-input-bridge.test.ts` for capability table (FX008-10); separate e2e at `test/e2e/attach-cross-process.test.ts` gated by `MINIH_E2E=1` (FX008-11).
- Domain: `cli` primary, `runner` additive. No cross-domain violations expected — `appendInboxMessage` and `buildOutsideMessage` already public in cli-domain.
- Companion briefed on lifecycle ownership invariant + `CoordinationRunLocation` requirement + wake-assertion test boundary.

## Tasks

### FX008-1 — runner ctx widening (DONE 2026-05-02)

**Diff**: `src/runner/types.ts` (`OnSessionReadyContext` gained `coordinated: boolean` + `agentSlug: string`); `src/runner/runner.ts:704` callsite passes them.

**Evidence**: `npx vitest run test/runner/runner.test.ts test/runner/runner-event-driven.test.ts` → 27/27 green. Existing callers (`run.ts:222`, `resume.ts:509`, runner-event-driven test sites) ignore the new fields harmlessly because they only destructure `ctx.runDir`/`ctx.runId`.

**Discoveries**:
- `coordinationEnabled` was already computed at `src/runner/runner.ts:350` and `definition.slug` was already in scope at line 700; no extra plumbing needed.
- The adapter-level `onSessionReady` (`src/adapter/events.ts:46`) is a DIFFERENT signature `(sender) => void` — not affected by this change. Only the runner-level `AgentRunConfig.onSessionReady` widened.

### FX008-2 + FX008-3 + FX008-4 — Bridge widening, write path, footer rendering (DONE 2026-05-02)

Bundled because the typecheck couples them: widening `InputCapability` forces the exhaustive switch in `header.tsx` to migrate, which forces `footer.tsx` to migrate, which forces existing tests to migrate. Doing all four in one coherent commit keeps the build green at every step.

**Diff summary**:
- `src/cli/human/input-bridge.ts`: rewritten. `InputCapability` is now 5 values (`'input → inbox' | 'input → session' | 'input read-only — non-coordinated' | 'input read-only — completed' | 'completed'`). `InputBridgeInput` gains optional `runDir`, `agentSlug`, `coordinated`, `location: CoordinationRunLocation`, `commandName`. `createInputBridge` resolves capability by the 5-row table; `'input → inbox'` writes through `appendInboxMessage` + `buildOutsideMessage`. New helper `synthesiseSubject` (60-char last-word-boundary trim).
- `src/cli/human/panes/footer.tsx`: `canType` and `capColor` updated to match new enum.
- `src/cli/human/panes/header.tsx`: `colorForCapability` exhaustive switch updated.
- `test/cli/human-input-bridge.test.ts`: 12 tests migrated to new strings.

**Evidence**:
- `npx tsc --noEmit` — 0 errors.
- `npx vitest run test/cli/human-input-bridge.test.ts` — 12/12 passed.
- `npx vitest run test/cli/` — 140 passed | 4 skipped (pre-existing skips, no regressions).

**Discoveries**:
- Workshop §4.3 type def includes `runDir`/`agentSlug`/`coordinated` as REQUIRED; making them OPTIONAL in the implementation lets callers in `run.ts`/`resume.ts`/`view.ts` continue compiling unchanged before FX008-5/6/7 wire them. Capability resolution treats missing fields as "non-coordinated" — same observable behaviour as today's `view`. **Trade-off**: the 5-row capability table promised by the workshop is only fully reachable after FX008-5/6/7/8 land. The bridge alone is correct; the wire-up is the consumer's job.
- The practical handle for inbox writes is `CoordinationRunLocation = { slug, agentsDir, runId }`, not just `runDir`. Added `location` to the input shape so callers do the resolution once (matches the pattern at `src/cli/commands/outside.ts:548-554`). `runDir` and `agentSlug` are kept on the input for traceability/future use.
- The legacy `'completed'` capability is preserved in the union but no longer produced by `createInputBridge` — kept for forward source-compat in case any downstream consumer literal-matches it. Internal callers all migrated to the new strings.

