import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildInsideMcpServerConfig,
  resolveInsideMcpServerEntry,
} from '../../src/mcp/spawn.js';
import { MINIH_COORDINATION_SERVER_NAME } from '../../src/mcp/types.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-mcp-spawn-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('buildInsideMcpServerConfig', () => {
  it('returns the minih-coordination stdio entry with minimal baked env', () => {
    const serverEntryPath = makeServerEntry('dist/mcp/server.js');
    const config = buildInsideMcpServerConfig({
      runId: 'run-123',
      runDir: path.join(tmpDir, 'agents', 'code-review', 'runs', 'run-123'),
      agentSlug: 'code-review',
      agentsDir: path.join(tmpDir, 'agents'),
      serverEntryPath,
    });

    const entry = config[MINIH_COORDINATION_SERVER_NAME];
    expect(entry.command).toBe('node');
    expect(entry.args).toEqual([serverEntryPath]);
    expect(entry.tools).toEqual(['*']);
    expect(entry.env).toEqual({
      MINIH: '1',
      MINIH_CONTEXT: 'inside',
      MINIH_INBOX_DIR: path.join(
        tmpDir,
        'agents',
        'code-review',
        'runs',
        'run-123',
        'inbox',
      ),
      MINIH_STATE_DIR: path.join(
        tmpDir,
        'agents',
        'code-review',
        'runs',
        'run-123',
        'state',
      ),
      NODE_NO_WARNINGS: '1',
      MINIH_MCP_RUN_ID: 'run-123',
      MINIH_MCP_RUN_DIR: path.join(
        tmpDir,
        'agents',
        'code-review',
        'runs',
        'run-123',
      ),
      MINIH_MCP_AGENT_SLUG: 'code-review',
      MINIH_MCP_AGENTS_DIR: path.join(tmpDir, 'agents'),
      MINIH_MCP_PROCESS_MARKER: 'minih-mcp-run-123',
    });
  });

  it('rejects relative or missing server artifacts clearly', () => {
    expect(() =>
      buildInsideMcpServerConfig({
        runId: 'run-123',
        runDir: tmpDir,
        agentSlug: 'code-review',
        agentsDir: tmpDir,
        serverEntryPath: 'dist/mcp/server.js',
      }),
    ).toThrow(/absolute/);

    expect(() =>
      buildInsideMcpServerConfig({
        runId: 'run-123',
        runDir: tmpDir,
        agentSlug: 'code-review',
        agentsDir: tmpDir,
        serverEntryPath: path.join(tmpDir, 'missing.js'),
      }),
    ).toThrow(/does not exist/);
  });

  it('rejects an empty node command override', () => {
    expect(() =>
      buildInsideMcpServerConfig({
        runId: 'run-123',
        runDir: tmpDir,
        agentSlug: 'code-review',
        agentsDir: tmpDir,
        serverEntryPath: makeServerEntry('server.js'),
        nodeCommand: ' ',
      }),
    ).toThrow(/command/);
  });

  it('omits telemetry env when telemetry is disabled (OPP-1)', () => {
    const prev = process.env.MINIH_TELEMETRY;
    delete process.env.MINIH_TELEMETRY;
    try {
      const entry = buildInsideMcpServerConfig({
        runId: 'run-123',
        runDir: path.join(tmpDir, 'agents', 'code-review', 'runs', 'run-123'),
        agentSlug: 'code-review',
        agentsDir: path.join(tmpDir, 'agents'),
        serverEntryPath: makeServerEntry('dist/mcp/server.js'),
      })[MINIH_COORDINATION_SERVER_NAME];
      expect(entry.env.MINIH_TELEMETRY).toBeUndefined();
      expect(entry.env.OTEL_EXPORTER_OTLP_ENDPOINT).toBeUndefined();
      expect(entry.env.TRACEPARENT).toBeUndefined();
    } finally {
      if (prev !== undefined) process.env.MINIH_TELEMETRY = prev;
    }
  });

  it('injects telemetry env when telemetry is enabled (OPP-1)', () => {
    const prevTel = process.env.MINIH_TELEMETRY;
    const prevOtlp = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    process.env.MINIH_TELEMETRY = 'true';
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4318';
    try {
      const entry = buildInsideMcpServerConfig({
        runId: 'run-123',
        runDir: path.join(tmpDir, 'agents', 'code-review', 'runs', 'run-123'),
        agentSlug: 'code-review',
        agentsDir: path.join(tmpDir, 'agents'),
        serverEntryPath: makeServerEntry('dist/mcp/server.js'),
      })[MINIH_COORDINATION_SERVER_NAME];
      expect(entry.env.MINIH_TELEMETRY).toBe('true');
      expect(entry.env.OTEL_EXPORTER_OTLP_ENDPOINT).toBe(
        'http://localhost:4318',
      );
      // TRACEPARENT only present when an active span exists; none in this unit test.
    } finally {
      if (prevTel !== undefined) process.env.MINIH_TELEMETRY = prevTel;
      else delete process.env.MINIH_TELEMETRY;
      if (prevOtlp !== undefined)
        process.env.OTEL_EXPORTER_OTLP_ENDPOINT = prevOtlp;
      else delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    }
  });
});

describe('resolveInsideMcpServerEntry', () => {
  it('resolves a packaged dist sibling next to spawn.js', () => {
    const serverEntry = makeServerEntry('package/dist/mcp/server.js');
    const spawnPath = makeServerEntry('package/dist/mcp/spawn.js');

    expect(resolveInsideMcpServerEntry(pathToFileURL(spawnPath).href)).toBe(
      serverEntry,
    );
  });

  it('resolves the built dist artifact when called from a source module', () => {
    const serverEntry = makeServerEntry('project/dist/mcp/server.js');
    const spawnPath = makeServerEntry('project/src/mcp/spawn.ts');

    expect(resolveInsideMcpServerEntry(pathToFileURL(spawnPath).href)).toBe(
      serverEntry,
    );
  });

  it('fails clearly when neither packaged nor built artifacts exist', () => {
    const spawnPath = makeServerEntry('project/src/mcp/spawn.ts');
    fs.rmSync(path.join(tmpDir, 'project', 'dist'), {
      recursive: true,
      force: true,
    });

    expect(() =>
      resolveInsideMcpServerEntry(pathToFileURL(spawnPath).href),
    ).toThrow(/npm run build/);
  });
});

function makeServerEntry(relativePath: string): string {
  const filePath = path.join(tmpDir, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, '');
  return filePath;
}
