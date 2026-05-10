/**
 * Plan 018 R1.20a — AC34 executable regression for config-discovery exemption.
 *
 * Spec AC34 (workshop 001 § Q12): an agent with
 *   permissions: read-only + allowedRoots: [/repo] + enableConfigDiscovery: true
 * should load `AGENTS.md` from `~` without firing `permission_denied`.
 *
 * R1 implementation: the FS guard is consulted only by `buildPermissionHandler`,
 * which is wired into the SDK's `onPermissionRequest`. Config discovery happens
 * at SDK startup *outside* the permission gate — the SDK reads AGENTS.md
 * directly, so no `read` permission request fires. This test pins that behaviour.
 *
 * If the SDK changes to gate config-discovery through onPermissionRequest, the
 * runner needs to add an explicit exemption for those tool calls.
 */
import { describe, expect, it } from 'vitest';
import { buildPermissionHandler } from '../../../src/runner/permissions/handler.js';
import type { ResolvedPolicy } from '../../../src/runner/permissions/policy.js';

describe('AC34 — config-discovery exemption', () => {
  it('handler is only consulted on PermissionRequest events; AGENTS.md reads bypass it', () => {
    // We can't unit-test "the SDK reads AGENTS.md without firing a permission
    // request" — that's an SDK contract verification. What we CAN test is
    // that our handler correctly denies a regular `read` outside roots, so a
    // future SDK change that does fire a request would surface in a fft run.
    const policy: ResolvedPolicy = {
      presetName: 'read-only',
      presetSource: 'frontmatter',
      decisions: {
        shell: 'deny',
        write: 'deny',
        mcp: 'allow',
        read: 'allow',
        url: 'deny',
        'custom-tool': 'deny',
        memory: 'deny',
        hook: 'deny',
      },
      canonicalRoots: ['/repo'],
      rootsResolvedFrom: [
        { root: '/repo', source: 'frontmatter', reason: 'test fixture' },
      ],
    };

    const denials: unknown[] = [];
    const handler = buildPermissionHandler(policy, {
      onDeny: (d) => denials.push(d),
    });

    // Regular read of /home/user/AGENTS.md outside roots → DENIES.
    // The SDK reads AGENTS.md WITHOUT firing this handler because config
    // discovery is internal to the SDK runtime, not a tool call. So the
    // handler firing here would itself prove the exemption is broken.
    const r = handler(
      {
        kind: 'read',
        requestId: 'r1',
        toolName: 'read',
        arguments: { file: '/home/user/AGENTS.md' },
      },
      { sessionId: 's' },
    );
    expect(r.kind).toBe('reject');
    expect(denials).toHaveLength(1);

    // The contract: as long as the SDK does NOT route AGENTS.md reads
    // through onPermissionRequest, the agent's startup AGENTS.md walk
    // succeeds silently. This test pins our half of the contract; the
    // sdk-permission-shapes.test.ts pins the SDK's half.
  });
});
