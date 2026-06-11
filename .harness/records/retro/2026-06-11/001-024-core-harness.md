---
schema_version: "1.0"
retro_id: "2026-06-11T07:07:55Z-claude-code-024a"
agent: "claude-code"
plan_id: "024-core-harness"
started_at: "2026-06-11T06:14:33Z"
ended_at: "2026-06-11T07:07:55Z"
summary: "Plan 024-core-harness setup excursion + build: stood up the .harness/ substrate on harness-core 0.2.0 (composite boot, governance migration, friction loop). One difficulty captured live during boot authoring and drained here — the spec's sensor-composition line assumed a minih doctor --json flag that does not exist."
entries:
  - id: DL-001
    kind: difficulty
    description: "Spec sensor composition names 'minih doctor --json' but minih doctor has no --json flag (checked dist and src/cli/commands/doctor.ts) — only --strict exists"
    target: plan
    severity: annoying
    workaround: "boot composite runs minih doctor twice: plain exit code detects errors, --strict exit code detects warnings (no prose scraping, no src change)"
    suggested_encoding: "follow-up candidate: add --json MinihEnvelope output to minih doctor (src change, out of 024 scope)"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-11T06:14:33Z"
---

# Retro — 024-core-harness

First committed engineering-harness record for minih: the observe → record
round-trip proven end-to-end (AC-6). DL-001 is the spec-drift find from the
boot-authoring excursion; its deterministic workaround (the plain + `--strict`
exit-code pair) is documented in governance § Boot sensors and in
`harness instructions boot`. The encode candidate (`--json` envelope output for
`minih doctor`) stays open as a post-024 follow-up — it is a `src/` change and
out of this plan's scope by spec Non-Goal.
