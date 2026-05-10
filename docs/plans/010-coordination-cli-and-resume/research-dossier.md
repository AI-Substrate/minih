# Research Report: Coordination CLI + Resume

**Generated**: 2026-04-28
**Research Query**: "CLI lane restructure + blocking inbox + resume-in-place — research the existing CLI/MCP/runner surface to inform plan 010"
**Mode**: Pre-Plan (auto-detected — created plan folder `010-coordination-cli-and-resume`)
**Location**: `docs/plans/010-coordination-cli-and-resume/research-dossier.md`
**FlowSpace**: Not used (focused 4-agent narrow scope; codebase already well-known)
**Findings**: 42 (12 IA + 12 MM + 12 RL + 6 DB + 10 PL — synthesized below)

---

## Executive Summary

### What plan 010 is

Three coupled CLI/runner improvements that together unblock pipelined human↔agent coordination as a daily-driver workflow:

- **HF-001 — Blocking inbox**: expose `--wait <ms>` (default 5 min) on `outside-inbox-list` so operators stop loop-polling with `sleep 15`. The inside MCP `inbox_list` already has bounded long-poll machinery — the fix is *exposure*, not invention.
- **HF-002 — Lane subcommand restructure**: `minih outside <verb> <slug>` and `minih inside <verb> <slug>` subcommand trees per Workshop 008. The flat `outside-*` prefix today is genuinely misleading (it means "called from outside" but `outside-inbox-list` reads the *inside* lane).
- **HF-003 — Resume-in-place**: `minih resume` should reuse the original run dir + SDK sessionId (so coordinated agent inbox/state continuity isn't lost on restart) + accept an optional structured resume prompt distinct from a user follow-up turn.

### Business purpose

Plan 009's Run 001 dogfood exposed three concrete harness gaps that hurt every coordinated-agent workflow. Each gap was experienced live, documented in `EXPERIMENT-LOG.md` (HF-001/002/003), and confirmed against source code. Plan 010 closes them so Run 002 of the experiment (and Phase 2's Ink TUI) operate on solid ground.

### Key insights

1. **The hard machinery already exists.** `waitForMatchingMessages` (file-watch + debounced re-read + single-settle cleanup) in `src/mcp/tools/inbox.ts:108-194` is exactly what HF-001 needs to expose. Extract upward into runner; CLI and MCP both consume.
2. **CLI grouping pattern is already proven.** `src/cli/commands/state.ts:47-83` is the model for `minih outside <verb>`. New parent `Command`, register verbs underneath, dotted envelope `command` strings (`outside.inbox.send`).
3. **Resume is the load-bearing change.** It's not a flag tweak — it's a new code path before `createRunFolder()` in `src/runner/runner.ts:245-268`. Today every invocation creates a fresh run dir unconditionally. HF-003 must intercept that for the in-place case while preserving the existing "fresh dir" path as an opt-out.
4. **No alias/deprecation pattern exists yet.** HF-002's one-release deprecation aliases will be a new mechanism — small, but it has no precedent to copy.
5. **Long-poll testing pattern is already proven.** `test/mcp/inbox.test.ts:190-260` writes real files mid-wait, races against the promise — that's the harness for the new outside CLI tests.

### Quick stats
- **Components**: 22 CLI command files; ~5 runner files (folder, runner, file-watcher, inbox-forwarder, manifest); 3 MCP files (tools/inbox, tools/state, types)
- **Dependencies**: `cli → mcp → runner → adapter` (one-way; runner cannot import mcp — important for the polling extraction direction)
- **Test coverage**: existing CLI commands shell out via `execSync` against `dist/cli/index.js`; long-poll tests use real fs writes during `setTimeout`
- **Complexity**: Medium overall. HF-001 is small (1-2 days of focused work). HF-002 is broad-touch but mechanical (Commander rewire + alias layer + agent-prompt sweep). HF-003 has the deepest plumbing change.
- **Prior learnings**: 10 (PL-01 through PL-10 — all from plans 008/009)
- **Domains**: 3 modified (cli, mcp, runner); 1 new contract (runner.pollInboxLane)

---

## How It Currently Works

### Entry points

