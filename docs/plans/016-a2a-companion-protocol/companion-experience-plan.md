# Plan 016: Companion Experience

**Status**: Active — fixes in flight
**Mode**: Simple (fix-driven; no formal phases yet)
**Created**: 2026-05-01
**Origin**: A2A protocol research → live `demo-companion` walkthrough → four user-experience failures surfaced

---

## Purpose

Plan 016 began as A2A protocol research (see `research-dossier.md`). The first attempt at running the resulting `demo-companion` walkthrough exposed four real coordination-loop UX failures, plus a magicWand. **The active work for this plan is now the four fixes**, captured in `fixes/`. The A2A research stays as a long-running reference that informs *naming and future direction*; the fixes ship the *current pain*.

## Target Domains

- `cli` (input bridge for FX001; **doctor warning for FX002** — `prompt-state-vocabulary-drift` check; outside CLI surface; init scaffolding for FX003)
- `runner` (`onSessionReady` ctx extension for FX001)
- ~~`mcp`~~ (initially flagged conditional; FX002-1 investigation ruled this out — `wait_for_any` event routing works correctly)
- Docs (no code domain)
- Agent prompts (`agents/demo-companion/prompt.md`, `agents/_shared/preamble.md` — non-code)
- Schema (`agents/demo-companion/state/inside-state.schema.json` — new)

## What surfaced (one-liners — full details in each fix)

| ID | Failure | Severity | Surface |
|---|---|---|---|
| F1 | `--wait` / `--after` invisible to operators; docs teach `sleep+cat` | HIGH | Docs |
| F2 | Companion didn't transition state on briefing — possibly prompt, possibly `wait_for_any` routing | HIGH | Prompt + possibly mcp |
| F3 | Demo's outside-state stayed empty for first 3 minutes — visual death | MEDIUM | Demo design |
| F4 | TUI footer input routes to SDK conversation, not coordinated inbox — **silent** | HIGH | cli/human + runner |

## Fixes

| ID | Created | Summary | Domain(s) | Status | Source |
|----|---------|---------|-----------|--------|--------|
| [FX001](./fixes/FX001-tui-input-routes-to-inbox.md) | 2026-05-01 | TUI footer input → coordinated inbox | cli, runner | Proposed | Live demo F4 |
| [FX002](./fixes/FX002-companion-state-transitions.md) | 2026-05-01 | Companion state transitions — schema vocabulary fix + systemic doctor warning (Path C) | cli (doctor), agent | **Complete** | Live demo F2 |
| [FX003](./fixes/FX003-driving-from-outside-docs.md) | 2026-05-01 | Document `--wait` / `--after` as the canonical operator pattern | docs | Proposed | Live demo F1 |
| [FX004](./fixes/FX004-demo-opens-with-state.md) | 2026-05-01 | `demo-companion` walkthrough sets outside state before briefing | docs, agent prompt | Proposed | Live demo F3 |
| [FX007](./fixes/FX007-wait-for-any-pre-existing.md) | 2026-05-02 | `wait_for_any` returns pre-existing unread inbox messages (MW6) | runner | Proposed | Workshop 002 § 3.3 + companion farewell |
| [FX008](./fixes/FX008-minih-attach-cross-process-tui.md) | 2026-05-02 | `minih attach` — cross-process read+write TUI; subsumes FX001 | cli, runner | Proposed | Workshop 005 + MW12 |

**Recommended order** (revised post-validation):

