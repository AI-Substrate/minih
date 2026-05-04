/**
 * Unit tests — coord-write-precondition.ts (FX008-2).
 *
 * Covers the 6 cases enumerated in the FX008 dossier task table plus
 * additional surface area:
 *   (a) coord-on + write-deny + no-flag           → throws E205
 *   (b) coord-off + write-deny                    → noop
 *   (c) coord-on + write-allow                    → noop
 *   (d) coord-on + write-deny + opt-out flag      → noop + stderr banner
 *   (e) message format includes preset, source, slug, and remediations
 *   (f) yolo preset — coord-on + write-allow      → noop (write-allow path)
 *   (g) sidecar source adds the `permissions reset` hint
 *   (h) ops kill-switch MINIH_DISABLE_COORD_WRITE_PRECONDITION → noop + banner
 *
 * Pure-function tests against synthesised `ResolvedPolicy` and
 * `AgentDefinition` fragments. No filesystem or compile() coupling.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  assertCoordWriteAllowed,
  CoordinationWriteDeniedError,
  formatCoordWriteDeniedMessage,
  isCoordWritePreconditionDisabled,
} from '../../../src/runner/permissions/coord-write-precondition.js';
import type {
  PermissionDecision,
  PermissionKind,
  ResolvedPolicy,
} from '../../../src/runner/permissions/policy.js';

function decisions(
  overrides: Partial<Record<PermissionKind, PermissionDecision>> = {},
): Record<PermissionKind, PermissionDecision> {
  return {
    shell: 'deny',
    write: 'deny',
    mcp: 'allow',
    read: 'allow',
    url: 'deny',
    'custom-tool': 'deny',
    memory: 'deny',
    hook: 'deny',
    ...overrides,
  } as Record<PermissionKind, PermissionDecision>;
}

function policy(
  override: Partial<
    Pick<ResolvedPolicy, 'presetName' | 'presetSource' | 'decisions'>
  > = {},
): Pick<ResolvedPolicy, 'presetName' | 'presetSource' | 'decisions'> {
  return {
    presetName: 'restricted',
    presetSource: 'release-default',
    decisions: decisions(),
    ...override,
  };
}

const coordEnabled = {
  slug: 'coord-agent',
  coordination: { enabled: true },
} as const;

const coordDisabled = {
  slug: 'plain-agent',
  coordination: { enabled: false },
} as const;

afterEach(() => {
  delete process.env.MINIH_DISABLE_COORD_WRITE_PRECONDITION;
});

describe('assertCoordWriteAllowed (FX008-2)', () => {
  test('(a) coord-on + write-deny + no-flag → throws E205 with structured fields', () => {
    expect(() => assertCoordWriteAllowed(coordEnabled, policy())).toThrow(
      CoordinationWriteDeniedError,
    );

    try {
      assertCoordWriteAllowed(coordEnabled, policy());
      throw new Error('should have thrown');
    } catch (err) {
      const e = err as CoordinationWriteDeniedError;
      expect(e.errorCode).toBe('E205');
      expect(e.kind).toBe('coord-write-deny');
      expect(e.slug).toBe('coord-agent');
      expect(e.presetName).toBe('restricted');
      expect(e.presetSource).toBe('release-default');
      expect(e.message).toContain('E205 COORDINATION_WRITE_DENIED');
    }
  });

  test('(b) coord-off + write-deny → noop (precondition is coord-only)', () => {
    expect(() =>
      assertCoordWriteAllowed(coordDisabled, policy()),
    ).not.toThrow();
  });

  test('(c) coord-on + write-allow → noop', () => {
    expect(() =>
      assertCoordWriteAllowed(
        coordEnabled,
        policy({ decisions: decisions({ write: 'allow' }) }),
      ),
    ).not.toThrow();
  });

  test('(d) coord-on + write-deny + opt-out flag → noop + stderr deprecation banner', () => {
    const stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);

    expect(() =>
      assertCoordWriteAllowed(coordEnabled, policy(), {
        allowCoordWriteDeny: true,
      }),
    ).not.toThrow();

    expect(stderrSpy).toHaveBeenCalledTimes(1);
    const banner = stderrSpy.mock.calls[0]?.[0] as string;
    // Anchored at start (AC-FX8.9) — match exact regex shape used in tests.
    expect(banner).toMatch(
      /^\[minih\] Warning: --allow-coord-write-deny set; canonical session record will not be persisted/,
    );
    expect(banner).toContain("slug='coord-agent'");
    expect(banner).toContain("preset='restricted'");

    stderrSpy.mockRestore();
  });

  test('(e) message format includes preset, source, slug, and three remediations', () => {
    const msg = formatCoordWriteDeniedMessage({
      slug: 'my-agent',
      presetName: 'read-only',
      presetSource: 'frontmatter',
    });
    expect(msg).toContain("Coordinated agent 'my-agent'");
    expect(msg).toContain('preset');
    expect(msg).toContain("'read-only'");
    expect(msg).toContain('Resolved from: frontmatter');
    expect(msg).toContain('Remediations (pick one):');
    expect(msg).toContain('1. Add `write: allow`');
    expect(msg).toContain('2. Pick a preset that allows write');
    expect(msg).toContain('3. Pass --allow-coord-write-deny');
    expect(msg).toContain('workshop 002 § Q1');
    // Frontmatter source does NOT include the sidecar reset hint.
    expect(msg).not.toContain('permissions reset');
  });

  test('(f) yolo preset (coord-on + write-allow) — noop (write-allow path)', () => {
    expect(() =>
      assertCoordWriteAllowed(
        coordEnabled,
        policy({
          presetName: 'yolo',
          presetSource: 'frontmatter',
          decisions: {
            shell: 'allow',
            write: 'allow',
            mcp: 'allow',
            read: 'allow',
            url: 'allow',
            'custom-tool': 'allow',
            memory: 'allow',
            hook: 'allow',
          },
        }),
      ),
    ).not.toThrow();
  });

  test('(g) sidecar source adds the `minih agent permissions reset` hint', () => {
    const msg = formatCoordWriteDeniedMessage({
      slug: 'my-agent',
      presetName: 'restricted',
      presetSource: 'sidecar',
    });
    expect(msg).toContain('Resolved from: sidecar');
    expect(msg).toContain('minih agent permissions reset');
  });

  test('(h) MINIH_DISABLE_COORD_WRITE_PRECONDITION=1 bypasses + emits anchored stderr banner', () => {
    process.env.MINIH_DISABLE_COORD_WRITE_PRECONDITION = '1';
    const stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);

    expect(() => assertCoordWriteAllowed(coordEnabled, policy())).not.toThrow();

    expect(stderrSpy).toHaveBeenCalledTimes(1);
    const banner = stderrSpy.mock.calls[0]?.[0] as string;
    expect(banner).toMatch(
      /^\[minih\] Warning: MINIH_DISABLE_COORD_WRITE_PRECONDITION is set/,
    );
    expect(banner).toContain("'coord-agent'");

    stderrSpy.mockRestore();
  });

  test('(h-true) MINIH_DISABLE_COORD_WRITE_PRECONDITION=true (case-insensitive) also bypasses', () => {
    process.env.MINIH_DISABLE_COORD_WRITE_PRECONDITION = 'TRUE';
    const stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);

    expect(() => assertCoordWriteAllowed(coordEnabled, policy())).not.toThrow();
    expect(stderrSpy).toHaveBeenCalledTimes(1);

    stderrSpy.mockRestore();
  });

  test('(h-other) MINIH_DISABLE_COORD_WRITE_PRECONDITION=other does NOT bypass', () => {
    process.env.MINIH_DISABLE_COORD_WRITE_PRECONDITION = 'maybe';
    expect(() => assertCoordWriteAllowed(coordEnabled, policy())).toThrow(
      CoordinationWriteDeniedError,
    );
  });

  test('flag wins over kill-switch only when both set (flag short-circuits first)', () => {
    // Order in implementation is: kill-switch checked BEFORE flag. So if both
    // set, kill-switch banner fires (not flag banner). Test that contract.
    process.env.MINIH_DISABLE_COORD_WRITE_PRECONDITION = '1';
    const stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);

    expect(() =>
      assertCoordWriteAllowed(coordEnabled, policy(), {
        allowCoordWriteDeny: true,
      }),
    ).not.toThrow();
    expect(stderrSpy).toHaveBeenCalledTimes(1);
    const banner = stderrSpy.mock.calls[0]?.[0] as string;
    expect(banner).toContain('MINIH_DISABLE_COORD_WRITE_PRECONDITION is set');

    stderrSpy.mockRestore();
  });
});

describe('isCoordWritePreconditionDisabled (FX008-8)', () => {
  test('returns false when env var unset', () => {
    delete process.env.MINIH_DISABLE_COORD_WRITE_PRECONDITION;
    expect(isCoordWritePreconditionDisabled()).toBe(false);
  });

  test('returns true for "1"', () => {
    process.env.MINIH_DISABLE_COORD_WRITE_PRECONDITION = '1';
    expect(isCoordWritePreconditionDisabled()).toBe(true);
  });

  test('returns true for case-insensitive "true"', () => {
    process.env.MINIH_DISABLE_COORD_WRITE_PRECONDITION = 'True';
    expect(isCoordWritePreconditionDisabled()).toBe(true);
  });

  test('returns false for "0", "false", or arbitrary strings', () => {
    for (const v of ['0', 'false', 'no', 'yes', 'on']) {
      process.env.MINIH_DISABLE_COORD_WRITE_PRECONDITION = v;
      expect(isCoordWritePreconditionDisabled()).toBe(false);
    }
  });
});
