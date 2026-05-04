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

- AC-FX6.1: Test suite skips cleanly on platforms it doesn't target (no false-fails).
- AC-FX6.2: At least 3 Windows-specific test cases (drive letters, reparse, UNC).
- AC-FX6.3: At least 1 TOCTOU regression locked in (documented best-effort behaviour).
- AC-FX6.4: Symlink-disabled FS fixture asserts graceful fallback.
- AC-FX6.5: `docs/how/permissions.md` documents residuals + test pointers.
- AC-FX6.6: CI matrix includes one Windows runner exercising the platform-gated tests (if not already configured).

## Out of scope
- Adopting `openat()` (Node N/A).
- Sandboxing the agent process via OS-level isolation (different threat model).
- New code paths for cross-platform handling that don't already exist — this fix is regression-test-only unless gaps are discovered.

## Risks
- Windows CI flakiness (path separators, line-endings) — mitigated by using `path.join` / `path.normalize` everywhere.
- TOCTOU test is inherently racy — mitigated by retry-with-backoff + accepting either "denied" or "best-effort allow with warning" as PASS.
- Adding Windows runner inflates CI minutes — accept; this is the only domain that needs it for plan 018.

## Testing
- TDD if any code paths added (none expected).
- Lightweight: platform-gated fixtures with skip-if guards.
- Manual: run on macOS, Linux, and Windows once before merge; verify skip behaviour.
