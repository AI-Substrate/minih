<!-- 🔄 RENDERED from the-flow.json — regenerate, never hand-edit this file as the primary. -->
# the-flow — companion-mode-reliability (plan 028)

**Plan**: companion-mode-reliability · **Mode**: Full · **Phases**: 5 (4 defect-fix + 1 user-added longevity)
**Rail**: `[the-flow] ◆─◆─◆─[◆─◆─◆─◐─◇]─◇`   ·   **now**: Phase 4 tasks PREPPED + VALIDATED (defect G) — T000–T0z, anchors re-verified live (1597-1598/441-442, not the plan's stale 1590/415); 4-agent thesis-aware pass clean · **next**: Phase 4 implement (terminal classification G)

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
    P1 --> P2[Phase 2 · Identifier & env D/E]:::done --> P3[Phase 3 · Findings read-path F]:::done --> P4[Phase 4 · Terminal classification G]:::wip --> P5[Phase 5 · Companion longevity · human gaps]:::known --> M[Merge]:::assumed

    %% ── live code-review companions wrapping each built phase (kind:companion, render:wrap) ──
    subgraph CMP1["🤝 code-review-companion (Phase 1 · 0 findings)"]
        P1
    end
    subgraph CMP2["🤝 code-review-companion (Phase 2 · 2 findings → F001+F002 fixed)"]
        P2
    end
    subgraph CMP3["🤝 code-review-companion (Phase 3 · 2 findings → F001+F002 fixed)"]
        P3
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
    UP3>"🗣 implemtn iwth companin"]:::said
    UP3 -.- P3
    UP4>"🗣 prep netx phae and then validate"]:::said
    UP4 -.- P4
    UP5>"🗣 Add as Phase 5 here"]:::said
    UP5 -.- P5
```

**Legend**: 🟩 done · 🟧 in progress · 🟥 blocked · 🟦 known future (designed) · ⬜╴assumed future (dashed) · 🟨 🗣 verbatim user input · 🟪 harness seams (violet — routed via `/eng-harness-flow`)

_Generated from `the-flow.json`. **Phases 1–3 COMPLETE** (A–F), each built with a live `code-review-companion`; full suite **1408 pass / 0 fail**, `tsc` clean, `minih doctor` 0 failures. **Phase 4 (terminal classification, G) — TASKS PREPPED + VALIDATED, implement pending.** `tasks.md` expands plan tasks 4.0–4.z into **T000–T0z** RED/GREEN pairs: T001/T002 collapse `result:'degraded'` → `manifest.status:'completed'` (velocity guard unchanged); T003/T004 source + write a **farewell-observed signal** (the hard task — none exists in `runner.ts`/`reconcile.ts` today); T005/T006 extend the `terminalReason` union with `operator-stop`/`idle-budget`/`no-engagement` and stop the real consumers red-rendering them; T007 reconcile-honours an operator-stop marker; T008 pins the 028↔#49 boundary + the underscore→hyphen spelling map. **Re-anchoring caught live**: the plan's `runner.ts:1590` is now **`1597-1598`** and `status.ts:415` is now **`441-442`** (Phase 1/2 shifted them) — all 9 anchors source-truth-verified. **Validation**: a 4-agent thesis-aware pass — source-truth verified every anchor, cross-ref confirmed 1:1 plan fidelity (all locked decisions carried), thesis advanced, forward-compat confirmed Phase 5 (AC-H) and #49 are both satisfied. Two MEDIUM fixes applied (T004 candidate sources + lifecycle/producer spike + provisional field shapes; T008 doc target named) plus a LOW (T006 domain.md History reminder). **Next: Phase 4 implement** (`--companion` has been the per-phase build mode); then Phase 5, merge._
