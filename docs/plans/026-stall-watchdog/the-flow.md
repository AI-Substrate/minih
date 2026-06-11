# the-flow — 026-stall-watchdog

> Generated from `the-flow.json` — do not hand-edit.

```mermaid
flowchart TD
    classDef done fill:#C8E6C9,stroke:#2E7D32
    classDef wip fill:#FFE0B2,stroke:#EF6C00
    classDef blocked fill:#FFCDD2,stroke:#C62828
    classDef known fill:#BBDEFB,stroke:#1565C0
    classDef assumed fill:#F5F5F5,stroke:#9E9E9E,stroke-dasharray: 5 5
    classDef said fill:#FFF9C4,stroke:#F9A825
    classDef harness fill:#EDE7F6,stroke:#673AB7
    classDef companion fill:#E0F7FA,stroke:#00838F

    start["Kickoff — issue #44 stall watchdog"]:::done
    research["Explore — runner lifecycle, SDK surface, Perplexity stall causes"]:::done
    spec["Specify (Simple) — CS-3, 11 ACs, Behavior Contract"]:::done
    backpressure["Backpressure survey — Certainty: Partial"]:::harness
    plan["Architect → READY + validate-v2 fix pass"]:::done
    build["Implement — T000–T011 done, 11/11 ACs, fft 1310 green"]:::done
    review["Code review (stage 7) — REQUEST_CHANGES → fixed → settled"]:::done
    merge["Merge via PR (PROCEED-gated; posts #44 comment)"]:::known

    subgraph companion1["🤝 code-review-companion · run 2026-06-12T08-39-31-885Z-544e · 0 findings"]
        fix1["Fix pass — FT-001…FT-005 (companion mode)"]:::done
    end

    start --> research --> spec --> backpressure --> plan --> build --> review --> merge
    review -.-> fix1 -.-> review

    said_start>"🗣 lets do the watchdog… explore, spec, (workshops if needed), architect, validate and then ready… I want to come back to a ready to execute plan i can review."]:::said
    said_start -.- start
    said_build>"🗣 build it"]:::said
    said_build -.- build
    said_fix>"🗣 yes, but please use companion mode"]:::said
    said_fix -.- fix1
    said_settle>"🗣 so all good for pr? … make sure the flow is closed out pre-pr please"]:::said
    said_settle -.- review
```

Legend: 🟩 done · 🟧 in progress · 🟥 blocked · 🟦 known next · ⬜ assumed · 🗣 user input · 🟪 harness loop · 🤝 companion

**Now**: flow CLOSED OUT pre-PR. Review settled by companion supersession (stage-6c doctrine; disposition in `reviews/fix-tasks.md`) — all seven findings fixed (FT-001 `ab0be14` … FT-005 `4b3d20f`), companion farewell zero findings / six APPROVEs over `752945f..a75d435`, `just fft` exit 0 (1319 tests, +9). Retro buffer drained to `.harness/records/retro/2026-06-11/004-026-stall-watchdog.md` (DL-001 SDK method-surface pin, SUGG-001 fake-adapter seam, DL-002 per-commit format). Nine commits on `026-stall-watchdog`, not pushed. #44 comment drafted, posts at merge.
**Next**: `/the-flow 8 merge --plan "docs/plans/026-stall-watchdog/stall-watchdog-plan.md"` — merge/PR analysis; executes only on typed `PROCEED`.
