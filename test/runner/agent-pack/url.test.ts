import { describe, expect, it } from 'vitest';
import {
  parseAgentUrl,
  renderAgentUrlCanonical,
} from '../../../src/runner/agent-pack/url.js';

describe('parseAgentUrl — npm-style github: shorthand', () => {
  it('parses bare github:owner/repo with default ref', () => {
    const r = parseAgentUrl('github:foo/bar');
    expect(r.type).toBe('github');
    if (r.type !== 'github') throw new Error('unreachable');
    expect(r.owner).toBe('foo');
    expect(r.repo).toBe('bar');
    expect(r.ref).toBe('main');
    expect(r.subpath).toBeUndefined();
  });

  it('parses github:owner/repo#ref', () => {
    const r = parseAgentUrl('github:foo/bar#dev');
    if (r.type !== 'github') throw new Error('unreachable');
    expect(r.ref).toBe('dev');
    expect(r.subpath).toBeUndefined();
  });

  it('parses github:owner/repo#ref:subpath', () => {
    const r = parseAgentUrl('github:foo/bar#main:agents/x');
    if (r.type !== 'github') throw new Error('unreachable');
    expect(r.ref).toBe('main');
    expect(r.subpath).toBe('agents/x');
  });

  it('parses github:owner/repo:subpath (subpath without ref)', () => {
    const r = parseAgentUrl('github:foo/bar:agents/x');
    if (r.type !== 'github') throw new Error('unreachable');
    expect(r.ref).toBe('main');
    expect(r.subpath).toBe('agents/x');
  });

  it('rejects malformed github: with missing repo', () => {
    expect(() => parseAgentUrl('github:foo')).toThrow();
  });
});

describe('parseAgentUrl — full HTTPS', () => {
  it('parses https://github.com/owner/repo with default ref', () => {
    const r = parseAgentUrl('https://github.com/foo/bar');
    expect(r.type).toBe('https');
    if (r.type !== 'https') throw new Error('unreachable');
    expect(r.owner).toBe('foo');
    expect(r.repo).toBe('bar');
    expect(r.ref).toBe('main');
  });

  it('parses https URL with #ref:subpath fragment', () => {
    const r = parseAgentUrl('https://github.com/foo/bar#dev:agents/x');
    if (r.type !== 'https') throw new Error('unreachable');
    expect(r.ref).toBe('dev');
    expect(r.subpath).toBe('agents/x');
  });

  it('parses https URL with ?path= query', () => {
    const r = parseAgentUrl('https://github.com/foo/bar?path=agents/x');
    if (r.type !== 'https') throw new Error('unreachable');
    expect(r.subpath).toBe('agents/x');
  });

  it('strips trailing .git suffix from repo', () => {
    const r = parseAgentUrl('https://github.com/foo/bar.git');
    if (r.type !== 'https') throw new Error('unreachable');
    expect(r.repo).toBe('bar');
  });
});

describe('parseAgentUrl — bare slugs and rejects', () => {
  it('rejects bare slug (not a URL)', () => {
    expect(() => parseAgentUrl('code-review-companion')).toThrow();
  });

  it('rejects empty input', () => {
    expect(() => parseAgentUrl('')).toThrow();
  });

  it('rejects subpath with traversal', () => {
    expect(() => parseAgentUrl('github:foo/bar:../../etc/passwd')).toThrow();
    expect(() =>
      parseAgentUrl('https://github.com/foo/bar?path=../escape'),
    ).toThrow();
  });

  it('rejects URL-encoded traversal in subpath', () => {
    expect(() =>
      parseAgentUrl('https://github.com/foo/bar?path=%2e%2e/escape'),
    ).toThrow();
  });

  it('rejects null byte in any segment', () => {
    expect(() => parseAgentUrl('github:foo/bar\u0000baz')).toThrow();
  });

  it('rejects oversized URL (>2048 bytes)', () => {
    const huge = `github:foo/${'x'.repeat(3000)}`;
    expect(() => parseAgentUrl(huge)).toThrow(/too long|length/i);
  });
});

describe('parseAgentUrl — subpath override', () => {
  it('honors explicit subpath override flag', () => {
    const r = parseAgentUrl('github:foo/bar#main:original/path', {
      subpathOverride: 'override/path',
    });
    if (r.type !== 'github') throw new Error('unreachable');
    expect(r.subpath).toBe('override/path');
  });

  it('rejects invalid subpath via override', () => {
    expect(() =>
      parseAgentUrl('github:foo/bar', { subpathOverride: '../escape' }),
    ).toThrow();
  });
});

describe('renderAgentUrlCanonical', () => {
  it('renders github type to npm-style canonical form', () => {
    const r = parseAgentUrl('github:foo/bar#dev:agents/x');
    expect(renderAgentUrlCanonical(r)).toBe('github:foo/bar#dev:agents/x');
  });

  it('omits trailing :subpath when undefined', () => {
    const r = parseAgentUrl('github:foo/bar#dev');
    expect(renderAgentUrlCanonical(r)).toBe('github:foo/bar#dev');
  });

  it('renders https type to npm-style canonical form (normalised)', () => {
    const r = parseAgentUrl('https://github.com/foo/bar#dev:agents/x');
    expect(renderAgentUrlCanonical(r)).toBe('github:foo/bar#dev:agents/x');
  });

  it('round-trip: parse → render → re-parse equals original', () => {
    const original = 'github:foo/bar#dev:agents/x';
    const r1 = parseAgentUrl(original);
    const rendered = renderAgentUrlCanonical(r1);
    const r2 = parseAgentUrl(rendered);
    expect(r2).toEqual(r1);
  });
});
