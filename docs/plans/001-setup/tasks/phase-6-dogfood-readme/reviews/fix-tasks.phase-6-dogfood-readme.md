# Fix Tasks: Phase 6: Dogfood + README

Apply in order. Re-run review after fixes.

## Critical / High Fixes

### FT-001: Remove remaining unsupported `--json` usage and align runtime docs
- **Severity**: HIGH
- **File(s)**:
  - /Users/jordanknight/substrate/minih/agents/smoke-test/prompt.md
  - /Users/jordanknight/substrate/minih/agents/convention-check/instructions.md
  - /Users/jordanknight/substrate/minih/README.md
- **Issue**: Landed dogfood artifacts and README still reference unsupported `--json` flags, and README also documents `MINIH_HAS_INPUT_SCHEMA` with the wrong runtime value semantics.
- **Fix**: Remove unsupported `--json` examples and instructions, document the stdout/stderr contract instead, and describe `MINIH_HAS_INPUT_SCHEMA` as `true` or `false` to match the runner.
- **Patch hint**:
  ```diff
  - npx minih history smoke-test --json 2>/dev/null
  - npx minih last-run smoke-test --json 2>/dev/null
  - 1. Run `minih doctor --json` as your primary data source
  - minih list --json   # JSON envelope on stdout
  - minih doctor --json # JSON envelope
  - | `MINIH_HAS_INPUT_SCHEMA` | `1` if input-schema.json exists |
  + npx minih history smoke-test 2>/dev/null
  + npx minih last-run smoke-test 2>/dev/null
  + 1. Run `npx minih doctor 2>/dev/null` as your primary data source
  + minih list          # JSON is always on stdout
  + minih doctor        # JSON is always on stdout
  + | `MINIH_HAS_INPUT_SCHEMA` | `true` if input-schema.json exists, else `false` |
  ```

### FT-002: Format phase-added schema files so the quality gate passes
- **Severity**: HIGH
- **File(s)**:
  - /Users/jordanknight/substrate/minih/agents/convention-check/output-schema.json
  - /Users/jordanknight/substrate/minih/agents/feedback-digest/output-schema.json
  - /Users/jordanknight/substrate/minih/agents/self-review/output-schema.json
  - /Users/jordanknight/substrate/minih/agents/smoke-test/output-schema.json
- **Issue**: `just fft` currently fails because these new schema files are not Biome-formatted.
- **Fix**: Run Biome formatting on the phase-added schema files and confirm the full repository quality gate passes afterward.
- **Patch hint**:
  ```diff
  -  "required": ["summary", "overallHealth", "agents", "preamble", "recommendations", "retrospective"],
  +  "required": [
  +    "summary",
  +    "overallHealth",
  +    "agents",
  +    "preamble",
  +    "recommendations",
  +    "retrospective"
  +  ],
  ```

## Medium / Low Fixes

### FT-003: Correct phase status and feedback-loop evidence
- **Severity**: MEDIUM
- **File(s)**:
  - /Users/jordanknight/substrate/minih/docs/plans/001-setup/tasks/phase-6-dogfood-readme/tasks.md
  - /Users/jordanknight/substrate/minih/docs/plans/001-setup/tasks/phase-6-dogfood-readme/execution.log.md
- **Issue**: The dossier still says `Proposed`, the execution log still says `In Progress`, and the log claims `--json` references were removed even though committed artifacts still contain them. The artifacts also do not show a post-fix rerun despite claiming the feedback loop is proven.
- **Fix**: Align status fields with the actual state, correct the incomplete `--json` fix claim, and either add concrete post-fix rerun evidence (commands, run IDs, validation results) or narrow the wording so it does not claim a completed rerun loop.
- **Patch hint**:
  ```diff
  - **Status**: Proposed
  + **Status**: Landed

  - **Status**: In Progress
  + **Status**: Complete

  - - Fix: removed `--json` from prompts, documented stdout/stderr convention in preamble
  + - Fix: partially removed `--json` references; remaining occurrences were corrected before closeout
  + - Re-run evidence: [add post-fix commands, run IDs, and validation outcomes]
  ```

## Re-Review Checklist

- [ ] All critical/high fixes applied
- [ ] Re-run `/plan-7-v2-code-review` and achieve zero HIGH/CRITICAL
