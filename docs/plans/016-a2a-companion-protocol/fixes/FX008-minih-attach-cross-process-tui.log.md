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

### FX008-5/6/7 — run.ts + resume.ts + view.ts migrations (DONE 2026-05-02)

**Diff summary**:
- `src/cli/commands/run.ts`: imports `coordinationRunLocation`; bridge is constructed with `runDir`, `agentSlug`, `coordinated` from new ctx fields, plus `location` only when `coordinated`. `commandName: 'human-tui.input'`.
- `src/cli/commands/resume.ts`: identical wiring.
- `src/cli/commands/view.ts`: loads `AgentDefinition` to read `coordination?.enabled`. Bridge gets `attached: true`, no `sender`, no `location` (so capability is always read-only).

**Discovery**: `AgentDefinition.coordination` is already a public, parsed field in `runner/types.ts:41` — no need to re-read frontmatter from disk.

### FX008-8/9 — `attach.ts` NEW + CLI registration (DONE 2026-05-02)

**Diff**:
- `src/cli/commands/attach.ts` (NEW, ~230 lines). Mirror of view.ts with three diffs: (1) bridge mounted with `attached: true` + `coordinated` + optional `location`; (2) `commandName: 'attach.input'`; (3) detach message phrasing: `[detached at <runId> — agent continues. To re-attach: minih attach <slug> --run <runId>]`. Reuses view.ts exit-state guard verbatim (the Ctrl-C-detaches-never-kills invariant is encoded by NOT signalling another process).
- `src/cli/index.ts`: imports + calls `registerAttachCommand(program)`.

**Verification**: `minih attach --help` renders with the Ctrl-C-detaches help text. `--read-only` flag withholds `location` so coordinated runs fall back to read-only by operator opt-in.

**Resolver choice**: attach uses `latest-active` only — no fallback to completed runs. Attach's value proposition is the live write path; for completed-run inspection use `view`.

### FX008-10 — capability table tests (DONE 2026-05-02)

**Diff**: `test/cli/human-input-bridge.test.ts` extended from 12 → 25 tests. Five new rows for the workshop §4.4 capability table; six `synthesiseSubject` edge cases. Filesystem assertions read `inbox/outside/messages.ndjson` and verify ULID, sender, type, subject, body. Covered the defensive cases too: coord without `location` falls back to `'input → session'` (when sender exists) or `'input read-only — non-coordinated'` (when neither).

**Discovery**: the on-disk inbox path is `runs/<id>/inbox/<lane>/messages.ndjson` (a directory per lane), NOT `runs/<id>/inbox/<lane>.ndjson`. First test attempt looked at the wrong path; fixed quickly.

### FX008-12 — FX001 SUPERSEDED (DONE 2026-05-02)

Added top-of-file SUPERSEDED header to `FX001-tui-input-routes-to-inbox.md` with cross-link to FX008.

### FX008-13 — Docs updates (DONE 2026-05-02)

`AGENTS.md` updates:
- Companion-mode-mandatory section gains a one-line `minih attach` mention (after the existing `minih view` mention).
- Dogfood-rule equivalence table grows two new rows: "Watching a run live (read-only)" → `view`, "Following AND chiming in" → `attach`.

**Out of scope (deferred)**:
- FX003's `docs/how/driving-an-agent-from-outside.md` doesn't exist yet → attach section will be added when FX003 lands. Already noted in the dossier as conditional.
- `--human` footer hint string explicitly: deferred because FX008-4's capability label (`[ input → inbox ]` / `[ input → session ]`) is self-documenting.

### FX008-14 — `just fft` clean (PARTIAL — pipeline green, companion farewell pending)

`just fft` ran clean: 716 passed | 10 skipped (pre-existing skips), 0 vulns, SDK 0.3.0 latest. Pre-commit linter found 5 formatting nits in the new test file; auto-fixed via `npx biome check --write`. Pipeline now green.

Remaining: send `control:stop` to companion, capture farewell, fold any open findings into final summary. FX008-11 (e2e test) deferred — see Discoveries.



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

