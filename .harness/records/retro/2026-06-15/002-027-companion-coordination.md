---
schema_version: "1.0"
retro_id: "2026-06-15T10:45:42Z-agent-027p45drn"
agent: agent
plan_id: 027-companion-coordination
started_at: "2026-06-15T04:08:43.613Z"
ended_at: "2026-06-15T10:45:42Z"
summary: "eng-harness-4-retro --drain ([a]ll-save) of plan 027 (companion-coordination) P4–P5 friction — 4 entries (DL-001, COORD-001, DL-002, DL-003). Dominant cluster: DL-001 + DL-002 = the-flow regenerates its plan JSON unformatted and both `just fft` and `harness boot` run lint BEFORE format, so the flow's own bookkeeping reddens the gate every phase — the same cluster as SUGG-001/SUGG-002 from the P1–P3 drain, now re-paid 4x. Strongest encode candidate. COORD-001: companion-mode skim read the OUTSIDE lane, so inside-lane findings were invisible for 7 commits. DL-003: `minih status` lastPollAt mis-read a live companion as dead. Nothing encoded this drain — encode candidates routed below."
entries:
  - id: DL-001
    kind: difficulty
    description: "just fft lint (biome check CI-mode) failed on docs/plans/027-companion-coordination/the-flow.json — the-flow regenerated the JSON unformatted (artifacts[] single-line), and fft runs lint BEFORE format, so the flow's own bookkeeping reddened the gate mid-Phase-4. Same cluster as SUGG-001/SUGG-002, re-paid again this phase."
    target: tooling
    severity: annoying
    workaround: "biome check --write the-flow.json then re-run fft"
    suggested_encoding: "the-flow biome-formats the plan JSON on write, or fft runs format before lint"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-15T04:08:43.613Z"
  - id: COORD-001
    kind: coordination
    description: "Companion-mode skim used 'minih outside inbox list' (the OUTSIDE lane) to check for companion findings — that lane only shows what the outside wrote, so the companion's inside-lane findings/summaries were invisible and I proceeded through 7 commits believing the run was clean. The companion had actually sent 4 findings (3 HIGH) + REQUEST_CHANGES, only discovered at the farewell read. To skim a companion's own output use the INSIDE lane (inbox/inside/messages.ndjson or 'minih inside inbox list')."
    target: minih
    suggested_encoding: "companion-mode skill: per-task skim must read the inside lane (minih inside inbox list --run), not outside inbox list; or add 'minih companion findings <slug> --run' over the new ledger"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-15T04:16:13.018Z"
  - id: DL-002
    kind: difficulty
    description: "boot lint sensor (biome check .) fails on docs/plans/**/the-flow.json format drift — guided-mode writes that flight-plan JSON unformatted, so every phase's pre-implement boot trips on a cosmetic nit unrelated to code"
    target: tooling
    severity: annoying
    suggested_encoding: "the-flow JSON writer runs biome-format on write, OR exclude docs/plans/**/*.json from the boot lint sensor"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-15T07:05:22.967Z"
  - id: DL-003
    kind: difficulty
    description: "minih status .data.lastPollAt read as null while the code-review-companion was actively polling+reviewing, so I wrongly concluded it never engaged / was dead; only reading output/report.json directly revealed it had reviewed every commit and found 3 findings"
    target: runtime-inspectability
    severity: degrading
    suggested_encoding: "fix lastPollAt derivation OR have 'minih status' surface a recent-inside-lane-activity summary so a peer can tell engagement at a glance"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-15T07:05:23.036Z"
system:
  compound:
    bubble_action: "all-save"
---

# Plan 027 — companion-coordination — P4–P5 retro drain

Drained at plan-complete (before merge of PR #48). 4 entries, all-save. See frontmatter `summary` for the cluster analysis. The dominant signal (DL-001 + DL-002, echoing SUGG-001/SUGG-002) is the strongest encode candidate this plan: **the-flow writes its plan JSON unformatted and the lint sensors run before format**, so the gate reddens on the flow's own bookkeeping every phase.