| Entry point | Type | Location | Purpose |
|------------|------|----------|---------|
| Root command tree | Commander | `src/cli/index.ts:68-88` | Flat registration of every command — no `outside`/`inside` parent today |
| `outside-send` | CLI | `src/cli/commands/outside-send.ts` | Write to outside inbox lane (operator-owned) |
| `outside-inbox-list` | CLI | `src/cli/commands/outside-inbox-list.ts` | Read INSIDE inbox lane (replies) — **misleading prefix** |
| `state get/set/transition` | Subcommand group | `src/cli/commands/state.ts:47-83` | The only existing parent-command pattern in minih |
| `resume` | CLI | `src/cli/commands/resume.ts:116-194` | Send follow-up to *completed* session; allocates new run dir |
| Inside `inbox_list` (MCP) | MCP tool | `src/mcp/tools/inbox.ts:46-194` | Long-poll primitive (`waitMs` + `waitForAny`) — what HF-001 will expose |

### Core execution flow — Inside MCP `inbox_list` long-poll (the primitive HF-001 must share)

```
┌─────────────────────────────────────────────────────────────────────┐
│ inbox_list({ waitMs })  ─ src/mcp/tools/inbox.ts:46-63              │
│   1. listVisibleMessages() — synchronous filtered read              │
│   2. if waitMs == 0 OR immediate.length > 0 → return now            │
│   3. else await waitForMatchingMessages()                           │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│ waitForMatchingMessages()  ─ inbox.ts:108-194                        │
│   • watchFileChanges(parentDir, onChange) ── runner/file-watcher    │
│   • setTimeout(timeoutFn, waitMs)                                    │
│   • settle() is idempotent: clearTimeout + watcher.close()          │
│   • on watch event → re-read → if filtered.length > 0 → resolve     │
│   • on timeout → resolve with matched: false                         │
│   • on watch error → reject MCP_INTERNAL_ERROR                       │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Filter chain (applied on every read)  ─ inbox.ts:79-98              │
│   unread → type → waitForAny → after  (in this order)               │
│   nextAfter watermark only set if more visible beyond limit         │
└─────────────────────────────────────────────────────────────────────┘
```

**Critical for HF-001**: This entire stack is fs-driven and watch-based, not interval-polling. The `MAX_INBOX_WAIT_MS = 30000` cap is enforced in `normalizeWaitMs` (`inbox.ts:461-475`) AND in the schema (`types.ts:207-213`). Raising the outside-CLI ceiling to 5 min requires either a new constant or a separate validation path.

### Core execution flow — `resume` today

```
minih resume <slug> [message] [--run <runId>]
        │
        ▼
findRunSession(slug, agentsDir, runId?)  ─ runner/folder.ts:552-607
   • If --run: look up that specific run dir
   • Else: scan runs/ for entries with completed.json + sessionId, pick latest
   • Returns { sessionId, runId, runDir }
        │
        ▼
Build AgentRunConfig with sessionId + resumedFromRunId + promptOverride
        │
        ▼
runAgent(adapter, definition, config)  ─ runner/runner.ts:245-268
   • createRunFolder(definition) — UNCONDITIONALLY allocates new runId/runDir
   • writeManifest(runDir, initialManifest) — fresh run.json
        │
        ▼
SDK adapter — adapter/sdk-copilot.ts:53-70
   • sessionId ? client.resumeSession(sessionId) : client.createSession()
   • Reattaches to the prior conversation
        │
        ▼
Send follow-up — adapter/sdk-copilot.ts:141-149
   • session.send({ prompt: message })  — plain user turn, no system framing
        │
        ▼
Inside MCP env vars derived from NEW runDir
   • MINIH_INBOX_DIR / MINIH_STATE_DIR point to new run's coordination tree
   • Old run's inbox/state are NOT seen by the resumed session
```

**The HF-003 problem in code**: SDK session reuse works perfectly. The break is in `runAgent` always calling `createRunFolder()` and re-deriving MCP env vars from the new dir. If the old run had coordinated state (inbox messages, state history), it's stranded.

---

## Architecture & Design

### Component map (relevant to plan 010)

| Component | Location | Owner | Responsibility |
|-----------|----------|-------|---------------|
| Root CLI | `src/cli/index.ts` | cli | Command registration tree |
| Commander subcommand pattern | `src/cli/commands/state.ts` | cli | Reference impl for `minih outside <verb>` / `minih inside <verb>` |
| JSON envelope | `src/cli/output.ts:26-76` | cli | `{command,status,timestamp,data,error}` + `exitWithEnvelope` |
| Active-run resolver | `src/cli/coordination.ts:205-260` | cli | E108 multiple-runs resolution — reuse for `--wait` |
| Inside MCP long-poll | `src/mcp/tools/inbox.ts:46-194` | mcp | The primitive to extract upward |
| File watcher | `src/runner/file-watcher.ts:42-139` | runner | Parent-dir `fs.watch` + debounce — already used by inbox-forwarder + MCP |
| Run folder lifecycle | `src/runner/folder.ts:124-168, 552-607` | runner | `inboxLanePath`, `stateFilePath`, `findRunSession` |
| Run creation | `src/runner/runner.ts:245-268` | runner | Where HF-003 must intercept |
| MCP env handoff | `src/runner/runner.ts:360-395` | runner | Where HF-003 must rebind to original run dir |
| SDK adapter | `src/adapter/sdk-copilot.ts:53-149` | adapter | `resumeSession`, plain `send({prompt})` — no system-message path today |
| Manifest lifecycle | `src/runner/run-manifest.ts` (+ `runner.ts:251-268, 430-438, 724-737`) | runner | Per-run `run.json` create/update/finalize |

