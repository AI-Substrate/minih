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
    review["Code review (stage 7) — REQUEST_CHANGES → fixes landed"]:::wip
    merge["Merge (PROCEED-gated)"]:::assumed

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
```

Legend: 🟩 done · 🟧 in progress · 🟥 blocked · 🟦 known next · ⬜ assumed · 🗣 user input · 🟪 harness loop · 🤝 companion

**Now**: fix pass DONE in companion mode — all review findings addressed (FT-001 `ab0be14` streamed-turn accounting, FT-002 `dd9d7a0` race-arm preinit, FT-003 `1997b3f` manifest, FT-004 `d713af9` resume budget proof, FT-005 `4b3d20f` runs terminalReason). `just fft` exit 0 — 1319 tests (+9). Companion farewell: **zero findings, six APPROVEs** across `752945f..a75d435`; magicWand = `--stop-after-summary`. Seven commits on `026-stall-watchdog`, not pushed. #44 comment still drafted-not-posted.
**Next**: `/the-flow 8 merge --plan "docs/plans/026-stall-watchdog/stall-watchdog-plan.md"` (companion supersedes a stage-7 re-run per 6c doctrine) — or re-run `/the-flow 7 review` first for a fresh artifact.
