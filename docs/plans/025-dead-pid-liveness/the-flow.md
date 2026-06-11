# Flow — dead-pid-liveness

Generated from `the-flow.json`.

```mermaid
flowchart TD
  classDef done fill:#d9f7d9,stroke:#2e7d32,color:#111
  classDef wip fill:#ffe7c2,stroke:#ef6c00,color:#111
  classDef blocked fill:#ffd6d6,stroke:#c62828,color:#111
  classDef known fill:#dde8f3,stroke:#546e7a,color:#111
  classDef assumed fill:#f5f5f5,stroke:#9e9e9e,stroke-dasharray: 5 5,color:#555
  classDef said fill:#fff7cc,stroke:#b58900,color:#111
  classDef harness fill:#EDE7F6,stroke:#673AB7,color:#111

  research["Evidence: FX dossiers reconciled — designs hold, 0% implemented; proof strategy answered"]:::done
  spec["Spec — CS-3, Simple, trio staged (FX009 → FX012 → FX011)"]:::done
  backpressure["Backpressure — Partial; tiny Phase 0 (seams-first)"]:::harness
  plan["Plan — READY, 17 tasks, validated with fixes"]:::done
  build["Implementation — DONE: 17/17 tasks, 13/13 ACs, fft green (1260 tests)"]:::done
  review["Code review — APPROVE (91% coverage confidence); 4 MEDIUM + 2 LOW findings → fix pass done, fft 1265/0"]:::done
  merge["Merge — via GitHub PR (stage-8 in-repo merge skipped by user decision); flow complete"]:::done

  said_research>"🗣 go after group 1, not sure how we prove hte fix though. work on branch"]:::said
  said_research -.- research
  said_spec>"🗣 yes — clarify: trio staged · unify 'dead' · exported verdict fn · shared probe upgrade · Simple · hybrid testing · targeted mocks · hybrid docs"]:::said
  said_spec -.- spec
  said_bp>"🗣 yes"]:::said
  said_bp -.- backpressure
  said_plan>"🗣 contnue"]:::said
  said_plan -.- plan
  said_build>"🗣 run it"]:::said
  said_build -.- build
  said_review>"🗣 code review is running in athoer agent · fix pass"]:::said
  said_review -.- review
  said_merge>"🗣 yeah commit and push, mark the flow as complete as we wil be merging via pr"]:::said
  said_merge -.- merge

  research --> spec --> backpressure --> plan --> build --> review --> merge
```

Legend: done / wip / blocked / known / assumed; 🗣 user input; 🟪 harness loop (backpressure done pre-plan; pre-implement boot + phase-end retro drain fired inside the build — retro record at `.harness/records/retro/2026-06-11/002-025-dead-pid-liveness.md`).

Mid-review seam: issue #44 (live-pid stalled-stream — the complementary quadrant of #24) was triaged, commented, and queued as plan 026 (stall watchdog + run budgets).

Fix pass (post-APPROVE): F001 `--all` mutual exclusion (E108) · F002 race-hardened reconcile lock (lost steals → E190, never raw fs errors) · F003 forced-TTY render smoke (both dead routes, built CLI) · F004/F005 runner domain + map currency · F006 honored as the commit split. +5 tests, suite 1265/0.

**Flow complete** — merge via GitHub PR (user decision; stage-8 in-repo merge skipped). Plan-complete seam: fix-pass insights drained to `.harness/records/retro/2026-06-11/003-025-dead-pid-liveness-fix-pass.md`. Follow-up queued outside this flow: plan 026 (issue #44 stall watchdog + run budgets).
