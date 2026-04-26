import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createRunFolder,
  hasOutsideMd,
  historyPath,
  InvalidCoordinationFrontmatterError,
  InvalidSlugError,
  inboxLanePath,
  listAgents,
  outsideMdPath,
  parseFrontmatter,
  resolveAgent,
  stateFilePath,
  validateSlug,
  watermarkPath,
} from '../../src/runner/folder.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('validateSlug', () => {
  it('accepts valid slugs', () => {
    expect(validateSlug('smoke-test')).toBeNull();
    expect(validateSlug('code_review')).toBeNull();
    expect(validateSlug('my-agent-v2')).toBeNull();
    expect(validateSlug('test123')).toBeNull();
    expect(validateSlug('a')).toBeNull();
  });

  it('rejects empty string', () => {
    expect(validateSlug('')).toMatch(/empty/i);
  });

  it('rejects path traversal', () => {
    expect(validateSlug('..')).not.toBeNull();
    expect(validateSlug('../evil')).not.toBeNull();
    expect(validateSlug('foo/bar')).not.toBeNull();
    expect(validateSlug('foo\\bar')).not.toBeNull();
  });

  it('rejects invalid characters', () => {
    expect(validateSlug('my agent')).not.toBeNull();
    expect(validateSlug('hello!')).not.toBeNull();
    expect(validateSlug('.hidden')).not.toBeNull();
  });

  it('rejects slugs over 64 chars', () => {
    expect(validateSlug('a'.repeat(65))).not.toBeNull();
    expect(validateSlug('a'.repeat(64))).toBeNull();
  });

  it('rejects null bytes', () => {
    expect(validateSlug('foo\0bar')).not.toBeNull();
  });
});

describe('parseFrontmatter', () => {
  it('extracts description and tags', () => {
    const content = `---
description: "My cool agent"
tags: [smoke, ci]
---

# Hello

Body here.`;
    const result = parseFrontmatter(content);
    expect(result.description).toBe('My cool agent');
    expect(result.tags).toEqual(['smoke', 'ci']);
    expect(result.body).toBe('\n# Hello\n\nBody here.');
  });

  it('handles missing frontmatter', () => {
    const content = `# No Frontmatter\n\nJust body.`;
    const result = parseFrontmatter(content);
    expect(result.description).toBe('');
    expect(result.tags).toEqual([]);
    expect(result.body).toBe(content);
  });

  it('handles empty frontmatter', () => {
    const content = `---\n---\n\nBody.`;
    const result = parseFrontmatter(content);
    expect(result.description).toBe('');
    expect(result.tags).toEqual([]);
    expect(result.body).toBe('\nBody.');
  });

  it('handles frontmatter with no tags', () => {
    const content = `---\ndescription: "Just a description"\n---\n\nBody.`;
    const result = parseFrontmatter(content);
    expect(result.description).toBe('Just a description');
    expect(result.tags).toEqual([]);
  });

  it('does not confuse markdown horizontal rules with frontmatter', () => {
    const content = `---
description: "Real frontmatter"
---

# Title

Some text.

---

More text after horizontal rule.`;
    const result = parseFrontmatter(content);
    expect(result.description).toBe('Real frontmatter');
    expect(result.body).toContain('---');
    expect(result.body).toContain('More text after horizontal rule.');
  });

  it('treats mid-file --- as body content, not frontmatter', () => {
    const content = `# No frontmatter\n\n---\n\ndescription: "not frontmatter"\n---`;
    const result = parseFrontmatter(content);
    expect(result.description).toBe('');
    expect(result.body).toBe(content);
  });

  it('handles Windows CRLF line endings', () => {
    const content =
      '---\r\ndescription: "CRLF agent"\r\ntags: [windows, crlf]\r\n---\r\n\r\n# Body';
    const result = parseFrontmatter(content);
    expect(result.description).toBe('CRLF agent');
    expect(result.tags).toEqual(['windows', 'crlf']);
    expect(result.body).toBe('\n# Body');
  });
});

