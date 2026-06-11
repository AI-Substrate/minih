import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeAgentAdapter } from '../../src/adapter/index.js';
import { resolveAgent } from '../../src/runner/folder.js';
import { runAgent } from '../../src/runner/runner.js';
import { validSystemOutput } from '../helpers/fixtures.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-runner-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function createAgent(
  slug: string,
  opts: {
    prompt?: string;
    schema?: object | null;
    instructions?: string | null;
    inputSchema?: object | null;
    preamble?: string | null;
  } = {},
) {
  const agentDir = path.join(tmpDir, slug);
  fs.mkdirSync(agentDir, { recursive: true });

  const prompt =
    opts.prompt ??
    `---\ndescription: "Test agent"\n---\n\n# ${slug}\n\nDo the thing.`;
  fs.writeFileSync(path.join(agentDir, 'prompt.md'), prompt);

  if (opts.schema !== null) {
    const schema = opts.schema ?? {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      required: ['result'],
      properties: { result: { type: 'string' } },
    };
    fs.writeFileSync(
      path.join(agentDir, 'output-schema.json'),
      JSON.stringify(schema),
    );
  }

  if (opts.instructions !== null) {
    fs.writeFileSync(
      path.join(agentDir, 'instructions.md'),
      opts.instructions ?? '# Instructions\n\nBe helpful.',
    );
  }

  if (opts.inputSchema) {
    fs.writeFileSync(
      path.join(agentDir, 'input-schema.json'),
      JSON.stringify(opts.inputSchema),
    );
  }

  if (opts.preamble !== undefined && opts.preamble !== null) {
    const sharedDir = path.join(tmpDir, '_shared');
    fs.mkdirSync(sharedDir, { recursive: true });
    fs.writeFileSync(path.join(sharedDir, 'preamble.md'), opts.preamble);
  }

  const def = resolveAgent(slug, tmpDir);
  if (def === null) throw new Error(`expected agent ${slug} to resolve`);
  return def;
}

