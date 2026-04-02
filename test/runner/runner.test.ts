import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { FakeAgentAdapter } from '../../src/adapter/fake.js';
import { resolveAgent } from '../../src/runner/folder.js';
import { runAgent } from '../../src/runner/runner.js';
import type { AgentEvent } from '../../src/adapter/events.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-runner-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function createAgent(slug: string, opts: {
  prompt?: string;
  schema?: object | null;
  instructions?: string | null;
  inputSchema?: object | null;
  preamble?: string | null;
} = {}) {
  const agentDir = path.join(tmpDir, slug);
  fs.mkdirSync(agentDir, { recursive: true });

  const prompt = opts.prompt ?? `---\ndescription: "Test agent"\n---\n\n# ${slug}\n\nDo the thing.`;
  fs.writeFileSync(path.join(agentDir, 'prompt.md'), prompt);

  if (opts.schema !== null) {
    const schema = opts.schema ?? {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      required: ['result'],
      properties: { result: { type: 'string' } },
    };
    fs.writeFileSync(path.join(agentDir, 'output-schema.json'), JSON.stringify(schema));
  }

  if (opts.instructions !== null) {
    fs.writeFileSync(path.join(agentDir, 'instructions.md'), opts.instructions ?? '# Instructions\n\nBe helpful.');
  }

  if (opts.inputSchema) {
    fs.writeFileSync(path.join(agentDir, 'input-schema.json'), JSON.stringify(opts.inputSchema));
  }

  if (opts.preamble !== undefined && opts.preamble !== null) {
    const sharedDir = path.join(tmpDir, '_shared');
    fs.mkdirSync(sharedDir, { recursive: true });
    fs.writeFileSync(path.join(sharedDir, 'preamble.md'), opts.preamble);
  }

  return resolveAgent(slug, tmpDir)!;
}

