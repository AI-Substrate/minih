# Code Review Companion — outside contract (Power On Mode orchestrator script)

This is the **orchestrator-side** script for the canonical companion-mode agent. The companion's `prompt.md` defines what happens *inside* the agent's SDK session; this file is what *you* (the human operator or the orchestrating agent driving implementation) run from the outside.

Read this once at session start; it's a recipe, not a reference. Detailed protocol rationale lives in [`docs/how/companion-mode.md`](../../docs/how/companion-mode.md).

---

## What this agent is for

You're shipping code. You want a second pair of eyes that follows along — reviews each commit at commit time, fires findings asynchronously, and writes a farewell envelope at the end with everything it saw. That's this companion.

This is **not** a one-shot reviewer. It boots, long-polls the inbox, and reacts to messages without exiting. You drive the lifecycle: boot → brief → per-commit pings → control:stop → read farewell.

> ⚠️ **Permission requirement**: companion-mode runs need `write` permission so the farewell envelope can land. This companion's `prompt.md` already sets `permissions.overrides.write: allow`. If you fork it, keep that override or pick a write-permitting preset, or `minih run` will refuse with [`E205 COORDINATION_WRITE_DENIED`](../../docs/how/permissions.md#coordinated-agents).

---

## 1. Install (one-time per project)

The companion ships as an installable agent-pack. Re-running is idempotent — it upgrades or reports `unchanged`:

```bash
minih agent install code-review-companion
```

This copies the canonical agent files into `agents/code-review-companion/` and writes a provenance sidecar. See [`docs/how/agent-pack.md`](../../docs/how/agent-pack.md) for the full surface.

---

## 2. Boot

```bash
export GH_TOKEN=$(gh auth token)   # required; the spawning shell needs this
minih run code-review-companion &
sleep 12
```

Capture the active run id:

```bash
RUN_ID=$(minih status code-review-companion 2>/dev/null | jq -r '.data | select(.verdict == "active") | .runId')
echo "Run: $RUN_ID"
```

The `verdict: 'active'` filter is load-bearing — `minih status` defaults to "latest run" which may be a completed one from a prior session.

**Boot failure modes**:

