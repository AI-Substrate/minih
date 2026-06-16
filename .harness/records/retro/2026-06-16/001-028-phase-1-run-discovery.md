---
record_kind: "retro"
harness_version: "0.3.0"
branch: "028-companion-mode-reliability"
repo: "https://github.com/AI-Substrate/minih.git"
created_at: "2026-06-16T04:26:04.709Z"
agent: "claude-opus-4-8"
plan_id: "028-companion-mode-reliability"
schema_version: "1.0"
retro_id: "2026-06-16T04:26:04Z-claude-opus-4-8-p1abc"
started_at: "2026-06-16T03:53:16.144Z"
ended_at: "2026-06-16T04:26:04.709Z"
summary: "Plan 028 Phase 1 (run-discovery fail-open, defects A/B/C) built TDD with a live code-review-companion + the harness loop. Five friction notes drained: boot's single verdict masks a green build behind a missing optional tool (DL-001); a live defect-D sighting in the companion's own runId (INS-001); the ACTIVE_STATUSES predicate is now triplicated across cli+runner (DL-002); the companion's magicWand for an open-findings command, which overlaps Phase 3 (SUGG-001); and the format-gate skip the companion caught as F001 (DL-003)."
entries:
  - id: DL-001
    kind: difficulty
    description: "harness boot reports overall status:error, but the only failing sensor is lint (npx biome check .) and biome is not on PATH (doctor toolchain layer flags it). typecheck + build+test (just check) pass clean. Boot's single overall verdict can't distinguish a missing optional tool from a real break, so a green build+test reads as a failed boot."
    target: tooling
    severity: annoying
    workaround: "read the per-sensor breakdown; treated the lint failure as non-blocking after confirming build+test green"
    suggested_encoding: "boot could treat a missing optional tool (biome) as warn not error, or the lint sensor should report 'skipped: biome not on PATH' when doctor's toolchain layer already flags it"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-16T03:53:16.144Z"
  - id: INS-001
    kind: insight
    description: "Live defect-D sighting during this dogfood run: the code-review-companion booted with runId 2026-06-16T13-50-25-287Z but the real wall-clock UTC was 03:52. The runId encodes local Sydney time (UTC+10) and mislabels it Z. This is exactly the bug Phase 2 (task 2.2) fixes, observed in the wild."
    target: schema
    suggested_encoding: "Phase 2 fixes this (UTC getters + sort-by-startedAt); the sighting is concrete validation that the defect is real and current"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-16T03:53:16.212Z"
  - id: DL-002
    kind: difficulty
    description: "Defect A fix needed an ACTIVE_STATUSES set in status.ts, but run-inventory.ts:16 and run-resolver.ts:38 already each define an identical private copy — now triplicated. The canonical 'active' predicate (statuses + updatedAt freshness) is duplicated across the cli and runner read-paths rather than shared."
    target: architecture-fitness
    severity: annoying
    suggested_encoding: "hoist one exported ACTIVE_STATUSES (and ideally the freshness predicate) into a shared runner module; import it in run-inventory, run-resolver, and status"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-16T04:03:08.240Z"
  - id: SUGG-001
    kind: improvement-suggestion
    description: "Companion magicWand from Phase 1 review: a lane-agnostic 'minih companion open-findings <slug> --run <runId>' that lists unresolved findings and whether later commits addressed them — so final drain reviews don't depend on the companion remembering prior inbox messages. Strongly overlaps plan 028 Phase 3 (the findings read-path, defect F)."
    target: coordination
    suggested_encoding: "fold into Phase 3 (minih companion findings) — add an open/unresolved view keyed by ackOf"
    system:
      compound:
        status: suggested
        source: agent-self
        first_seen_at: "2026-06-16T04:25:13.182Z"
  - id: DL-003
    kind: difficulty
    description: "Skipped the format gate (just fft / biome format) before committing Phase 1, so 3 new files landed unformatted and harness boot's lint sensor failed — and I misdiagnosed it as 'biome not installed' rather than my own unformatted files. The code-review-companion caught both (finding F001)."
    target: tooling
    severity: degrading
    workaround: "ran npx biome format --write at phase end, re-checked clean, corrected the evidence"
    suggested_encoding: "a pre-commit hook (or implement-verb step) that runs the format gate, so unformatted files can't be committed"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-16T04:25:13.245Z"
system:
  compound:
    bubble_action: "all-save"
---

# Retro — Plan 028 Phase 1 (run-discovery fail-open, A/B/C)

Five friction notes captured while building defects A/B/C TDD with a live
`code-review-companion` and the harness loop. The standout is **DL-003 / F001**:
the companion caught that I skipped the format gate before committing and then
misdiagnosed the resulting boot lint failure — a clean demonstration that the
companion review added real value beyond the green test suite.

**Cross-plan follow-ups**: SUGG-001 (open-findings command) → fold into Phase 3;
INS-001 (live defect-D) → already covered by Phase 2; DL-002 (ACTIVE_STATUSES
triplication) → a small shared-constant refactor candidate.
