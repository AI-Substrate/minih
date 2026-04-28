import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';

const cliPath = path.resolve('dist/cli/index.js');
const agentDir = path.resolve('agents/coordination-loop-validator');
const schemaFiles = [
  'output-schema.json',
  'inside-state.schema.json',
  'outside-state.schema.json',
] as const;

interface Envelope {
  data: Record<string, unknown>;
}

interface DoctorAgent {
  slug: string;
  checks: Array<{ check: string; status: string }>;
}

function run(args: string[]): { stdout: string; exitCode: number } {
  try {
    const stdout = execFileSync('node', [cliPath, ...args], {
      cwd: path.resolve('.'),
      env: { ...process.env, GH_TOKEN: undefined, NO_COLOR: '1' },
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { stdout, exitCode: 0 };
  } catch (error) {
    const err = error as { stdout?: Buffer | string; status?: number };
    return { stdout: String(err.stdout ?? ''), exitCode: err.status ?? 1 };
  }
}

function parseEnvelope(stdout: string): Envelope {
  return JSON.parse(stdout) as Envelope;
}

function makeAjv(): Ajv2020 {
  const ajv = new Ajv2020({ allErrors: true });
  addFormats(ajv);
  return ajv;
}

describe('coordination-loop-validator worked example', () => {
  it('is discoverable and has no doctor failures', () => {
    const result = run(['doctor']);
    expect(result.exitCode).toBe(0);

    const envelope = parseEnvelope(result.stdout);
    const agents = (envelope.data.agents ??
      envelope.data.agentResults) as DoctorAgent[];
    const agent = agents.find(
      (candidate) => candidate.slug === 'coordination-loop-validator',
    );

    expect(agent).toBeTruthy();
    if (!agent) throw new Error('coordination-loop-validator missing');
    expect(agent.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ check: 'prompt.md', status: 'pass' }),
        expect.objectContaining({ check: 'frontmatter', status: 'pass' }),
        expect.objectContaining({ check: 'output-schema', status: 'pass' }),
        expect.objectContaining({ check: 'outside.md', status: 'pass' }),
      ]),
    );
    expect(agent.checks.filter((check) => check.status === 'fail')).toEqual([]);
  });

  it('exposes the canonical outside runbook through outside-context', () => {
    const result = run(['outside-context', 'coordination-loop-validator']);
    expect(result.exitCode).toBe(0);

    const envelope = parseEnvelope(result.stdout);
    expect(envelope.data.contractStatus).toBe('present');
    const context = envelope.data.context as string;
    expect(context).toContain(
      'minih run coordination-loop-validator --timeout 900',
    );
    expect(context).toContain('minih status coordination-loop-validator');
    expect(context).toContain('minih tail coordination-loop-validator');
    expect(context).toContain(
      'minih tail coordination-loop-validator --run "$RUN_ID" --lines 20 --snapshot',
    );
    expect(context).toContain('area-1 ready for validation');
    expect(context).toContain('area-2 ready for validation');
    expect(context).toContain('area-3 ready for validation');
    expect(context).toContain('--status in-progress');
    expect(context).toContain('--status done');
    expect(context).not.toContain('--status milestone-ready');
  });

  it('dry-runs with coordinated prompt, peer contract, and bounded waiting', () => {
    const result = run(['run', 'coordination-loop-validator', '--dry-run']);
    expect(result.exitCode).toBe(0);

    const envelope = parseEnvelope(result.stdout);
    const parts = envelope.data.parts as string[];
    const prompt = envelope.data.prompt as string;
    expect(parts).toContain('COORDINATION');
    expect(prompt).toContain('## Your Context (coordination)');
    expect(prompt).toContain("## Peer's Contract (from outside.md)");
    expect(prompt).toContain('minih tail coordination-loop-validator');
    expect(prompt).toContain('waitForAny: ["milestone", "complete", "cancel"]');
    expect(prompt).toContain(
      'minih check coordination-loop-validator --file <literal-output-path>',
    );
    expect(prompt).toContain('Bounded waiting');
    expect(prompt).toContain('not the quality of source code');
  });

  it.each(schemaFiles)('%s parses and compiles as JSON Schema', (file) => {
    const schema = JSON.parse(
      fs.readFileSync(path.join(agentDir, file), 'utf8'),
    );
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(() => makeAjv().compile(schema)).not.toThrow();
  });

  it('keeps workflow vocabulary out of state status enums', () => {
    const outsideSchema = JSON.parse(
      fs.readFileSync(path.join(agentDir, 'outside-state.schema.json'), 'utf8'),
    );
    const insideSchema = JSON.parse(
      fs.readFileSync(path.join(agentDir, 'inside-state.schema.json'), 'utf8'),
    );

    expect(outsideSchema.properties.status.enum).toEqual([
      'idle',
      'in-progress',
      'paused',
      'done',
      'error',
    ]);
    expect(insideSchema.properties.status.enum).toEqual([
      'idle',
      'in-progress',
      'paused',
      'reviewing',
      'complete',
      'error',
    ]);
    expect(outsideSchema.properties.status.enum).not.toContain(
      'milestone-ready',
    );
    expect(insideSchema.properties.status.enum).not.toContain(
      'waiting-for-milestone',
    );
  });
});