describe('listAgents', () => {
  it('finds agents with prompt.md', () => {
    const agentDir = path.join(tmpDir, 'hello-world');
    fs.mkdirSync(agentDir);
    fs.writeFileSync(
      path.join(agentDir, 'prompt.md'),
      '---\ndescription: "Say hello"\n---\n\n# Hello',
    );

    const agents = listAgents(tmpDir);
    expect(agents).toHaveLength(1);
    expect(agents[0].slug).toBe('hello-world');
    expect(agents[0].description).toBe('Say hello');
  });

  it('skips underscore-prefixed folders', () => {
    const shared = path.join(tmpDir, '_shared');
    fs.mkdirSync(shared);
    fs.writeFileSync(path.join(shared, 'preamble.md'), '# Preamble');

    const agentDir = path.join(tmpDir, 'real-agent');
    fs.mkdirSync(agentDir);
    fs.writeFileSync(
      path.join(agentDir, 'prompt.md'),
      '---\ndescription: "Real"\n---\n\n# Real',
    );

    const agents = listAgents(tmpDir);
    expect(agents).toHaveLength(1);
    expect(agents[0].slug).toBe('real-agent');
  });

  it('skips folders without prompt.md', () => {
    const noPrompt = path.join(tmpDir, 'no-prompt');
    fs.mkdirSync(noPrompt);
    fs.writeFileSync(path.join(noPrompt, 'readme.md'), '# Not a prompt');

    const agents = listAgents(tmpDir);
    expect(agents).toHaveLength(0);
  });

  it('returns agents sorted alphabetically', () => {
    for (const slug of ['zebra', 'alpha', 'middle']) {
      const dir = path.join(tmpDir, slug);
      fs.mkdirSync(dir);
      fs.writeFileSync(
        path.join(dir, 'prompt.md'),
        `---\ndescription: "${slug}"\n---\n\n# ${slug}`,
      );
    }

    const agents = listAgents(tmpDir);
    expect(agents.map((a) => a.slug)).toEqual(['alpha', 'middle', 'zebra']);
  });

  it('detects optional files', () => {
    const dir = path.join(tmpDir, 'full-agent');
    fs.mkdirSync(dir);
    fs.writeFileSync(
      path.join(dir, 'prompt.md'),
      '---\ndescription: "Full"\n---\n\n# Full',
    );
    fs.writeFileSync(path.join(dir, 'output-schema.json'), '{}');
    fs.writeFileSync(path.join(dir, 'input-schema.json'), '{}');
    fs.writeFileSync(path.join(dir, 'instructions.md'), '# Instructions');

    const agents = listAgents(tmpDir);
    expect(agents[0].schemaPath).not.toBeNull();
    expect(agents[0].inputSchemaPath).not.toBeNull();
    expect(agents[0].instructionsPath).not.toBeNull();
  });

  it('returns empty for nonexistent directory', () => {
    const agents = listAgents(path.join(tmpDir, 'nonexistent'));
    expect(agents).toHaveLength(0);
  });

  it('skips agents with missing frontmatter description', () => {
    const noDesc = path.join(tmpDir, 'no-desc');
    fs.mkdirSync(noDesc);
    fs.writeFileSync(
      path.join(noDesc, 'prompt.md'),
      '# No Frontmatter\n\nJust body.',
    );

    const withDesc = path.join(tmpDir, 'with-desc');
    fs.mkdirSync(withDesc);
    fs.writeFileSync(
      path.join(withDesc, 'prompt.md'),
      '---\ndescription: "Has description"\n---\n\n# Good',
    );

    const agents = listAgents(tmpDir);
    expect(agents).toHaveLength(1);
    expect(agents[0].slug).toBe('with-desc');
  });
});

