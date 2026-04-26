import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  AgentResult,
  AgentRunOptions,
  IAgentAdapter,
} from '../../src/adapter/index.js';
import {
  inboxLanePath,
  resolveAgent,
  stateFilePath,
} from '../../src/runner/folder.js';
import { runAgent } from '../../src/runner/runner.js';
import { writeState } from '../../src/runner/state.js';
import type { InsideState, OutsideState } from '../../src/runner/types.js';
import { validSystemOutput } from '../helpers/fixtures.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-run-snapshot-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

class NoSessionReadyAdapter implements IAgentAdapter {
  async run(_options: AgentRunOptions): Promise<AgentResult> {
    return {
      output: validSystemOutput(),
      sessionId: 'snapshot-session',
      status: 'completed',
      exitCode: 0,
      tokens: null,
    };
  }

  async compact(sessionId: string): Promise<AgentResult> {
    return {
      output: '',
      sessionId,
      status: 'completed',
      exitCode: 0,
      tokens: null,
    };
  }

  async terminate(sessionId: string): Promise<AgentResult> {
    return {
      output: '',
      sessionId,
      status: 'killed',
      exitCode: 143,
      tokens: null,
    };
  }
}

function createCoordinatedAgent(slug: string) {
  const agentDir = path.join(tmpDir, slug);
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(
    path.join(agentDir, 'prompt.md'),
    `---\ndescription: "${slug} agent"\ncoordination: enabled\n---\n\n# ${slug}\n`,
  );
  const definition = resolveAgent(slug, tmpDir);
  if (!definition) throw new Error(`expected ${slug} to resolve`);
  return definition;
}

describe('run-folder coordination snapshots', () => {
  it('writes empty lane snapshots and null state snapshots when files are absent', async () => {
    const definition = createCoordinatedAgent('empty-snapshot');

    const result = await runAgent(
      new NoSessionReadyAdapter(),
      definition,
      { slug: 'empty-snapshot' },
      undefined,
      tmpDir,
    );

    expect(result.metadata.result).toBe('completed');
    expect(
      fs.readFileSync(
        path.join(result.runDir, 'inbox-snapshot', 'outside.ndjson'),
        'utf8',
      ),
    ).toBe('');
    expect(
      fs.readFileSync(
        path.join(result.runDir, 'inbox-snapshot', 'inside.ndjson'),
        'utf8',
      ),
    ).toBe('');
    expect(
      JSON.parse(
        fs.readFileSync(
          path.join(result.runDir, 'state-snapshot.json'),
          'utf8',
        ),
      ),
    ).toEqual({ outside: null, inside: null });
  });

  it('copies inbox lanes byte-for-byte and snapshots present side states', async () => {
    const definition = createCoordinatedAgent('filled-snapshot');
    const outsideLane = inboxLanePath('filled-snapshot', tmpDir, 'outside');
    fs.mkdirSync(path.dirname(outsideLane), { recursive: true });
    fs.writeFileSync(outsideLane, 'not-json-but-preserved\n');
    const insideState: InsideState = {
      status: 'reviewing',
      data: { phase: 6 },
      updatedAt: '2026-04-26T00:00:00Z',
      updatedBy: 'inside',
    };
    const outsideState: OutsideState = {
      status: 'in-progress',
      data: { milestone: 'snapshot' },
      updatedAt: '2026-04-26T00:00:01Z',
      updatedBy: 'outside',
    };
    writeState('inside', 'filled-snapshot', tmpDir, insideState);
    writeState('outside', 'filled-snapshot', tmpDir, outsideState);

    const result = await runAgent(
      new NoSessionReadyAdapter(),
      definition,
      { slug: 'filled-snapshot' },
      undefined,
      tmpDir,
    );

    expect(result.metadata.result).toBe('completed');
    expect(
      fs.readFileSync(
        path.join(result.runDir, 'inbox-snapshot', 'outside.ndjson'),
        'utf8',
      ),
    ).toBe('not-json-but-preserved\n');
    expect(
      JSON.parse(
        fs.readFileSync(
          path.join(result.runDir, 'state-snapshot.json'),
          'utf8',
        ),
      ),
    ).toEqual({ outside: outsideState, inside: insideState });
    expect(result.metadata.artifacts).toEqual([
      'events.ndjson',
      'inbox-snapshot/inside.ndjson',
      'inbox-snapshot/outside.ndjson',
      'output/report.json',
      'prompt.md',
      'state-snapshot.json',
    ]);
  });

  it('fails finalization actionably for corrupt present state files', async () => {
    const definition = createCoordinatedAgent('corrupt-state');
    const outsideState = stateFilePath('corrupt-state', tmpDir, 'outside');
    fs.mkdirSync(path.dirname(outsideState), { recursive: true });
    fs.writeFileSync(outsideState, '{bad json');

    const result = await runAgent(
      new NoSessionReadyAdapter(),
      definition,
      { slug: 'corrupt-state' },
      undefined,
      tmpDir,
    );

    expect(result.metadata.result).toBe('failed');
    expect(result.agentResult.output).toContain('Run finalization failed');
    expect(result.agentResult.output).toContain('state file is corrupt');
  });
});
