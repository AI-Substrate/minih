# Coordination CLI Ergonomics: Lane Restructure + Blocking Inbox + Resume-In-Place

**Mode**: Simple

📚 This specification incorporates findings from `research-dossier.md` and the design lock-ins from `workshops/001-resume-in-place-semantics.md` (HF-003) and plan 009's `workshops/008-cli-lane-semantics-and-blocking-inbox.md` (HF-001 + HF-002).

---

## Research Context

Plan 009's Run 001 dogfood (Option A baseline) of the FX001 fix surfaced three concrete harness gaps that hurt every coordinated-agent workflow. All three are documented as `HF-001`, `HF-002`, `HF-003` in `docs/plans/009-human-agent-view/prompts/EXPERIMENT-LOG.md`:

- **HF-001** — `outside-inbox-list` has no `--wait`; operators loop-poll with `sleep 15`. Inside MCP `inbox_list` already long-polls.
- **HF-002** — The `outside-*` CLI prefix is misleading: `outside-inbox-list` reads the *inside* lane (replies). Lane-as-prefix is asymmetric (`state` is grouped, others are flat).
- **HF-003** — `minih resume` creates a *new run dir*, losing the coordinated agent's inbox/state continuity. After every dist rebuild during long-running coordination (e.g. mid-FX001) the operator loses context.

Workshop 008 (plan 009) already locks in the design for HF-001 and HF-002. Workshop 001 (this plan) locks in HF-003. Critical Findings 02 and 03 from the research require a parameterized polling primitive (`pollInboxLane`) shared between CLI and inside MCP, with asymmetric wait caps (30 s for MCP, 5 min for CLI).

---

## Summary

Make minih's coordination CLI honest, blocking, and continuous. **Honest**: `inside`/`outside` become first-class subcommand groups so the lane name on the CLI matches the lane on disk. **Blocking**: `inside inbox list --wait <ms>` lets operators block until the next reply lands instead of polling. **Continuous**: `minih resume` reuses the original run dir + SDK session so a coordinated agent's inbox, state, and history survive a restart — the agent feels like it never stopped.

## Goals

