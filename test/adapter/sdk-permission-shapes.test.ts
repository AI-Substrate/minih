/**
 * Plan 018 R1 — SDK shape regression test (T-R1.14).
 *
 * Pins the SDK 0.3.x permission shape names. If the SDK 0.4.x renames
 * `approve-once` → `approved` (or anything else), this test fails loudly
 * so we update our string-literal unions explicitly rather than silently
 * approving the new shape.
 *
 * If this test fails: read the SDK changelog, update
 * `src/runner/permissions/handler.ts` types + `src/adapter/copilot-types.ts`
 * to match, and snapshot the new shape here.
 */
import { describe, expect, it } from 'vitest';
import {
  approveAll,
  type PermissionDecisionApproveOnce,
  type PermissionDecisionReject,
  type PermissionRequest,
} from '@github/copilot-sdk';

describe('SDK permission shape regression (T-R1.14)', () => {
  it('PermissionRequest.kind union matches our pinned vocabulary', () => {
    // Statically assert by constructing values for every kind.
    const kinds: PermissionRequest['kind'][] = [
      'shell',
      'write',
      'mcp',
      'read',
      'url',
      'custom-tool',
      'memory',
      'hook',
    ];
    expect(kinds).toHaveLength(8);
  });

  it('PermissionDecisionApproveOnce uses kind="approve-once"', () => {
    const dec: PermissionDecisionApproveOnce = { kind: 'approve-once' };
    expect(dec.kind).toBe('approve-once');
  });

  it('PermissionDecisionReject uses kind="reject" with optional feedback', () => {
    const dec: PermissionDecisionReject = { kind: 'reject', feedback: 'x' };
    expect(dec.kind).toBe('reject');
    expect(dec.feedback).toBe('x');
  });

  it('approveAll exists and returns approve-once', async () => {
    const result = await approveAll(
      { kind: 'shell' },
      { sessionId: 'test' },
    );
    expect(result).toEqual({ kind: 'approve-once' });
  });
});
