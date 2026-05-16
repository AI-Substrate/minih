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

  it('T004 (spec AC6): implicit manifest synthesis ships root-level inside/outside state schemas', async () => {
    // Spec AC6: An agent source folder with prompt.md + inside-state.schema.json
    // + outside-state.schema.json (all at root per FX001) but no explicit
    // agent.json installs successfully, and the installed copy contains both
    // schema files at root. This exercises CANONICAL_AGENT_FILES (manifest.ts:33-37)
    // which already lists root-level schema paths — T003 verified, T004 locks in.
    writeFile(sourceDir, 'prompt.md', '# implicit-manifest companion prompt');
    writeFile(
      sourceDir,
      'inside-state.schema.json',
      JSON.stringify({
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['idle', 'working', 'done'],
          },
        },
      }),
    );
    writeFile(
      sourceDir,
      'outside-state.schema.json',
      JSON.stringify({
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['idle', 'in-progress', 'paused', 'done', 'error'],
          },
        },
      }),
    );
    // NO agent.json — implicit-manifest path must synthesize one.

    const result = await installAgentPack({
      source: { type: 'local', localPath: sourceDir },
      agentsDir,
    });

    expect(result.action).toBe('installed');
    expect(
      fs.existsSync(path.join(agentsDir, 'source-agent', 'prompt.md')),
      'prompt.md missing from installed copy',
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(agentsDir, 'source-agent', 'inside-state.schema.json'),
      ),
      'inside-state.schema.json missing — implicit-manifest did not pick up root schema',
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(agentsDir, 'source-agent', 'outside-state.schema.json'),
      ),
      'outside-state.schema.json missing — implicit-manifest did not pick up root schema',
    ).toBe(true);

    // Sidecar fileChecksums must include the schemas so future upgrades
    // surface them in changedFiles[] (linkage to spec AC4).
    const sidecar = JSON.parse(
      fs.readFileSync(
        path.join(agentsDir, 'source-agent', '.minih-source.json'),
        'utf-8',
      ),
    );
    expect(sidecar.fileChecksums['inside-state.schema.json']).toMatch(
      /^sha256:/,
    );
    expect(sidecar.fileChecksums['outside-state.schema.json']).toMatch(
      /^sha256:/,
    );
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

  it('FX003b regression: 0.1.0 → 0.2.0 upgrade reports the 3 new companion files in changedFiles[] (spec AC4)', async () => {
    // Fixture mirrors the canonical code-review-companion upgrade path:
    //   v0.1.0 ships 4 files (prompt/instructions/input-schema/output-schema)
    //   v0.2.0 ships 7 files (the original 4 + outside.md + 2 state schemas at root per FX001)
    // The per-file checksum diff (install.ts:467-471) must surface the 3 NEW
    // root-level files as changedFiles[] entries on re-install. This is the
    // load-bearing assertion behind FX003b's "adopters notice the upgrade"
    // promise on issue AI-Substrate/minih#30.

    // v0.1.0 source
    writeFile(sourceDir, 'prompt.md', '# v0.1.0 companion prompt');
    writeFile(sourceDir, 'instructions.md', '# v0.1.0 instructions');
    writeFile(sourceDir, 'input-schema.json', '{"v":"0.1.0"}');
    writeFile(sourceDir, 'output-schema.json', '{"v":"0.1.0"}');
    fs.writeFileSync(
      path.join(sourceDir, 'agent.json'),
      JSON.stringify({
        name: 'companion-fixture',
        version: '0.1.0',
        description: 'v0.1.0 baseline',
        files: [
          { path: 'prompt.md', description: 'agent prompt' },
          { path: 'instructions.md', description: 'instructions' },
          { path: 'input-schema.json', description: 'input schema' },
          { path: 'output-schema.json', description: 'output schema' },
        ],
      }),
    );

    const first = await installAgentPack({
      source: { type: 'local', localPath: sourceDir },
      agentsDir,
    });
    expect(first.action).toBe('installed');

    // v0.2.0 source: add 3 new files at root + keep originals identical
    writeFile(sourceDir, 'outside.md', '# v0.2.0 outside contract');
    writeFile(
      sourceDir,
      'inside-state.schema.json',
      '{"$schema":"https://json-schema.org/draft/2020-12/schema","v":"0.2.0-inside"}',
    );
    writeFile(
      sourceDir,
      'outside-state.schema.json',
      '{"$schema":"https://json-schema.org/draft/2020-12/schema","v":"0.2.0-outside"}',
    );
    fs.writeFileSync(
      path.join(sourceDir, 'agent.json'),
      JSON.stringify({
        name: 'companion-fixture',
        version: '0.2.0',
        description: 'v0.2.0 with coordination contract',
        files: [
          { path: 'prompt.md', description: 'agent prompt' },
          { path: 'instructions.md', description: 'instructions' },
          { path: 'outside.md', description: 'outside contract' },
          { path: 'input-schema.json', description: 'input schema' },
          { path: 'output-schema.json', description: 'output schema' },
          { path: 'inside-state.schema.json', description: 'inside state schema' },
          { path: 'outside-state.schema.json', description: 'outside state schema' },
        ],
      }),
    );

    const second = await installAgentPack({
      source: { type: 'local', localPath: sourceDir },
      agentsDir,
    });

    expect(second.action).toBe('upgraded');
    // The 3 new files MUST appear in changedFiles[]. Order is
    // implementation-defined (alphabetical-by-path in current impl), so we
    // assert membership rather than order.
    expect(second.changedFiles).toContain('outside.md');
    expect(second.changedFiles).toContain('inside-state.schema.json');
    expect(second.changedFiles).toContain('outside-state.schema.json');
    // The 4 unchanged files MUST NOT appear (identical content + same path).
    expect(second.changedFiles).not.toContain('prompt.md');
    expect(second.changedFiles).not.toContain('instructions.md');
    expect(second.changedFiles).not.toContain('input-schema.json');
    expect(second.changedFiles).not.toContain('output-schema.json');

    // The installed copy contains all 7 files at root.
    // Slug is derived from source-dir basename (sourceDir = .../source-agent/),
    // not the `name` field in agent.json.
    for (const f of [
      'prompt.md',
      'instructions.md',
      'outside.md',
      'input-schema.json',
      'output-schema.json',
      'inside-state.schema.json',
      'outside-state.schema.json',
    ]) {
      expect(
        fs.existsSync(path.join(agentsDir, 'source-agent', f)),
        `installed copy missing ${f}`,
      ).toBe(true);
    }
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

describe('installAgentPack — fetcher requirement guards', () => {
  it('rejects URL source missing fetcher with composition-root error', async () => {
    await expect(
      installAgentPack({
        source: { type: 'url', url: 'github:foo/bar', ref: 'main' },
        agentsDir,
      }),
    ).rejects.toThrow(/fetcher is required for URL source/);
  });

  it('rejects registry source missing fetcher with composition-root error', async () => {
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
    ).rejects.toThrow(/fetcher is required for registry source/);
  });
});

// ============================================================================
// T006 — URL install tests via FakeAgentPackFetcher
// ============================================================================

import * as zlib from 'node:zlib';
import { Pack } from 'tar';
import { FakeAgentPackFetcher } from '../../../src/runner/agent-pack/fetcher.js';

/**
 * Build a gzipped tarball that simulates a GitHub-style payload — entries
 * are wrapped in a `<repo>-<sha>/` top-level dir, optionally with a
 * subpath underneath.
 */
async function makeGithubTarball(opts: {
  repoPrefix: string;
  files: Array<{ path: string; body: string }>;
}): Promise<Buffer> {
  const stagingRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'minih-install-fixture-'),
  );
  try {
    const stageDir = path.join(stagingRoot, opts.repoPrefix);
    fs.mkdirSync(stageDir, { recursive: true });
    const filesArg: string[] = [];
    for (const f of opts.files) {
      const abs = path.join(stageDir, f.path);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, f.body);
      filesArg.push(`${opts.repoPrefix}/${f.path}`);
    }
    const pack = new Pack({ cwd: stagingRoot, portable: true });
    for (const f of filesArg) pack.write(f);
    pack.end();
    const chunks: Buffer[] = [];
    for await (const chunk of pack) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return zlib.gzipSync(Buffer.concat(chunks));
  } finally {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
  }
}

