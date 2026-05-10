import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeAgentAdapter } from '../../src/adapter/index.js';
import { listAgents, resolveAgent } from '../../src/runner/folder.js';
import { runAgent } from '../../src/runner/runner.js';
import { validSystemOutput } from '../helpers/fixtures.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-integ-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('Runner Integration', () => {
  it('full end-to-end: agent with schema, instructions, preamble → completed run', async () => {
    // Set up preamble
    const sharedDir = path.join(tmpDir, '_shared');
    fs.mkdirSync(sharedDir, { recursive: true });
    fs.writeFileSync(
      path.join(sharedDir, 'preamble.md'),
      '# Preamble\n\nYour working directory is: {{REPO_ROOT}}\n\n## Feedback\n\nBe honest.',
    );

    // Set up agent
    const agentDir = path.join(tmpDir, 'smoke-test');
    fs.mkdirSync(agentDir, { recursive: true });

    fs.writeFileSync(
      path.join(agentDir, 'prompt.md'),
      `---
description: "End-to-end smoke test"
tags: [smoke, ci, integration]
---

# Smoke Test

## Objective

Verify the system is working.

---

Note: horizontal rule above should NOT break frontmatter parsing.
`,
    );

    fs.writeFileSync(
      path.join(agentDir, 'output-schema.json'),
      JSON.stringify({
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        required: ['status'],
        properties: {
          status: { type: 'string', enum: ['pass', 'fail'] },
        },
      }),
    );

    fs.writeFileSync(
      path.join(agentDir, 'instructions.md'),
      '# Smoke Test Agent\n\nYou are a smoke test agent. Be thorough.',
    );

    // Verify discovery
    const agents = listAgents(tmpDir);
    expect(agents).toHaveLength(1);
    expect(agents[0].slug).toBe('smoke-test');
    expect(agents[0].description).toBe('End-to-end smoke test');
    expect(agents[0].tags).toEqual(['smoke', 'ci', 'integration']);

    // Configure fake adapter with valid output (system + user fields)
    const output = validSystemOutput({ status: 'pass' });

    const fake = new FakeAgentAdapter({
      output,
      sessionId: 'integ-sess-001',
      events: [
        {
          type: 'thinking',
          timestamp: new Date().toISOString(),
          data: { content: 'Planning approach...' },
        },
        {
          type: 'tool_call',
          timestamp: new Date().toISOString(),
          data: { toolName: 'bash', input: 'echo hello', toolCallId: 'tc1' },
        },
        {
          type: 'tool_result',
          timestamp: new Date().toISOString(),
          data: { toolCallId: 'tc1', output: 'hello', isError: false },
        },
        {
          type: 'message',
          timestamp: new Date().toISOString(),
          data: { content: 'Done!' },
        },
      ],
    });

    // Run agent
    const def = resolveAgent('smoke-test', tmpDir);
    if (def === null) throw new Error('expected smoke-test agent to resolve');
    const result = await runAgent(
      fake,
      def,
      { slug: 'smoke-test', cwd: '/test/project' },
      undefined,
      tmpDir,
    );

    // Verify run folder structure
    expect(fs.existsSync(result.runDir)).toBe(true);

    // Frozen copies
    expect(fs.existsSync(path.join(result.runDir, 'prompt.md'))).toBe(true);
    expect(fs.existsSync(path.join(result.runDir, 'instructions.md'))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(result.runDir, 'output-schema.json'))).toBe(
      true,
    );

    // Events NDJSON
    const eventsPath = path.join(result.runDir, 'events.ndjson');
    expect(fs.existsSync(eventsPath)).toBe(true);
    const eventLines = fs.readFileSync(eventsPath, 'utf-8').trim().split('\n');
    expect(eventLines).toHaveLength(4);

    // Output
    const reportPath = path.join(result.runDir, 'output', 'report.json');
    expect(fs.existsSync(reportPath)).toBe(true);
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
    expect(report.status).toBe('pass');
    expect(report.retrospective.magicWand).toBeDefined();

    // Completed metadata
    const completedPath = path.join(result.runDir, 'completed.json');
    expect(fs.existsSync(completedPath)).toBe(true);
    const metadata = JSON.parse(fs.readFileSync(completedPath, 'utf-8'));
    expect(metadata.slug).toBe('smoke-test');
    expect(metadata.result).toBe('completed');
    expect(metadata.sessionId).toBe('integ-sess-001');
    expect(metadata.eventCount).toBe(4);
    expect(metadata.toolCallCount).toBe(1);
    expect(metadata.systemValidated).toBe(true);
    expect(metadata.userValidated).toBe(true);
    expect(metadata.validated).toBe(true);
    expect(metadata.validationErrors).toEqual([]);
    expect(metadata.artifacts).toContain('events.ndjson');
    expect(metadata.artifacts).toContain('prompt.md');

    // Verify prompt assembly
    const sentPrompt = fake.getRunHistory()[0].prompt;
    expect(sentPrompt).toContain('Your working directory is: /test/project');
    expect(sentPrompt).toContain('Be thorough');
    expect(sentPrompt).toContain('Write your final JSON report to:');
    expect(sentPrompt).toContain('Verify the system is working.');
    expect(sentPrompt).toContain('Required Output Format');
    expect(sentPrompt).not.toContain('description: "End-to-end smoke test"');

    // Result
    expect(result.metadata.result).toBe('completed');

    // Env vars cleaned up
    expect(process.env.MINIH).toBeUndefined();
    expect(process.env.MINIH_AGENT_SLUG).toBeUndefined();
  });
});
