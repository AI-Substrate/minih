/**
 * Plan 018 — AC2 (mcp/custom-tool allowlists) + companion finding F001.
 *
 * Verifies object-form overrides parse and compile into ResolvedPolicy
 * `mcpAllowedServers` / `customToolAllowedNames`.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { compile } from '../../../src/runner/permissions/compile.js';
import { parseFrontmatter } from '../../../src/runner/folder.js';

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-ac2-'));
  fs.mkdirSync(path.join(tmp, '.git'));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('AC2 — mcp.allowedServers + custom-tool.allowedNames', () => {
  it('parses inline object form for mcp.allowedServers', () => {
    const yaml = `---\ndescription: a\npermissions:\n  preset: restricted\n  overrides:\n    mcp: {"allowedServers":["minih-coordination"]}\n---\n`;
    const r = parseFrontmatter(yaml);
    expect(r.permissions?.overrides).toEqual({
      mcp: { allowedServers: ['minih-coordination'] },
    });
  });

  it('parses inline object form for custom-tool.allowedNames', () => {
    const yaml = `---\ndescription: a\npermissions:\n  preset: restricted\n  overrides:\n    custom-tool: {"allowedNames":["my-tool"]}\n---\n`;
    const r = parseFrontmatter(yaml);
    expect(r.permissions?.overrides).toEqual({
      'custom-tool': { allowedNames: ['my-tool'] },
    });
  });

  it('compiles mcp allowlist into ResolvedPolicy.mcpAllowedServers', () => {
    const r = compile({
      frontmatter: {
        preset: 'restricted',
        overrides: {
          mcp: { allowedServers: ['minih-coordination'] },
        },
      },
      releaseDefault: { preset: 'restricted' },
      cwd: tmp,
    });
    expect(r.mcpAllowedServers).toEqual(['minih-coordination']);
    expect(r.decisions.mcp).toBe('allow');
  });

  it('compiles custom-tool allowlist into ResolvedPolicy.customToolAllowedNames', () => {
    const r = compile({
      frontmatter: {
        preset: 'restricted',
        overrides: {
          'custom-tool': { allowedNames: ['my-tool', 'other-tool'] },
        },
      },
      releaseDefault: { preset: 'restricted' },
      cwd: tmp,
    });
    expect(r.customToolAllowedNames).toEqual(['my-tool', 'other-tool']);
    expect(r.decisions['custom-tool']).toBe('allow');
  });

  it('empty allowlist denies the kind', () => {
    const r = compile({
      frontmatter: {
        preset: 'trusted',
        overrides: {
          mcp: { allowedServers: [] },
        },
      },
      releaseDefault: { preset: 'restricted' },
      cwd: tmp,
    });
    expect(r.mcpAllowedServers).toEqual([]);
    expect(r.decisions.mcp).toBe('deny');
  });

  it('rejects object-form override on unsupported kind', () => {
    const yaml = `---\ndescription: a\npermissions:\n  preset: restricted\n  overrides:\n    shell: {"allowed":["ls"]}\n---\n`;
    expect(() => parseFrontmatter(yaml)).toThrow();
  });
});
