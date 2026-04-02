# Fix Tasks: Phase 1: Project Scaffold + Types

Apply in order. Re-run review after fixes.

## Critical / High Fixes

### FT-001: Remove committed local harness telemetry
- **Severity**: HIGH
- **File(s)**: `/Users/jordanknight/substrate/minih/.chainglass/data/activity-log.jsonl`, `/Users/jordanknight/substrate/minih/.gitignore`
- **Issue**: The phase diff includes a local `.chainglass` activity log with Copilot/terminal metadata that is unrelated to the scaffold/types deliverable.
- **Fix**: Remove `/Users/jordanknight/substrate/minih/.chainglass/data/activity-log.jsonl` from the tracked phase diff and add a correct `.chainglass/` ignore rule in `/Users/jordanknight/substrate/minih/.gitignore`. Keep ignore entries as separate lines.
- **Patch hint**:
  ```diff
  diff --git a/.gitignore b/.gitignore
  @@
  -node_modules/\ndist/
  +.chainglass/
  diff --git a/.chainglass/data/activity-log.jsonl b/.chainglass/data/activity-log.jsonl
  deleted file mode 100644
  ```

### FT-002: Register and document the new domains
- **Severity**: HIGH
- **File(s)**: `/Users/jordanknight/substrate/minih/docs/domains/registry.md`, `/Users/jordanknight/substrate/minih/docs/domains/domain-map.md`, `/Users/jordanknight/substrate/minih/docs/domains/adapter/domain.md`, `/Users/jordanknight/substrate/minih/docs/domains/runner/domain.md`, `/Users/jordanknight/substrate/minih/docs/domains/cli/domain.md`
- **Issue**: Adapter, runner, and cli were introduced in code, but no registry, map, or per-domain docs were added. That leaves contracts and concepts undocumented and blocks downstream domain-compliance checks.
- **Fix**: Create the registry, domain map, and per-domain docs. Each `domain.md` should record Phase 1 in History, list Composition, enumerate public Contracts, and include a Concepts table for the contracts added in this phase.
- **Patch hint**:
  ```diff
  +docs/domains/registry.md
  +docs/domains/domain-map.md
  +docs/domains/adapter/domain.md
  +docs/domains/runner/domain.md
  +docs/domains/cli/domain.md
  ```

## Medium / Low Fixes

### FT-003: Give the root package barrel an explicit owner
- **Severity**: MEDIUM
- **File(s)**: `/Users/jordanknight/substrate/minih/docs/plans/001-setup/miniharness-extraction-plan.md`, `/Users/jordanknight/substrate/minih/src/index.ts`
- **Issue**: `/Users/jordanknight/substrate/minih/src/index.ts` was added as the package root export surface, but the plan's Domain Manifest does not assign it an owner.
- **Fix**: Add `/Users/jordanknight/substrate/minih/src/index.ts` to the Domain Manifest as the package/root contract surface with explicit ownership, or remove the barrel until ownership is defined.
- **Patch hint**:
  ```diff
   | File | Domain | Classification | Rationale |
   |------|--------|---------------|-----------|
  +| `src/index.ts` | ??? | contract | Root package public API barrel |
  ```

### FT-004: Make the placeholder CLI fail loudly
- **Severity**: LOW
- **File(s)**: `/Users/jordanknight/substrate/minih/src/cli/index.ts`
- **Issue**: The placeholder CLI prints "not yet implemented" but exits `0`, which looks like success to scripts and automation.
- **Fix**: Return a non-zero exit code (or throw) until Phase 4 replaces the placeholder with real commands.
- **Patch hint**:
  ```diff
  -process.exit(0);
  +process.exit(1);
  ```

## Re-Review Checklist

- [ ] All critical/high fixes applied
- [ ] Re-run `/plan-7-v2-code-review --plan /Users/jordanknight/substrate/minih/docs/plans/001-setup/miniharness-extraction-plan.md --phase "Phase 1: Project Scaffold + Types"` and achieve zero HIGH/CRITICAL
