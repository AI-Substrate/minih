<!-- 🔄 RENDERED from the-flow.json — regenerate, never hand-edit this file as the primary. -->
# the-flow — companion-mode-reliability (plan 028)

**Plan**: companion-mode-reliability · **Mode**: Full · **Phases**: 5 (4 defect-fix + 1 user-added longevity)
**Rail**: `[the-flow] ◆─◆─◆─[◆─◆─◇─◇─◇]─◇`   ·   **now**: Phase 2 COMPLETE (D/E) — built `--companion`; defect D's sort migration now spans ALL ~11 selectors · **next**: Phase 3 tasks (findings read-path, F)

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
    P1 --> P2[Phase 2 · Identifier & env D/E]:::done --> P3[Phase 3 · Findings read-path F]:::known --> P4[Phase 4 · Terminal classification G]:::known --> P5[Phase 5 · Companion longevity · human gaps]:::known --> M[Merge]:::assumed

    %% ── live code-review companions wrapping each built phase (kind:companion, render:wrap) ──
    subgraph CMP1["🤝 code-review-companion (Phase 1 · 0 findings)"]
        P1
    end
    subgraph CMP2["🤝 code-review-companion (Phase 2 · 2 findings → F001+F002 fixed)"]
        P2
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
    UB>"🗣 kick off the build with companion pleae"]:::said
    UB -.- P1
    UC>"🗣 pleae implemet with companion"]:::said
    UC -.- P2
    UP5>"🗣 Add as Phase 5 here"]:::said
    UP5 -.- P5
```

**Legend**: 🟩 done · 🟧 in progress · 🟥 blocked · 🟦 known future (designed) · ⬜╴assumed future (dashed) · 🟨 🗣 verbatim user input · 🟪 harness seams (violet — routed via `/eng-harness-flow`)

_Generated from `the-flow.json`. **Phase 1 (run-discovery fail-open, A/B/C) COMPLETE** — 5 commits, suite green. **Phase 2 (identifier & env, D/E) COMPLETE** — built with a live `code-review-companion`, 6 commits, full suite **1404 pass / 0 fail**, tsc clean. Defect **D**: `createRunFolder` emits true-UTC runIds (`getUTC*` + injectable `now?`), and every "newest/latest run" selector now sorts by `startedAt` (true UTC) via the shared `sortRunIdsNewestFirst` helper. The live companion earned its keep: `validate-v2` scoped the sort fix to **4** selectors, but the companion — reviewing each commit — caught that the migration was incomplete (`findRunSession` + a ~7-surface sweep), so on the human's "fix them all" call defect D now closes across **all ~11** latest/default selectors. Defect **E**: `MINIH_PROJECT_ROOT` = resolved git root (was the run dir). Phase-end retro drained 4 entries (incl. the companion's run-selector-audit magicWand). **Next: Phase 3 tasks (findings read-path, F)** — add `minih companion findings` over the existing ledger; then 4–5, then merge._