- `E122 GH_TOKEN not set` → the spawning shell needs `GH_TOKEN`. The Copilot CLI runtime doesn't reliably inherit it; explicit export is required.
- `E205 COORDINATION_WRITE_DENIED` → the resolved permission policy denies `write`. See [`permissions.md § Coordinated agents`](../../docs/how/permissions.md#coordinated-agents).
- Boot times out / no active run after 12s → wait another 30s, re-check. If still no active run, inspect `minih status` output and run logs under `agents/code-review-companion/runs/`.

---

## 3. Brief (one-shot at session start)

Send **one** `briefing`-typed message naming the plan, the protocol, and what to watch for. Brief once; do not re-brief mid-session unless the scope materially changes.

```bash
minih outside inbox send code-review-companion --run "$RUN_ID" \
  --type briefing \
  --subject "Plan NNN: <title> — Power On Mode start" \
  --body "Plan: <abs path to plan.md>
Spec: <abs path to spec.md>

Protocol:
- I will ping at every per-commit boundary as type=task with subject 'review-request: T### <sha>'
- Fire-and-forget; reply only if you find issues
- I'll send control:stop when the session ends

Hazards (from plan Key Findings):
- <hazard 1>
- <hazard 2>

Domain context:
- <domain> + <expectations from domain.md>

Please watch for: domain compliance violations, contract drift, anti-reinvention overlaps, scope creep beyond the task table."
```

The companion long-polls with `waitForAny: ['task', 'question', 'directive', 'control', 'briefing', 'review-request']` — any of these wake it up.

---

## 4. Review at every commit boundary

After every meaningful commit, fire a `review-request`:

```bash
SHA=$(git rev-parse --short HEAD)
minih outside inbox send code-review-companion --run "$RUN_ID" \
  --type task \
  --subject "review-request: T### $SHA" \
  --body "Diff: git show $SHA. Watch for: <task-specific concerns — domain boundary, contract change, scope drift>. Reply if you find issues."
```

**Fire-and-forget.** Do NOT wait for a reply before moving to the next task. The companion replies asynchronously only if it finds issues.

### Skim the inbox between commits (cheap)

Before starting the next task, glance at the outside inbox for new findings:

```bash
minih outside inbox list code-review-companion --run "$RUN_ID" --unread 2>&1 | jq '.data.messages | map({id, from, type, subject, ackOf})'
```

- **No new messages** → proceed immediately.
- **New `finding`-typed message** → read it. If `severity: HIGH|CRITICAL`, address inline before the next task. If `MEDIUM|LOW`, queue for end-of-phase or address opportunistically. Either way, log the finding's `ackOf` mapping so the verdict reconciliation at session end can surface it.
- **New `summary` APPROVE** → great, log it; proceed.
- **`question`-typed message with subject `still-needed`** → the companion's check-in protocol (plan 019) fired because it hasn't heard from you in a while. Reply with another `task` (resumes work), a `directive` (keeps it alive), or `control:stop` (ends cleanly). Ignoring leads to `no_engagement` or `idle_budget` exit. See [`docs/how/companion-mode.md § Lifecycle and check-in protocol`](../../docs/how/companion-mode.md#lifecycle-and-check-in-protocol).

### Handling findings inline

When a finding lands:

1. Read it (file:line, category, severity, recommendation).
2. Decide: fix now, fix at end of phase, or document deferral with reasoning.
3. If fixing: make the fix, commit it as a `fix:` commit, and ping the new SHA as another review-request. The companion verifies the fix on the next ping.
4. If deferring: log the finding ID + reasoning in your execution log so the end-of-session reconciliation surfaces it.

---

## 5. (Optional) Final drain ping

Before stopping, send one final review-request asking for a full-range sweep:

```bash
minih outside inbox send code-review-companion --run "$RUN_ID" \
  --type task \
  --subject "review-request: final $SHA — DONE" \
  --body "Final commit. Please scan the entire commit range for: <specific final checks>. I'll send control:stop after I read your reply."
```

This gives the companion one last chance to surface findings that only emerge from looking at the full diff range. Wait briefly for the reply, then proceed to step 6.

---

## 6. Stop and read the farewell

**Send `control:stop` before reporting back to your user**:

```bash
minih outside inbox send code-review-companion --run "$RUN_ID" \
  --type control \
  --subject "stop" \
  --body "stop — session complete. Please write your farewell envelope and exit."
```

Wait for the farewell to land:

```bash
sleep 5
```

Then read it via the dogfood path:

```bash
minih retros --slug code-review-companion
# OR, for the just-completed run:
minih last-run code-review-companion
minih validate code-review-companion --file <path-from-last-run>
```

The farewell envelope contains the canonical session record — fold any open findings or retro insights into your operator-facing report.

> 🛑 **Dogfood rule**: do NOT `cat agents/code-review-companion/runs/<run>/output/report.json` directly. The CLI surfaces above are the supported path. If they don't expose what you need, that's a missing surface — file it as a magicWand or fix dossier and use `cat` only after raising the gap explicitly.

---

## State vocabulary the companion uses (inside)

For reference when reading the inbox / state transitions: `idle | reading | reviewing | reporting | blocked | stopping`. See `prompt.md § 3 State Vocabulary` for the full meaning of each. The inside-state schema is enforced at runtime via the MCP `state_transition` tool. The canonical 0.2.0 install ships the schema at `inside-state.schema.json` (agent root) because `state/` is in the install-manifest runtime-dir denylist; the MCP resolver also accepts `state/inside-state.schema.json` for in-tree-only agents (e.g. `demo-companion`). Orchestrators MUST NOT set inside state directly; only the companion writes it.

## State vocabulary you (outside) use

Standard minih outside enum: `idle | in-progress | paused | done | error`. Set it via:

```bash
minih outside state set code-review-companion --run "$RUN_ID" \
  --status in-progress \
  --data-json '{"phase":"impl-T015","plan":"021-coordinated-install-resilience","commitsReviewed":3,"lastReviewedSha":"abc1234"}'
```

The companion uses `wait_for_any` to listen for both inbox messages AND outside-state changes, so flipping outside state wakes it up the same way an inbox message does (see [`docs/how/companion-mode.md § Wait-for-any`](../../docs/how/companion-mode.md#wait-for-any-plan-014-and-companion-mode)).

---

## Troubleshooting

- **Companion appears `dead` after >30min silence** — known false positive when the companion is mid-tool-call. Check `currentlyRunningTool` and `selfReportedState` in `minih status` — both being non-null is a strong "alive" signal. Don't kill it.
- **`still-needed` check-in arrived and you didn't see it** — your inbox skim missed it. The companion fires this after `firstContactPollThreshold` (~10 min default) or `postTaskPollThreshold` (~5 min default) empty polls. Reply with a `task`, `directive`, or `control:stop`; or accept the clean exit. See [`docs/how/companion-mode.md § Lifecycle and check-in protocol`](../../docs/how/companion-mode.md#lifecycle-and-check-in-protocol).
- **Run wedged at `status: 'active'` for 30+min** — known limitation as of `code-review-companion@0.2.0`. A runner-level MCP-error watchdog that terminates such runs cleanly is scoped for a follow-up plan (see [plan 021](../../docs/plans/021-coordinated-install-resilience/) § Scope Reduction). Until then, recovery is manual: `kill <pid>` and inspect the run-dir state.

---

## See also

- [`prompt.md`](./prompt.md) — the companion's identity and coordination loop (inside-side contract).
- [`docs/how/companion-mode.md`](../../docs/how/companion-mode.md) — Power On Mode protocol rationale + lifecycle deep-dive.
- [`docs/how/agent-pack.md`](../../docs/how/agent-pack.md) — install / upgrade / drift surface.
- [`docs/how/permissions.md`](../../docs/how/permissions.md) — the write-permission requirement.
- [`agents/coordination-loop-validator/outside.md`](../coordination-loop-validator/outside.md) — richer canonical coordination loop example (not companion-mode, but useful for understanding outside/inside conventions).
- [`AGENTS.md`](../../AGENTS.md) § Companion mode — minih's own dogfooding of this agent.
