# Companion-Mode Reliability — issue #50 defects A–G

**Mode**: Full

ℹ️ No `research-dossier.md` was produced — the root causes were diagnosed ad-hoc this session (three parallel passes + direct verification). The verified root-cause map (each defect → file:line, live/fixed) is captured in [`original-ask.md`](./original-ask.md) and summarised under Research Context below.

## Research Context

GitHub issue **#50** reports that minih's `code-review-companion`, driven by an orchestrating agent in companion / Power-On mode, is **not reliably drivable**: the orchestrator boots the companion, then cannot learn the live `runId` during the window it needs it, and even when review happens the findings can be invisible. Seven defects (A–G) were filed plus one schema item.

Verified findings (all **live in v0.2.1** unless noted; the plan-027 release touched companion/coordination/MCP, not the run-discovery read-paths):

- **A** — `minih status <slug>` returns non-active for a freshly-booted, still-running run. Verdict is computed from a pid probe + `events.ndjson` file age (60s), **never** from `run.json.updatedAt`, so a just-booted run whose `events.ndjson` is still empty resolves to `unknown` and the documented `select(.verdict=="active").runId` yields nothing. `src/cli/commands/status.ts:188-216`.
- **B** — `runs list` / `runs list --active` omit a genuinely-live run; `--all` shows it with `liveness:"dead"`. Liveness = `process.kill(manifest.pid,0)`; a *live* run probes alive, so `dead` means a **stale prior `active` manifest** (dead-pid orphan) was selected — those are healed only post-mortem by `reconcile`. Also: `--all` is a **declared-but-never-read no-op** in the inventory, so "default empty / `--all` populated" is a timing race, not a filter. `src/runner/run-inventory.ts:204-212`, `run-eligibility.ts:50-62`.
- **C** — `history` / `last-run` throw `E121 "Agent not found"` transiently. `E121` fires only when `resolveAgent` returns null (reads `agents/<slug>/prompt.md`), which concurrent run-folder writes don't touch — so the symptom is **not reproducible** from the cited core commands; the reporter's literal status JSON (`selfReportedState`/`currentlyRunningTool`) comes from a **peer-activity surface** (`src/runner/peer-activity.ts`), not core `status`. Needs reframe + investigation. `history.ts:32`, `last-run.ts:31`, `folder.ts:685-704`.
- **D** — timestamps: the **run-folder name / runId** is built from **local** `Date` getters (`getHours()`…) with a literal `"Z"` appended; `run.json`/CLI envelope use `.toISOString()` and are correct UTC. (The issue inverts which file is buggy.) `src/runner/folder.ts:752-759`.
- **E** — a spawned child's `MINIH_PROJECT_ROOT` is set to raw `config.cwd` (the run dir for a companion), while `canonicalRoots` runs the same input through a git-root walk and is correct. `src/runner/runner.ts:631` (correct path: `permissions/fs-guard.ts:100-138`).
- **F** — the documented operator skim reads `minih outside inbox list` (the **outside** lane = what the operator sent); the companion writes `finding`/`summary` to the **inside** lane, so a real HIGH finding is silently dropped. A findings ledger exists (`companion-ledger.ts`) but there is no lane-agnostic `companion findings` command, and the exemplar still points operators at the wrong lane. `agents/code-review-companion/outside.md:88-96`.
- **G** — a clean run (sent `farewell`, 0 errors) is recorded `status:"failed"`/`result:"degraded"` with `terminalReason:null`. A schema-validation miss yields `degraded`; the manifest collapses everything ≠`completed` to `failed`; `farewell` is never consulted; the `terminalReason` union has no clean member; the idle-policy decision is unwired (overlaps follow-up **#49**). `runner.ts:1516-1594`, `types.ts:575-581`.
- **#5 (schema)** — `state_transition {to:"reading"}` rejection is **already fixed in v0.2.1** (per-agent schema ships and is preferred). **Out of scope.**

## Summary

Make companion mode reliably drivable by an orchestrating agent. The unifying fault is that minih's run-discovery read-paths **fail closed** (null / empty / misleading error) during a run's boot/active window instead of surfacing a just-started run as active; plus four independent correctness defects (local-time run IDs, wrong child env var, findings on an unreadable lane, clean runs misclassified). This plan fixes the live defects (A–G) so that: an orchestrator can learn a live run's `runId` the moment it needs it, run IDs and the child's project root are correct, a companion's findings are readable through one documented command regardless of lane, and a clean shutdown is distinguishable from a crash.

## Goals

- An orchestrator can **deterministically learn a live run's `runId`** during the run's active window (the headline — A/B/C).
- Run-discovery read-paths **fail open to "active"**, not closed to null/empty/error, for a run whose pid is alive and whose `run.json.updatedAt` is advancing.
- Every emitted run identifier encodes **true UTC** (D); a spawned child's `MINIH_PROJECT_ROOT` is the **repo root** (E).
- A companion's `finding`/`summary` output is **readable through one documented operator command** regardless of lane, and the exemplar points operators at it (F).
- A run that ended cleanly (farewell / operator-stop / idle) is recorded with a **terminal state distinct from a crash** (G).
- Correct the two factual mis-framings in the issue (D file inversion; A/B/C surface conflation) so fixes target the real code.
- **(Scope extension — Phase 5, from the #50 follow-up comment)** A companion **survives long human-in-the-loop gaps** (minutes to hours) without prematurely idle/stall/timeout-killing itself before reviewable work lands — via a runner heartbeat + configurable idle/stall/timeout ceilings, composing with (not pre-empting) #49.

## Non-Goals

- The schema item #5 (already fixed in v0.2.1).
- A full rewrite of the run lifecycle or the coordination MCP.
- Wiring `evaluateIdlePolicy` into the runner loop end-to-end — that is follow-up **#49**; this plan only ensures G's terminal taxonomy *can* represent an idle/clean stop (it coordinates with, but does not close, #49).
- Proving the complete orchestrator-drives-companion loop with a same-process fake adapter (a known limitation — see Risks).
- The larger **"attach a companion to a running session + feed it commits"** mechanism. Phase 5 lands the *longevity* approach only (heartbeat + ceilings + #49 compose); the attach+feed alternative is a flagged follow-up (the durable inbox already exists — only a `git log` → `outside inbox send` feeder is missing).

## Target Domains

| Domain | Status | Relationship | Role in This Feature |
|--------|--------|--------------|----------------------|
| runner | existing | **modify** | Run read-path / liveness / reconcile-on-read (A/B/C); UTC runId (D); `MINIH_PROJECT_ROOT` (E); terminal classification (G); companion findings ledger surface (F) |
| cli | existing | **modify** | `status`, `runs list`, `history`, `last-run` fail-open behaviour (A/B/C); a lane-agnostic findings command (F) |
| _docs | n/a | **create** | `docs/how/` operator guide for reading companion findings (F); fix `agents/code-review-companion/outside.md` exemplar |

No new domains. All touched domains have existing `domain.md` files. (`mcp`/`adapter`/`measurement` are not expected to change; #5 which would touch `mcp` is out of scope.)

## Testing Strategy

- **Approach**: **Full TDD** — write the failing regression test first for each defect, then fix.
- **Rationale**: every code defect has a clean deterministic check, and minih is TDD-first/fixture-based; regression tests are also the durable proof that companion mode stays drivable.
- **Focus Areas**: run read-path verdict computation (status/runs-list/history/last-run) against on-disk fixtures with a live pid; liveness probe truth for a running pid; reconcile-on-read of stale dead-pid orphans; runId UTC equality with `startedAt`; child `MINIH_PROJECT_ROOT` resolution; lane-agnostic findings retrieval; terminal-state classification for farewell/idle/clean-stop vs crash.
- **Excluded**: the full orchestrator↔companion integration loop where the inside-MCP must be driven by a real SDK adapter (can't be exercised by a same-process fake — proven at the unit/read-path level instead).
- **Mock Usage**: **Avoid mocks — real fixtures.** Use real on-disk `run.json` / `events.ndjson` / run folders. Targeted seam only where unavoidable (a process-liveness probe or clock injected behind an existing seam), never general mocking.

## Documentation Strategy

- **Location**: **`docs/how/` + fix the exemplar.** Add a short operator guide (reading a companion's findings regardless of lane) under `docs/how/`, and correct `agents/code-review-companion/outside.md` so the documented skim reads the inside lane / the new findings command.
- **Rationale**: F's root cause is documentation pointing operators at the wrong lane; the fix is part code (a lane-agnostic command) and part doc.

## Complexity

- **Score**: CS-4 (large)
- **Breakdown**: S=2, I=1, D=1, N=1, F=1, T=2  (sum 8 → CS-4)
- **Confidence**: 0.70 — root causes verified with file:line; residual unknowns are the exact peer-activity surface behind C's literal symptom and the desired terminal-state taxonomy for G.
- **Assumptions**: see Risks & Assumptions.
- **Dependencies**: coordinates with open issue **#49** (idle-policy wiring) for G.
- **Risks**: see Risks & Assumptions.
- **Phases** (anticipated; locked at architect):
  1. **Run-discovery fail-open** (A/B/C) — status verdict from pid-alive + recent `updatedAt`; runs-list/liveness truth + the `--all` flag (wire or remove); history/last-run resolution; reconcile-on-read of stale orphans; investigate/confirm the peer-activity surface behind C's literal symptom.
  2. **Identifier & env correctness** (D/E) — UTC runId; `MINIH_PROJECT_ROOT` = repo root.
  3. **Findings read-path** (F) — lane-agnostic operator command over the existing ledger; fix the exemplar; `docs/how/` guide.
  4. **Terminal classification** (G) — clean/idle/farewell terminal reasons distinct from crash; coordinate with #49.

## Acceptance Criteria

1. **AC-A** — `minih status <slug>` for a freshly-booted, still-running run (pid alive, `run.json.updatedAt` advancing, `events.ndjson` empty or absent) returns `verdict:"active"` and the live `runId` (not null/`unknown`). The documented `minih status "$SLUG" | jq -r '.data | select(.verdict=="active") | .runId'` yields the live runId.
2. **AC-B** — `minih runs list` and `minih runs list --active` include a genuinely-live run; the liveness probe reports `alive` for a running pid. Stale dead-pid `active` orphans do not cause a live run to be dropped or mislabeled `dead`. The `--all` flag either measurably broadens the result set or is removed/documented — no silent no-op flag remains.
3. **AC-C** — `minih history <slug>` and `minih last-run <slug>` resolve any agent that `minih list` resolves from the same cwd (no spurious `E121` for an agent whose `prompt.md` exists). The surface the orchestrator uses for boot-detection returns the live `runId` during the active window; the `E121`/null behaviour is reframed against the real (peer-activity) code path, with a test pinning the corrected behaviour.
4. **AC-D** — every run-folder name / `runId` encodes true UTC and refers to the same instant as that run's `run.json.startedAt` (a regression test asserts the runId timestamp parses to the same UTC instant as `startedAt`). No emitted timestamp is local-time suffixed with `Z`.
5. **AC-E** — a spawned child agent's `MINIH_PROJECT_ROOT` equals the resolved project root (git root / `canonicalRoots[0]`), not the run directory; asserted by a test for the companion-spawn case.
6. **AC-F** — one documented operator command surfaces a companion's `finding` and `summary` messages regardless of lane (e.g. `minih companion findings <slug>` over the existing ledger, or a corrected documented `inside`-lane read). A HIGH finding emitted by a companion is visible via the documented path. `agents/code-review-companion/outside.md` no longer instructs operators to read the outside lane for findings; a `docs/how/` guide documents the read path.
7. **AC-G** — a run that ended cleanly (sent `farewell`, operator-stopped, or idle-timed-out with 0 errors) is recorded with a terminal classification **distinct from a crash** — a clean `terminalReason` (e.g. `completed`/`operator-stop`/`idle`) rather than `status:"failed"`/`result:"degraded"` with `terminalReason:null`. The taxonomy can represent an idle/clean stop (coordinating with #49, which does the live wiring).
8. **AC-meta** — the two factual mis-framings in the issue are corrected in the fix (D targets `folder.ts`, not `run.json`; A/B/C target the real read-path + peer-activity surface, not a `--all` filter), and #50 can be closed/commented with the accurate disposition per defect.
9. **AC-H (scope extension — Phase 5)** — a companion configured survive-gaps survives a simulated long human gap (no provider events past the old 300s stall threshold; idle past the old 30-min budget) without a hard `stalled-stream`/`timeout`/idle stand-down, while a runner heartbeat keeps `updatedAt` advancing so run-discovery (AC-A) still reports it `active`; the survive-gaps posture composes with #49 (a still-needed companion is not stood down); the wall-clock `timeout` remains the ultimate backstop.

## Risks & Assumptions

- **Fail-open must not mask real failures.** Treating a live-pid + recent-`updatedAt` run as active must still correctly report a genuinely dead/stalled run — the stall watchdog (plan 026) and dead-pid liveness (plan 025) semantics must be preserved, not regressed.
- **Reconcile-on-read races.** Healing stale dead-pid orphans during an inventory read must avoid lock/write races with a live run; may reuse the existing `reconcile-lock` / `run-lock`.
- **Same-process fake can't drive the inside-MCP** (known): the full orchestrator→companion integration can't be proven by a same-process `FakeAgentAdapter`; A/B/C/F are proven at the read-path/unit level with real fixtures, and the end-to-end is an inferential/manual check.
- **C is partly investigative.** The literal symptom came from a peer-activity surface; some of Phase 1 is confirming exactly what the orchestrator hit before deciding the fix shape.
- **G overlaps #49.** The terminal taxonomy change must not collide with the idle-policy wiring tracked in #49; coordinate (and possibly land the taxonomy here, the wiring in #49).
- **Timestamp change is identity-affecting.** Changing the runId format changes run-folder names; existing on-disk runs use the old (local-as-Z) format — ensure ordering/back-compat for already-written folders.

## Open Questions

1. What exactly is the peer-activity status surface that returned `{runId:null, selfReportedState:null, currentlyRunningTool:null}` for Defect A — a coordination MCP read, `peer-activity.ts` consumer, or an older build? (Phase 1 investigation.)
2. Should `runs list --all` be **wired** to broaden the view, or **removed** as a misleading no-op? (Decide in Phase 1 / architect.)
3. What is the desired **terminal-state taxonomy** for G — extend `terminalReason` with `operator-stop`/`idle`/`completed`, keep a distinct `status:"degraded"`, or both? (Workshop candidate; coordinate with #49.)
4. Should reconcile-on-read be implicit in every inventory read, or a narrower heal-the-selected-run step? (Architect.)

## Workshop Opportunities

| Topic | Type | Why Workshop | Key Questions |
|-------|------|--------------|---------------|
| Run read-path fail-open + reconcile-on-read | State Machine / Integration Pattern | A/B/C share this; it's the headline and has race/back-compat hazards | When is a run "active"? How to heal stale dead-pid orphans on read without racing a live run? What does each read-path return mid-window? |
| Terminal-state taxonomy | State Machine | G needs a clean vs crash vs degraded vs idle vocabulary that coordinates with #49 | Which terminal reasons exist? Is `farewell` authoritative? How does this compose with the idle policy (#49)? |

## Clarifications

### Session 2026-06-15

Round 1 (front-loaded, batched):

- **Workflow Mode** → **Full**. The fixes span run-discovery (A/B/C), timestamps+env (D/E), findings read-path+docs (F), and terminal classification (G) across runner/cli/agents/docs — naturally 3–4 phases.
- **Testing Strategy** → **Full TDD**. Failing regression test first per fix; matches minih's TDD-first convention; every code defect has a deterministic check.
- **Mock Usage** → **Avoid mocks — real fixtures** (on-disk `run.json`/`events.ndjson`/run folders); targeted seam only where unavoidable (liveness probe / clock).
- **Documentation Strategy** → **`docs/how/` guide + fix exemplar**. Correct `agents/code-review-companion/outside.md` and add a short operator findings-read guide under `docs/how/`.

Round 2: not triggered — Target Domains are all existing (no NEW/contested entries); no critical `[NEEDS CLARIFICATION]` markers remain (open items are tracked under Open Questions, not as blocking markers).

### Scope extension 2026-06-16 (post-architect)

A follow-up comment on issue #50 reported a *structural* companion problem (idle-times-out during long human-in-the-loop gaps before any reviewable commit lands). The user chose to fold this in as **Phase 5** (companion longevity) — adding **Goal: survive long human gaps** and **AC-H** above. The larger "attach + feed commits" alternative is a flagged follow-up (Non-Goals). This widened the plan from 4 → 5 phases.
