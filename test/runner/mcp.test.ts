import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeAgentAdapter } from '../../src/adapter/index.js';
import { loadMcpConfig } from '../../src/runner/index.js';

describe('loadMcpConfig', () => {
  it('loads mcpServers from a valid config file', () => {
    const fixturePath = path.join(__dirname, '..', 'fixtures', 'mcp-config.json');
    const servers = loadMcpConfig(fixturePath);
    expect(servers).toHaveProperty('test-echo');
    expect((servers['test-echo'] as Record<string, unknown>).command).toBe('node');
  });

  it('throws on missing file', () => {
    expect(() => loadMcpConfig('/nonexistent/mcp.json')).toThrow('not found');
  });

  it('throws on invalid JSON', () => {
    const tmpFile = path.join(os.tmpdir(), 'bad-mcp.json');
    fs.writeFileSync(tmpFile, 'not json');
    try {
      expect(() => loadMcpConfig(tmpFile)).toThrow('not valid JSON');
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it('throws when mcpServers property is missing', () => {
    const tmpFile = path.join(os.tmpdir(), 'no-servers-mcp.json');
    fs.writeFileSync(tmpFile, JSON.stringify({ other: 'stuff' }));
    try {
      expect(() => loadMcpConfig(tmpFile)).toThrow('mcpServers');
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });
});

describe('MCP config threading', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('FakeAgentAdapter accepts configDir in options without error', async () => {
    const adapter = new FakeAgentAdapter({ output: '{}' });
    const result = await adapter.run({
      prompt: 'test',
      configDir: '/some/path',
    });
    expect(result.status).toBe('completed');
  });

  it('FakeAgentAdapter accepts mcpServers in options without error', async () => {
    const adapter = new FakeAgentAdapter({ output: '{}' });
    const result = await adapter.run({
      prompt: 'test',
      mcpServers: { 'test-echo': { command: 'node', args: [], tools: ['*'] } },
    });
    expect(result.status).toBe('completed');
  });

  it('FakeAgentAdapter works with no MCP config (backward compat)', async () => {
    const adapter = new FakeAgentAdapter({ output: '{}' });
    const result = await adapter.run({ prompt: 'test' });
    expect(result.status).toBe('completed');
  });
});
