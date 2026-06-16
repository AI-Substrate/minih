---
record_kind: "retro"
harness_version: "0.3.0"
branch: "028-companion-mode-reliability"
repo: "https://github.com/AI-Substrate/minih.git"
created_at: "2026-06-16T07:47:39.884Z"
agent: claude-code
plan_id: 028-companion-mode-reliability
schema_version: "1.1"
retro_id: "2026-06-16T07:47:53Z-claude-code-061c"
started_at: "2026-06-16T07:47:02.923Z"
ended_at: "2026-06-16T07:47:53Z"
summary: "Plan 028 Phase 3 (defect #50 F) — added `minih companion findings <slug>` over the existing lane-agnostic ledger (TDD, live code-review-companion). Two friction signals: a missing pre-commit sensor for size-capped/bundled contract files (the 8KB outside.md cap + dist bundle staleness only failed in the full suite, after the doc commit), and a magic-wand the live companion itself named — a contract-drift sweep over prompt-listed surfaces after contract-changing reviews."
entries:
  - id: DL-001
    kind: difficulty
    description: "outside.md's 8192-byte doctor cap and the dist/AGENTS_README staleness only surfaced in the FULL vitest run AFTER the T003 doc commit — no pre-commit sensor flagged that a doc edit pushed a size-capped/bundled file over budget"
    target: project-sensor
    severity: degrading
    workaround: "ran the full suite, trimmed outside.md back under 8192, rebuilt to re-bundle dist"
    suggested_encoding: "a pre-commit/just recipe asserting size-capped contract files (outside.md <=8KB) + dist bundle freshness before commit"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-16T07:47:02.923Z"
  - id: MW-001
    kind: magic-wand
    description: "the live code-review-companion caught real AGENTS_README/companion-mode contract drift that validate-v2 and I both missed — a recurring 'doc surfaces drift after a contract change' pattern its own magicWand names"
    target: tooling
    suggested_encoding: "a bounded contract-drift sweep template the companion runs over prompt-named surfaces (incl. AGENTS_README, dogfood examples) after every contract-changing review"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-16T07:47:02.995Z"
---

# Retro — plan 028 Phase 3 (findings read-path, F)

The phase fixed itself live: a raw `inbox list | jq 'select(.sender=="inside")'` skim showed 0 messages, while the new `minih companion findings` command surfaced the companion's 2 findings + 4 summaries — defect #50 F reproduced and fixed in the same session.

Two tiers caught what the other couldn't: the **inferential** tier (the live companion) flagged the AGENTS_README / companion-mode `cat report.json` contract drift; the **computational** tier (the test suite's 8KB `outside.md` cap + dist-bundle freshness check) flagged the size overflow the companion missed. Both signals are encodable — see DL-001 (a pre-commit doc-budget sensor) and MW-001 (a companion contract-drift sweep).