describe('runAgent', () => {
  it('assembles prompt in correct order: preamble → instructions → hint → prompt → system', async () => {
    const def = createAgent('test-order', {
      preamble: 'PREAMBLE_CONTENT',
      instructions: 'INSTRUCTIONS_CONTENT',
    });

    const fake = new FakeAgentAdapter({
      output: validSystemOutput({ result: 'ok' }),
    });
    await runAgent(fake, def, { slug: 'test-order' }, undefined, tmpDir);

    const history = fake.getRunHistory();
    expect(history).toHaveLength(1);
    const prompt = history[0].prompt;

    const preambleIdx = prompt.indexOf('PREAMBLE_CONTENT');
    const instructionsIdx = prompt.indexOf('INSTRUCTIONS_CONTENT');
    const hintIdx = prompt.indexOf('Write your final JSON report to:');
    const bodyIdx = prompt.indexOf('Do the thing.');
    const systemIdx = prompt.indexOf('Required Output Format');

    expect(preambleIdx).toBeLessThan(instructionsIdx);
    expect(instructionsIdx).toBeLessThan(hintIdx);
    expect(hintIdx).toBeLessThan(bodyIdx);
    expect(bodyIdx).toBeLessThan(systemIdx);

    expect(prompt).toContain('\n\n---\n\n');
  });

  it('strips frontmatter from prompt', async () => {
    const def = createAgent('test-strip', {
      prompt:
        '---\ndescription: "Should be stripped"\ntags: [test]\n---\n\n# Real Content\n\nBody here.',
      schema: null,
      instructions: null,
      preamble: null,
    });

    const fake = new FakeAgentAdapter({ output: validSystemOutput() });
    await runAgent(fake, def, { slug: 'test-strip' }, undefined, tmpDir);

    const prompt = fake.getRunHistory()[0].prompt;
    expect(prompt).not.toContain('description: "Should be stripped"');
    expect(prompt).toContain('# Real Content');
  });

  it('replaces {{REPO_ROOT}} in preamble', async () => {
    const def = createAgent('test-replace', {
      preamble: 'Root is: {{REPO_ROOT}}',
      schema: null,
      instructions: null,
    });

    const fake = new FakeAgentAdapter({ output: validSystemOutput() });
    await runAgent(
      fake,
      def,
      { slug: 'test-replace', cwd: '/my/project' },
      undefined,
      tmpDir,
    );

    const prompt = fake.getRunHistory()[0].prompt;
    expect(prompt).toContain('Root is: /my/project');
    expect(prompt).not.toContain('{{REPO_ROOT}}');
  });

  it('works without preamble — still has system output instructions', async () => {
    const def = createAgent('no-preamble', {
      preamble: null,
      schema: null,
      instructions: null,
    });

    const fake = new FakeAgentAdapter({ output: validSystemOutput() });
    await runAgent(fake, def, { slug: 'no-preamble' }, undefined, tmpDir);

    const prompt = fake.getRunHistory()[0].prompt;
    expect(prompt).toContain('Do the thing.');
    expect(prompt).toContain('Required Output Format');
  });

  it('skips instructions when not present', async () => {
    const def = createAgent('no-instr', {
      instructions: null,
      schema: null,
      preamble: null,
    });

    const fake = new FakeAgentAdapter({ output: validSystemOutput() });
    await runAgent(fake, def, { slug: 'no-instr' }, undefined, tmpDir);

    const prompt = fake.getRunHistory()[0].prompt;
    expect(prompt).not.toContain('Be helpful');
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

    const fake = new FakeAgentAdapter({ output: validSystemOutput() });
    await runAgent(
      fake,
      def,
      { slug: 'with-params', params: { file_path: '/src/main.ts' } },
      undefined,
      tmpDir,
    );

    const prompt = fake.getRunHistory()[0].prompt;
    expect(prompt).toContain('## Input Parameters');
    expect(prompt).toContain('file_path: /src/main.ts');
  });

  it('always includes output hint', async () => {
    const def = createAgent('no-schema', {
      schema: null,
      preamble: null,
      instructions: null,
    });

    const fake = new FakeAgentAdapter({ output: validSystemOutput() });
    await runAgent(fake, def, { slug: 'no-schema' }, undefined, tmpDir);

    const prompt = fake.getRunHistory()[0].prompt;
    expect(prompt).toContain('Write your final JSON report to:');
  });

  it('writes events to NDJSON', async () => {
    const def = createAgent('events-test', {
      schema: null,
      instructions: null,
      preamble: null,
    });

    const fake = new FakeAgentAdapter({
      output: validSystemOutput(),
      events: [
        {
          type: 'thinking',
          timestamp: '2026-01-01T00:00:00Z',
          data: { content: 'hmm' },
        },
        {
          type: 'tool_call',
          timestamp: '2026-01-01T00:00:01Z',
          data: { toolName: 'bash', input: 'ls', toolCallId: 'tc1' },
        },
      ],
    });

    const result = await runAgent(
      fake,
      def,
      { slug: 'events-test' },
      undefined,
      tmpDir,
    );

    const eventsPath = path.join(result.runDir, 'events.ndjson');
    const lines = fs.readFileSync(eventsPath, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).type).toBe('thinking');
  });

  it('writes completed.json with correct metadata including system validation', async () => {
    const def = createAgent('meta-test', {
      schema: null,
      instructions: null,
      preamble: null,
    });

    const fake = new FakeAgentAdapter({
      output: validSystemOutput(),
      sessionId: 'sess-123',
    });
    const result = await runAgent(
      fake,
      def,
      { slug: 'meta-test' },
      undefined,
      tmpDir,
    );

    const completedPath = path.join(result.runDir, 'completed.json');
    const metadata = JSON.parse(fs.readFileSync(completedPath, 'utf-8'));

    expect(metadata.slug).toBe('meta-test');
    expect(metadata.sessionId).toBe('sess-123');
    expect(metadata.result).toBe('completed');
    expect(metadata.systemValidated).toBe(true);
    expect(metadata.userValidated).toBeNull();
    expect(metadata.startedAt).toBeDefined();
    expect(metadata.completedAt).toBeDefined();
    expect(metadata.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('sets degraded status when output fails user schema validation', async () => {
    const def = createAgent('degraded-user', {
      preamble: null,
      instructions: null,
    });

    // Has system fields but missing user schema's required 'result' field
    const fake = new FakeAgentAdapter({
      output: validSystemOutput({ wrong: 'field' }),
    });
    const result = await runAgent(
      fake,
      def,
      { slug: 'degraded-user' },
      undefined,
      tmpDir,
    );

    expect(result.metadata.result).toBe('degraded');
    expect(result.metadata.systemValidated).toBe(true);
    expect(result.metadata.userValidated).toBe(false);
  });

  it('sets degraded status when output fails system validation', async () => {
    const def = createAgent('degraded-system', {
      schema: null,
      preamble: null,
      instructions: null,
    });

    // Missing system fields entirely
    const fake = new FakeAgentAdapter({
      output: '{"just": "plain text in json"}',
    });
    const result = await runAgent(
      fake,
      def,
      { slug: 'degraded-system' },
      undefined,
      tmpDir,
    );

    expect(result.metadata.result).toBe('degraded');
    expect(result.metadata.systemValidated).toBe(false);
  });

  it('sets failed status on adapter error', async () => {
    const def = createAgent('fail-test', {
      schema: null,
      instructions: null,
      preamble: null,
    });

    const fake = new FakeAgentAdapter({
      output: 'error',
      status: 'failed',
      exitCode: 1,
    });
    const result = await runAgent(
      fake,
      def,
      { slug: 'fail-test' },
      undefined,
      tmpDir,
    );

    expect(result.metadata.result).toBe('failed');
    expect(result.metadata.exitCode).toBe(1);
  });

  it('creates frozen copies in run folder', async () => {
    const def = createAgent('freeze-test', {
      preamble: null,
      instructions: 'Freeze these instructions',
    });

    const fake = new FakeAgentAdapter({
      output: validSystemOutput({ result: 'ok' }),
    });
    const result = await runAgent(
      fake,
      def,
      { slug: 'freeze-test' },
      undefined,
      tmpDir,
    );

    expect(fs.existsSync(path.join(result.runDir, 'prompt.md'))).toBe(true);
    expect(fs.existsSync(path.join(result.runDir, 'instructions.md'))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(result.runDir, 'output-schema.json'))).toBe(
      true,
    );
    expect(
      fs.existsSync(path.join(result.runDir, 'output', 'report.json')),
    ).toBe(true);
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
    const result = await runAgent(
      fake,
      def,
      { slug: 'input-fail', params: {} },
      undefined,
      tmpDir,
    );

    expect(result.metadata.result).toBe('failed');
    expect(fake.getRunHistory()).toHaveLength(0);
  });

  it('handles timeout — terminates adapter and reports timeout status', async () => {
    const def = createAgent('timeout-test', {
      schema: null,
      instructions: null,
      preamble: null,
    });

    const fake = new FakeAgentAdapter({
      output: 'too slow',
      sessionId: 'slow-sess',
      runDuration: 500,
      events: [
        {
          type: 'session_start',
          timestamp: new Date().toISOString(),
          data: { sessionId: 'slow-sess' },
        },
      ],
    });

    const result = await runAgent(
      fake,
      def,
      { slug: 'timeout-test', timeout: 0.1 },
      undefined,
      tmpDir,
    );

    expect(result.metadata.result).toBe('timeout');
    expect(result.metadata.exitCode).toBe(124);
    expect(fake.getTerminateHistory().length).toBeGreaterThan(0);
  });

  // Plan 026 T004 — the existing timeout fires, but it must also leave a
  // diagnosable run.json: terminalReason 'timeout' in the final patch, and
  // the error message must report the configured budget.
  it('timeout writes terminalReason "timeout" in the final manifest patch', async () => {
    const def = createAgent('timeout-reason', {
      schema: null,
      instructions: null,
      preamble: null,
    });

    const fake = new FakeAgentAdapter({ output: 'too slow', runDuration: 500 });
    const result = await runAgent(
      fake,
      def,
      { slug: 'timeout-reason', timeout: 0.1 },
      undefined,
      tmpDir,
    );

    expect(result.metadata.result).toBe('timeout');
    expect(result.agentResult.output).toContain('timed out after 0.1s');
    const manifest = JSON.parse(
      fs.readFileSync(path.join(result.runDir, 'run.json'), 'utf-8'),
    );
    expect(manifest.status).toBe('failed');
    expect(manifest.terminalReason).toBe('timeout');
  });

  // Plan 026 T004 (CD-01) — terminal artifacts may never depend on SDK
  // cooperation: a terminate() that hangs on dead RPC must not block
  // completed.json or the final manifest patch.
  it('still terminalizes within a bounded window when terminate() hangs', async () => {
    const def = createAgent('timeout-hung-terminate', {
      schema: null,
      instructions: null,
      preamble: null,
    });

    const fake = new FakeAgentAdapter({
      output: 'too slow',
      runDuration: 500,
      hangOnTerminate: true,
    });

    const started = Date.now();
    const result = await runAgent(
      fake,
      def,
      { slug: 'timeout-hung-terminate', timeout: 0.1, cleanupGraceMs: 50 },
      undefined,
      tmpDir,
    );

    expect(Date.now() - started).toBeLessThan(3000);
    expect(result.metadata.result).toBe('timeout');
    expect(result.metadata.exitCode).toBe(124);
    expect(fake.getTerminateHistory().length).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(result.runDir, 'completed.json'))).toBe(
      true,
    );
    const manifest = JSON.parse(
      fs.readFileSync(path.join(result.runDir, 'run.json'), 'utf-8'),
    );
    expect(manifest.status).toBe('failed');
    expect(manifest.terminalReason).toBe('timeout');
  });

  it('sets MINIH env vars during run and cleans up after', async () => {
    const def = createAgent('env-test', {
      schema: null,
      instructions: null,
      preamble: null,
    });

    let capturedEnv: Record<string, string | undefined> = {};
    const fake = new FakeAgentAdapter({
      output: validSystemOutput(),
      events: [
        {
          type: 'message',
          timestamp: new Date().toISOString(),
          data: { content: 'checking env' },
        },
      ],
    });

    // Capture env during the run via onEvent
    await runAgent(
      fake,
      def,
      { slug: 'env-test', model: 'test-model', timeout: 60 },
      () => {
        capturedEnv = {
          MINIH: process.env.MINIH,
          MINIH_AGENT_SLUG: process.env.MINIH_AGENT_SLUG,
          MINIH_MODEL: process.env.MINIH_MODEL,
          MINIH_TIMEOUT: process.env.MINIH_TIMEOUT,
        };
      },
      tmpDir,
    );

    // Env was set during run
    expect(capturedEnv.MINIH).toBe('1');
    expect(capturedEnv.MINIH_AGENT_SLUG).toBe('env-test');
    expect(capturedEnv.MINIH_MODEL).toBe('test-model');
    expect(capturedEnv.MINIH_TIMEOUT).toBe('60');

    // Env cleaned up after run
    expect(process.env.MINIH).toBeUndefined();
    expect(process.env.MINIH_AGENT_SLUG).toBeUndefined();
  });

  it('sets coordination env vars during coordinated runs and cleans up after', async () => {
    const def = createAgent('coord-env-test', {
      prompt:
        '---\ndescription: "Coordination env test"\ncoordination: enabled\npermissions:\n  preset: yolo\n---\n\n# Env',
      schema: null,
      instructions: null,
      preamble: null,
    });

    let capturedEnv: Record<string, string | undefined> = {};
    const fake = new FakeAgentAdapter({
      output: validSystemOutput(),
      events: [
        {
          type: 'message',
          timestamp: new Date().toISOString(),
          data: { content: 'checking coordination env' },
        },
      ],
    });

    const result = await runAgent(
      fake,
      def,
      { slug: 'coord-env-test' },
      () => {
        capturedEnv = {
          MINIH_CONTEXT: process.env.MINIH_CONTEXT,
          MINIH_INBOX_DIR: process.env.MINIH_INBOX_DIR,
          MINIH_STATE_DIR: process.env.MINIH_STATE_DIR,
        };
      },
      tmpDir,
    );

    expect(capturedEnv).toEqual({
      MINIH_CONTEXT: 'inside',
      MINIH_INBOX_DIR: path.join(result.runDir, 'inbox'),
      MINIH_STATE_DIR: path.join(result.runDir, 'state'),
    });
    expect(process.env.MINIH_CONTEXT).toBeUndefined();
    expect(process.env.MINIH_INBOX_DIR).toBeUndefined();
    expect(process.env.MINIH_STATE_DIR).toBeUndefined();
  });
});
