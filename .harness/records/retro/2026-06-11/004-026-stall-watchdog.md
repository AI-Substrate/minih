---
schema_version: "1.0"
retro_id: "2026-06-11T23:20:00Z-claude-code-026sw"
agent: "claude-code"
plan_id: "026-stall-watchdog"
started_at: "2026-06-11T11:29:26Z"
ended_at: "2026-06-11T23:20:00Z"
summary: "Plan 026 build + review fix pass (issue #44): deadline-bounded SDK cleanup with forceStop escalation, any-event-reset stall watchdog, --stall-timeout/--max-turns budgets recorded in run.json. Stage-7 review returned REQUEST_CHANGES (1 HIGH F001: adapter suppressed the consolidated assistant.message after streamed deltas, so --max-turns missed real streaming turns); fix pass ran in companion mode (code-review-companion, zero findings, six APPROVEs over 752945f..a75d435). Final gate 1319/16, sdk-check 1.0.1. Three frictions drained below at the phase-end seam on Jordan's go."
entries:
  - id: DL-001
    kind: difficulty
    description: "SDK 1.0.1 silently removed session.destroy() and our mirror types (copilot-types.ts) kept tsc green while the runtime call would TypeError — the sdk-permission-shapes pin only covers permission shapes, not the session/client method surface, so an SDK minor can drop a method we call without any sensor firing"
    target: project-sensor
    severity: degrading
    workaround: "caught manually during T001 by diffing the installed .d.ts; T003 dropped the destroy rung"
    suggested_encoding: "extend test/adapter/sdk-permission-shapes.test.ts to pin the session/client method surface (abort/disconnect/forceStop/send/sendAndWait/on) so removals fail the bump canary"
    system:
      compound:
        status: suggested
        source: agent-self
        first_seen_at: "2026-06-11T21:27:51Z"
  - id: SUGG-001
    kind: improvement-suggestion
    description: "The CLI has no fake-adapter seam: a real 'minih run' needs GH_TOKEN plus the Copilot CLI, so built-CLI subprocess tests cannot execute a run end-to-end — plan 026 had to prove budget threading via a dry-run envelope echo instead, and the budgets-in-run.json proof had to live in the runner suite"
    target: project-sensor
    severity: annoying
    workaround: "dry-run budgets echo + runner-level manifest assertions"
    suggested_encoding: "consider a MINIH_FAKE_ADAPTER env seam in sdk-runtime.ts so subprocess tests can drive full runs deterministically"
    system:
      compound:
        status: suggested
        source: agent-self
        first_seen_at: "2026-06-11T21:27:54Z"
  - id: DL-002
    kind: difficulty
    description: "companion-mode per-task commits land unformatted — biome format errors surface only at phase-end fft (bit both the 026 build and FT-005 in the fix pass), so a formatting nit discovered at the gate forces a trailing cleanup commit instead of being absorbed at the task boundary"
    target: skill
    severity: annoying
    workaround: "npx biome check --write . after the fft failure, folded into the bookkeeping commit"
    suggested_encoding: "per-commit 'npx biome check --write' step in the stage-6c per-task checklist (or a repo pre-commit hook)"
    system:
      compound:
        status: suggested
        source: agent-self
        first_seen_at: "2026-06-11T22:55:26Z"
---

# Retro — 026 stall-watchdog (build + companion-mode fix pass)

Stage-7 review caught what the computational tier could not: the test seam (ScriptedAdapter emitting consolidated `message` events directly) masked that the production SDK adapter suppressed exactly that event for streamed turns — F001/HIGH, fixed in `ab0be14` with the suppression removed and display dedup confirmed downstream. SUGG-001 above is the structural answer to that seam gap. The companion debrief also produced a magicWand worth weighing: `outside inbox send --stop-after-summary` to auto-queue control:stop after the final review summary (its six APPROVE summaries were only reliably visible via the farewell envelope, not `outside inbox list`). Details: `docs/plans/026-stall-watchdog/execution.log.md`.