1. **FX002-1 first** (the 5-min investigation). Must run BEFORE any demo re-run — the live run dir is overwrite-sensitive and the latest demo run dir is the only evidence we have of the F2 failure.
2. **FX003 in parallel with FX001** — but FX003-4 (the `agents/demo-companion/outside.md` rewrite) MUST finish before FX004 starts because FX004 also edits that file. Either treat FX003-4 as gating FX004, or move the demo `outside.md` edit out of FX003 entirely.
3. **FX001** (code work) any time after FX002-1 has captured evidence.
4. **FX004 last** (polish; needs both FX002 result for visible state transitions AND FX003-4's outside.md rewrite to land first).

Note: parallel parts of FX003 (the new how-to page, AGENTS_README cheat-sheet, scaffolding fix, drift sweep) are safe alongside FX001. Only FX003-4 has overlap with FX004.

## Deferred follow-ups (magicWands, not fixes)

- **MW1** — `npx minih outside send-and-wait <slug> --type ... --wait <ms>` collapses send-then-block into one command. File as a separate plan when scoped.
- **MW2** — `doctor` warning when an `outside.md` contains `sleep N` near `cat <inbox|state>` — automatic foot-gun detector for new agent authors.
- **MW3** — `--human` view shows a low-key "(idle, polling)" badge during long `wait_for_any` calls so operators know the system isn't dead.
- **MW4** — `run.json.counters.messages` doesn't track inbox messages on disk (observed `0` despite 3 inside + 1 outside messages present). The companion's farewell run-2 confirmed the gap: companion-mode agents have to reconstruct counts manually at farewell time. Target: `coordination` — a counter helper that records message counts and peer-update counts automatically in run metadata.
- **MW5** *(filed 2026-05-01 from full demo verification)* — `inside inbox list --after <id>` (and `outside inbox list --after <id>`) silently return `[]` when the id doesn't exist in the lane being listed. Cross-lane ids (e.g. passing an outside-message id as `--after` when listing inside) ALWAYS hit this. The natural operator mental model "wait for replies newer than the outside message I just sent" breaks. Either (a) error when `--after` id isn't in lane, (b) document explicitly that `--after` requires a same-lane id, or (c) make `--after` smart enough to compare ULIDs by timestamp regardless of lane. FX003 should surface this in the canonical how-to.
- **MW6** *(filed 2026-05-01 from full demo verification + companion's own magicWand)* — `wait_for_any` returns only events that ARRIVE during the wait window; pre-existing unread inbox messages are NOT included. Companions with idle-budget gaps (or anything that breaks the polling loop momentarily) silently drop messages until something else wakes them. The companion independently flagged this in its farewell: "Add a wait_for_any diagnostic mode or returned high-water mark that shows when matching inbox messages are skipped or already pending". Possible fixes: include unread visible messages on first-call; or expose a `unreadCount` in the wait result; or have the agent prompt advise an `inbox_list({unread: true})` BEFORE every `wait_for_any` to drain pre-existing.
- **MW7** *(filed 2026-05-01 from code-review-companion farewell — run `2026-05-01T16-32-21-242Z-507d`)* — Companion-mode agents reconstruct their farewell envelope by hand at shutdown: counting inbox messages by type, mapping `ackOf` chains, listing findings already sent to the inbox, etc. The lane already has all this data; the report just doesn't auto-derive it. The companion's farewell magicWand: *"Add a built-in companion session ledger view that groups each outside task with its ack, findings, and summary, plus a generated final-report draft, so long-running reviewers do not need to manually reconstruct counts and ackOf mappings at shutdown."* Companion's `difficulties` row called this `[annoying]` and noted the workaround: manually copying finding payloads into `output/report.json` before validation. Target: `coordination`. Possible shape: a `report_draft` MCP tool that returns a derived skeleton (counts, finding payloads, ackOf chains) the agent can extend with summary + retro fields.
- **MW8** *(filed 2026-05-02 from state-surface audit)* — Inside-state's `reason` string is the single most actionable field the agent emits ("awaiting answer to: Q1: Which quirk?", "preparing for: Round 2: emoji width", etc.) but it's stripped from every consumer-facing surface. `inside state get` returns only `{status, data, updatedAt, updatedBy}` — no reason. `state.peer.changed` events delivered to a peer agent carry the new state's `status` but not the `reason` that explains *why*. `outside inbox send`'s `peer` block returns `selfReportedState` (an enum) and `currentlyRunningTool` (an opaque tool name) but no human-readable intent. Net effect: the rich, actionable signal (`reason`) lives only in `state/history.ndjson` on disk; programmatic consumers never see it. Three concrete fixes worth bundling:
  1. **Lift `reason` (and `lastTransitionAt`) into `SideState`** — populate them when reading state, derived from the most-recent `history.ndjson` row. Surfaces immediately to `state get`, the `peer` block, and any other reader.
  2. **Include `reason` in `state.peer.changed` event payload** — peer agents can then route on intent rather than just enum value. A peer that sees `{status: 'blocked', reason: 'awaiting answer to: Q1: Which quirk?'}` knows what to do; today it just sees `'blocked'`.
  3. **Shared preamble nudges agents to populate `data.label`** — a one-line operator-friendly variant of the status. Same pattern as FX002-4's schema-rejection guidance. The default state schema already permits `data.label`; we just don't teach agents to use it.
  Target: `coordination` + `runner` + agent prompt. Without this, even our own `--human` workbench renders bare enum pills with no operator context, and inter-agent peer-state awareness is far thinner than it could be.
- **MW9** *(filed 2026-05-02 from dogfood-rule encoding in AGENTS.md)* — There's no CLI surface for reading `state/history.ndjson` (the full transition log). The natural commands are `minih state history <slug> --run <run>` (full ledger) and `minih state history <slug> --run <run> --side inside --since <iso>` (filtered). Today the only way to inspect history is to `cat` the NDJSON — the very anti-pattern the dogfood rule prohibits. Target: `cli` + `runner` (likely a thin wrapper around the existing read path used by `peer-activity.ts:readLastMatchingHistoryRow` once MW8a lands). Composes cleanly with workshop 002's lane-aggregator (FX005) — the aggregator's `state-history.ndjson` walk could be exposed as the CLI surface for free.
- **MW10** *(filed 2026-05-02 from `minih view` papercut)* — `minih run --human` boots+attaches in one shell; `minih view <slug>` attaches read-only cross-process — but `view` rejects `--human` even though it IS the human-mode TUI. Two cleanup options: (a) make `view --human` a no-op alias for command symmetry (cheapest); (b) rename to `minih human view <slug>` for clearer intent (heavier; breaks existing usage). Prefer (a) for compat. Target: `cli`. Filed after the user hit `minih view code-review-companion --human → unknown option '--human'` during a live demo.
- **MW11** *(filed 2026-05-02 from stale-active manifest observation)* — When a `minih run` process dies without graceful shutdown (Ctrl-C, crash, idle-budget exit that didn't write the manifest cleanly), `run.json.status` stays `"active"` even though the PID is dead. Result: `minih view <slug>` (and any other resolver using `latest-active`) finds N "active" runs and errors out with E170 AMBIGUOUS_RUN. The fix is a PID liveness check on each manifest read: if `pid` exists but `process.kill(pid, 0)` throws ESRCH, mark `status: stale` (or `status: failed`) and exclude from active-run resolution. Target: `runner/run-eligibility.ts` (the existing eligibility checker — extend its `stale` heuristic to include "dead PID"). Without this, every long-running dev session accumulates phantom-active runs that block the next attach.
- **MW12** *(filed 2026-05-02 from real session friction — the human couldn't follow-and-write to a session the AI started in background)* — When the AI starts an agent in the background (`minih run code-review-companion` from a non-interactive shell), the human in another terminal CANNOT join the same session as a writeable peer. Today's options:
  - `minih view <slug> --run <id>` — attaches cross-process but is **read-only** (cannot type into the footer). Defeats the operator's natural mental model of "I want to follow the chat AND chime in".
  - `minih outside inbox send ... ` — works for writes but doesn't render the live transcript; you have to flip terminals between viewing and writing.
  - `minih resume --human` — overtakes the SDK session as a fresh boot; not a peer-attach.

  **What's needed**: when `view` is attached to a coordinated agent, footer input should write to the outside inbox via `appendInboxMessage` — same routing FX001 designs for `run --human` coordinated mode, just from the cross-process attach. The lane is already file-based and append-only; multiple writers are safe by construction. The flag could be `view --writable` (opt-in initially since interactive cross-process write is a behaviour change) or auto-enable when `coordinated: enabled`. Composes naturally with FX001's input-bridge dual-routing — `view`'s bridge currently fixes capability to `'input read-only'` because `attached: true` AND `sender` is null; the new logic would override that to `'input → inbox'` when the agent is coordinated. Target: `cli/human/input-bridge.ts` + `cli/commands/view.ts`. **The user explicitly named this as the next fix dossier to scope.**

  **STATUS**: Scoped via [workshop 005](./workshops/005-minih-attach-semantics.md) (2026-05-02) — final design uses a NEW `minih attach <slug>` command (not `view --writable`); subsumes FX001 entirely. Implementation dossier: [FX008](./fixes/FX008-minih-attach-cross-process-tui.md).

## Layout

```
docs/plans/016-a2a-companion-protocol/
├── companion-experience-plan.md   (this file)
├── research-dossier.md             (A2A protocol research)
├── workshops/
│   └── 001-companion-demo.md       (demo design)
└── fixes/
    ├── FX001-tui-input-routes-to-inbox.md
    ├── FX001-tui-input-routes-to-inbox.fltplan.md
    ├── FX001-tui-input-routes-to-inbox.log.md
    ├── FX002-companion-state-transitions.md
    ├── FX002-companion-state-transitions.fltplan.md
    ├── FX002-companion-state-transitions.log.md
    ├── FX003-driving-from-outside-docs.md
    ├── FX003-driving-from-outside-docs.fltplan.md
    ├── FX003-driving-from-outside-docs.log.md
    ├── FX004-demo-opens-with-state.md
    ├── FX004-demo-opens-with-state.fltplan.md
    └── FX004-demo-opens-with-state.log.md
```

---

## Validation Record (2026-05-01)

Three parallel explore agents validated the fix dossier post-creation. Lens coverage: 9/12 (User Experience, System Behavior, Hidden Assumptions, Edge Cases, Domain Boundaries, Integration & Ripple, Concept Documentation, Forward-Compatibility, Deployment & Ops). Forward-Compatibility ENGAGED (multiple downstream consumers named).

| Agent | Lenses Covered | Issues | Verdict |
|-------|---------------|--------|---------|
| Source Truth | Hidden Assumptions, Concept Documentation, Technical Constraints | 1 CRITICAL fixed, 1 HIGH fixed | ⚠️ → ✅ |
| Cross-Ref & Coherence | Integration & Ripple, Edge Cases & Failures, Domain Boundaries | 4 HIGH fixed, 2 MEDIUM fixed, 1 LOW fixed | ⚠️ → ✅ |
| Forward-Compatibility | Forward-Compatibility, User Experience, System Behavior, Hidden Assumptions, Deployment & Ops | 3 HIGH fixed, 1 MEDIUM fixed | ⚠️ → ✅ |

### Forward-Compatibility Matrix

| Consumer | Requirement | Failure Mode | Verdict | Evidence |
|----------|-------------|--------------|---------|----------|
| `plan-6 --fix FX###` | Tasks executable / not blocked on clarification | shape mismatch | ✅ (post-fix) | FX001-3 made concrete (`appendInboxMessage` cli-domain confirmed); FX002-4 was initially marked BLOCKED until verdict — verdict (FX002-1) came back as Path C (schema/vocabulary), making B-blocking moot; FX002-4 reframed as Path C shared-preamble guidance; decision table replaces "Possibly both" |
| Demo re-run | Union of fixes covers all 12 primitives | contract drift | ✅ | FX001 (input bridge), FX002 (state visibility), FX003 (operator round-trip), FX004 (timeline opener) collectively cover the workshop's P1–P12 |
| Third-party agent authors | Discoverable canonical doc | encapsulation lockout | ✅ (post-fix) | New FX003-7 adds three discoverability surfaces: `init.ts` welcome stderr, `doctor` pointer, `README.md` Coordination link |
| Live-demo run dir for FX002-1 | Survives until investigation reads it | lifecycle ownership | ✅ (post-fix) | FX002-1 Notes now include explicit "do NOT re-run before this lands" guard; problem section acknowledges the originally-cited run id may be pruned and instructs locating the latest run |
| MagicWands MW1/MW2/MW3 | Not locked out by current fixes | encapsulation lockout / contract drift | ✅ | FX001 dual-routing leaves room for MW3 polling badge; FX003 docs-only doesn't bake in two-step pattern as immutable; MW2 doctor warning composes naturally with FX003-7 doctor pointer |

**Outcome alignment**: *"detailed fix tasks please. We can then re-run the demo and do more fixes after if we need."* — the dossier as revised provides four plan-6-ready fixes with explicit sequencing, evidence preservation guards, and discoverability hooks; their union unlocks a clean demo re-run while closing the silent-failure UX gap for third-party agent authors.

**Standalone?**: No — five downstream consumers named with concrete needs.

### Fixes applied inline

- **C1** (Source-Truth): FX002-1's hardcoded run id replaced with "locate latest demo-companion run dir"; problem statement notes original id may be pruned.
- **H1** (Source-Truth): FX001-1 corrected — current ctx is `{ runDir, runId }`; `coordinated`/`agentSlug` are NEW additions; `runDir` already present.
- **H2** (Cross-Ref): Parent plan's recommended order rewritten — FX002-1 first (evidence preservation); FX003 in parallel with FX001 EXCEPT FX003-4 must finish before FX004; FX004 last.
- **H3** (Cross-Ref): Parent plan Target Domains initially flagged `mcp` as conditional on FX002-1 verdict. **Post-FX002-1 update (2026-05-01)**: verdict came back as Path C (schema vocabulary), not Path B (mcp); `mcp` was struck from Target Domains. The conditional was preserved historically, the rule was discharged.
- **H4** (Cross-Ref): FX002 Proposed Fix replaced "Possibly both" with strict decision table. **Post-FX002-1 update (2026-05-01)**: the decision table itself was superseded — FX002-1 verdict surfaced a fourth path (Path C — schema/vocabulary mismatch) that none of the original three rows matched. Dossier rewritten to Path C as the actual fix; A and B ruled out.
- **H5** (Forward-Compat): FX001-3 made concrete — `appendInboxMessage` ownership confirmed (`src/cli/coordination.ts:92-117`, cli-domain); no re-export needed; subject synthesis spelled out.
- **H6** (Forward-Compat): FX002-4 was initially marked BLOCKED until FX002-1 verdict = Path B; diagnostic steps added. **Post-FX002-1 update (2026-05-01)**: verdict was Path C (not B), so the B-blocking was dissolved. FX002-4 has been reframed as Path C agent guidance (shared preamble: surface schema-rejection errors via `progress` messages so the operator sees them).
- **H7** (Forward-Compat): FX002-1 Notes now include "do NOT re-run before this lands" lifecycle guard.
- **M1** (Cross-Ref): FX003-4-before-FX004 ordering documented in BOTH dossiers' Sequencing notes.
- **M2** (Cross-Ref): FX004 dependency on FX002 + FX003-4 made explicit in parent plan order rationale.
- **M3** (Forward-Compat): New task FX003-7 adds three discoverability hooks (init, doctor, README).
- **L1** (Cross-Ref): New task FX003-8 harmonises pre-existing workshop ↔ outside.md drift on the read-farewell step.
- **L2** (Cross-Ref): FX001-3 now asserts `appendInboxMessage` is already cli-domain.

**Overall**: ⚠️ VALIDATED WITH FIXES — dossier is plan-6-ready. FX002-1 should be the first task implemented (evidence preservation gate).
