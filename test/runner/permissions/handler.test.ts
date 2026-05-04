/**
 * Plan 018 R1 — handler decision matrix tests (T-R1.9).
 *
 * Verifies the SDK-shape decision flow across kinds × decisions × paths.
 * Idempotency on requestId per workshop 002 § Q4.
 */
import { describe, expect, it } from 'vitest';
import {
  buildPermissionHandler,
  type PermissionDenialReason,
} from '../../../src/runner/permissions/handler.js';
import type {
  PermissionKind,
  ResolvedPolicy,
} from '../../../src/runner/permissions/policy.js';

function policyWith(
  decisions: Partial<Record<PermissionKind, 'allow' | 'deny' | 'prompt-user'>>,
  canonicalRoots: string[] = ['/tmp'],
): ResolvedPolicy {
  return {
    presetName: 'restricted',
    presetSource: 'release-default',
    decisions: {
      shell: 'deny',
      write: 'deny',
      mcp: 'allow',
      read: 'allow',
      url: 'deny',
      'custom-tool': 'deny',
      memory: 'deny',
      hook: 'deny',
      ...decisions,
    } as Record<PermissionKind, 'allow' | 'deny' | 'prompt-user'>,
    canonicalRoots,
    rootsResolvedFrom: canonicalRoots.map((r) => ({
      root: r,
      source: 'git-root' as const,
      reason: 'test',
    })),
  };
}

describe('buildPermissionHandler — kind decisions', () => {
  it('approves allow-decisions', () => {
    const h = buildPermissionHandler(policyWith({}));
    const r = h({ kind: 'mcp', requestId: 'r1' }, { sessionId: 's' });
    expect(r).toEqual({ kind: 'approve-once' });
  });

  it('rejects deny-decisions and fires onDeny', () => {
    const denials: PermissionDenialReason[] = [];
    const h = buildPermissionHandler(policyWith({}), {
      onDeny: (d) => denials.push(d),
    });
    const r = h({ kind: 'shell', requestId: 'r1' }, { sessionId: 's' });
    expect(r.kind).toBe('reject');
    expect(denials).toHaveLength(1);
    expect(denials[0].kind).toBe('shell');
  });

  it('idempotent on requestId', () => {
    const denials: PermissionDenialReason[] = [];
    const h = buildPermissionHandler(policyWith({}), {
      onDeny: (d) => denials.push(d),
    });
    h({ kind: 'shell', requestId: 'rX' }, { sessionId: 's' });
    h({ kind: 'shell', requestId: 'rX' }, { sessionId: 's' });
    expect(denials).toHaveLength(1);
  });

  it('prompt-user decision rejects (FX002 stub)', () => {
    const denials: PermissionDenialReason[] = [];
    const h = buildPermissionHandler(policyWith({ shell: 'prompt-user' }), {
      onDeny: (d) => denials.push(d),
    });
    const r = h({ kind: 'shell', requestId: 'r1' }, { sessionId: 's' });
    expect(r.kind).toBe('reject');
    expect(denials[0].decision).toBe('prompt-user');
  });
});

describe('buildPermissionHandler — path-bearing kinds', () => {
  it('denies write outside roots', () => {
    const denials: PermissionDenialReason[] = [];
    const tmpRoot = require('node:fs').realpathSync('/tmp');
    const h = buildPermissionHandler(
      policyWith({ write: 'allow' }, [tmpRoot]),
      { onDeny: (d) => denials.push(d) },
    );
    const r = h(
      {
        kind: 'write',
        requestId: 'r1',
        toolName: 'write',
        arguments: { file: '/etc/passwd' },
      },
      { sessionId: 's' },
    );
    expect(r.kind).toBe('reject');
    expect(denials[0].attemptedPath).toBe('/etc/passwd');
  });

  it('allows write inside roots', () => {
    const denials: PermissionDenialReason[] = [];
    const tmpRoot = require('node:fs').realpathSync('/tmp');
    const fs = require('node:fs');
    const path = require('node:path');
    const fixtureDir = fs.mkdtempSync(path.join(tmpRoot, 'minih-handler-'));
    try {
      const h = buildPermissionHandler(
        policyWith({ write: 'allow' }, [tmpRoot]),
        { onDeny: (d) => denials.push(d) },
      );
      const r = h(
        {
          kind: 'write',
          requestId: 'r1',
          toolName: 'write',
          arguments: { file: path.join(fixtureDir, 'foo') },
        },
        { sessionId: 's' },
      );
      expect(r.kind).toBe('approve-once');
      expect(denials).toHaveLength(0);
    } finally {
      fs.rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  it('allows non-path-bearing tool args even in path-bearing kind (no path = approved)', () => {
    const tmpRoot = require('node:fs').realpathSync('/tmp');
    const h = buildPermissionHandler(policyWith({ read: 'allow' }, [tmpRoot]));
    const r = h(
      { kind: 'read', requestId: 'r1', arguments: { foo: 'bar' } },
      { sessionId: 's' },
    );
    expect(r.kind).toBe('approve-once');
  });
});

describe('buildPermissionHandler — closure isolation', () => {
  it('two handler instances have independent denial sets', () => {
    const h1 = buildPermissionHandler(policyWith({}));
    const h2 = buildPermissionHandler(policyWith({}));
    expect(h1).not.toBe(h2);
  });
});