- Operators can block-wait on the next coordinated-agent reply without scripting a polling loop.
- Operators can read the inside lane (agent → operator) and the outside lane (operator → agent) using CLI verbs that name the lane correctly.
- Operators can stop a long-running coordinated agent (intentionally or via crash), restart it, and have it resume in the same run dir with full inbox/state/history continuity and the same SDK conversation.
- Operators receive a structured "you were resumed" signal the agent recognizes (so the LLM doesn't waste a turn re-orienting).
- The Phase 2 Ink TUI (plan 009) inherits these primitives ready-made.
- The experiment harness (Run 002+) defaults to a pipelined collaboration loop powered by `inside inbox list --wait` instead of strict block-and-wait.
- Old flat command names (`outside-send`, `outside-inbox-list`, `outside-context`, `outside-retro`, `state set/transition`) are **hard-removed in the same PR as the lane restructure** — every in-repo agent prompt, doc, and test gets updated atomically.

## Non-Goals

- A full `minih agent <verb>` parent prefix for lifecycle commands (`run`, `status`, `tail`, etc. stay top-level — Workshop 008 Q5 deferred this).
- Adapter API extension for true SDK system messages (Workshop 001 Q8 chose the prefix-convention path for v1; revisit only if dogfooding shows confusion).
- Multi-host resume (resuming a run from a different machine).
- Cross-version resume (resuming a run started under a different minih major version) — refuse with a clear error.
- Resume-and-fork (cloning a run dir for what-if exploration) — separate feature.
- Full Ink TUI / human-agent view (that's plan 009 Phase 2).
- A new `minih watch` composite multi-lane TUI (Workshop 008 Q5 deferred).

## Target Domains

| Domain | Status | Relationship | Role in This Feature |
|--------|--------|-------------|---------------------|
| `cli` | existing | **modify** | Add `outside <verb>` and `inside <verb>` subcommand trees as a **hard rename** (no deprecation aliases — old flat names removed in same PR; in-repo consumers updated atomically). New `--wait`/`--type`/`--after` flags. `resume`'s flag surface gains `--resume-prompt`, `--takeover`, `--fresh`, `--yes`. New top-level `minih state get <slug>` survives (cross-lane "both lanes" view); `state set/transition` move to `outside state` only. New `inside retro show` reads the inside retro section from the farewell envelope. |
| `runner` | existing | **modify** | Extract a new **internal** helper `pollInboxLane` (not a public contract for v1 — undocumented; promote to public in v2 if external demand emerges) that both CLI and inside MCP consume. Extend `findRunSession` for active/stale/failed eligibility. Intercept `runAgent`'s unconditional `createRunFolder` for in-place resume. Rebind MCP env vars to the original run dir. Mutate `run.json` with append-only `resumes[]`; version `completed.json` via `completed-N.json` rename. Append synthetic `{type: 'resume'}` event to the event stream. |
| `mcp` | existing | **modify** | Refactor `inbox_list` to consume `runner.pollInboxLane`; remove duplicated polling logic. Schema/cap unchanged (30 s ceiling stays for inside MCP). |
| `adapter` | existing | **consume** | No code change. Already supports `client.resumeSession(sessionId)` and `session.send({prompt})`. The structured resume prompt is sent as a separate `send` call with a recognizable prefix — no new adapter method. |
| `agents/_shared/preamble.md` | existing (template) | **modify** | Add an "On Resume" section that teaches every coordinated agent to recognize the `[SYSTEM RESUME]` envelope. Re-scaffolded copies in `dist/templates` get the update. In-repo coordinated agents pick it up via `_shared/preamble.md`. |
| All in-repo coordinated agents (`code-review-companion`, `coordination-smoke-test`, `coordination-loop-validator`) | existing | **modify** | Update `outside.md` and `prompt.md` examples from flat command names to lane-grouped names in the same PR as HF-002. Hard rename means flat names stop working immediately — atomic update prevents broken in-repo prompts. |

(No new domains. Respects the import direction `cli → mcp → runner → adapter`. The new `cli → runner` import for `pollInboxLane` is already permitted by the existing rule — it just becomes explicit.)

## Complexity

- **Score**: CS-3 (medium)
- **Breakdown**: S=2, I=0, D=1, N=1, F=0, T=1 (total P=5)
  - **S=2** — many files touched: every CLI `outside-*` and `state` command file, plus runner manifest/folder/runner.ts, plus mcp/tools/inbox.ts, plus all in-repo coordinated agent docs. Cross-cutting.
  - **I=0** — all internal; no external services or new third-party deps.
  - **D=1** — minor schema change: `run.json` gains `resumes[]`; `completed-N.json` rename is a file-system convention.
  - **N=1** — HF-001 and HF-002 fully designed in Workshop 008; HF-003 fully designed in Workshop 001. Some implementation discovery remains (alias mechanism has no precedent per IA-03).
  - **F=0** — no perf/security/compliance constraints beyond what the existing primitives carry.
  - **T=1** — integration tests required (long-poll mid-write race, eligibility state machine, manifest evolution). HF-003 live SDK tests gated behind `MINIH_E2E=1`.
- **Confidence**: 0.85 — high, thanks to two prior workshops covering the design completely.
- **Assumptions**:
  - Workshop 001 design (eligibility rules, takeover protocol, manifest evolution, prefix prompt) is accepted as written; clarify pass surfaces any pushback.
  - One-release deprecation is acceptable to in-repo and dogfood agents (we update them; external consumers see warnings).
  - The prefix convention (`[SYSTEM RESUME]\n...`) is sufficient for v1; no SDK system-message channel needed.
  - The operator running tools is on a single host (no cross-host resume).
  - `fs.watch` parent-dir behavior on macOS/Linux is sufficient for both lanes (already proven by inside MCP + inbox-forwarder consumers).
- **Dependencies**:
  - **None blocking** — Workshop 008 + Workshop 001 are landed; research dossier is landed; no upstream code changes required before this plan starts.
  - **Downstream consumers** (Phase 2 of plan 009, future Run 002 of the experiment harness) wait on this plan but don't gate it.
- **Risks**: see § Risks & Assumptions
- **Phases** (suggested for plan-3):
  1. **HF-001 — Blocking inbox**: extract `pollInboxLane`, expose `--wait`/`--type`/`--after` on `outside-inbox-list` (and the future `inside inbox list`). Smallest standalone; ships first; unblocks Run 002 of the experiment harness immediately.
  2. **HF-002 — Lane subcommand restructure**: introduce `outside <verb>` and `inside <verb>` parents, deprecation aliases, new error code `E121 NOT_COORDINATED`, sweep all in-repo agent prompts. Mostly mechanical, but broad-touch.
  3. **HF-003 — Resume-in-place**: implement Workshop 001 in full (eligibility state machine, takeover protocol with lock file, manifest mutation + versioned `completed-N.json`, `--resume-prompt` prefix convention, synthetic resume event, all E125-E130 error codes, "On Resume" preamble). Live smoke + `MINIH_E2E=1` gate.

## Acceptance Criteria

1. **Pipelined polling works without scripting**:
   `minih outside-inbox-list code-review-companion --wait 60000 --type summary --after $LAST_ID` blocks up to 60 s, returns immediately when a matching `summary` reply arrives, and emits an envelope with `data.wait.{requestedMs, elapsedMs, timedOut, matched}` matching the inside MCP shape. Default `--wait 0` preserves today's behavior. `--wait 5min` (300000) is the maximum on the outside CLI; values >max return `E122 WAIT_OUT_OF_RANGE`.

2. **Long-poll detects agent death**:
   While `outside-inbox-list --wait 300000` is blocking, if the targeted run's `run.json` status flips to non-`active` (process died, agent farewelled, etc.), the CLI returns `E123 AGENT_GONE` (non-zero exit) within 1 s of the manifest change. SIGINT during wait exits 130 cleanly with no partial output.

3. **Lane CLI tree is honest**:
   - `minih outside <verb> <slug>` and `minih inside <verb> <slug>` both work for `inbox`, `state`, `context`, `retro` per Workshop 008's verb table.
   - Inside-side write attempts (`minih inside inbox send`, `minih inside state set`, etc.) are rejected with `E124 INSIDE_READ_ONLY` and a hint pointing to the agent's MCP tool.
   - Non-coordinated agents return `E121 NOT_COORDINATED` from any `inside`/`outside` subcommand with a hint to enable `coordination: enabled` and re-init.
   - `minih state get <slug>` (no lane prefix, top-level cross-lane "both lanes" view) survives — it's the only `state` command at top level.
   - `minih inside retro show <slug>` reads the inside retro section from the agent's farewell envelope.

4. **Hard rename is atomic — old flat command names are gone**:
   `minih outside-send`, `minih outside-inbox-list`, `minih outside-context`, `minih outside-retro`, `minih state set`, `minih state transition` (top-level forms) all return Commander's standard "unknown command" error in the same release. Every in-repo agent prompt (`agents/*/prompt.md`, `agents/*/outside.md`), every test, every doc reference is updated atomically in the rename PR. No deprecation aliases, no `docs/cli-migration.md`, no stderr warnings — clean break.

5. **Resume-in-place is the new default**:
   `minih resume <slug>` (no flags) reuses the original run dir, the original SDK sessionId, and all coordination artifacts (inbox, state, history, events.ndjson, output). Inbox messages sent while the agent was stopped are visible to the resumed agent on its next `inbox_list`. `--fresh` opts back into today's "create new run dir" behavior (with `resumedFromRunId` backlink) for migration scenarios.

6. **Eligibility state machine is enforced**:
   `minih resume` correctly classifies the targeted run as one of `active | stale | completed | failed | nonexistent` per Workshop 001's `detectRunState`. Attempts to resume an `active` run without `--takeover` return `E125 ALREADY_ACTIVE` with the live PID. Attempts on `nonexistent` return `E126 NO_RUN_TO_RESUME`. `stale | completed | failed` proceed by default.

7. **Takeover protocol works under crash and concurrent-resume scenarios**:
   - `--takeover` against an `active` run prompts in TTY mode, requires `--yes` in non-TTY, SIGTERMs the live PID with a 5 s grace, then SIGKILLs.
   - Concurrent `minih resume` calls coordinate via `<runDir>/resume-intent.lock`; second caller waits up to 35 s, then errors `E128 RESUME_IN_PROGRESS`.
   - Stale lock files (>30 s old, owner pid dead) are force-cleared with stderr warning.

8. **Manifest evolution preserves audit trail**:
   - `run.json` is mutated in place with `pid` updated and `resumes[]` appended (each entry: `ts`, `fromState`, `kind`, `previousPid`, optional `rebuildHint`).
   - `completed.json` is renamed to `completed-N.json` (where N = `resumes.length` at write time) before the resumed session writes a fresh `completed.json` on its next exit.
   - `events.ndjson` continues appending; a synthetic `{type: 'resume', ts, fromState, kind}` event marks each boundary.
   - `coordinationFiles` snapshot is regenerated to reflect post-resume state.

9. **Structured resume prompt is recognized by agents**:
   `minih resume <slug> --resume-prompt "MCP rebuilt; tools are FX001-aware"` sends a separately addressed turn via `session.send({prompt: '[SYSTEM RESUME]\n  ts: ...\n  reason: ...\n  fromState: ...\n  previousPid: ...\n\n<message>'})`. `agents/_shared/preamble.md` "On Resume" section instructs every coordinated agent to recognize this envelope, briefly orient against current inbox/state, and continue without restarting their orient sequence. Combined `--resume-prompt` + positional message sends two sequential turns (system signal first, user message second).

10. **SDK session expiration surfaces cleanly**:
    If `client.resumeSession(sessionId)` rejects (server-side session expired), the CLI surfaces `E127 SESSION_EXPIRED` with a hint to start a fresh run, and does **not** silently fall through to a new run dir.

11. **All in-repo coordinated agents continue to function unchanged**:
    `code-review-companion`, `coordination-smoke-test`, `coordination-loop-validator` agent prompts and `outside.md` references are updated to the new lane CLI tree in the same PR. Their `just fft` smoke runs pass without behavioral regression.

12. **Filter chain symmetry between CLI and MCP holds**:
    The same set of filter flags (`--unread`, `--type`, `--after`) applied to `outside inbox list` produces the same `messages[]` ordering as inside MCP `inbox_list` would for the equivalent lane. Both are backed by the shared `pollInboxLane` primitive — drift is impossible because the filter logic lives in one place.

13. **Asymmetric wait caps documented and enforced**:
    `pollInboxLane` accepts a `maxWaitMs` parameter. Inside MCP passes `30_000` (today's `MAX_INBOX_WAIT_MS`); outside CLI passes `300_000` (5 min). Schema and runtime validation enforce both limits with `E122` (CLI-side) or `MCP_INVALID_ARGUMENT` (MCP-side). Rationale documented in `runner.pollInboxLane` doc comment AND in `docs/domains/runner/domain.md` Concepts.

14. **`--wait` defaults match user expectations**:
    Bare `--wait` (no value) defaults to **60_000 (1 minute)** — protects CI/scripts from accidental indefinite blocks. `--wait 0` is immediate (today's behavior). `--wait <ms>` between 100 and 300_000 (5 min max) is accepted. Out-of-range returns `E122 WAIT_OUT_OF_RANGE`.

15. **`just fft` baseline maintained**:
    472+ tests pass after each phase. `MINIH_E2E=1 npx vitest run test/cli/resume-in-place.test.ts` (new, opt-in) covers the live SDK round-trip and is run before merge.

## Risks & Assumptions

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| `findRunSession` extension introduces a takeover race against an actively writing process | Medium | High | Eligibility state machine refuses `active` without `--takeover`; `resume-intent.lock` serializes concurrent attempts; SIGTERM grace + SIGKILL bounded at 5 s. |
| Filter chain drift between CLI and MCP after sharing `pollInboxLane` | Low | High | Single source of truth — the filter logic lives in the runner extract; both consumers call the same code; integration test `coordination-contract.test.ts` (extended) asserts CLI output matches MCP for identical filter inputs. |
| Prefix convention for `[SYSTEM RESUME]` is misread by some LLMs as a user turn | Medium | Medium | `_shared/preamble.md` "On Resume" instructions are explicit; live smoke validates with `code-review-companion`; if dogfooding shows confusion, escalate to adapter system-message channel (Workshop 001 Q8 → plan 011). |
| Manifest mutation surfaces concurrency bugs (crash mid-write) | Low | Medium | Reuse existing atomic-write pattern (`src/runner/atomic-write.ts`); `run.json` writes were already atomic by design. `completed-N.json` rename is a single fs.renameSync (atomic on POSIX). |
| Deprecation aliases skew JSON envelope `command` field, breaking external scripts that grep on it | ~~Low~~ N/A | ~~Low~~ N/A | ~~Aliases keep `command` field canonical~~ — hard rename per clarify session means no aliases at all. External scripts (only the user has any) break loudly until updated. |
| Long-poll over `fs.watch` misses an event under macOS atomic-rename writes | Low | Medium | Today's inside MCP long-poll already handles this via parent-dir watch + debounce + re-read on event (per MM-08); same primitive, same behavior. New lane tests must replicate the proven mid-write pattern from `test/mcp/inbox.test.ts:190-260`. |
| Plan 010 lands while plan 009 Phase 2 is mid-implementation; CLI rename collides | Low | Medium | Phase 2 of plan 009 is paused on this work (Run 002 needs HF-001). Phase 2 should pick up the new CLI names directly (no aliases needed in the Ink TUI). |

**Assumptions** (also see Workshop 001 Q1-Q6 resolutions):

- Resume-in-place becomes the new default; `--fresh` is the opt-out (per Workshop 001 Q1).
- Operator on a single host; cross-host resume is out of scope.
- Coordinated agents written before plan 010 are tolerant of the `[SYSTEM RESUME]` prefix appearing as a user turn (worst case: they treat it as a strange user message and re-orient — annoying but not destructive).
- Existing tests under `test/cli/` and `test/mcp/inbox.test.ts` are sufficient as the regression baseline; new tests are additive.

## Open Questions

_All resolved in the 2026-04-28 clarify session — see § Clarifications below._

## Workshop Opportunities

| Topic | Type | Why Workshop | Key Questions | Status |
|-------|------|--------------|---------------|--------|
| Resume-in-place semantics | State Machine + Integration Pattern | HF-003 has no precedent; eligibility/takeover/manifest decisions all interrelated | Eligibility states, lock protocol, manifest evolution, prompt envelope, failure modes | ✅ **Complete** — `workshops/001-resume-in-place-semantics.md` |
| Polling primitive contract (`pollInboxLane`) | API Contract | _N/A — kept internal v1 per clarify; spec acceptance criteria 12-13 cover the contract sufficiently_ | — | ❌ Not needed |
| Migration strategy | Other | _N/A — hard rename per clarify; no migration doc needed_ | — | ❌ Not needed |

## Testing Strategy

**Approach**: Hybrid

**Rationale** (from clarify Q2):
- HF-001's `pollInboxLane` has a clear primitive contract (filter chain order + settlement semantics) where TDD pays off — write failing tests asserting filter behavior + race-window correctness, then implement.
- HF-003's eligibility state machine + takeover protocol have non-trivial state transitions and edge cases (stale lock, race-against-active, manifest mutation under crash) that benefit from explicit RED bars before code.
- HF-002 is mostly Commander rewiring + agent-prompt sweep — TDD is overkill; lightweight verification (does `minih outside inbox list ...` produce the expected envelope?) is sufficient.

**Mock policy**: avoid mocks (clarify Q3). Real fs, real run dirs, real `outside-send` writes mid-wait, mirroring the proven pattern in `test/mcp/inbox.test.ts:190-260`. HF-003's live SDK round-trip is the only opt-in gate (`MINIH_E2E=1`) — Copilot calls cost real money.

**Focus areas**:
- `pollInboxLane` filter chain order parity between CLI and MCP consumers
- Long-poll race window (write arrives during `setTimeout`, settlement contract holds)
- Resume eligibility state machine across all 5 states
- Takeover protocol under concurrent-resume + crash scenarios
- Manifest evolution: `run.json.resumes[]` append, `completed-N.json` rename atomicity
- `[SYSTEM RESUME]` prefix recognition by in-repo coordinated agents (live smoke)

**Excluded**:
- Mocked-fs unit tests for any path that touches real coordination artifacts
- Adapter-level system-message channel (deferred to v2 per Workshop 001 Q8)

## Documentation Strategy

**Approach**: Inline doc comments + agent prompt updates only — **no new doc files**.

**Rationale** (from clarify Q6 → hard rename + Q4 → internal pollInboxLane):
- Hard rename eliminates `docs/cli-migration.md` (no aliases to migrate from).
- `pollInboxLane` is internal v1 → no entry in `docs/domains/runner/domain.md` § Contracts; doc comment in code is sufficient.
- Domain `History` rows updated for `cli`, `runner`, `mcp` (existing pattern, not new docs).
- All in-repo coordinated agent `outside.md` files updated atomically with the rename PR (already in scope per HF-002).
- `agents/_shared/preamble.md` "On Resume" section update (already in scope per HF-003).

## Notes for plan-3

- Workshop 001 enumerates all error codes (E125-E130) for HF-003 and Workshop 008 enumerates E121-E125 for HF-001/HF-002. Plan-3 should consolidate into a single error-code table in `src/cli/output.ts` so operators can `grep` codes consistently.
- The `pollInboxLane` extraction must happen before HF-001's CLI work (HF-001 consumes it). Within HF-001 phase, extraction is the first task.
- Hard rename means HF-002's PR includes the agent-prompt sweep atomically. No alias layer to maintain. Recommend a single PR for the whole HF-002 phase.
- HF-003's `MINIH_E2E=1` gate must run before merge of phase 3, not after. Live SDK round-trip is the only way to catch session-resumption regressions.
- Phase 2 of plan 009 (Ink TUI) should be unblocked after phase 1 of this plan (HF-001) lands. Phase 2 of plan 009 should consume the new lane CLI tree directly.
- **Mode = Simple**: plan-3 may render this as a single phase with three internal task groups (HF-001/HF-002/HF-003) rather than three separate phases. The user has signalled "don't overcomplicate" — favor velocity over ceremony. Dossiers/gates optional.

---

## Clarifications

### Session 2026-04-28

**Q1: Workflow Mode** → **Simple**
- Single-phase plan, inline tasks, dossiers/gates optional.
- Velocity over ceremony. Plan-3 may still propose internal task groups for HF-001/HF-002/HF-003 readability.

**Q2: Testing Strategy** → **Hybrid**
- TDD for HF-001 polling primitive (filter chain + settlement contract has clear RED/GREEN cycle).
- TDD for HF-003 eligibility state machine + takeover protocol (state transitions and edge cases benefit from RED bars).
- Lightweight for HF-002 mechanical Commander rewire + agent-prompt sweep (overkill for plumbing).

**Q3: Mock Usage** → **Avoid mocks**
- Real fs, real run dirs, real `outside-send` writes mid-wait.
- Matches the proven pattern in `test/mcp/inbox.test.ts:190-260` and `test/cli/state.test.ts`.
- HF-003's live SDK round-trip is gated by `MINIH_E2E=1` (real Copilot calls cost money).

**Q4: Domain — `pollInboxLane` visibility** → **Internal v1**
- Undocumented helper; CLI and MCP are the only consumers.
- Promote to public contract in v2 only if external operator tooling demands it.
- Doc comment in code is sufficient; no entry in `docs/domains/runner/domain.md` § Contracts for v1.

**Q5: Bare `--wait` default** → **60_000 (1 minute)**
- Protects CI/scripts from accidental indefinite blocks.
- `--wait 0` = immediate; `--wait` (no value) = 60_000; `--wait <ms>` accepts 100-300_000.

**Q6: Deprecation cadence** → **Hard rename (no aliases)**
- Old flat command names removed in the same PR as the lane restructure.
- No `docs/cli-migration.md`. No stderr warnings. No alias layer.
- All in-repo agent prompts/docs/tests updated atomically.
- External scripts break loudly — acceptable for a pre-1.0 tool with a single-operator user base.

**Q7: `inside retro show` scope** → **Include in HF-002**
- Tiny addition (~30 min). Reads from farewell envelope, no new storage.
- Ship in the same PR for full lane symmetry.

**Q8: Top-level `minih state get <slug>`** → **Keep**
- The only `state` command surviving at top level.
- "Both lanes at once" is a useful single-call view.
- Asymmetry is acceptable because it's clearly a different verb (cross-lane vs lane-specific).

### Coverage summary

- ✅ Workflow Mode — answered
- ✅ Testing Strategy — answered
- ✅ Mock Usage — answered
- ✅ Documentation — N/A (hard rename eliminates the migration doc; no other new docs needed beyond inline doc comments)
- ✅ Domain Review — answered (pollInboxLane internal; no other domain boundary concerns)
- ✅ Harness — N/A (no harness in this project; Q4 of skill default not applicable)
- ✅ All 5 [NEEDS CLARIFICATION] markers from Open Questions resolved
- 8/8 questions used; capped at limit.