describe('resolveAgent', () => {
  it('finds agent by slug', () => {
    const dir = path.join(tmpDir, 'my-agent');
    fs.mkdirSync(dir);
    fs.writeFileSync(
      path.join(dir, 'prompt.md'),
      '---\ndescription: "Mine"\n---\n\n# Mine',
    );

    const agent = resolveAgent('my-agent', tmpDir);
    expect(agent).not.toBeNull();
    expect(agent?.slug).toBe('my-agent');
  });

  it('returns null for unknown slug', () => {
    const agent = resolveAgent('nonexistent', tmpDir);
    expect(agent).toBeNull();
  });
});

describe('createRunFolder', () => {
  it('creates timestamped run folder with frozen copies', () => {
    const dir = path.join(tmpDir, 'test-agent');
    fs.mkdirSync(dir);
    fs.writeFileSync(
      path.join(dir, 'prompt.md'),
      '---\ndescription: "Test"\n---\n\n# Test prompt',
    );
    fs.writeFileSync(path.join(dir, 'output-schema.json'), '{"type":"object"}');
    fs.writeFileSync(path.join(dir, 'instructions.md'), '# Instructions');

    const agent = resolveAgent('test-agent', tmpDir);
    expect(agent).not.toBeNull();
    if (!agent) throw new Error('expected test-agent to resolve');
    const { runDir, runId } = createRunFolder(agent);

    expect(fs.existsSync(runDir)).toBe(true);
    expect(runId).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[0-9a-f]{4}$/,
    );

    // Frozen copies
    expect(fs.existsSync(path.join(runDir, 'prompt.md'))).toBe(true);
    expect(fs.existsSync(path.join(runDir, 'output-schema.json'))).toBe(true);
    expect(fs.existsSync(path.join(runDir, 'instructions.md'))).toBe(true);
    expect(fs.existsSync(path.join(runDir, 'output'))).toBe(true);

    // Content preserved
    expect(fs.readFileSync(path.join(runDir, 'prompt.md'), 'utf-8')).toContain(
      '# Test prompt',
    );
  });
});

// ---------------------------------------------------------------------------
// P1 / T007 — coordination path helpers
// ---------------------------------------------------------------------------