### Patterns identified

1. **Commander parent-child subcommand grouping** (`state.ts:47-83`) — clone for `outside`/`inside` parents.
2. **JSON envelope with dotted command names** (`state.get`, `state.set`, `state.transition`) — mirror as `outside.inbox.send`, `inside.inbox.list`, etc.
3. **Stdout JSON / stderr human + warnings** (`output.ts:69-76`) — deprecation warnings belong on stderr only.
4. **`assertOutsideContext` preAction guards** (`run.ts:41-53`, `resume.ts:38-50`, etc.) — symmetric inside-context check would be useful for the new `inside <verb>` tree.
5. **Real-fs long-poll testing** (`test/mcp/inbox.test.ts:190-246`) — schedule writes mid-wait, race against promise.
6. **Watch-based file change** (`runner/file-watcher.ts`) — parent-dir `fs.watch`, debounce, filename filter, null-name conservative behavior.
7. **`isResume` skips preamble** (`runner.ts:339-358`) — resume sends only the message, not the system framing. This is where a structured resume prompt would slot in.

### System boundaries

- **`cli → mcp`**: CLI shells out to MCP server via spawn (`src/mcp/spawn.ts`). CLI does **not** import MCP source (so HF-001's polling extraction must end up in `runner`, not `mcp`, if both CLI and MCP are to consume it).
- **`mcp → runner`**: MCP tools call `inboxLanePath`, `coordinationRunLocation`, `readStateLazy`, etc. — runner is the shared substrate for both lanes.
- **`runner → adapter`**: runner invokes adapter for SDK session lifecycle. No reverse imports.

---

## Dependencies & Integration

### What plan 010 depends on (existing reusable surface)

| Dependency | Type | Purpose | Risk if changed |
|------------|------|---------|-----------------|
| `runner/file-watcher.ts` `watchFileChanges` | Required | The polling primitive HF-001 uses | LOW — already battle-tested by inbox-forwarder + MCP |
| `mcp/tools/inbox.ts` `waitForMatchingMessages` + `listVisibleMessages` | Required | The exact algorithm to extract upward | MEDIUM — extraction must preserve filter chain order, settlement semantics, error mapping |
| `cli/coordination.ts` active-run resolver | Required | Resolve `--run` or single-active-run for `--wait` | LOW — pure resolver, easy to reuse |
| `cli/output.ts` envelope helpers | Required | Stdout JSON for new commands | LOW |
| `runner/folder.ts` `inboxLanePath`, `stateFilePath`, `findRunSession` | Required | Path resolution for both lanes | MEDIUM for HF-003 (resume-eligibility logic must extend to active/stale runs) |
| `runner/runner.ts` `createRunFolder`, MCP env setup | Required | Where HF-003 intercepts | HIGH — touches the load-bearing run lifecycle |
| `adapter/sdk-copilot.ts` `resumeSession`, `send` | Required | SDK session reuse already works | LOW for sessionId reuse; MEDIUM for structured resume prompt (no system-message path today) |

### What depends on plan 010 (downstream consumers)

- **Plan 009 Phase 2** (Ink TUI / human-agent view) — wants exactly these primitives. Will use `outside inbox list --wait` for "next reply" rendering, will use `resume --in-place` semantics for "reattach to a running agent".
- **All in-repo coordinated agents** (`code-review-companion`, `coordination-smoke-test`, `coordination-loop-validator`) — their `outside.md` files reference `outside-send` / `outside-inbox-list` / `state` flat names. One-release alias period prevents breakage; they should be updated in the same PR.
- **Experiment harness `option-a/b` prompts** — both reference flat names. Update in same PR.
- **Workshop 008** is the design source of truth — plan 010 implements it 1:1 plus HF-003 (which Workshop 008 mentions only in passing as a separate plan).

---

## Quality & Testing

### Current test coverage of the surface plan 010 touches

| Area | Coverage | Pattern |
|------|----------|---------|
| Inside MCP long-poll | Strong (`test/mcp/inbox.test.ts:190-260`) | Real fs writes during `setTimeout`, race against promise |
| CLI command surface | Solid (`test/cli/commands.test.ts:18-72`) | `execSync` against `dist/cli/index.js`, parse JSON stdout, assert help text contains command names |
| `state` subcommand group | Solid (`test/cli/state.test.ts:29-41`) | Same execSync pattern; subcommand tested via dotted invocation |
| `resume` | Light | No dedicated test file; covered indirectly via integration |
| File watcher | Solid (`test/runner/file-watcher.test.ts`) | Already tests debouncing, parent-dir watch, filename filter |
| Active-run resolver | Solid (E108 paths covered in `test/cli/state.test.ts` + `outside-inbox-list` tests) | Real fs run dirs, error envelope assertions |

### Test strategy for plan 010

- **HF-001**: extend `test/cli/outside-inbox-list.test.ts` (or create) with the long-poll pattern from `test/mcp/inbox.test.ts:190-246` adapted for CLI shell-out. Schedule a `outside-send` mid-wait. Assert envelope shape matches MCP (`wait.timedOut`, `wait.matched`).
- **HF-002**: extend help-text assertions in `test/cli/commands.test.ts:53-72` to assert new tree exists. Add per-verb tests under `outside.<verb>.test.ts` and `inside.<verb>.test.ts`. Add deprecation-warning stderr assertions for each alias.
- **HF-003**: hardest to test. Live SDK calls cost real money. Instead, unit-test the `findRunSession` extension (active/stale eligibility) + the `createRunFolder` bypass branch + the MCP env binding to original run dir. Integration test could be opt-in like `MINIH_E2E=1`.

### Known issues + tech debt that touch plan 010

- No alias/deprecation precedent exists — plan 010 invents the pattern (per IA-03).
- `findRunSession` only matches completed runs (per RL-03, RL-11). Active/stale matching is needed for "as if it didn't even stop". This is genuinely new behavior, not a tweak.
- No structured resume prompt path exists (per RL-06, RL-07). The SDK adapter sends only `{prompt}` — no system-message channel surfaced today. May require adapter API extension OR live with prompt-prefix convention (`"[SYSTEM RESUME]:\n..."`).
- Resume currently treats the resumed session as a *new run* with a `resumedFromRunId` backlink (per RL-12). HF-003's "same run" model is incompatible with that artifact pattern — must decide whether to mutate the original manifest or write a `resumed-at.ndjson` log line.

---

## Modification Considerations

### ✅ Safe to modify

1. **CLI tree (HF-002)** — Commander wiring is mechanical; the `state` group proves the pattern works. Help-text tests will catch surface drift.
2. **Adding `--wait` to outside-inbox-list (HF-001)** — purely additive; default 0 = today's behavior.
3. **`pollInboxLane` extraction to runner** — copy `waitForMatchingMessages` + `listVisibleMessages` upward; have MCP and CLI both call into it. Strict in-domain change.
4. **Stderr deprecation warnings** — additive; tests can assert their presence.

### ⚠️ Modify with caution

1. **Filter chain semantics** (`unread → type → waitForAny → after`) — the order matters; outside CLI's `--type` and `--unread` must produce identical results to inside MCP. Drift here would break the design promise that "inside and outside are symmetric".
2. **Settlement contract** (single-settle, idempotent cleanup) — preserve exactly. A regression here causes hung promises or double-resolve crashes.
3. **`MAX_INBOX_WAIT_MS`** — raising for outside CLI must NOT raise for inside MCP (agents shouldn't sit idle for 5 min). Two ceilings, one shared primitive. Probably parameterize the cap.
4. **Help-text contract** (`commands.test.ts:53-72`) — the test asserts specific command names. New names must be added; deprecated names can stay until removal release.

### 🚫 Danger zones

1. **`runAgent` run-folder allocation** (`runner.ts:245-268`) — the unconditional `createRunFolder` call is load-bearing. HF-003 must intercept BEFORE this without breaking the non-resume path.
2. **MCP env handoff timing** (`runner.ts:360-395`) — these vars are read by spawned MCP subprocesses at startup. If they bind to the wrong dir even momentarily, the inside agent sees the wrong inbox/state.
3. **SDK `resumeSession` race conditions** — what happens if a coordinated agent is still actively writing to its run dir (file watcher running) when resume tries to take it over? Today `resume` only matches *completed* sessions, so this race doesn't exist. HF-003 introduces it. Need a clean takeover protocol (probably: refuse to resume an `active` run; only resume `stale` or `completed`).
4. **Manifest lifecycle on resume-in-place** — does the original `run.json` get updated? Replaced? A new `run-2.json` written? Decide explicitly; document it.

### Extension points (already well-designed)

1. **Commander parent-child** — `program.command('outside').command('inbox').command('list')` works directly.
2. **`watchFileChanges`** — already accepts an `onChange` callback + debounce options; reusable as-is.
3. **`assertOutsideContext`** — symmetric `assertInsideContext` would slot into preAction hooks for inside lane CLI commands.

---

## Prior Learnings (From Previous Implementations)

### 📚 PL-01 — Operator polling pain confirmed live

**Source**: `docs/plans/009-human-agent-view/prompts/EXPERIMENT-LOG.md:69-79` (HF-001)
**Type**: friction (gotcha-equivalent in the experiment harness)
**What they found**: > *"No `--wait`; operator loop-polls with `sleep 15` to detect companion's `summary` reply. Inside MCP `inbox_list` already long-polls."*
**How resolved**: deferred to plan 010
**Why this matters now**: the canonical motivation for HF-001. The fix is exposure (no new mechanism).
**Action**: HF-001 is the smallest standalone shippable; do it first.

### 📚 PL-02 — Lane prefix is genuinely misleading

**Source**: `EXPERIMENT-LOG.md:69-79` (HF-002)
**What they found**: > *"`outside-*` prefix means 'called from outside' but `outside-inbox-list` reads the **inside** lane (replies). Misleading."*
**Why this matters now**: design rationale for HF-002. Don't try to "fix" the old name — restructure.
**Action**: lane-as-subcommand is the right shape. Aliases for one release.

### 📚 PL-03 — Resume-restart loses coordination context

**Source**: `EXPERIMENT-LOG.md:69-79` (HF-003)
**What they found**: > *"Creates a new run dir with fresh inbox/state instead of resuming in the original run dir."*
**Why this matters now**: HF-003 is a workflow fix, not cosmetic. Confirmed live during the FX001 dist-rebuild restart.
**Action**: resume-in-place must preserve the original run dir + SDK sessionId.

### 📚 PL-04 — Workshop 008 is the design source

**Source**: `docs/plans/009-human-agent-view/workshops/008-cli-lane-semantics-and-blocking-inbox.md`
**Why this matters now**: skip re-deriving the design — Workshop 008 already enumerates the lane tree, --wait semantics (default 5 min, max 5 min), error codes (E121/E122/E123/E124/E125), migration strategy (one-release aliases), and acceptance criteria.
**Action**: plan 010 implements Workshop 008 sections 1:1; HF-003 is the only addition not fully workshopped.

### 📚 PL-05 — Long-poll is already a proven primitive

**Source**: `docs/plans/008-canonical-coordination-loop/fixes/FX002-blocking-inbox-list.md:13-20, 80-87`
**What they found**: > *"inside agent had to invent sleep-poll loops… add optional wait parameter… `waitMs`…"*
**Why this matters now**: confirms the `waitMs` design has been validated for inside MCP for ~2 plans. Outside CLI just gets the same.
**Action**: don't redesign. Extract.

### 📚 PL-06 — Run-scoped artifacts are the foundation

**Source**: `docs/plans/008-canonical-coordination-loop/fixes/FX001-run-scoped-coordination-state.md:13-21, 63-67`
**What they found**: inbox/state/history live under `agents/<slug>/runs/<runId>/...` — all run-scoped.
**Why this matters now**: HF-003's "same run dir" implicitly preserves this — the inbox/state files don't move; the resume just reuses the existing dir. No re-architecture.

### 📚 PL-07 — Don't overclaim env-var handoff

**Source**: `docs/plans/008-canonical-coordination-loop/fixes/FX003-coordination-eval-ux-followups.md:13-23, 95-99`
**What they found**: shell visibility of `$MINIH_OUTPUT_PATH` is SDK/environment-dependent.
**Why this matters now**: when HF-003 rebinds MCP env vars to original run dir on resume, **document and verify** what the agent process actually sees, don't assume.

### 📚 PL-08 — Silent contract failures are dangerous

**Source**: `docs/plans/009-human-agent-view/fixes/FX001-coordination-tool-surface.md:15-18, 27-30`
**What they found**: state schema lookup ignored `state/` folder; ackOf was prompt-only — both shipped silently for plan 008.
**Why this matters now**: every plan 010 contract change (especially HF-002 aliases) needs **a real test** that proves the new and old names produce the same persisted artifacts. Don't trust verbal contracts.

### 📚 PL-09 — Tighten dogfood agents to verify-not-just-call

**Source**: FX001-7/-8 in same dossier
**Why this matters now**: when HF-001's `--wait` lands, the `coordination-smoke-test` agent should exercise it (with `outside-send` injecting mid-wait) and read back the resulting envelope. Pattern: every CLI primitive should have a smoke-agent step that verifies it end-to-end.

### 📚 PL-10 — The dogfood validated the need

**Source**: `docs/plans/009-human-agent-view/prompts/option-a/runs/001-fx001-baseline.md:57-87`
**What they found**: > *"The blocking inbox (HF-001) and CLI restructure (HF-002) and resume-in-place (HF-003) are real harness gaps surfaced by living the workflow."*
**Why this matters now**: plan 010 is grounded in lived experience, not speculation. Prioritize ruthlessly: HF-001 unblocks the next experiment; HF-003 unblocks the dist-rebuild loop; HF-002 is the polish.

### Prior Learnings Summary

| ID | Type | Source | Insight | Action |
|----|------|--------|---------|--------|
| PL-01 | friction | 009 EXP LOG | `--wait` missing on outside | HF-001 first |
| PL-02 | friction | 009 EXP LOG | `outside-*` is misleading | HF-002 restructure |
| PL-03 | friction | 009 EXP LOG | resume creates new run dir | HF-003 in-place |
| PL-04 | design | 009 WS 008 | Lane tree fully designed | Implement 1:1 |
| PL-05 | proven primitive | 008 FX002 | `waitMs` works | Extract, don't reinvent |
| PL-06 | invariant | 008 FX001 | Run-scoped artifacts | Preserve in HF-003 |
| PL-07 | gotcha | 008 FX003 | Env-var visibility varies | Verify in HF-003 |
| PL-08 | gotcha | 009 FX001 | Silent contract failures | Test alias parity |
| PL-09 | pattern | 009 FX001 | Verify-not-just-call | New CLI prim → smoke step |
| PL-10 | validation | 009 EXP LOG | Lived experience | Prioritize harshly |

---

## Domain Context

### Existing domains relevant to plan 010

| Domain | Relationship | Relevant contracts | Key components |
|--------|-------------|-------------------|----------------|
| `cli` | **modify** | Top-level command tree, JSON envelope, active-run resolver | All `src/cli/commands/*.ts`; new `outside` + `inside` parent commands; deprecation alias layer |
| `mcp` | **consume → modify** | `inbox_list` long-poll (extraction source); inputSchema constraints | `src/mcp/tools/inbox.ts` (lines 46-194 extract upward); `src/mcp/types.ts` (no top-level not/oneOf/anyOf) |
| `runner` | **add public contract** | `inboxLanePath`, `stateFilePath`, `findRunSession`, NEW `pollInboxLane` | `src/runner/folder.ts` (extend `findRunSession` for active/stale); `src/runner/runner.ts` (HF-003 intercept point); new `src/runner/inbox-poll.ts` |
| `adapter` | **consume — no change planned** | SDK `resumeSession`, `send` | Already supports sessionId reuse — HF-003 doesn't need adapter changes (unless we add structured resume prompt as system message) |

### Domain map position

```
cli ──┬──→ mcp ──→ runner ──→ adapter
      │              ▲
      └──────────────┘  (NEW: cli imports runner.pollInboxLane directly)
```

The new edge `cli → runner` (for `pollInboxLane`) is **already permitted** by the import direction rule (`cli → mcp → runner → adapter`). CLI may import runner. The change just makes the relationship explicit.

### Potential domain actions

- **Add new contract `runner.pollInboxLane`** to `docs/domains/runner/domain.md` § Contracts. Currently undocumented.
- **Update `docs/domains/cli/domain.md`** § History entry: lane subcommand restructure + `--wait` + resume-in-place.
- **Update `docs/domains/mcp/domain.md`** § Composition: note that `waitForMatchingMessages` is now consumed via the runner-side helper (not duplicated).
- **No new domain extraction needed** — plan 010 fits cleanly into existing topology.

---

## Critical Discoveries

### 🚨 Critical Finding 01: HF-003 has no precedent and is the riskiest piece

**Impact**: Critical
**Source**: RL-02, RL-03, RL-08, RL-09, RL-11, RL-12
**What**: Every code path in `runAgent` assumes a fresh run dir. `findRunSession` only matches completed runs. Resume writes a NEW `completed.json` with `resumedFromRunId` backlink — there's no notion of "continue the original run".
**Why it matters**: HF-003 is not a flag tweak — it's a meaningful new behavior with eligibility rules (active vs stale vs completed), takeover races (what if MCP subprocess died but file watcher might still hold a handle?), and manifest semantics (mutate original or write `resumed-at.ndjson`?).
**Required action**: HF-003 should likely be its own phase with a workshop-style design doc before implementation. Probably:
- Phase 1: HF-001 (smallest, unblocks Run 002)
- Phase 2: HF-002 (lane restructure + aliases)
- Phase 3: HF-003 (resume-in-place — needs a design doc / mini-workshop first)

### 🚨 Critical Finding 02: Filter chain order MUST match exactly between CLI and MCP

**Impact**: High
**Source**: MM-05, MM-06
**What**: `unread → type → waitForAny → after` chain in `inbox.ts:79-98` is the contract. CLI's `--unread`, `--type`, `--after` flags must produce byte-identical results to inside MCP's same filters.
**Why it matters**: Workshop 008's promise of "lane symmetry" depends on this. Drift = unpredictable behavior; agents written to spec wouldn't match operator expectations.
**Required action**: extracting `pollInboxLane` should also extract `listVisibleMessages` (or its filter logic) so both consumers share the same code, not two copies that drift.

### 🚨 Critical Finding 03: Outside CLI 5-min cap requires parameterization

**Impact**: Medium-High
**Source**: MM-07
**What**: `MAX_INBOX_WAIT_MS = 30000` is enforced both in `normalizeWaitMs` and the MCP inputSchema. Outside CLI wants 5 min (300000); inside MCP must stay at 30s (agents shouldn't idle that long).
**Why it matters**: a single-constant approach won't work. The cap must be parameterized at the polling primitive level.
**Required action**: `pollInboxLane(opts)` should accept a `maxWaitMs` parameter. MCP passes `MAX_INBOX_WAIT_MS = 30000`; CLI passes `MAX_OUTSIDE_WAIT_MS = 300000`. Document why the asymmetry exists.

### 🚨 Critical Finding 04: No structured-resume-prompt path today

**Impact**: Medium
**Source**: RL-06, RL-07
**What**: `session.send({ prompt })` is the only injection path. There's no adapter-level "system message" channel surfaced.
**Why it matters**: HF-003 wants a *structured* resume prompt distinct from a user follow-up. Two options: (a) extend `IAgentAdapter` with `sendSystem({ prompt })` (real adapter API change); (b) live with a prompt-prefix convention (`"[SYSTEM RESUME — MCP rebuilt at ${ts}]\n\n${userMessage}"`). Option (b) is much smaller.
**Required action**: workshop this in plan 010 if HF-003 is in scope. The prefix convention may be sufficient for MVP.

---

## Recommendations

### If implementing plan 010

**Phase order** (by effort × leverage):

1. **Phase 1 — HF-001 (blocking inbox)**: ~1-2 days. Extract `pollInboxLane` upward, expose `--wait` on `outside-inbox-list`. Smallest standalone, unblocks Run 002 of the experiment harness immediately. **Do this first** so we can switch the experiment to pipelined Option A' as the default.
2. **Phase 2 — HF-002 (lane restructure)**: ~3-4 days. Mostly mechanical. Commander wiring + alias layer + agent-prompt sweep + help-text tests + `outside.md` updates across in-repo agents. Risk: surface area is large but each change is small.
3. **Phase 3 — HF-003 (resume-in-place)**: ~3-5 days. The biggest design lift. Needs a mini-workshop covering: eligibility rules (active/stale/completed/never), takeover protocol, manifest semantics, structured-prompt approach (adapter extension vs prefix convention). **Don't bundle with phases 1-2.**

**Workshop dependency**: Workshop 008 covers HF-001 and HF-002 completely. HF-003 needs its own mini-workshop before Phase 3 implementation.

### If extending plan 010 scope later

- Phase 4 candidates: `state get --watch` (block until next state transition); `tail` symmetry with `outside inbox list --wait`; first-class `minih agent` parent (defer per Workshop 008's open question).

### If refactoring this area

- The `findRunSession` function in `runner/folder.ts:552-607` is overdue for splitting into `findCompletedRun` + `findActiveRun` + `findAnyRun(verdict-filter)` so HF-003's eligibility rules don't have to bolt onto a single function.

---

## External Research Opportunities

No external research gaps identified. The scope is entirely internal to minih's CLI/MCP/runner stack, the design source (Workshop 008) already exists, and the long-poll mechanism (`fs.watch` + parent-dir + debounce) is a well-understood Node.js pattern. No need for /deepresearch.

---

## Appendix: File Inventory

### Core files (modify in plan 010)

| File | Purpose | Plan 010 work |
|------|---------|--------------|
| `src/cli/index.ts` | Root command registration | Add `outside`/`inside` parents; register aliases |
| `src/cli/commands/outside-send.ts` | Write to outside lane | Becomes `outside inbox send`; add deprecation alias |
| `src/cli/commands/outside-inbox-list.ts` | Read inside lane (misleading) | Becomes `inside inbox list`; add `--wait`; alias |
| `src/cli/commands/state.ts` | State subcommand group | Split into `outside state` + `inside state get` (read-only); alias |
| `src/cli/commands/outside-context.ts` | Print outside.md | Becomes `outside context`; alias |
| `src/cli/commands/outside-retro.ts` | Write outside retro | Becomes `outside retro add`; alias |
| `src/cli/commands/resume.ts` | Resume command | HF-003: support in-place + optional structured prompt |
| `src/cli/coordination.ts` | Active-run resolver | Reuse for `--wait` |
| `src/cli/output.ts` | JSON envelope | Add E121/E122/E123/E124/E125 error codes; add stderr deprecation-warning helper |
| `src/mcp/tools/inbox.ts` | Inside MCP `inbox_list` | Refactor to consume new `runner/pollInboxLane`; remove duplicated logic |
| `src/runner/inbox-poll.ts` | **NEW** | Extract `waitForMatchingMessages` + `listVisibleMessages` filter chain |
| `src/runner/folder.ts` | Run folder paths | Extend `findRunSession` for active/stale eligibility (HF-003) |
| `src/runner/runner.ts` | runAgent orchestration | HF-003: intercept `createRunFolder` for in-place case; rebind MCP env vars to original run dir |
| `src/adapter/sdk-copilot.ts` | SDK adapter | OPTIONAL HF-003: add structured-prompt support OR document prefix convention |

### Test files (modify in plan 010)

| File | Plan 010 work |
|------|--------------|
| `test/cli/commands.test.ts` | Update help-text contract (new commands appear; deprecated commands warn) |
| `test/cli/state.test.ts` | Refactor for `outside state` / `inside state get` paths |
| `test/cli/outside-inbox-list.test.ts` (or new equivalent) | Add `--wait` long-poll integration test |
| `test/mcp/inbox.test.ts` | Verify shared-primitive behaviour unchanged |
| `test/runner/inbox-poll.test.ts` | **NEW** unit tests for the extracted helper |
| `test/runner/folder.test.ts` | Test `findRunSession` active/stale eligibility |
| `test/runner/runner.test.ts` | Test HF-003 in-place vs new-dir branching |

### Config / docs files

| File | Plan 010 work |
|------|--------------|
| `docs/cli-migration.md` | **NEW** alias mapping table for one-release deprecation |
| `docs/domains/cli/domain.md` | History entry + Concepts update |
| `docs/domains/runner/domain.md` | Add `pollInboxLane` to public Contracts table; History entry |
| `docs/domains/mcp/domain.md` | Note shared-primitive consumption pattern; History entry |
| `agents/code-review-companion/outside.md`, `prompt.md` | Update CLI references (one-release alias period covers transition) |
| `agents/coordination-smoke-test/outside.md`, `prompt.md` | Same |
| `agents/coordination-loop-validator/outside.md`, `prompt.md` | Same |
| `docs/plans/009-human-agent-view/prompts/option-a/plan-6-fx001-option-a.md` | Update CLI references |
| `docs/plans/009-human-agent-view/prompts/option-b/plan-6-fx001-option-b.md` | Update CLI references |
| `AGENTS_README.md`, `README.md` | Update CLI examples |

---

## Next Steps

This is a research dossier. Awaiting your direction:

1. **`/plan-1b-v2-specify "Coordination CLI ergonomics: lane restructure + blocking inbox + resume-in-place"`** — turn this research into a feature spec (recommended next step).
2. **`/plan-2c-v2-workshop 010-coordination-cli-and-resume "Resume-in-place semantics"`** — workshop HF-003 design before specifying (recommended if you want the riskiest piece de-risked first).
3. Skip straight to **`/plan-3-v2-architect`** with `--from-research` — bigger lift but possible since Workshop 008 already covers HF-001/HF-002 design.

I'd recommend **(1)** then **(2)** — get the spec written first (it'll synthesize Workshop 008 + this research naturally), then workshop HF-003 specifically before Phase 3 starts.

---

**Research Complete**: 2026-04-28
**Report Location**: `docs/plans/010-coordination-cli-and-resume/research-dossier.md`
