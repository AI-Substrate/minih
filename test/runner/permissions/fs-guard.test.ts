/**
 * Plan 018 R1 — fs-guard tests (T-R1.4-R1.7).
 *
 * Real .git fixtures + real symlink trees in tmpdir(). Cleaned up via
 * afterEach. Cross-platform stubs not present (T-R1.5 follow-up).
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AllowedRootsInvalidError,
  canonicalizeRoots,
  extractPathArg,
  ForbiddenRootError,
  isPathAllowed,
  resolveDefaultAllowedRoots,
} from '../../../src/runner/permissions/fs-guard.js';

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-fsguard-'));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('resolveDefaultAllowedRoots', () => {
  it('finds .git ancestor and returns gitRoot', () => {
    fs.mkdirSync(path.join(tmp, '.git'));
    fs.mkdirSync(path.join(tmp, 'src', 'sub'), { recursive: true });
    const result = resolveDefaultAllowedRoots(path.join(tmp, 'src', 'sub'));
    expect(result.roots).toEqual([fs.realpathSync(tmp)]);
    expect(result.reasons[0].source).toBe('git-root');
  });

  it('falls back to cwd if no .git ancestor', () => {
    const sub = path.join(tmp, 'no-git');
    fs.mkdirSync(sub);
    const result = resolveDefaultAllowedRoots(sub);
    expect(result.roots[0]).toBe(fs.realpathSync(sub));
    expect(result.reasons[0].source).toBe('cwd-fallback');
  });

  it('refuses to fall back to /', () => {
    expect(() => resolveDefaultAllowedRoots('/')).toThrow(ForbiddenRootError);
  });
});

describe('canonicalizeRoots', () => {
  it('extends defaults with frontmatter layer', () => {
    fs.mkdirSync(path.join(tmp, 'extra'));
    const result = canonicalizeRoots(
      [
        {
          source: 'frontmatter',
          rule: { mode: 'extend', roots: [path.join(tmp, 'extra')] },
        },
      ],
      {
        roots: [fs.realpathSync(tmp)],
        reasons: [
          { root: fs.realpathSync(tmp), source: 'git-root', reason: 'test' },
        ],
      },
    );
    expect(result.canonicalRoots).toContain(fs.realpathSync(tmp));
    expect(result.canonicalRoots).toContain(
      fs.realpathSync(path.join(tmp, 'extra')),
    );
  });

  it('replace-mode wipes lower layers', () => {
    fs.mkdirSync(path.join(tmp, 'only'));
    const result = canonicalizeRoots(
      [
        {
          source: 'cli',
          rule: { mode: 'replace', roots: [path.join(tmp, 'only')] },
        },
      ],
      {
        roots: [fs.realpathSync(tmp)],
        reasons: [
          { root: fs.realpathSync(tmp), source: 'git-root', reason: 'test' },
        ],
      },
    );
    expect(result.canonicalRoots).toEqual([
      fs.realpathSync(path.join(tmp, 'only')),
    ]);
  });

  it('refuses forbidden roots', () => {
    expect(() =>
      canonicalizeRoots(
        [
          {
            source: 'cli',
            rule: { mode: 'replace', roots: ['/'] },
          },
        ],
        { roots: [], reasons: [] },
      ),
    ).toThrow(ForbiddenRootError);
  });

  it('refuses empty composition', () => {
    expect(() =>
      canonicalizeRoots(
        [{ source: 'cli', rule: { mode: 'replace', roots: [] } }],
        { roots: [], reasons: [] },
      ),
    ).toThrow(AllowedRootsInvalidError);
  });
});

describe('isPathAllowed', () => {
  it('approves paths inside roots', () => {
    fs.mkdirSync(path.join(tmp, 'work'));
    fs.writeFileSync(path.join(tmp, 'work', 'file.txt'), 'x');
    expect(
      isPathAllowed(path.join(tmp, 'work', 'file.txt'), [fs.realpathSync(tmp)]),
    ).toBe(true);
  });

  it('denies paths outside roots', () => {
    expect(isPathAllowed('/etc/passwd', [fs.realpathSync(tmp)])).toBe(false);
  });

  it('approves write-to-new-file (ENOENT) when parent is in roots', () => {
    expect(
      isPathAllowed(path.join(tmp, 'new-file.txt'), [fs.realpathSync(tmp)]),
    ).toBe(true);
  });

  it('denies symlink that escapes the root', () => {
    const work = path.join(tmp, 'work');
    fs.mkdirSync(work);
    const escapeLink = path.join(work, 'escape-link');
    fs.symlinkSync('/etc', escapeLink);
    // escape-link/passwd → resolves to /etc/passwd which is outside tmp
    expect(
      isPathAllowed(path.join(escapeLink, 'passwd'), [fs.realpathSync(tmp)]),
    ).toBe(false);
  });

  it('denies broken symlinks (ELOOP / ENOENT chains)', () => {
    const work = path.join(tmp, 'work');
    fs.mkdirSync(work);
    const link = path.join(work, 'circular');
    fs.symlinkSync(link, link);
    expect(isPathAllowed(link, [fs.realpathSync(tmp)])).toBe(false);
  });
});

describe('extractPathArg', () => {
  it('finds cwd in shell args', () => {
    expect(extractPathArg('shell', { cwd: '/tmp' })).toBe('/tmp');
  });

  it('finds file path in write args', () => {
    expect(extractPathArg('write', { file: '/tmp/foo' })).toBe('/tmp/foo');
  });

  it('finds *Path heuristic', () => {
    expect(extractPathArg('custom', { targetPath: '/tmp/x' })).toBe('/tmp/x');
  });

  it('returns null for non-path-bearing args', () => {
    expect(extractPathArg('mcp', { url: 'http://x' })).toBe(null);
  });

  it('returns null for non-object args', () => {
    expect(extractPathArg('shell', null)).toBe(null);
    expect(extractPathArg('shell', 'some-string')).toBe(null);
  });
});