describe('coordination path helpers (T007)', () => {
  it('inboxLanePath returns absolute path with the correct lane', () => {
    const p = inboxLanePath('hello', tmpDir, 'outside');
    expect(path.isAbsolute(p)).toBe(true);
    expect(p).toBe(
      path.join(
        path.resolve(tmpDir),
        'hello',
        'inbox',
        'outside',
        'messages.ndjson',
      ),
    );
  });

  it('stateFilePath returns absolute path per side', () => {
    const o = stateFilePath('hello', tmpDir, 'outside');
    const i = stateFilePath('hello', tmpDir, 'inside');
    expect(path.isAbsolute(o) && path.isAbsolute(i)).toBe(true);
    expect(o).toMatch(/state\/outside\.json$/);
    expect(i).toMatch(/state\/inside\.json$/);
  });

  it('historyPath returns absolute path to history.ndjson', () => {
    const p = historyPath('hello', tmpDir);
    expect(path.isAbsolute(p)).toBe(true);
    expect(p).toMatch(/state\/history\.ndjson$/);
  });

  it('watermarkPath returns absolute path to sdk-watermark.json', () => {
    const p = watermarkPath('hello', tmpDir);
    expect(path.isAbsolute(p)).toBe(true);
    expect(p).toMatch(/state\/sdk-watermark\.json$/);
  });

  it('outsideMdPath returns absolute path to outside.md', () => {
    const p = outsideMdPath('hello', tmpDir);
    expect(path.isAbsolute(p)).toBe(true);
    expect(p).toMatch(/hello\/outside\.md$/);
  });

  it.each([
    ['..', 'parent traversal'],
    ['a/b', 'slash'],
    ['x\\y', 'backslash'],
    ['', 'empty'],
  ])('all helpers throw InvalidSlugError for slug %j (%s)', (badSlug) => {
    expect(() => inboxLanePath(badSlug, tmpDir, 'outside')).toThrow(
      InvalidSlugError,
    );
    expect(() => stateFilePath(badSlug, tmpDir, 'outside')).toThrow(
      InvalidSlugError,
    );
    expect(() => historyPath(badSlug, tmpDir)).toThrow(InvalidSlugError);
    expect(() => watermarkPath(badSlug, tmpDir)).toThrow(InvalidSlugError);
    expect(() => outsideMdPath(badSlug, tmpDir)).toThrow(InvalidSlugError);
    expect(() => hasOutsideMd(badSlug, tmpDir)).toThrow(InvalidSlugError);
  });

  it('hasOutsideMd is false when file absent', () => {
    fs.mkdirSync(path.join(tmpDir, 'hello'));
    expect(hasOutsideMd('hello', tmpDir)).toBe(false);
  });

  it('hasOutsideMd is true when file present', () => {
    fs.mkdirSync(path.join(tmpDir, 'hello'));
    fs.writeFileSync(path.join(tmpDir, 'hello', 'outside.md'), 'body');
    expect(hasOutsideMd('hello', tmpDir)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// P1 / T007 — outsideContract discovery via listAgents/resolveAgent
// ---------------------------------------------------------------------------

describe('outsideContract discovery (T007)', () => {
  function seedAgent(opts: {
    slug: string;
    description: string;
    coordination?: string; // raw frontmatter line
    outsideMdBody?: string | null; // null = absent; '' = present-but-empty
  }): void {
    const dir = path.join(tmpDir, opts.slug);
    fs.mkdirSync(dir, { recursive: true });
    const fm = ['---', `description: "${opts.description}"`, 'tags: [test]'];
    if (opts.coordination) fm.push(`coordination: ${opts.coordination}`);
    fm.push('---', '', '# body');
    fs.writeFileSync(path.join(dir, 'prompt.md'), fm.join('\n'));
    if (opts.outsideMdBody !== undefined && opts.outsideMdBody !== null) {
      fs.writeFileSync(path.join(dir, 'outside.md'), opts.outsideMdBody);
    }
  }

  it('absent outside.md → outsideContract: undefined', () => {
    seedAgent({ slug: 'plain', description: 'no outside.md' });
    const agent = resolveAgent('plain', tmpDir);
    expect(agent?.outsideContract).toBeUndefined();
  });

  it('present outside.md → outsideContract: body', () => {
    seedAgent({
      slug: 'with-outside',
      description: 'has outside.md',
      outsideMdBody: '# Peer contract\n\nbody here',
    });
    const agent = resolveAgent('with-outside', tmpDir);
    expect(agent?.outsideContract).toContain('# Peer contract');
  });

  it('empty outside.md → outsideContract: "" (distinguishable from absent)', () => {
    seedAgent({
      slug: 'empty-outside',
      description: 'empty outside.md',
      outsideMdBody: '',
    });
    const agent = resolveAgent('empty-outside', tmpDir);
    expect(agent?.outsideContract).toBe('');
  });

  it('oversize outside.md (>16KB) is truncated with a console.warn', () => {
    const big = 'x'.repeat(20_000); // 20 KB > 16 KB ceiling
    seedAgent({
      slug: 'big-outside',
      description: 'oversize',
      outsideMdBody: big,
    });
    const warns: string[] = [];
    const orig = console.warn;
    console.warn = (msg: string) => warns.push(msg);
    try {
      const agent = resolveAgent('big-outside', tmpDir);
      expect(agent?.outsideContract).toBeDefined();
      expect(agent?.outsideContract?.length).toBeLessThanOrEqual(16 * 1024);
      expect(warns.some((w) => w.includes('big-outside'))).toBe(true);
    } finally {
      console.warn = orig;
    }
  });
});

// ---------------------------------------------------------------------------
// P1 / T008 — parseFrontmatter coordination field
// ---------------------------------------------------------------------------

describe('parseFrontmatter coordination field (T008)', () => {
  function fm(coord: string | null): string {
    const lines = ['---', 'description: "x"'];
    if (coord !== null) lines.push(coord);
    lines.push('---', '', 'body');
    return lines.join('\n');
  }

  it('absent → {enabled: false} (always populated, never omitted)', () => {
    const result = parseFrontmatter(fm(null));
    expect(result.coordination).toEqual({ enabled: false });
  });

  it("string 'enabled' → {enabled: true}", () => {
    const result = parseFrontmatter(fm('coordination: enabled'));
    expect(result.coordination).toEqual({ enabled: true });
  });

  it("string 'disabled' → {enabled: false}", () => {
    const result = parseFrontmatter(fm('coordination: disabled'));
    expect(result.coordination).toEqual({ enabled: false });
  });

  it('object form with enabled: true preserves outside/inside placeholders', () => {
    const content = [
      '---',
      'description: "x"',
      'coordination:',
      '  enabled: true',
      '  outside: {}',
      '  inside: {}',
      '---',
      '',
      'body',
    ].join('\n');
    const result = parseFrontmatter(content);
    expect(result.coordination.enabled).toBe(true);
    expect(result.coordination.outside).toEqual({});
    expect(result.coordination.inside).toEqual({});
  });

  it('object form preserves real outside/inside payload values (F001)', () => {
    const content = [
      '---',
      'description: "x"',
      'coordination:',
      '  enabled: true',
      '  outside: {"audience":"ci","verbose":true}',
      '  inside: {"strict":true}',
      '---',
      '',
      'body',
    ].join('\n');
    const result = parseFrontmatter(content);
    expect(result.coordination.outside).toEqual({
      audience: 'ci',
      verbose: true,
    });
    expect(result.coordination.inside).toEqual({ strict: true });
  });

  it('object form rejects non-object outside/inside JSON (F001)', () => {
    const content = [
      '---',
      'description: "x"',
      'coordination:',
      '  enabled: true',
      '  outside: "not-an-object"',
      '---',
      '',
      'body',
    ].join('\n');
    expect(() => parseFrontmatter(content)).toThrow(
      InvalidCoordinationFrontmatterError,
    );
  });

  it('object form rejects malformed JSON in outside/inside value (F001)', () => {
    const content = [
      '---',
      'description: "x"',
      'coordination:',
      '  enabled: true',
      '  outside: {missing-quotes}',
      '---',
      '',
      'body',
    ].join('\n');
    expect(() => parseFrontmatter(content)).toThrow(
      InvalidCoordinationFrontmatterError,
    );
  });

  it('object form with enabled: false (explicit) → {enabled: false}', () => {
    const content = [
      '---',
      'description: "x"',
      'coordination:',
      '  enabled: false',
      '---',
      '',
      'body',
    ].join('\n');
    const result = parseFrontmatter(content);
    expect(result.coordination).toEqual({ enabled: false });
  });

  // Negative cases — InvalidCoordinationFrontmatterError
  it.each([
    'coordination: maybe',
    'coordination: yes',
    'coordination: ENABLED',
    'coordination: 1',
  ])('invalid string value rejects: %s', (line) => {
    expect(() => parseFrontmatter(fm(line))).toThrow(
      InvalidCoordinationFrontmatterError,
    );
  });

  it('object form missing `enabled` rejects', () => {
    const content = [
      '---',
      'description: "x"',
      'coordination:',
      '  outside: {}',
      '---',
      '',
      'body',
    ].join('\n');
    expect(() => parseFrontmatter(content)).toThrow(
      InvalidCoordinationFrontmatterError,
    );
  });

  it('existing 9 agents do not declare `coordination` and resolve with {enabled:false}', () => {
    // Sanity: parseFrontmatter against a stripped real-agent shape behaves.
    const realShape = [
      '---',
      'description: "Confirm minih is working"',
      'tags: [smoke, minimal]',
      '---',
      '',
      '# Hello World',
    ].join('\n');
    const result = parseFrontmatter(realShape);
    expect(result.coordination).toEqual({ enabled: false });
  });
});
