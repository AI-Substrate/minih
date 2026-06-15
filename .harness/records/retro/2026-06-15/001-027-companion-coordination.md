---
schema_version: "1.0"
retro_id: "2026-06-15T02:50:16Z-agent-027p3drn"
agent: agent
plan_id: 027-companion-coordination
started_at: "2026-06-14T21:39:24.698Z"
ended_at: "2026-06-15T02:50:16Z"
summary: "eng-harness-4-retro --drain ([a]ll-save) of plan 027 (companion-coordination) P1–P3 friction — 5 entries. Cluster: SUGG-001 + SUGG-002 = the biome lint-vs-format ordering in the boot/fft gate (re-paid each phase). COORD-001's magicWand independently re-derived plan 027 Phase 4 (coordination_status). Nothing encoded this drain."
entries:
  - id: SUGG-001
    kind: improvement-suggestion
    target: skill
    description: "the-flow regenerates the-flow.json without biome formatting → first 'harness boot' goes red on the lint sensor (biome check). Candidate: the-flow should emit biome-formatted JSON (or fft the plan dir) on write, so the pre-implement boot isn't tripped by the flow's own bookkeeping."
    suggested_encoding: "the-flow biome-formats the plan JSON on write, or runs fft on the plan dir"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-14T21:39:24.698Z"
  - id: COORD-001
    kind: coordination
    target: minih
    description: "Companion debrief: I told the code-review-companion 'control:stop incoming' after the final ping, but then applied an inline fix (F001) before sending stop — so the companion idled out and self-stopped via idle-budget (its MH-001). Lesson: send control:stop promptly once the last commit is pinged, or don't promise an imminent stop while still iterating. Also: companion's magicWand independently re-derived plan 027 Phase 4 (coordination_status/deriveCompanionLedger)."
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-14T22:02:08.490Z"
  - id: DL-001
    kind: difficulty
    target: tooling
    severity: degrading
    description: "just fft 'test' step flaked on test/runner/agent-pack/extractor.test.ts (gg-PaxHeader): ENOENT writing to a mkdtemp dir under full-parallel run, but passes 45/45 in isolation. Cost a detour to confirm it was a pre-existing test-isolation race, not a Phase 2 regression."
    workaround: "re-ran the file in isolation to confirm a pre-existing race, not a regression"
    suggested_encoding: "fix the mkdtemp isolation race or pin extractor.test.ts to run serially"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-14T23:44:24.052Z"
  - id: SUGG-002
    kind: improvement-suggestion
    target: tooling
    description: "just fft runs 'lint' (biome check, CI-mode) BEFORE 'format' (biome format --write), so a commit with auto-fixable formatting fails the gate at lint even though format would fix it one step later. Had to run 'biome check --write' manually then re-run fft. Mild ordering friction — lint surfacing format-only failures."
    suggested_encoding: "reorder fft to run format before lint, or make the lint step ignore format-only diffs"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-14T23:44:24.117Z"
  - id: SUGG-003
    kind: improvement-suggestion
    target: skill
    description: "The progress sub-skill's documented companion farewell-read 'dogfood path' calls 'minih validate <slug> --file <output/report.json>', but minih 0.2.0 rejects '--file' (unknown option) — had to read output/report.json directly. Update the debrief instructions for the 0.2.0 validate signature (or add a 'minih validate --file' alias)."
    suggested_encoding: "update the progress sub-skill's farewell-read step for the 0.2.0 validate signature, or add a 'minih validate --file' alias"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-15T02:34:01.414Z"
system:
  compound:
    bubble_action: "all-save"
---

# Retro — plan 027-companion-coordination (P1–P3 drain)

Session-end `[a]ll-save` drain of the observe buffer accumulated across plan 027 Phases 1–3 (verify-and-close #25 / inbox delivery parity #40 / state-vocabulary coherence #27/#31), all implemented with the live `code-review-companion`.

**The one real cluster** — `SUGG-001` + `SUGG-002` are the same friction from two angles: the biome **lint-vs-format ordering** in the boot/fft gate. `the-flow` regenerates `the-flow.json` unformatted, and `just fft` runs `lint` (CI-mode `biome check`) *before* `format` (`biome format --write`), so the flow's own bookkeeping trips the lint sensor before the format step that would fix it. Re-paid every phase since P1 — the prime `[e]ncode` candidate next harvest.

**`COORD-001`** is a process lesson (send `control:stop` promptly once the last commit is pinged) — and notably its magicWand, like the P1 and P2 companions', **independently re-derived plan 027 Phase 4** (`coordination_status` / `deriveCompanionLedger`). Three independent re-derivations now corroborate that phase.

`DL-001` is a pre-existing test-isolation race (not a plan-027 regression); `SUGG-003` is a stale `minih validate --file` reference in the progress sub-skill's farewell-read path.

Nothing encoded this drain — saved for `--harvest` at plan-complete.
