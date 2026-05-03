import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AGENT_MANIFEST_FILENAME,
  RUNTIME_DIR_NAMES,
  readAgentManifest,
  synthesizeImplicitManifest,
  validateManifest,
} from '../../../src/runner/agent-pack/manifest.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-agent-pack-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeManifest(dir: string, manifest: unknown): void {
  fs.writeFileSync(
    path.join(dir, AGENT_MANIFEST_FILENAME),
    JSON.stringify(manifest),
  );
}

describe('validateManifest', () => {
  it('accepts a valid manifest', () => {
    const result = validateManifest({
      name: 'demo',
      version: '0.1.0',
      description: 'demo agent',
      files: [
        { path: 'prompt.md', description: 'agent prompt' },
        { path: 'instructions.md', description: 'system instructions' },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it('rejects manifest missing prompt.md in files[]', () => {
    const result = validateManifest({
      name: 'demo',
      version: '0.1.0',
      description: 'demo',
      files: [{ path: 'instructions.md', description: 'instr' }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(' ')).toMatch(/prompt\.md/i);
    }
  });

  it('rejects path with traversal "..".', () => {
    const result = validateManifest({
      name: 'demo',
      version: '0.1.0',
      description: 'demo',
      files: [
        { path: 'prompt.md', description: 'p' },
        { path: '../etc/passwd', description: 'evil' },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(' ')).toMatch(/\.\./);
    }
  });

  it('rejects absolute path with leading slash', () => {
    const result = validateManifest({
      name: 'demo',
      version: '0.1.0',
      description: 'demo',
      files: [
        { path: 'prompt.md', description: 'p' },
        { path: '/etc/passwd', description: 'evil' },
      ],
    });
    expect(result.ok).toBe(false);
  });

  it('rejects path with null byte', () => {
    const result = validateManifest({
      name: 'demo',
      version: '0.1.0',
      description: 'demo',
      files: [
        { path: 'prompt.md', description: 'p' },
        { path: 'foo\u0000bar', description: 'evil' },
      ],
    });
    expect(result.ok).toBe(false);
  });

  it('rejects path starting with runs/', () => {
    const result = validateManifest({
      name: 'demo',
      version: '0.1.0',
      description: 'demo',
      files: [
        { path: 'prompt.md', description: 'p' },
        { path: 'runs/foo', description: 'evil' },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(' ')).toMatch(/runs/);
    }
  });

  it('rejects path starting with inbox/, state/, .git/', () => {
    for (const prefix of ['inbox/foo', 'state/foo', '.git/foo']) {
      const result = validateManifest({
        name: 'demo',
        version: '0.1.0',
        description: 'demo',
        files: [
          { path: 'prompt.md', description: 'p' },
          { path: prefix, description: 'evil' },
        ],
      });
      expect(result.ok, `${prefix} should reject`).toBe(false);
    }
  });

  it('rejects path with backslash (Windows-style)', () => {
    const result = validateManifest({
      name: 'demo',
      version: '0.1.0',
      description: 'demo',
      files: [
        { path: 'prompt.md', description: 'p' },
        { path: 'foo\\bar', description: 'win-style' },
      ],
    });
    expect(result.ok).toBe(false);
  });

  it('rejects duplicate paths in files[]', () => {
    const result = validateManifest({
      name: 'demo',
      version: '0.1.0',
      description: 'demo',
      files: [
        { path: 'prompt.md', description: 'first' },
        { path: 'prompt.md', description: 'duplicate' },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(' ')).toMatch(/duplicate/i);
    }
  });

  it('rejects non-string description', () => {
    const result = validateManifest({
      name: 'demo',
      version: '0.1.0',
      description: 'demo',
      files: [{ path: 'prompt.md', description: 42 }],
    });
    expect(result.ok).toBe(false);
  });

  it('rejects manifest missing required top-level fields', () => {
    const result = validateManifest({
      files: [{ path: 'prompt.md', description: 'p' }],
    });
    expect(result.ok).toBe(false);
  });

  it('rejects non-object input', () => {
    expect(validateManifest(null).ok).toBe(false);
    expect(validateManifest('string').ok).toBe(false);
    expect(validateManifest([]).ok).toBe(false);
  });
});

describe('readAgentManifest', () => {
  it('returns parsed manifest when agent.json present and valid', () => {
    writeManifest(tmpDir, {
      name: 'demo',
      version: '0.1.0',
      description: 'demo',
      files: [{ path: 'prompt.md', description: 'p' }],
    });
    const manifest = readAgentManifest(tmpDir);
    expect(manifest).not.toBeNull();
    expect(manifest?.name).toBe('demo');
  });

  it('returns null when agent.json absent', () => {
    expect(readAgentManifest(tmpDir)).toBeNull();
  });

  it('throws on malformed JSON', () => {
    fs.writeFileSync(path.join(tmpDir, AGENT_MANIFEST_FILENAME), 'not json');
    expect(() => readAgentManifest(tmpDir)).toThrow();
  });

  it('throws on invalid manifest shape', () => {
    writeManifest(tmpDir, { not: 'a manifest' });
    expect(() => readAgentManifest(tmpDir)).toThrow();
  });
});

describe('synthesizeImplicitManifest', () => {
  it('synthesizes a manifest from canonical files present on disk', () => {
    fs.writeFileSync(path.join(tmpDir, 'prompt.md'), '# prompt');
    fs.writeFileSync(path.join(tmpDir, 'instructions.md'), '# instr');
    fs.writeFileSync(path.join(tmpDir, 'output-schema.json'), '{}');

    const manifest = synthesizeImplicitManifest(tmpDir);
    const paths = manifest.files.map((f) => f.path);
    expect(paths).toContain('prompt.md');
    expect(paths).toContain('instructions.md');
    expect(paths).toContain('output-schema.json');
    expect(paths).not.toContain('input-schema.json');
  });

  it('only includes prompt.md when no other canonical files exist', () => {
    fs.writeFileSync(path.join(tmpDir, 'prompt.md'), '# prompt');
    const manifest = synthesizeImplicitManifest(tmpDir);
    expect(manifest.files).toHaveLength(1);
    expect(manifest.files[0]?.path).toBe('prompt.md');
  });

  it('throws if prompt.md is missing — implicit manifest requires it', () => {
    expect(() => synthesizeImplicitManifest(tmpDir)).toThrow(/prompt\.md/);
  });
});

describe('exported constants for cross-module reuse', () => {
  it('exports RUNTIME_DIR_NAMES so Phase 3 extractor can share denylist', () => {
    expect(RUNTIME_DIR_NAMES).toContain('runs');
    expect(RUNTIME_DIR_NAMES).toContain('inbox');
    expect(RUNTIME_DIR_NAMES).toContain('state');
    expect(RUNTIME_DIR_NAMES).toContain('.git');
  });
});
