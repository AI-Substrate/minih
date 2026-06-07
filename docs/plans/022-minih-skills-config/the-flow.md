# Flight view — minih-skills-config

> Generated from [`the-flow.json`](./the-flow.json). Do not hand-edit this markdown as the primary; update the JSON and regenerate.

**Plan**: minih-skills-config · **Mode**: Simple · **Phases**: 1
**Rail**: `[the-flow] ◆─◆─◆─◆─◇` · **now**: Implementation complete · **next**: Review

```mermaid
flowchart TD
    classDef done    fill:#4CAF50,stroke:#388E3C,color:#fff
    classDef wip     fill:#FF9800,stroke:#F57C00,color:#000
    classDef blocked fill:#F44336,stroke:#D32F2F,color:#fff
    classDef known   fill:#90A4AE,stroke:#607D8B,color:#000
    classDef assumed fill:#ECEFF1,stroke:#B0BEC5,color:#90A4AE,stroke-dasharray:4 4
    classDef said    fill:#FFFDE7,stroke:#FBC02D,color:#000
    classDef companion fill:#E0F2F1,stroke:#00897B,color:#000
    classDef worker  fill:#E8EAF6,stroke:#3F51B5,color:#000

    S["Spec"]:::done --> PL["Plan"]:::done --> I["Implementation"]:::done --> R["Review"]:::known --> M["Merge"]:::assumed

    S -.->|design workshop| W1["Workshop 1 · CLI config and discovery"]:::done
    W1 -.-> PL

    S -.->|proof survey| BP["Backpressure survey"]:::done
    BP -.-> PL

    subgraph CRC["code-review-companion completed"]
        I
    end
    style CRC fill:#E0F2F1,stroke:#00897B,color:#000

    US>"🗣 Workflow Mode: Simple; Testing: Full TDD; Mocks: Targeted; Docs: Hybrid"]:::said
    US -.- S
    UW>"🗣 discoverable, affordable, easy for agents on other machines — light up like a Christmas tree"]:::said
    UW -.- W1
    UC>"🗣 add committed .agents sample skill + agents/test-skills backpressure"]:::said
    UC -.- PL
    UM>"🗣 use code review companion mode for /6 please"]:::said
    UM -.- I
```

**Legend**: 🟩 done · 🟧 in progress · 🟥 blocked · 🟦 known future (designed) · ⬜╴assumed future (dashed) · 🟨 🗣 verbatim/reconstructed user input · companion (teal, wraps) · worker (indigo, side)

## Nodes

- **Spec** — done: `minih-skills-config-spec.md`.
- **Workshop 1 · CLI config and discovery** — done: `workshops/001-cli-config-and-discovery.md`.
- **Backpressure survey** — done: `backpressure-coverage.md` (`Certainty: Partial`).
- **Plan** — done: `minih-skills-config-plan.md` (`Status: READY`) and `minih-skills-config.fltplan.md`.
- **Implementation** — done: `execution.log.md`; companion completed before final diff review.
- **Review** — known next: formal `/plan-7-v2-code-review` recommended.
- **Merge** — final explicit-confirmation step.
