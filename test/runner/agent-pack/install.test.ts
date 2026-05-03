import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installAgentPack } from '../../../src/runner/agent-pack/install.js';

let tmpDir: string;
let sourceDir: string;
let agentsDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-install-test-'));
  sourceDir = path.join(tmpDir, 'source-agent');
  agentsDir = path.join(tmpDir, 'agents');
  fs.mkdirSync(sourceDir);
  fs.mkdirSync(agentsDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeAgentJson(
  dir: string,
  files: Array<{ path: string; description: string }>,
): void {
  fs.writeFileSync(
    path.join(dir, 'agent.json'),
    JSON.stringify({
      name: path.basename(dir),
      version: '0.1.0',
      description: 'test agent',
      files,
    }),
  );
}

function writeFile(dir: string, rel: string, content: string): void {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

describe('installAgentPack — local source', () => {
  it('fresh install with explicit agent.json copies all manifest-listed files', async () => {
    writeFile(sourceDir, 'prompt.md', '# prompt');
    writeFile(sourceDir, 'instructions.md', '# instr');
    writeAgentJson(sourceDir, [
      { path: 'prompt.md', description: 'agent prompt' },
      { path: 'instructions.md', description: 'instructions' },
    ]);

    const result = await installAgentPack({
      source: { type: 'local', localPath: sourceDir },
      agentsDir,
    });

    expect(result.action).toBe('installed');
    expect(result.slug).toBe('source-agent');
    expect(
      fs.existsSync(path.join(agentsDir, 'source-agent', 'prompt.md')),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(agentsDir, 'source-agent', 'instructions.md')),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(agentsDir, 'source-agent', '.minih-source.json')),
    ).toBe(true);
    // No agent.json in installed copy unless listed in manifest — current spec keeps it minimal.
    // (We DO copy agent.json itself when present in source so info can re-read it.)
    expect(
      fs.existsSync(path.join(agentsDir, 'source-agent', 'agent.json')),
    ).toBe(true);
  });

  it('fresh install with implicit manifest (no agent.json in source)', async () => {
    writeFile(sourceDir, 'prompt.md', '# prompt');
    writeFile(sourceDir, 'instructions.md', '# instr');
    writeFile(sourceDir, 'output-schema.json', '{}');

    const result = await installAgentPack({
      source: { type: 'local', localPath: sourceDir },
      agentsDir,
    });

    expect(result.action).toBe('installed');
    expect(
      fs.existsSync(path.join(agentsDir, 'source-agent', 'prompt.md')),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(agentsDir, 'source-agent', 'instructions.md')),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(agentsDir, 'source-agent', 'output-schema.json')),
    ).toBe(true);
  });

  it('re-install with identical source returns action: "unchanged"', async () => {
    writeFile(sourceDir, 'prompt.md', '# prompt');
    writeAgentJson(sourceDir, [{ path: 'prompt.md', description: 'p' }]);

    const first = await installAgentPack({
      source: { type: 'local', localPath: sourceDir },
      agentsDir,
    });
    expect(first.action).toBe('installed');

    const second = await installAgentPack({
      source: { type: 'local', localPath: sourceDir },
      agentsDir,
    });
    expect(second.action).toBe('unchanged');
  });

  it('re-install with changed source returns action: "upgraded" + atomic-swaps changed files', async () => {
    writeFile(sourceDir, 'prompt.md', 'v1');
    writeAgentJson(sourceDir, [{ path: 'prompt.md', description: 'p' }]);

    await installAgentPack({
      source: { type: 'local', localPath: sourceDir },
      agentsDir,
    });

    // Modify source
    writeFile(sourceDir, 'prompt.md', 'v2');

    const result = await installAgentPack({
      source: { type: 'local', localPath: sourceDir },
      agentsDir,
    });

    expect(result.action).toBe('upgraded');
    const installed = fs.readFileSync(
      path.join(agentsDir, 'source-agent', 'prompt.md'),
      'utf-8',
    );
    expect(installed).toBe('v2');
  });

  it('preserves runs/, inbox/, state/ on upgrade', async () => {
    writeFile(sourceDir, 'prompt.md', 'v1');
    writeAgentJson(sourceDir, [{ path: 'prompt.md', description: 'p' }]);

    await installAgentPack({
      source: { type: 'local', localPath: sourceDir },
      agentsDir,
    });

    const installedDir = path.join(agentsDir, 'source-agent');
    fs.mkdirSync(path.join(installedDir, 'runs', 'r1'), { recursive: true });
    fs.writeFileSync(
      path.join(installedDir, 'runs', 'r1', 'data.txt'),
      'precious',
    );
    fs.mkdirSync(path.join(installedDir, 'inbox'), { recursive: true });
    fs.writeFileSync(path.join(installedDir, 'inbox', 'msg.txt'), 'msg');
    fs.mkdirSync(path.join(installedDir, 'state'), { recursive: true });
    fs.writeFileSync(path.join(installedDir, 'state', 'inside.json'), '{}');

    writeFile(sourceDir, 'prompt.md', 'v2');
    await installAgentPack({
      source: { type: 'local', localPath: sourceDir },
      agentsDir,
    });

    expect(
      fs.readFileSync(
        path.join(installedDir, 'runs', 'r1', 'data.txt'),
        'utf-8',
      ),
    ).toBe('precious');
    expect(
      fs.readFileSync(path.join(installedDir, 'inbox', 'msg.txt'), 'utf-8'),
    ).toBe('msg');
    expect(
      fs.readFileSync(path.join(installedDir, 'state', 'inside.json'), 'utf-8'),
    ).toBe('{}');
  });

  it('refuses self-install when source path equals target path', async () => {
    writeFile(sourceDir, 'prompt.md', '# prompt');
    writeAgentJson(sourceDir, [{ path: 'prompt.md', description: 'p' }]);

    // Target ends up as agentsDir/source-agent — set agentsDir so the resolved
    // target path is sourceDir itself.
    const cleverAgentsDir = path.dirname(sourceDir);
    await expect(
      installAgentPack({
        source: { type: 'local', localPath: sourceDir },
        agentsDir: cleverAgentsDir,
      }),
    ).rejects.toThrow(/self-install|same path/i);
  });

  it('rejects with E183 when target folder exists without .minih-source.json (hand-rolled)', async () => {
    writeFile(sourceDir, 'prompt.md', '# new');
    writeAgentJson(sourceDir, [{ path: 'prompt.md', description: 'p' }]);

    // Pre-existing hand-rolled agent at the target slug
    const targetDir = path.join(agentsDir, 'source-agent');
    fs.mkdirSync(targetDir);
    fs.writeFileSync(path.join(targetDir, 'prompt.md'), '# user-authored');

    await expect(
      installAgentPack({
        source: { type: 'local', localPath: sourceDir },
        agentsDir,
      }),
    ).rejects.toThrow(/E183|already installed|hand-rolled/i);
  });

  it('--as <new-slug> aliases the install', async () => {
    writeFile(sourceDir, 'prompt.md', '# prompt');
    writeAgentJson(sourceDir, [{ path: 'prompt.md', description: 'p' }]);

    const result = await installAgentPack({
      source: { type: 'local', localPath: sourceDir },
      agentsDir,
      asSlug: 'aliased',
    });

    expect(result.slug).toBe('aliased');
    expect(fs.existsSync(path.join(agentsDir, 'aliased', 'prompt.md'))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(agentsDir, 'source-agent'))).toBe(false);
  });

  it('--force overrides E183 collision (destructive — clobbers user files)', async () => {
    writeFile(sourceDir, 'prompt.md', '# new');
    writeAgentJson(sourceDir, [{ path: 'prompt.md', description: 'p' }]);

    const targetDir = path.join(agentsDir, 'source-agent');
    fs.mkdirSync(targetDir);
    fs.writeFileSync(path.join(targetDir, 'prompt.md'), '# user-authored');

    const result = await installAgentPack({
      source: { type: 'local', localPath: sourceDir },
      agentsDir,
      force: true,
    });

    expect(result.action).toBe('installed');
    const content = fs.readFileSync(path.join(targetDir, 'prompt.md'), 'utf-8');
    expect(content).toBe('# new');
  });

  it('source manifest with path traversal rejected before any write', async () => {
    writeFile(sourceDir, 'prompt.md', '# prompt');
    fs.writeFileSync(
      path.join(sourceDir, 'agent.json'),
      JSON.stringify({
        name: 'evil',
        version: '0.1.0',
        description: 'evil',
        files: [
          { path: 'prompt.md', description: 'p' },
          { path: '../../escape', description: 'evil' },
        ],
      }),
    );

    await expect(
      installAgentPack({
        source: { type: 'local', localPath: sourceDir },
        agentsDir,
      }),
    ).rejects.toThrow();

    // Crucially: nothing should have been written.
    expect(fs.existsSync(path.join(agentsDir, 'source-agent'))).toBe(false);
  });

  it('rejects when source path does not exist', async () => {
    await expect(
      installAgentPack({
        source: {
          type: 'local',
          localPath: path.join(tmpDir, 'does-not-exist'),
        },
        agentsDir,
      }),
    ).rejects.toThrow(/E182|does not exist|missing/i);
  });

  it('rejects when source missing prompt.md (implicit manifest synthesis fails)', async () => {
    writeFile(sourceDir, 'instructions.md', '# only this');
    await expect(
      installAgentPack({
        source: { type: 'local', localPath: sourceDir },
        agentsDir,
      }),
    ).rejects.toThrow(/prompt\.md/);
  });

  it('writes .minih-source.json with source.type "local" and resolvedAt timestamp', async () => {
    writeFile(sourceDir, 'prompt.md', '# prompt');
    writeAgentJson(sourceDir, [{ path: 'prompt.md', description: 'p' }]);

    await installAgentPack({
      source: { type: 'local', localPath: sourceDir },
      agentsDir,
    });

    const sidecar = JSON.parse(
      fs.readFileSync(
        path.join(agentsDir, 'source-agent', '.minih-source.json'),
        'utf-8',
      ),
    );
    expect(sidecar.schemaVersion).toBe('1');
    expect(sidecar.source.type).toBe('local');
    expect(sidecar.source.localPath).toBe(path.resolve(sourceDir));
    expect(sidecar.source.resolvedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(sidecar.fileChecksums['prompt.md']).toMatch(/^sha256:/);
  });
});

describe('installAgentPack — registry/URL stubs (placeholder)', () => {
  it('rejects URL source with helpful "not yet available" message', async () => {
    await expect(
      installAgentPack({
        source: { type: 'url', url: 'github:foo/bar', ref: 'main' },
        agentsDir,
      }),
    ).rejects.toThrow(/not yet available|Phase 3|E182/);
  });

  it('rejects registry source with helpful "not yet available" message', async () => {
    await expect(
      installAgentPack({
        source: {
          type: 'registry',
          registrySlug: 'foo',
          url: 'github:foo/bar',
          ref: 'main',
        },
        agentsDir,
      }),
    ).rejects.toThrow(/not yet available|Phase 3|E182/);
  });
});