describe('installAgentPack — URL source (T006)', () => {
  it('(a) URL install with prefilled fake → action=installed + sidecar.source.type=url', async () => {
    const tarball = await makeGithubTarball({
      repoPrefix: 'minih-abc1234',
      files: [{ path: 'prompt.md', body: 'hello' }],
    });
    const fake = new FakeAgentPackFetcher();
    fake.setSuccess('github:foo/my-agent', 'main', {
      commitSha: 'abc1234567890abcdef1234567890abcdef12345',
      tarball,
    });

    const result = await installAgentPack({
      source: { type: 'url', url: 'github:foo/my-agent', ref: 'main' },
      agentsDir,
      fetcher: fake,
    });

    expect(result.action).toBe('installed');
    expect(result.slug).toBe('my-agent');
    expect(result.source.type).toBe('url');
    if (result.source.type === 'url') {
      expect(result.source.commitSha).toBe(
        'abc1234567890abcdef1234567890abcdef12345',
      );
    }
    expect(fs.existsSync(path.join(agentsDir, 'my-agent', 'prompt.md'))).toBe(
      true,
    );
    expect(
      fs.existsSync(path.join(agentsDir, 'my-agent', '.minih-source.json')),
    ).toBe(true);
  });

  it('(b) URL re-install with same content → action=unchanged', async () => {
    const tarball = await makeGithubTarball({
      repoPrefix: 'minih-1',
      files: [{ path: 'prompt.md', body: 'same' }],
    });
    const fake = new FakeAgentPackFetcher();
    fake.setSuccess('github:foo/my-agent', 'main', {
      commitSha: '0'.repeat(40),
      tarball,
    });
    await installAgentPack({
      source: { type: 'url', url: 'github:foo/my-agent', ref: 'main' },
      agentsDir,
      fetcher: fake,
    });
    const result = await installAgentPack({
      source: { type: 'url', url: 'github:foo/my-agent', ref: 'main' },
      agentsDir,
      fetcher: fake,
    });
    expect(result.action).toBe('unchanged');
  });

  it('(c) URL upgrade — fake tarball changes → action=upgraded', async () => {
    const tarball1 = await makeGithubTarball({
      repoPrefix: 'minih-1',
      files: [{ path: 'prompt.md', body: 'v1' }],
    });
    const tarball2 = await makeGithubTarball({
      repoPrefix: 'minih-1',
      files: [{ path: 'prompt.md', body: 'v2-much-longer-content' }],
    });
    const fake = new FakeAgentPackFetcher();
    fake.setSuccess('github:foo/my-agent', 'main', {
      commitSha: '1'.repeat(40),
      tarball: tarball1,
    });
    await installAgentPack({
      source: { type: 'url', url: 'github:foo/my-agent', ref: 'main' },
      agentsDir,
      fetcher: fake,
    });
    fake.setSuccess('github:foo/my-agent', 'main', {
      commitSha: '2'.repeat(40),
      tarball: tarball2,
    });
    const result = await installAgentPack({
      source: { type: 'url', url: 'github:foo/my-agent', ref: 'main' },
      agentsDir,
      fetcher: fake,
    });
    expect(result.action).toBe('upgraded');
    expect(result.changedFiles).toContain('prompt.md');
    expect(
      fs.readFileSync(path.join(agentsDir, 'my-agent', 'prompt.md'), 'utf-8'),
    ).toBe('v2-much-longer-content');
  });

  it('(d) URL with subpath → installs only the slice', async () => {
    const tarball = await makeGithubTarball({
      repoPrefix: 'minih-x',
      files: [
        { path: 'README.md', body: 'top-level readme' },
        { path: 'agents/demo/prompt.md', body: 'demo prompt' },
        {
          path: 'agents/other/prompt.md',
          body: 'other prompt that should NOT be installed',
        },
      ],
    });
    const fake = new FakeAgentPackFetcher();
    fake.setSuccess('github:org/repo', 'main', {
      commitSha: '3'.repeat(40),
      tarball,
    });
    const result = await installAgentPack({
      source: {
        type: 'url',
        url: 'github:org/repo',
        ref: 'main',
        subpath: 'agents/demo',
      },
      agentsDir,
      fetcher: fake,
    });
    expect(result.slug).toBe('demo'); // basename of subpath
    expect(
      fs.readFileSync(path.join(agentsDir, 'demo', 'prompt.md'), 'utf-8'),
    ).toBe('demo prompt');
    expect(fs.existsSync(path.join(agentsDir, 'other'))).toBe(false);
    expect(fs.existsSync(path.join(agentsDir, 'demo', 'README.md'))).toBe(
      false,
    );
  });

  it('(e) URL with subpath pointing to non-existent dir → E182', async () => {
    const tarball = await makeGithubTarball({
      repoPrefix: 'minih-x',
      files: [{ path: 'prompt.md', body: 'x' }],
    });
    const fake = new FakeAgentPackFetcher();
    fake.setSuccess('github:org/repo', 'main', {
      commitSha: '4'.repeat(40),
      tarball,
    });
    await expect(
      installAgentPack({
        source: {
          type: 'url',
          url: 'github:org/repo',
          ref: 'main',
          subpath: 'does/not/exist',
        },
        agentsDir,
        fetcher: fake,
      }),
    ).rejects.toThrow(/subpath.*not found.*\(E182\)/);
  });

  it('(g) URL install + tmp dir cleaned up on success', async () => {
    const tarball = await makeGithubTarball({
      repoPrefix: 'minih-x',
      files: [{ path: 'prompt.md', body: 'x' }],
    });
    const fake = new FakeAgentPackFetcher();
    fake.setSuccess('github:foo/my-agent', 'main', {
      commitSha: '5'.repeat(40),
      tarball,
    });
    const installTmpDir = path.join(tmpDir, 'install-tmp-success');
    fs.mkdirSync(installTmpDir);
    await installAgentPack({
      source: { type: 'url', url: 'github:foo/my-agent', ref: 'main' },
      agentsDir,
      fetcher: fake,
      tempDir: installTmpDir,
    });
    expect(
      fs
        .readdirSync(installTmpDir)
        .filter((d) => d.startsWith('minih-agent-pack-')),
    ).toEqual([]);
  });

  it('(h) URL install + tmp dir cleaned up on extract failure', async () => {
    const fake = new FakeAgentPackFetcher();
    // Garbage that gunzips fine but is not a valid tar — extractor returns
    // empty. install will then fail with implicit-manifest error since
    // there's no prompt.md. Either way, tmp dir must be cleaned.
    const garbage = zlib.gzipSync(Buffer.alloc(512));
    fake.setSuccess('github:foo/my-agent', 'main', {
      commitSha: '6'.repeat(40),
      tarball: garbage,
    });
    const installTmpDir = path.join(tmpDir, 'install-tmp-failure');
    fs.mkdirSync(installTmpDir);
    await expect(
      installAgentPack({
        source: { type: 'url', url: 'github:foo/my-agent', ref: 'main' },
        agentsDir,
        fetcher: fake,
        tempDir: installTmpDir,
      }),
    ).rejects.toThrow();
    expect(
      fs
        .readdirSync(installTmpDir)
        .filter((d) => d.startsWith('minih-agent-pack-')),
    ).toEqual([]);
  });

  it('(i) URL install when fetcher rejects → E181 from fetcher', async () => {
    const fake = new FakeAgentPackFetcher();
    fake.setFailure(
      'github:foo/my-agent',
      'main',
      new Error('synthetic E181 fetch failed'),
    );
    await expect(
      installAgentPack({
        source: { type: 'url', url: 'github:foo/my-agent', ref: 'main' },
        agentsDir,
        fetcher: fake,
      }),
    ).rejects.toThrow(/E181|fetch failed/);
  });

  it('(j) URL install without fetcher opt → composition-root bug guard', async () => {
    await expect(
      installAgentPack({
        source: { type: 'url', url: 'github:foo/my-agent', ref: 'main' },
        agentsDir,
        // intentionally no `fetcher`
      }),
    ).rejects.toThrow(/internal error.*fetcher is required/);
  });

  it('(k) slug derivation: URL without subpath uses repo name', async () => {
    const tarball = await makeGithubTarball({
      repoPrefix: 'foo-1',
      files: [{ path: 'prompt.md', body: 'x' }],
    });
    const fake = new FakeAgentPackFetcher();
    fake.setSuccess('github:foo/my-special-agent', 'main', {
      commitSha: '7'.repeat(40),
      tarball,
    });
    const result = await installAgentPack({
      source: {
        type: 'url',
        url: 'github:foo/my-special-agent',
        ref: 'main',
      },
      agentsDir,
      fetcher: fake,
    });
    expect(result.slug).toBe('my-special-agent');
  });
});

