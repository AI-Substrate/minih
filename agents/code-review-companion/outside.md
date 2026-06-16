# Code Review Companion — outside contract (Power On Mode orchestrator script)

This is the **orchestrator-side** script for the canonical companion-mode agent. The companion's `prompt.md` defines what happens *inside* its SDK session; this file is what *you* (human operator or supervising agent) run from the outside.

Read once at session start; it's a recipe, not a reference. Detailed protocol rationale lives in [`docs/how/companion-mode.md`](../../docs/how/companion-mode.md).

---

## What this agent is for

You're shipping code. You want a second pair of eyes that reviews each commit at commit time, fires findings asynchronously, and writes a farewell envelope at the end. That's this companion.

**Not** a one-shot reviewer. It boots, long-polls the inbox, reacts to messages without exiting. You drive the lifecycle: boot → brief → per-commit pings → control:stop → read farewell.

> ⚠️ **Permission requirement**: companion-mode runs need `write` permission so the farewell envelope can land. This companion's `prompt.md` already sets `permissions.overrides.write: allow`. If you fork it, keep that override or `minih run` will refuse with [`E205 COORDINATION_WRITE_DENIED`](../../docs/how/permissions.md#coordinated-agents).

---

## 1. Install (one-time per project)

The companion ships as an installable agent-pack; re-running is idempotent (upgrades or reports `unchanged`):

```bash
minih agent install code-review-companion
```

Copies canonical files into `agents/code-review-companion/` + writes a provenance sidecar. See [`docs/how/agent-pack.md`](../../docs/how/agent-pack.md).

---

## 2. Boot

```bash
export GH_TOKEN=$(gh auth token)   # required; the spawning shell needs this
minih run code-review-companion &
sleep 12
RUN_ID=$(minih status code-review-companion 2>/dev/null | jq -r '.data | select(.verdict == "active") | .runId')
echo "Run: $RUN_ID"
```

The `verdict: 'active'` filter is load-bearing — `minih status` defaults to "latest run" which may be a completed one. (`verdict: 'dead'` = process gone; heal via `minih reconcile`.)

