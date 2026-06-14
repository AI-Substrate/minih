<!-- 🔄 RENDERED from the-flow.json — regenerate, never hand-edit this file as the primary. -->
# Flight plan — companion-coordination

**Plan**: companion-coordination · **Mode**: Full · **Phases**: 6 (1–6; Phase 0 dropped after validate-v2)
**Rail**: `[the-flow] ◆─◆─◆─[◆─◇─◇─◇─◇─◇]─◇`   ·   **now**: Phase 1 (#25) complete · **next**: Phase 2 (#40) tasks

```mermaid
flowchart TD
    classDef done    fill:#4CAF50,stroke:#388E3C,color:#fff
    classDef wip     fill:#FF9800,stroke:#F57C00,color:#000
    classDef blocked fill:#F44336,stroke:#D32F2F,color:#fff
    classDef known   fill:#90A4AE,stroke:#607D8B,color:#000
    classDef assumed fill:#ECEFF1,stroke:#B0BEC5,color:#90A4AE,stroke-dasharray:4 4
    classDef said    fill:#FFFDE7,stroke:#FBC02D,color:#000
    classDef harness fill:#EDE7F6,stroke:#673AB7,color:#000

    %% ── spine; post-spec Backpressure Check sits between Spec and Plan ──
    R[Research]:::done --> S[Spec]:::done
    S --> BP["Backpressure Check · /eng-harness-flow --event post-spec"]:::harness --> PL[Plan]:::done
    PL --> P1[Phase 1 · Verify-and-close #25 · DONE — gate proven, docs fixed, companion APPROVE]:::done
    PL -.->|dropped| P0["🚫 Phase 0 · Establish Backpressure · DROPPED — Sensor B → P6"]:::assumed
    P1 --> P2[Phase 2 · Inbox delivery parity #40 · next]:::known
    P2 --> P3[Phase 3 · State-vocabulary #27/#31]:::known
    P3 --> P4[Phase 4 · Ledger primitive #36/#32]:::known
    P4 --> P5[Phase 5 · Idle policy + drain #35]:::known
    P5 --> P6[Phase 6 · Self-discovery + docs #29/#32]:::known
    P6 --> M[Merge]:::known

    %% ── excursions: each workshop is its own node ──
    S -.->|design| W1[Workshop 1 · wait_for_any #40]:::done
    W1 --> W2[Workshop 2 · state-vocab #27/#31]:::done
    W2 --> W3[Workshop 3 · lifecycle primitive #36/#32/#29/#35]:::done
    W3 -.-> BP

    %% ── harness seams (router installed) ──
    P1 -.->|pre-implement boot + phase-end retro| HS1[["⚙ pre-implement (degraded/SLOW) + phase-end drain · /eng-harness-flow"]]:::harness
    M -.->|reflection| HH[["plan-complete seam · /eng-harness-flow --event plan-complete"]]:::harness

    %% ── verbatim user-said bubbles ──
    UR>"🗣 explore please"]:::said
    UR -.- R
    US>"🗣 run specify please"]:::said
    US -.- S
    U1>"🗣 runt he workshops, ten we will do the back pressure check"]:::said
    U1 -.- W1
    UBP>"🗣 run it"]:::said
    UBP -.- BP
    UPL>"🗣 do it"]:::said
    UPL -.- PL
    UP1a>"🗣 generate the phase 1 dossier then validate it"]:::said
    UP1a -.- P1
    UP1b>"🗣 implement please with companion"]:::said
    UP1b -.- P1
```

**Legend**: 🟩 done · 🟧 in progress · 🟦 known future (designed) · ⬜╴assumed future (dashed) · 🟨 🗣 verbatim user input · 🟪 harness seams (violet — routed via `/eng-harness-flow`)

_Generated from `the-flow.json`. **Phase 1 (#25) is COMPLETE — verify-and-close shipped with the live `code-review-companion`.** AC-1: a new `.e2e` characterisation test drives a real `compile()` release-default resolution (`restricted`/write-deny) through the FX008 boot gate to **E205**, plus a CLI no-permissions repro case — **8/8 targeted tests green**; the stale `runner.ts` "yolo default" comment was corrected to the R6 reality. AC-2: `companion-mode.md` already said "at boot" (no edit); the companion caught a real **MEDIUM (F001)** — `permissions.md` named the wrong physical inbox lane for the `permission-error` signal (`outside`→`inside`) — fixed; the #25 close-comment disposition is recorded. **Companion verdict APPROVE, 0 HIGH/CRITICAL**; its magicWand independently re-derived **Phase 4** (`coordination_status`/`deriveCompanionLedger`). The pre-implement boot came up `degraded`/SLOW (a biome format diff in this very flight-plan JSON — formatted, then proceeded) and the phase-end seam buffered SUGG-001 + COORD-001/MH-001 for the retro. Commits: `5ab51e1` · `57644c7` · `a7bcac5` · `181fc19`. Next: **Phase 2 (#40)** — inbox delivery parity — generate its tasks dossier (stage 5)._
