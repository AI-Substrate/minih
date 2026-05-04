# FX006 — Cross-platform FS-guard regression suite

**Status**: DEFERRED (post-R6)
**Plan**: 018-agent-permissions
**Origin**: Top-10 follow-up #5 — fs-guard has 17 unit tests but most use `tmpdir()` real filesystems on macOS/Linux. Windows path semantics, symlink-disabled filesystems, and the documented TOCTOU residual are uncovered.

## Motivation

The runner's `fs-guard.ts` is the load-bearing isolation seam between agents and the operator's filesystem. Plan 018 spec § Risks documents two known residuals:

1. **TOCTOU race against adversarial agents**: an agent could probe a path, get an allow, then before the SDK acts, swap a symlink target. Currently best-effort mitigation only — Node lacks `openat()`.
2. **Cross-platform path semantics**: case-insensitivity on macOS/Windows, symlink resolution differences (Windows reparse points, Linux bind mounts), drive-letter normalisation. None are exercised in CI.

A known-failure-mode regression suite prevents silent erosion when:
- Node ever ships `openat()` and we should adopt it.
- A future change to fs-guard accidentally introduces a Windows-only path traversal hole.
- A symlink-disabled filesystem (Lambda, container, sandboxed CI) breaks the guard in production.

## Scope

### FX006-1: Platform-gated test fixtures

```ts
// test/runner/permissions/fs-guard-cross-platform.test.ts
describe('fs-guard cross-platform', () => {
  describe.runIf(process.platform === 'darwin' || process.platform === 'linux')('symlinks', () => {
    // Existing symlink tests, made explicit
  });

  describe.runIf(process.platform === 'win32')('windows paths', () => {
    test('drive-letter normalisation', ...);
    test('reparse-point handling', ...);
    test('UNC paths rejected when not in allowlist', ...);
  });

  describe('TOCTOU residual', () => {
    test('symlink swap mid-check yields documented best-effort result', ...);
  });
});
```

Use `vitest`'s `describe.runIf` (or skip-if equivalent) so non-platform tests skip cleanly without failing.

### FX006-2: Symlink-disabled filesystem fixture

Some CI runners (Lambda, locked-down containers) reject `symlink()` outright. Add a fixture that:
- Mocks `fs.symlinkSync` to throw `EPERM`.
- Asserts the guard treats the failure as "not a symlink" and continues with realpath check.

### FX006-3: Document residuals in `docs/how/permissions.md`

Add a § "FS guard limitations" subsection covering:
- TOCTOU best-effort posture.
- Platform differences with link to the test fixtures.
- Migration plan if Node ships `openat()` in the future.

## Acceptance criteria

- AC-FX6.1: Test suite skips cleanly on platforms it doesn't target (no false-fails). Skip messages include the platform reason (e.g., `"darwin/linux only — Windows uses different symlink semantics"`).
- AC-FX6.2: At least 3 Windows-specific test cases (drive letters, reparse, UNC).
- AC-FX6.3: TOCTOU test asserts the outcome is EITHER `denied` (guard caught the swap) OR `best-effort allow with a logged warning` containing the string `TOCTOU`. Both outcomes are PASS. Test MUST NOT assert a single deterministic outcome. Comment in test file: `// This test is intentionally non-deterministic by design — see FX006 dossier TOCTOU rationale.`
- AC-FX6.4: When `fs.symlinkSync` (mocked) throws `EPERM`, the guard MUST: (a) treat the path as a non-symlink, (b) proceed to realpath check, and (c) NOT throw or abort the check. Test asserts that a path inside `allowedRoots` is still ALLOWED and a path outside is still DENIED when symlinks are disabled.
- AC-FX6.5: `docs/how/permissions.md` § "FS guard limitations" exists and contains: (1) a bullet for TOCTOU best-effort, (2) a bullet for platform differences, each linking to `test/runner/permissions/fs-guard-cross-platform.test.ts`, and (3) a bullet for the `openat()` migration path. Link-check pass required.
- AC-FX6.6: `.github/workflows/` includes a `windows-latest` job that runs `npx vitest run test/runner/permissions/fs-guard-cross-platform.test.ts`. Implementer verifies existing CI config first; if a Windows runner already covers this test file, AC is satisfied with a one-line note in the PR (`already satisfied by <workflow-name>`). FX006 owns the Windows runner config; future fs-guard fixes extend `test/runner/permissions/fs-guard-cross-platform.test.ts` (or sibling files using the same `describe.runIf` gate).

## Out of scope
- Adopting `openat()` (Node N/A).
- Sandboxing the agent process via OS-level isolation (different threat model).
- New code paths for cross-platform handling that don't already exist — this fix is regression-test-only unless gaps are discovered.

## Risks
- Windows CI flakiness (path separators, line-endings) — mitigated by using `path.join` / `path.normalize` everywhere.
- TOCTOU test is inherently racy — mitigated by retry-with-backoff + accepting either "denied" or "best-effort allow with warning" as PASS (encoded in AC-FX6.3).
- **CI billing change**: adding `windows-latest` to GitHub Actions costs approximately 2× the Linux per-minute rate. The implementer MUST confirm with the repository owner before opening the PR that adds the runner. If the repo is on a free-tier plan, gate the Windows runner on the `fft-gate` trigger (not every push). Document the decision in the PR description.

## Testing
- TDD if any code paths added (none expected).
- Lightweight: platform-gated fixtures with skip-if guards.
- Manual: run on macOS, Linux, and Windows once before merge; verify skip behaviour.

---

## Validation Record (2026-05-04)

| Agent | Lenses Covered | Issues | Verdict |
|-------|---------------|--------|---------|
| Source-Truth | Technical Constraints | 0 (`describe.runIf` is real vitest API; no aspirational fns) | ✅ |
| Cross-Reference | Integration & Ripple | 0 | ✅ |
| Completeness | Edge Cases, Deployment & Ops | 1 CRITICAL (AC-FX6.4 vague) + 2 HIGH + 2 MEDIUM → all fixed inline | ❌ → ✅ |
| Forward-Compatibility | Forward-Compatibility (Test boundary) | 1 LOW (AC-FX6.6 ownership conditional) → fixed inline | ⚠️ → ✅ |

**Lens coverage**: 8/12 (at floor).

**Fixes applied**: AC-FX6.4 reformulated with explicit (a)/(b)/(c) behaviour spec, AC-FX6.3 dual-outcome PASS design encoded in AC, AC-FX6.6 made unconditional with verification step + ownership claim, CI billing approval gate added to Risks, AC-FX6.5 reformulated to require observable § structure with 3 enumerated bullets.

**Overall**: ❌ → ⚠️ VALIDATED WITH FIXES — ready for `/plan-6 --fix FX006` cycle.