// ============================================================================
// Phase 5 companion-review fixes — F001 (pre-fetch self-install) + F002 (commitSha refresh)
// ============================================================================

describe('installAgentPack — registry source (Phase 5 companion-review fixes)', () => {
  it('F001: pre-fetch E183 collision when target slug already exists hand-rolled (fetcher MUST NOT be called)', async () => {
    // Create a hand-rolled folder at the target slug, no .minih-source.json.
    const targetDir = path.join(agentsDir, 'my-pack');
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(
      path.join(targetDir, 'prompt.md'),
      'hand-rolled local prompt content',
    );

    // Fetcher would FAIL if called — proves the pre-fetch check is what fired.
    const fake = new FakeAgentPackFetcher();
    fake.setFailure('github:foo/bar', 'main', new Error('UNREACHABLE FETCHER'));

    await expect(
      installAgentPack({
        source: {
          type: 'registry',
          registrySlug: 'my-pack',
          url: 'github:foo/bar',
          ref: 'main',
        },
        agentsDir,
        fetcher: fake,
      }),
    ).rejects.toThrow(/E183/);

    // Fetcher must NOT have been called — pre-fetch guard fired first.
    expect(fake.callHistory.length).toBe(0);

    // The hand-rolled prompt MUST still exist untouched.
    expect(fs.readFileSync(path.join(targetDir, 'prompt.md'), 'utf-8')).toBe(
      'hand-rolled local prompt content',
    );
  });

  it('F001: --as <new-slug> escape hatch lets registry install proceed alongside hand-rolled', async () => {
    fs.mkdirSync(path.join(agentsDir, 'my-pack'), { recursive: true });
    fs.writeFileSync(path.join(agentsDir, 'my-pack/prompt.md'), 'hand-rolled');

    const tarball = await makeGithubTarball({
      repoPrefix: 'foo-bar-aaa1111',
      files: [{ path: 'prompt.md', body: 'remote' }],
    });
    const fake = new FakeAgentPackFetcher();
    fake.setSuccess('github:foo/bar', 'main', {
      commitSha: 'a'.repeat(40),
      tarball,
    });

    const result = await installAgentPack({
      source: {
        type: 'registry',
        registrySlug: 'my-pack',
        url: 'github:foo/bar',
        ref: 'main',
      },
      asSlug: 'my-pack-new',
      agentsDir,
      fetcher: fake,
    });

    expect(result.action).toBe('installed');
    expect(result.slug).toBe('my-pack-new');
    expect(result.source.type).toBe('registry');
    if (result.source.type === 'registry') {
      expect(result.source.registrySlug).toBe('my-pack');
    }

    // Original hand-rolled untouched.
    expect(
      fs.readFileSync(path.join(agentsDir, 'my-pack/prompt.md'), 'utf-8'),
    ).toBe('hand-rolled');
  });

  it('F002: registry no-op refreshes sidecar.commitSha when remote sha advanced even with byte-identical files', async () => {
    // First install: commit=A, file content "x"
    const tarA = await makeGithubTarball({
      repoPrefix: 'foo-bar-aaaaaaaa',
      files: [{ path: 'prompt.md', body: 'x' }],
    });
    const fake = new FakeAgentPackFetcher();
    fake.setSuccess('github:foo/bar', 'main', {
      commitSha: 'a'.repeat(40),
      tarball: tarA,
    });

    const r1 = await installAgentPack({
      source: {
        type: 'registry',
        registrySlug: 'my-pack',
        url: 'github:foo/bar',
        ref: 'main',
      },
      agentsDir,
      fetcher: fake,
    });
    expect(r1.action).toBe('installed');
    if (r1.source.type !== 'registry')
      throw new Error('expected registry source');
    expect(r1.source.commitSha).toBe('a'.repeat(40));

    // Second install: commit=B, SAME file content "x" — bytes match, sha differs.
    const tarB = await makeGithubTarball({
      repoPrefix: 'foo-bar-bbbbbbbb',
      files: [{ path: 'prompt.md', body: 'x' }],
    });
    fake.setSuccess('github:foo/bar', 'main', {
      commitSha: 'b'.repeat(40),
      tarball: tarB,
    });

    const r2 = await installAgentPack({
      source: {
        type: 'registry',
        registrySlug: 'my-pack',
        url: 'github:foo/bar',
        ref: 'main',
      },
      agentsDir,
      fetcher: fake,
    });
    // Action is still `unchanged` (file bytes match) — that contract holds.
    expect(r2.action).toBe('unchanged');
    // BUT the returned source AND on-disk sidecar must show the NEW commitSha.
    if (r2.source.type !== 'registry')
      throw new Error('expected registry source');
    expect(r2.source.commitSha).toBe('b'.repeat(40));

    const sidecarPath = path.join(agentsDir, 'my-pack/.minih-source.json');
    const sidecar = JSON.parse(fs.readFileSync(sidecarPath, 'utf-8'));
    expect(sidecar.source.type).toBe('registry');
    expect(sidecar.source.commitSha).toBe('b'.repeat(40));
  });

  it('F002: URL no-op also refreshes sidecar.commitSha when remote sha advanced', async () => {
    const tarA = await makeGithubTarball({
      repoPrefix: 'foo-bar-aaaaaaaa',
      files: [{ path: 'prompt.md', body: 'x' }],
    });
    const fake = new FakeAgentPackFetcher();
    fake.setSuccess('github:foo/bar', 'main', {
      commitSha: 'a'.repeat(40),
      tarball: tarA,
    });

    const r1 = await installAgentPack({
      source: { type: 'url', url: 'github:foo/bar', ref: 'main' },
      agentsDir,
      fetcher: fake,
    });
    expect(r1.action).toBe('installed');

    const tarB = await makeGithubTarball({
      repoPrefix: 'foo-bar-bbbbbbbb',
      files: [{ path: 'prompt.md', body: 'x' }],
    });
    fake.setSuccess('github:foo/bar', 'main', {
      commitSha: 'b'.repeat(40),
      tarball: tarB,
    });

    const r2 = await installAgentPack({
      source: { type: 'url', url: 'github:foo/bar', ref: 'main' },
      agentsDir,
      fetcher: fake,
    });
    expect(r2.action).toBe('unchanged');
    if (r2.source.type !== 'url') throw new Error('expected url source');
    expect(r2.source.commitSha).toBe('b'.repeat(40));

    const sidecar = JSON.parse(
      fs.readFileSync(path.join(agentsDir, 'bar/.minih-source.json'), 'utf-8'),
    );
    expect(sidecar.source.commitSha).toBe('b'.repeat(40));
  });
});
