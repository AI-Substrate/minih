---
record_kind: "retro"
harness_version: "0.3.0"
branch: "028-companion-mode-reliability"
repo: "https://github.com/AI-Substrate/minih.git"
created_at: "2026-06-16T06:52:37.709Z"
agent: "claude-opus-4-8"
plan_id: "028-companion-mode-reliability"
schema_version: "1.0"
retro_id: "2026-06-16T06:52:37Z-claude-opus-4-8-p2de"
started_at: "2026-06-16T06:01:56.704Z"
ended_at: "2026-06-16T06:52:37.709Z"
summary: "Plan 028 Phase 2 (identifier & env correctness, defects D/E) built TDD with a live code-review-companion + the harness loop. Defect D: true-UTC runId + injectable clock, then a startedAt-primary sort migration across ALL latest/default run selectors (11 total). Defect E: MINIH_PROJECT_ROOT = resolved git root. Four friction notes: a 2nd live defect-D sighting (INS-001), the companion catching what static validation missed (INS-002), a run-selector audit-fixture magic wand (MW-001), and the plan under-scoping a cross-cutting fix (DL-001)."
entries:
  - id: INS-001
    kind: insight
    description: "Second live defect-D sighting: the Phase 2 companion booted with runId 2026-06-16T15-58-44-285Z while real wall-clock UTC was ~05:58 — local Sydney time (UTC+10) mislabeled Z. Sighted WHILE building the fix (T002). Concrete proof the defect recurs every run."
    target: schema
    suggested_encoding: "T002 (getUTC* + now? seam) fixes exactly this; second in-the-wild sighting after Phase 1's INS-001"
    system:
      compound:
        status: encoded
        source: agent-self
        first_seen_at: "2026-06-16T06:01:56.704Z"
        resolved_by: "8f850ba"
        note: "createRunFolder now uses getUTC* getters + an injectable now? clock — the runId encodes true UTC, so the local-as-Z mislabel can no longer occur."
  - id: INS-002
    kind: insight
    description: "Live companion caught what static validation missed: validate-v2 (4 agents) scoped defect-D's sort fix to 4 selectors; the live code-review-companion reviewing actual commits found findRunSession (a 5th, session-resume selector) PLUS a ~7-surface sweep (coordination/harvest/validate/status/tail/view/connect). Concrete proof the companion adds value beyond the green suite + static review."
    target: coordination
    suggested_encoding: "Phase-2 dogfooding win; the companion's per-commit review surfaced incomplete-migration drift no static pass found"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-16T06:52:00.624Z"
  - id: MW-001
    kind: magic-wand
    description: "Run-selector drift is recurring: the same 'sort run folders by name' bug appeared in ~11 places (defect D). A single audit fixture that seeds mixed old-local-Z + new-true-UTC folders and asserts EVERY latest/default selector picks the chronologically-newest run would prevent re-introduction (the companion's magic wand)."
    target: project-sensor
    suggested_encoding: "build a parametrized run-selector audit test covering last-run/history/companion/findRunSession/listActiveRunCandidates/coordination/harvest/validate against one mixed fixture"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-16T06:52:00.688Z"
  - id: DL-001
    kind: difficulty
    description: "Plan/validation under-scoped a cross-cutting fix: the dossier (and validate-v2) named 4 run-sort selectors, but repo-wide the pattern lived in ~11 spots. A grep-based completeness sweep ('find ALL call sites of this bug class') at plan time would have scoped defect D correctly up front."
    target: architecture-fitness
    severity: degrading
    workaround: "companion review caught the gap; fixed in the same phase after a scope decision"
    suggested_encoding: "at architect/tasks time, for a 'fix this pattern everywhere' defect, grep the whole repo for the anti-pattern and enumerate every site, not just the named ones"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-16T06:52:00.753Z"
system:
  compound:
    bubble_action: "all-save"
---

# Retro — Plan 028 Phase 2 (identifier & env correctness, D/E)

Built defects D (true-UTC runId + sort migration) and E (`MINIH_PROJECT_ROOT` =
git root) TDD with a live `code-review-companion` and the harness loop. The
standout is **INS-002 / MW-001**: `validate-v2` scoped defect D's sort fix to
four "newest run" selectors, but the live companion — reviewing each commit —
found the migration was incomplete in **seven more** places, the most central
being `findRunSession` (session resume). The human chose "fix them all," so
defect D now closes across all ~11 selectors. A clean demonstration that the
live per-commit companion catches cross-cutting drift the green suite and the
static validation pass both missed.

**The companion's magic wand (MW-001)** is the natural follow-up: a single
run-selector audit fixture that seeds mixed old-local-`Z` + new-true-UTC folders
and asserts every latest/default selector picks the chronologically-newest run —
so this bug class can't silently re-appear in a new selector.

**DL-001** is the process lesson: when a defect is "fix this pattern
everywhere," enumerate every call site by repo-wide grep at plan/tasks time, not
just the ones a finding happens to name.
