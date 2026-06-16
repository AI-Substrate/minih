<!-- 🔄 RENDERED from the-flow.json — regenerate, never hand-edit this file as the primary. -->
# the-flow — companion-mode-reliability (plan 028)

**Plan**: companion-mode-reliability · **Mode**: Full · **Phases**: 5 (4 defect-fix + 1 user-added longevity)
**Rail**: `[the-flow] ◆─◆─◆─[◆─◐─◇─◇─◇]─◇`   ·   **now**: Phase 1 COMPLETE (A/B/C) — 5 commits, 1396 tests pass, built with a live companion · **next**: Phase 2 tasks (D/E)

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
    S[Spec]:::done --> PL[Plan]:::done --> P1[Phase 1 · Run-discovery fail-open A/B/C]:::done
    P1 --> P2[Phase 2 · Identifier & env D/E]:::known --> P3[Phase 3 · Findings read-path F]:::known --> P4[Phase 4 · Terminal classification G]:::known --> P5[Phase 5 · Companion longevity · human gaps]:::known --> M[Merge]:::assumed

    %% ── live code-review companion wrapping Phase 1 (kind:companion, render:wrap) ──
    subgraph CMP1["🤝 code-review-companion (Power-On · per-commit review)"]
        P1
    end

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

_Generated from `the-flow.json`. **Plan written and validated** (Status READY; all 5 phases passed thesis-aware multi-agent review against source, v1.1.1 folded in the fixes). **Phase 1 (run-discovery fail-open, A/B/C) is COMPLETE** — 5 commits on branch `028-companion-mode-reliability`, full suite **1396 pass / 0 fail**, `tsc` clean. Defect **A**: `computeStatusVerdict` fails open for a live-pid run (`status.ts`). Defect **B**: `runs list --all` wired (was a no-op) + best-effort heal-on-read of dead-pid orphans (`run-inventory.ts`). Defect **C**: AC-C fallback — the literal symptom is emitted by no core surface, so a `resolveAgent↔listAgents` parity lock + documented finding. Built with a **live `code-review-companion`** (briefed once, pinged per commit, 0 findings) and the **harness loop** (boot seam → friction capture → phase-end retro). **Next: Phase 2 tasks (Identifier & env, D/E)**, then 3–5, then merge._
