<!-- 🔄 RENDERED from the-flow.json — regenerate, never hand-edit this file as the primary. -->
# the-flow — companion-mode-reliability (plan 028)

**Plan**: companion-mode-reliability · **Mode**: Full · **Phases**: 5 (4 defect-fix + 1 user-added longevity)
**Rail**: `[the-flow] ◆─◆─◆─[◐─◇─◇─◇─◇]─◇`   ·   **now**: Phase 1 tasks dossiered (9 tasks) — Phase 1 in progress · **next**: implement Phase 1 with companion

```mermaid
flowchart TD
    classDef done    fill:#4CAF50,stroke:#388E3C,color:#fff
    classDef wip     fill:#FF9800,stroke:#F57C00,color:#000
    classDef blocked fill:#F44336,stroke:#D32F2F,color:#fff
    classDef known   fill:#90A4AE,stroke:#607D8B,color:#000
    classDef assumed fill:#ECEFF1,stroke:#B0BEC5,color:#90A4AE,stroke-dasharray:4 4
    classDef said    fill:#FFFDE7,stroke:#FBC02D,color:#000
    classDef harness fill:#EDE7F6,stroke:#673AB7,color:#000

    %% ── spine: spec → plan → 5 build phases → merge ──
    S[Spec]:::done --> PL[Plan]:::done --> P1[Phase 1 · Run-discovery fail-open A/B/C]:::wip
    P1 --> P2[Phase 2 · Identifier & env D/E]:::known --> P3[Phase 3 · Findings read-path F]:::known --> P4[Phase 4 · Terminal classification G]:::known --> P5[Phase 5 · Companion longevity · human gaps]:::known --> M[Merge]:::assumed

    %% ── optional post-spec backpressure survey (offered, not taken — dotted off the spine) ──
    S -.->|optional| BP["Backpressure Check · /eng-harness-flow --event post-spec"]:::harness

    %% ── workshop excursions (each its own node), rejoining at the plan ──
    S -.->|design| W1[Workshop 1 · run read-path fail-open A/B/C]:::done
    W1 --> W2[Workshop 2 · terminal-state taxonomy G]:::done
    W2 -.-> PL

    %% ── harness seam node (first-class; router IS installed) ──
    M -.->|reflection| HH[["plan-complete seam · /eng-harness-flow --event plan-complete"]]:::harness

    %% ── verbatim user-said bubbles ──
    US>"🗣 set up a new plan for them please"]:::said
    US -.- S
    UW>"🗣 yeah do workshops please."]:::said
    UW -.- W1
    UC>"🗣 implement with companion"]:::said
    UC -.- PL
    UP5>"🗣 Add as Phase 5 here"]:::said
    UP5 -.- P5
    UB>"🗣 kick off the build with companion pleae"]:::said
    UB -.- P1
```

**Legend**: 🟩 done · 🟧 in progress · 🟥 blocked · 🟦 known future (designed) · ⬜╴assumed future (dashed) · 🟨 🗣 verbatim user input · 🟪 harness seams (violet — routed via `/eng-harness-flow`)

_Generated from `the-flow.json`. **Plan written and validated** (Status READY; all 5 phases passed thesis-aware multi-agent review against source, v1.1.1 folded in the fixes). **The build is now under way**: Phase 1's task dossier is written (`tasks/phase-1-run-discovery-fail-open-a-b-c/tasks.md` — 9 tasks T000–T009; the C-symptom spike runs first to name the surface, then the A/B RED→GREEN pairs, harness seams bracketing). **Next: implement Phase 1 with the companion** — a `code-review-companion` (a parallel `minih` agent) reviews every commit and supersedes the review stage. Phases 2–5 follow; then merge._
