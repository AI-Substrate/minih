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
