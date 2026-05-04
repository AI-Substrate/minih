/**
 * Plan 018 R1 — frontmatter parser tests for `permissions:` field (T-R1.3).
 */
import { describe, expect, it } from 'vitest';
import {
  parseFrontmatter,
  InvalidPermissionsFrontmatterError,
} from '../../../src/runner/folder.js';

function fm(body: string): string {
  return `---\n${body}\n---\n`;
}

describe('parsePermissionsField — string form', () => {
  it('absent → undefined', () => {
    const r = parseFrontmatter(fm('description: agent\ntags: []'));
    expect(r.permissions).toBeUndefined();
  });

  it('yolo string → preset', () => {
    const r = parseFrontmatter(fm('description: a\npermissions: yolo'));
    expect(r.permissions).toEqual({ preset: 'yolo' });
  });

  it('read-only string', () => {
    const r = parseFrontmatter(fm('description: a\npermissions: read-only'));
    expect(r.permissions).toEqual({ preset: 'read-only' });
  });

  it('unknown string → throws', () => {
    expect(() =>
      parseFrontmatter(fm('description: a\npermissions: bogus')),
    ).toThrow(InvalidPermissionsFrontmatterError);
  });
});

describe('parsePermissionsField — object form', () => {
  it('preset only', () => {
    const yaml = `description: a
permissions:
  preset: trusted`;
    const r = parseFrontmatter(fm(yaml));
    expect(r.permissions).toEqual({ preset: 'trusted' });
  });

  it('preset + overrides', () => {
    const yaml = `description: a
permissions:
  preset: read-only
  overrides:
    network: allow
    shell: allow`;
    const r = parseFrontmatter(fm(yaml));
    expect(r.permissions).toEqual({
      preset: 'read-only',
      overrides: { url: 'allow', shell: 'allow' },
    });
  });

  it('allowedRoots block', () => {
    const yaml = `description: a
permissions:
  preset: restricted
  allowedRoots:
    mode: extend
    roots: ["./repo", "./tmp"]`;
    const r = parseFrontmatter(fm(yaml));
    expect(r.permissions?.preset).toBe('restricted');
    expect(r.permissions?.allowedRoots).toEqual({
      mode: 'extend',
      roots: ['./repo', './tmp'],
    });
  });

  it('rejects invalid override decision', () => {
    const yaml = `description: a
permissions:
  preset: restricted
  overrides:
    shell: maybe`;
    expect(() => parseFrontmatter(fm(yaml))).toThrow(
      InvalidPermissionsFrontmatterError,
    );
  });

  it('rejects unknown override kind', () => {
    const yaml = `description: a
permissions:
  preset: restricted
  overrides:
    nonsense: allow`;
    expect(() => parseFrontmatter(fm(yaml))).toThrow(
      InvalidPermissionsFrontmatterError,
    );
  });

  it('rejects unknown preset in object form', () => {
    const yaml = `description: a
permissions:
  preset: bogus`;
    expect(() => parseFrontmatter(fm(yaml))).toThrow(
      InvalidPermissionsFrontmatterError,
    );
  });

  it('rejects malformed roots (not JSON array)', () => {
    const yaml = `description: a
permissions:
  preset: restricted
  allowedRoots:
    roots: not-json`;
    expect(() => parseFrontmatter(fm(yaml))).toThrow(
      InvalidPermissionsFrontmatterError,
    );
  });
});

describe('parsePermissionsField — CRLF safety (PL-01)', () => {
  it('handles \\r\\n line endings', () => {
    const yaml = ['description: a', 'permissions: yolo'].join('\r\n');
    const r = parseFrontmatter(`---\r\n${yaml}\r\n---\r\n`);
    expect(r.permissions).toEqual({ preset: 'yolo' });
  });
});
