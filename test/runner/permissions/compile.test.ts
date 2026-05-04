/**
 * Plan 018 R1 — compile() resolution chain tests (T-R1.8).
 *
 * Verifies the 4-layer override matrix per AC24.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { compile } from '../../../src/runner/permissions/compile.js';

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-compile-'));
  fs.mkdirSync(path.join(tmp, '.git'));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('compile — preset resolution chain (AC24)', () => {
  it('frontmatter wins over sidecar', () => {
    const r = compile({
      frontmatter: { preset: 'restricted' },
      sidecar: { preset: 'yolo' },
      releaseDefault: { preset: 'yolo' },
      cwd: tmp,
    });
    expect(r.presetName).toBe('restricted');
  });

  it('sidecar wins over env', () => {
    const r = compile({
      sidecar: { preset: 'trusted' },
      env: { preset: 'yolo' },
      releaseDefault: { preset: 'yolo' },
      cwd: tmp,
    });
    expect(r.presetName).toBe('trusted');
  });

  it('env wins over release default', () => {
    const r = compile({
      env: { preset: 'restricted' },
      releaseDefault: { preset: 'yolo' },
      cwd: tmp,
    });
    expect(r.presetName).toBe('restricted');
  });

  it('release default fallback', () => {
    const r = compile({
      releaseDefault: { preset: 'yolo' },
      cwd: tmp,
    });
    expect(r.presetName).toBe('yolo');
  });
});

describe('compile — override stacking', () => {
  it('frontmatter overrides apply on top of preset', () => {
    const r = compile({
      frontmatter: {
        preset: 'restricted',
        overrides: { shell: 'allow' },
      },
      releaseDefault: { preset: 'yolo' },
      cwd: tmp,
    });
    expect(r.decisions.shell).toBe('allow');
    expect(r.decisions.write).toBe('deny');
  });

  it('frontmatter overrides win over sidecar overrides', () => {
    const r = compile({
      frontmatter: {
        preset: 'restricted',
        overrides: { shell: 'allow' },
      },
      sidecar: {
        overrides: { shell: 'deny' },
      },
      releaseDefault: { preset: 'yolo' },
      cwd: tmp,
    });
    expect(r.decisions.shell).toBe('allow');
  });
});

describe('compile — allowedRoots composition', () => {
  it('default root is git-root', () => {
    const r = compile({
      releaseDefault: { preset: 'yolo' },
      cwd: tmp,
    });
    expect(r.canonicalRoots).toEqual([fs.realpathSync(tmp)]);
    expect(r.rootsResolvedFrom[0].source).toBe('git-root');
  });

  it('frontmatter extends default roots', () => {
    fs.mkdirSync(path.join(tmp, 'extra'));
    const r = compile({
      frontmatter: {
        allowedRoots: { mode: 'extend', roots: [path.join(tmp, 'extra')] },
      },
      releaseDefault: { preset: 'yolo' },
      cwd: tmp,
    });
    expect(r.canonicalRoots.length).toBe(2);
    expect(r.canonicalRoots).toContain(
      fs.realpathSync(path.join(tmp, 'extra')),
    );
  });

  it('replace mode wipes lower layers', () => {
    fs.mkdirSync(path.join(tmp, 'only'));
    const r = compile({
      frontmatter: {
        allowedRoots: { mode: 'replace', roots: [path.join(tmp, 'only')] },
      },
      releaseDefault: { preset: 'yolo' },
      cwd: tmp,
    });
    expect(r.canonicalRoots).toEqual([
      fs.realpathSync(path.join(tmp, 'only')),
    ]);
  });
});