describe('runAgent', () => {
  it('assembles prompt in correct order: preamble → instructions → hint → prompt', async () => {
    const def = createAgent('test-order', {
      preamble: 'PREAMBLE_CONTENT',
      instructions: 'INSTRUCTIONS_CONTENT',
    });

    const fake = new FakeAgentAdapter({ output: '{"result":"ok"}' });
    await runAgent(fake, def, { slug: 'test-order' }, undefined, tmpDir);

    const history = fake.getRunHistory();
    expect(history).toHaveLength(1);
    const prompt = history[0].prompt;

    // Verify order
    const preambleIdx = prompt.indexOf('PREAMBLE_CONTENT');
    const instructionsIdx = prompt.indexOf('INSTRUCTIONS_CONTENT');
    const hintIdx = prompt.indexOf('Write your final JSON report to:');
    const bodyIdx = prompt.indexOf('Do the thing.');

    expect(preambleIdx).toBeLessThan(instructionsIdx);
    expect(instructionsIdx).toBeLessThan(hintIdx);
    expect(hintIdx).toBeLessThan(bodyIdx);

    // Verify separator
    expect(prompt).toContain('\n\n---\n\n');
  });

  it('strips frontmatter from prompt', async () => {
    const def = createAgent('test-strip', {
      prompt: '---\ndescription: "Should be stripped"\ntags: [test]\n---\n\n# Real Content\n\nBody here.',
      schema: null,
      instructions: null,
      preamble: null,
    });

    const fake = new FakeAgentAdapter({ output: 'done' });
    await runAgent(fake, def, { slug: 'test-strip' }, undefined, tmpDir);

    const prompt = fake.getRunHistory()[0].prompt;
    expect(prompt).not.toContain('description: "Should be stripped"');
    expect(prompt).toContain('# Real Content');
    expect(prompt).toContain('Body here.');
  });

  it('replaces {{REPO_ROOT}} in preamble', async () => {
    const def = createAgent('test-replace', {
      preamble: 'Root is: {{REPO_ROOT}}',
      schema: null,
      instructions: null,
    });

    const fake = new FakeAgentAdapter({ output: 'done' });
    await runAgent(fake, def, { slug: 'test-replace', cwd: '/my/project' }, undefined, tmpDir);

    const prompt = fake.getRunHistory()[0].prompt;
    expect(prompt).toContain('Root is: /my/project');
    expect(prompt).not.toContain('{{REPO_ROOT}}');
  });

  it('works without preamble', async () => {
    const def = createAgent('no-preamble', {
      preamble: null,
      schema: null,
      instructions: null,
    });

    const fake = new FakeAgentAdapter({ output: 'done' });
    await runAgent(fake, def, { slug: 'no-preamble' }, undefined, tmpDir);

    const prompt = fake.getRunHistory()[0].prompt;
    expect(prompt).toContain('Do the thing.');
    expect(prompt).not.toContain('---');
  });

  it('skips instructions when not present', async () => {
    const def = createAgent('no-instr', {
      instructions: null,
      schema: null,
      preamble: null,
    });

    const fake = new FakeAgentAdapter({ output: 'done' });
    await runAgent(fake, def, { slug: 'no-instr' }, undefined, tmpDir);

    const prompt = fake.getRunHistory()[0].prompt;
    expect(prompt).not.toContain('Instructions');
  });

  it('formats input params as ## Input Parameters', async () => {
    const def = createAgent('with-params', {
      inputSchema: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        required: ['file_path'],
        properties: { file_path: { type: 'string' } },
      },
      preamble: null,
      instructions: null,
      schema: null,
    });

    const fake = new FakeAgentAdapter({ output: 'done' });
    await runAgent(fake, def, { slug: 'with-params', params: { file_path: '/src/main.ts' } }, undefined, tmpDir);

    const prompt = fake.getRunHistory()[0].prompt;
    expect(prompt).toContain('## Input Parameters');
    expect(prompt).toContain('file_path: /src/main.ts');
  });

  it('includes output hint when schema exists', async () => {
    const def = createAgent('with-schema', { preamble: null, instructions: null });

    const fake = new FakeAgentAdapter({ output: '{"result":"ok"}' });
    await runAgent(fake, def, { slug: 'with-schema' }, undefined, tmpDir);

    const prompt = fake.getRunHistory()[0].prompt;
    expect(prompt).toContain('Write your final JSON report to:');
  });

  it('writes events to NDJSON', async () => {
    const def = createAgent('events-test', { schema: null, instructions: null, preamble: null });

    const fake = new FakeAgentAdapter({
      output: 'done',
      events: [
        { type: 'thinking', timestamp: '2026-01-01T00:00:00Z', data: { content: 'hmm' } },
        { type: 'tool_call', timestamp: '2026-01-01T00:00:01Z', data: { toolName: 'bash', input: 'ls', toolCallId: 'tc1' } },
      ],
    });

    const result = await runAgent(fake, def, { slug: 'events-test' }, undefined, tmpDir);

    const eventsPath = path.join(result.runDir, 'events.ndjson');
    const lines = fs.readFileSync(eventsPath, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);

    const event0 = JSON.parse(lines[0]);
    expect(event0.type).toBe('thinking');
  });

  it('writes completed.json with correct metadata', async () => {
    const def = createAgent('meta-test', { schema: null, instructions: null, preamble: null });

    const fake = new FakeAgentAdapter({ output: 'done', sessionId: 'sess-123' });
    const result = await runAgent(fake, def, { slug: 'meta-test' }, undefined, tmpDir);

    const completedPath = path.join(result.runDir, 'completed.json');
    const metadata = JSON.parse(fs.readFileSync(completedPath, 'utf-8'));

    expect(metadata.slug).toBe('meta-test');
    expect(metadata.sessionId).toBe('sess-123');
    expect(metadata.result).toBe('completed');
    expect(metadata.startedAt).toBeDefined();
    expect(metadata.completedAt).toBeDefined();
    expect(metadata.durationMs).toBeGreaterThanOrEqual(0);
    expect(metadata.artifacts).toBeInstanceOf(Array);
  });

  it('sets degraded status when output fails validation', async () => {
    const def = createAgent('degraded-test', { preamble: null, instructions: null });

    // Output doesn't match schema (missing required 'result' field)
    const fake = new FakeAgentAdapter({ output: '{"wrong":"field"}' });
    const result = await runAgent(fake, def, { slug: 'degraded-test' }, undefined, tmpDir);

    expect(result.metadata.result).toBe('degraded');
    expect(result.validation).not.toBeNull();
    expect(result.validation!.valid).toBe(false);
  });

  it('sets failed status on adapter error', async () => {
    const def = createAgent('fail-test', { schema: null, instructions: null, preamble: null });

    const fake = new FakeAgentAdapter({ output: 'error', status: 'failed', exitCode: 1 });
    const result = await runAgent(fake, def, { slug: 'fail-test' }, undefined, tmpDir);

    expect(result.metadata.result).toBe('failed');
    expect(result.metadata.exitCode).toBe(1);
  });

  it('creates frozen copies in run folder', async () => {
    const def = createAgent('freeze-test', {
      preamble: null,
      instructions: 'Freeze these instructions',
    });

    const fake = new FakeAgentAdapter({ output: '{"result":"ok"}' });
    const result = await runAgent(fake, def, { slug: 'freeze-test' }, undefined, tmpDir);

    expect(fs.existsSync(path.join(result.runDir, 'prompt.md'))).toBe(true);
    expect(fs.existsSync(path.join(result.runDir, 'instructions.md'))).toBe(true);
    expect(fs.existsSync(path.join(result.runDir, 'output-schema.json'))).toBe(true);
    expect(fs.existsSync(path.join(result.runDir, 'output', 'report.json'))).toBe(true);
  });

  it('fails fast on invalid input params', async () => {
    const def = createAgent('input-fail', {
      inputSchema: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        required: ['file_path'],
        properties: { file_path: { type: 'string' } },
      },
      preamble: null,
      instructions: null,
      schema: null,
    });

    const fake = new FakeAgentAdapter({ output: 'should not run' });
    const result = await runAgent(fake, def, { slug: 'input-fail', params: {} }, undefined, tmpDir);

    expect(result.metadata.result).toBe('failed');
    expect(fake.getRunHistory()).toHaveLength(0); // Adapter never called
  });
});
