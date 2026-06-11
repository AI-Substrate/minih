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

    start["Kickoff — issue #44 stall watchdog"]:::done
    research["Explore — runner lifecycle, SDK surface, Perplexity stall causes"]:::done
    spec["Specify (Simple) — CS-3, 11 ACs, Behavior Contract"]:::done
    backpressure["Backpressure survey — Certainty: Partial"]:::harness
    plan["Architect → READY + validate-v2 fix pass"]:::done
    build["Implement — T000–T011 done, 11/11 ACs, fft 1310 green"]:::done
    review["Code review (stage 7) — REQUEST_CHANGES"]:::wip
    fix1["Fix pass — FT-001…FT-005, then re-review"]:::known
    merge["Merge (PROCEED-gated)"]:::assumed

    start --> research --> spec --> backpressure --> plan --> build --> review --> merge
    review -.-> fix1 -.-> review

    said_start>"🗣 lets do the watchdog… explore, spec, (workshops if needed), architect, validate and then ready… I want to come back to a ready to execute plan i can review."]:::said
    said_start -.- start
    said_build>"🗣 build it"]:::said
    said_build -.- build
```

Legend: 🟩 done · 🟧 in progress · 🟥 blocked · 🟦 known next · ⬜ assumed · 🗣 user input · 🟪 harness loop

**Now**: review came back **REQUEST_CHANGES** — 1 HIGH (F001: adapter suppresses the consolidated `assistant.message` after streaming deltas, so `--max-turns` misses normal streamed turns; AC-4 at 60%), 4 MED (F002 `fireMaxTurns` init ordering, F003 manifest classification, F004 resume budget evidence, F005 `runs` passthrough evidence), 2 LOW (barrel manifest rows). F001+F002 verified real against source. Fix tasks at `reviews/fix-tasks.md`. Nothing committed.
**Next**: `/the-flow 6 implement --plan "docs/plans/026-stall-watchdog/stall-watchdog-plan.md"` (fix pass), then re-run `/the-flow 7 review`.