**Boot failures**: `E122 GH_TOKEN not set` (export explicitly — Copilot CLI doesn't reliably inherit); `E205 COORDINATION_WRITE_DENIED` (see [permissions.md](../../docs/how/permissions.md#coordinated-agents)); no active run after 12s (wait 30s more, check `minih status` + `agents/code-review-companion/runs/`).

---

## 3. Brief (one-shot at session start)

Send **one** `briefing`-typed message naming plan/protocol/hazards. Brief once; don't re-brief mid-session unless scope changes.

```bash
minih outside inbox send code-review-companion --run "$RUN_ID" \
  --type briefing \
  --subject "Plan NNN: <title> — Power On Mode start" \
  --body "Plan: <abs path to plan.md>
Spec: <abs path to spec.md>

Protocol: per-commit task pings with subject 'review-request: T### <sha>'; fire-and-forget; control:stop at end.

Hazards (from plan Key Findings):
- <hazard 1>
- <hazard 2>

Watch for: domain compliance, contract drift, anti-reinvention, scope creep."
```
```

The companion long-polls `waitForAny: ['task', 'question', 'directive', 'control', 'briefing', 'review-request']`.

---

## 4. Review at every commit boundary

After every meaningful commit, fire a `review-request`:

```bash
SHA=$(git rev-parse --short HEAD)
minih outside inbox send code-review-companion --run "$RUN_ID" \
  --type task \
  --subject "review-request: T### $SHA" \
  --body "Diff: git show $SHA. Watch for: <task-specific concerns>. Reply if you find issues."
```

**Fire-and-forget.** Do NOT wait for a reply before moving on. The companion replies asynchronously only on findings.

### Read findings between commits

The canonical, **lane-agnostic** findings read-path — one command, regardless of which inbox lane the companion wrote to (#50 F):

```bash
minih companion findings code-review-companion --run "$RUN_ID" --json | jq '.data.findings'
```

`.data.findings` is the companion's structured findings (severity / file / category / issue / recommendation); `.data.summariesCount` and `.data.draftFarewell.summary` surface the review summary. It derives over the same ledger `minih companion status` uses, so the two never drift.

> ⚠️ Do **not** hand-`jq` a raw inbox lane file for findings — the companion writes findings to its *inside* lane, so `jq`-ing the outside lane silently misses them. `minih companion findings` reads the right lane for you.

To just check whether the companion sent *anything* new since the last commit (a cheap liveness skim — **not** the findings read-path):

```bash
minih outside inbox list code-review-companion --run "$RUN_ID" --unread 2>&1 | jq '.data.messages | map({id, from, type, subject, ackOf})'
```

- **No new messages** → proceed.
- **`finding` HIGH/CRITICAL** → read it via `minih companion findings` above; address inline before the next task.
- **`finding` MEDIUM/LOW** → queue for end-of-phase. Log the `ackOf` mapping for end-of-session reconciliation.
- **`summary` APPROVE** → log it; proceed.
- **`question` `still-needed`** → check-in protocol fired (plan 019). Reply with another `task`/`directive` to keep alive, or `control:stop` to end. Ignoring leads to `no_engagement` / `idle_budget` exit. See [`docs/how/companion-mode.md § Lifecycle and check-in protocol`](../../docs/how/companion-mode.md#lifecycle-and-check-in-protocol).

### Handling findings inline

1. Read it (file:line, category, severity, recommendation).
2. Decide: fix now, fix at phase end, or document deferral.
3. If fixing: commit as `fix:` + ping new SHA as another `review-request`. Companion verifies on next ping.
4. If deferring: log finding ID + reasoning in your execution log.

---

## 5. (Optional) Final drain ping

Before stopping, fire one final review-request asking for a full-range sweep:

```bash
minih outside inbox send code-review-companion --run "$RUN_ID" \
  --type task \
  --subject "review-request: final $SHA — DONE" \
  --body "Final commit. Scan the entire commit range for: <specific final checks>. control:stop follows."
```

---

## 6. Stop and read the farewell

```bash
minih outside inbox send code-review-companion --run "$RUN_ID" \
  --type control --subject "stop" \
  --body "stop — session complete. Please write your farewell and exit."
sleep 5
minih retros --slug code-review-companion
# OR for the just-completed run:
minih last-run code-review-companion
minih validate code-review-companion --file <path-from-last-run>
```

The farewell envelope is the canonical session record — fold open findings + retro insights into your operator-facing report.

> 🛑 **Dogfood rule**: do NOT `cat agents/code-review-companion/runs/<run>/output/report.json` directly. Use the CLI surfaces above. If they don't expose what you need, that's a missing surface — file it as a magicWand/fix dossier before falling back.

---

## State vocabularies

**Inside** (companion sets via MCP `state_transition`): `idle | reading | reviewing | reporting | blocked | stopping`. Schema enforces this enum. Canonical 0.2.0 install ships the schema at `inside-state.schema.json` (agent root); `state/` is the install-manifest runtime-dir denylist, so the path lives at root. Orchestrators MUST NOT set inside state.

**Outside** (you set via CLI): `idle | in-progress | paused | done | error`.

```bash
minih outside state set code-review-companion --run "$RUN_ID" \
  --status in-progress \
  --data-json '{"phase":"impl-T015","plan":"NNN-...","commitsReviewed":3,"lastReviewedSha":"abc1234"}'
```

The companion uses `wait_for_any` on inbox AND outside-state, so flipping outside state wakes it like an inbox message (see [`docs/how/companion-mode.md § Wait-for-any`](../../docs/how/companion-mode.md#wait-for-any-plan-014-and-companion-mode)).

---

## Troubleshooting

- **Companion appears `dead` after >30min** — false positive when mid-tool-call. Check `currentlyRunningTool` + `selfReportedState` in `minih status`; both non-null = alive. Don't kill.
- **`still-needed` arrived and you missed it** — skim was late. Fires after `firstContactPollThreshold` (~10min) or `postTaskPollThreshold` (~5min) empty polls. Reply with `task`/`directive`/`control:stop`, or accept the clean exit.
- **Run wedged at `status: 'active'` for 30+min** — known limitation as of `code-review-companion@0.2.0`. A runner-level MCP-error watchdog is scoped for a follow-up plan (see [plan 021](../../docs/plans/021-coordinated-install-resilience/) § Scope Reduction). Until then, diagnose via `minih status --run <id>`, `minih tail --run <id> --snapshot --lines 50`, `minih retros --slug code-review-companion`. If OS-level `kill <pid>` proves necessary, file the missing-surface gap first.

---

## See also

- [`prompt.md`](./prompt.md), [`docs/how/companion-mode.md`](../../docs/how/companion-mode.md), [`docs/how/agent-pack.md`](../../docs/how/agent-pack.md), [`docs/how/permissions.md`](../../docs/how/permissions.md), [`agents/coordination-loop-validator/outside.md`](../coordination-loop-validator/outside.md), [`AGENTS.md`](../../AGENTS.md) § Companion mode.
