<!-- 🔄 RENDERED from the-flow.json — regenerate, never hand-edit this file as the primary. -->
# the-flow — companion-mode-reliability (plan 028)

**Plan**: companion-mode-reliability · **Mode**: Full · **Phases**: 5 (4 defect-fix + 1 user-added longevity)
**Rail**: `[the-flow] ◆─◆─◆─[◆─◆─◆─◇─◇]─◇`   ·   **now**: Phase 3 COMPLETE (defect F) — `minih companion findings` built `--companion`; 2 companion findings fixed; suite 1408/0 · **next**: Phase 4 tasks (terminal classification G)

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
    P1 --> P2[Phase 2 · Identifier & env D/E]:::done --> P3[Phase 3 · Findings read-path F]:::done --> P4[Phase 4 · Terminal classification G]:::known --> P5[Phase 5 · Companion longevity · human gaps]:::known --> M[Merge]:::assumed

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
    UP5>"🗣 Add as Phase 5 here"]:::said
    UP5 -.- P5
```

**Legend**: 🟩 done · 🟧 in progress · 🟥 blocked · 🟦 known future (designed) · ⬜╴assumed future (dashed) · 🟨 🗣 verbatim user input · 🟪 harness seams (violet — routed via `/eng-harness-flow`)

_Generated from `the-flow.json`. **Phase 1 (A/B/C) COMPLETE** — 5 commits, suite green. **Phase 2 (D/E) COMPLETE** — built with a live `code-review-companion`, 6 commits, full suite **1404 pass / 0 fail**; defect **D** (true-UTC runId + `startedAt`-primary sort across all ~11 selectors — the companion caught the migration was incomplete beyond the 4 named) and **E** (`MINIH_PROJECT_ROOT` = resolved git root) closed. **Phase 3 (findings read-path, F) COMPLETE** — built with a live `code-review-companion` (cmp3), 5 commits, full suite **1408 pass / 0 fail**, `tsc` clean, `minih doctor` 0 failures. `minih companion findings <slug>` reads a companion's findings + summary over the lane-agnostic `deriveCompanionLedger().findings` + `buildDraftFarewell` (no new ledger API); `outside.md`, `docs/how/companion-mode.md` (§3a), and `AGENTS_README.md` corrected to that read-path. The live companion raised **2 MEDIUM** contract-drift findings (F001/F002 — adjacent guides still taught `cat report.json`); both fixed. **Dogfood moment**: `minih companion findings` (the command this phase built) surfaced 2 findings + 4 summaries that a raw inbox-lane `jq` skim reported as 0 — defect F reproduced and fixed in the same session. Phase-end retro drained 2 entries (DL-001 a pre-commit doc-budget sensor, MW-001 a companion contract-drift sweep). **Next: Phase 4 tasks** (terminal classification G); then Phase 5, merge._
