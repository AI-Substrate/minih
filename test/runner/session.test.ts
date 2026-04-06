/**
 * Tests for session lookup helper and resume path.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeAgentAdapter } from '../../src/adapter/fake.js';
import { findRunSession, runAgent } from '../../src/runner/index.js';
import type {
  AgentDefinition,
  AgentRunConfig,
} from '../../src/runner/types.js';

const TEST_DIR = path.join(process.cwd(), 'test', '.tmp-session-test');

function setupAgentWithRuns(
  runs: Array<{
    runId: string;
    sessionId?: string;
    result?: string;
    resumedFromRunId?: string;
  }>,
): string {
  const agentsDir = path.join(TEST_DIR, 'agents');
  const slug = 'test-agent';
  const agentDir = path.join(agentsDir, slug);
  const runsDir = path.join(agentDir, 'runs');

  // Create agent dir with prompt.md
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(
    path.join(agentDir, 'prompt.md'),
    '---\ndescription: test agent\n---\nTest prompt',
  );

  // Create run folders with completed.json
  for (const run of runs) {
    const runDir = path.join(runsDir, run.runId);
    fs.mkdirSync(path.join(runDir, 'output'), { recursive: true });

    if (run.sessionId !== undefined) {
      const metadata: Record<string, unknown> = {
        slug,
        runId: run.runId,
        sessionId: run.sessionId,
        result: run.result ?? 'completed',
        durationMs: 1000,
        validated: true,
      };
      if (run.resumedFromRunId) {
        metadata.resumedFromRunId = run.resumedFromRunId;
      }
      fs.writeFileSync(
        path.join(runDir, 'completed.json'),
        JSON.stringify(metadata, null, 2),
      );
    }
  }

  return agentsDir;
}

describe('findRunSession', () => {
  beforeEach(() => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('returns latest run session when no runId specified', () => {
    const agentsDir = setupAgentWithRuns([
      { runId: '2026-01-01T00-00-00-000Z-aaaa', sessionId: 'old-session' },
      { runId: '2026-01-02T00-00-00-000Z-bbbb', sessionId: 'new-session' },
    ]);

    const result = findRunSession('test-agent', agentsDir);
    expect(result).not.toBeNull();
    expect(result!.sessionId).toBe('new-session');
    expect(result!.runId).toBe('2026-01-02T00-00-00-000Z-bbbb');
  });

  it('returns specific run session when runId provided', () => {
    const agentsDir = setupAgentWithRuns([
      { runId: '2026-01-01T00-00-00-000Z-aaaa', sessionId: 'old-session' },
      { runId: '2026-01-02T00-00-00-000Z-bbbb', sessionId: 'new-session' },
    ]);

    const result = findRunSession(
      'test-agent',
      agentsDir,
      '2026-01-01T00-00-00-000Z-aaaa',
    );
    expect(result).not.toBeNull();
    expect(result!.sessionId).toBe('old-session');
  });

  it('returns null when no runs directory exists', () => {
    const agentsDir = path.join(TEST_DIR, 'agents');
    fs.mkdirSync(path.join(agentsDir, 'test-agent'), { recursive: true });

    const result = findRunSession('test-agent', agentsDir);
    expect(result).toBeNull();
  });

  it('returns null when completed.json is missing', () => {
    const agentsDir = setupAgentWithRuns([
      { runId: '2026-01-01T00-00-00-000Z-aaaa' }, // no sessionId = no completed.json
    ]);

    const result = findRunSession('test-agent', agentsDir);
    expect(result).toBeNull();
  });

  it('returns null when specified runId not found', () => {
    const agentsDir = setupAgentWithRuns([
      { runId: '2026-01-01T00-00-00-000Z-aaaa', sessionId: 'some-session' },
    ]);

    const result = findRunSession('test-agent', agentsDir, 'nonexistent-run');
    expect(result).toBeNull();
  });

  it('returns null when completed.json has no sessionId', () => {
    const agentsDir = setupAgentWithRuns([
      { runId: '2026-01-01T00-00-00-000Z-aaaa', sessionId: '' },
    ]);

    const result = findRunSession('test-agent', agentsDir);
    expect(result).toBeNull();
  });

  it('returns null when completed.json is corrupt', () => {
    const agentsDir = path.join(TEST_DIR, 'agents');
    const runDir = path.join(
      agentsDir,
      'test-agent',
      'runs',
      '2026-01-01T00-00-00-000Z-aaaa',
    );
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'completed.json'), 'not json!!!');

    const result = findRunSession('test-agent', agentsDir);
    expect(result).toBeNull();
  });
});

describe('runAgent resume path', () => {
  const AGENTS_DIR = path.join(TEST_DIR, 'agents');
  const AGENT_SLUG = 'resume-test';

  function createTestAgent(): AgentDefinition {
    const agentDir = path.join(AGENTS_DIR, AGENT_SLUG);
    fs.mkdirSync(agentDir, { recursive: true });

    const promptPath = path.join(agentDir, 'prompt.md');
    fs.writeFileSync(
      promptPath,
      '---\ndescription: resume test\n---\nFollow-up message here',
    );

    return {
      slug: AGENT_SLUG,
      description: 'resume test',
      tags: [],
      dir: agentDir,
      promptPath,
      schemaPath: null,
      instructionsPath: null,
      inputSchemaPath: null,
    };
  }

  beforeEach(() => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('forwards sessionId to adapter when config.sessionId is set', async () => {
    const definition = createTestAgent();
    const adapter = new FakeAgentAdapter();
    const config: AgentRunConfig = {
      slug: AGENT_SLUG,
      sessionId: 'test-session-123',
      resumedFromRunId: 'original-run-id',
    };

    const result = await runAgent(adapter, definition, config);
    expect(result.agentResult.sessionId).toBe('test-session-123');
  });

  it('writes resumedFromRunId to completed.json', async () => {
    const definition = createTestAgent();
    const adapter = new FakeAgentAdapter();
    const config: AgentRunConfig = {
      slug: AGENT_SLUG,
      sessionId: 'test-session-456',
      resumedFromRunId: 'original-run-xyz',
    };

    const result = await runAgent(adapter, definition, config);

    const completedPath = path.join(result.runDir, 'completed.json');
    const metadata = JSON.parse(fs.readFileSync(completedPath, 'utf-8'));
    expect(metadata.resumedFromRunId).toBe('original-run-xyz');
  });

  it('skips system output validation on resume', async () => {
    const definition = createTestAgent();
    // Agent returns non-JSON output — normally would fail system validation
    const adapter = new FakeAgentAdapter({ output: 'Just a plain text reply' });
    const config: AgentRunConfig = {
      slug: AGENT_SLUG,
      sessionId: 'test-session-789',
      resumedFromRunId: 'some-run',
    };

    const result = await runAgent(adapter, definition, config);
    // Resume skips system validation, so it should be 'completed' not 'degraded'
    expect(result.metadata.result).toBe('completed');
    expect(result.metadata.systemValidated).toBe(true);
  });

  it('does NOT write resumedFromRunId for fresh runs', async () => {
    const definition = createTestAgent();
    const adapter = new FakeAgentAdapter();
    const config: AgentRunConfig = { slug: AGENT_SLUG };

    const result = await runAgent(adapter, definition, config);

    const completedPath = path.join(result.runDir, 'completed.json');
    const metadata = JSON.parse(fs.readFileSync(completedPath, 'utf-8'));
    expect(metadata.resumedFromRunId).toBeUndefined();
  });
});
