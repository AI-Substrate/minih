import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FakeAgentAdapter } from '../../src/adapter/index.js';
import { resolveAgent, runAgent } from '../../src/runner/index.js';
import { validSystemOutput } from '../helpers/fixtures.js';

const regressionDescribe =
  process.env.MINIH_REGRESSION === '1' ? describe : describe.skip;

const repoRoot = path.resolve('.');
const cliPath = path.join(repoRoot, 'dist/cli/index.js');
const baselineDir = path.join(
  repoRoot,
  'docs/plans/007-backgrounding/tasks/phase-1-runner-foundations/baselines',
);
const ignoredKeys = new Set([
  'timestamp',
  'ts',
  'runId',
  'sessionId',
  'duration',
  'startedAt',
  'completedAt',
  'runDir',
]);

function stripTransientKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripTransientKeys);
  }
  if (value && typeof value === 'object') {
    const stripped: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      if (!ignoredKeys.has(key)) {
        stripped[key] = stripTransientKeys(nestedValue);
      }
    }
    return stripped;
  }
  return value;
}

function firstDifferencePath(
  expected: unknown,
  actual: unknown,
  currentPath = '$',
): string | null {
  if (Object.is(expected, actual)) {
    return null;
  }
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) {
      return currentPath;
    }
    if (expected.length !== actual.length) {
      return `${currentPath}.length`;
    }
    for (let index = 0; index < expected.length; index++) {
      const child = firstDifferencePath(
        expected[index],
        actual[index],
        `${currentPath}[${index}]`,
      );
      if (child) {
        return child;
      }
    }
    return null;
  }
  if (
    expected &&
    actual &&
    typeof expected === 'object' &&
    typeof actual === 'object'
  ) {
    const expectedKeys = Object.keys(expected).sort();
    const actualKeys = Object.keys(actual).sort();
    if (expectedKeys.join('\0') !== actualKeys.join('\0')) {
      return `${currentPath}.{keys}`;
    }
    for (const key of expectedKeys) {
      const child = firstDifferencePath(
        (expected as Record<string, unknown>)[key],
        (actual as Record<string, unknown>)[key],
        `${currentPath}.${key}`,
      );
      if (child) {
        return child;
      }
    }
    return null;
  }
  return currentPath;
}

function runCli(command: 'doctor' | 'list'): unknown {
  const result = spawnSync(process.execPath, [cliPath, command], {
    cwd: repoRoot,
    env: { ...process.env, FORCE_COLOR: undefined, NO_COLOR: '1' },
    encoding: 'utf-8',
  });

  if (result.status !== 0) {
    throw new Error(
      `minih ${command} failed with exit ${result.status ?? 'null'}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    );
  }
  return JSON.parse(result.stdout);
}

function loadBaseline(command: 'doctor' | 'list'): unknown {
  return JSON.parse(
    fs.readFileSync(path.join(baselineDir, `${command}.json`), 'utf-8'),
  );
}

function createRepresentativeAgentsDir(): string {
  const agentsDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'minih-regression-agents-'),
  );
  fs.cpSync(
    path.join(repoRoot, 'agents/_shared'),
    path.join(agentsDir, '_shared'),
    { recursive: true },
  );
  fs.cpSync(
    path.join(repoRoot, 'agents/hello-world'),
    path.join(agentsDir, 'hello-world'),
    {
      recursive: true,
      filter: (source) => !source.split(path.sep).includes('runs'),
    },
  );
  return agentsDir;
}

regressionDescribe('existing agents backward compatibility', () => {
  it.each([
    'doctor',
    'list',
  ] as const)('matches the P1 %s baseline after stripping transient keys', (command) => {
    const expected = stripTransientKeys(loadBaseline(command));
    const actual = stripTransientKeys(runCli(command));
    const firstDiff = firstDifferencePath(expected, actual);

    expect(
      actual,
      firstDiff
        ? `${command}.json differs from the P1 baseline at ${firstDiff}`
        : undefined,
    ).toEqual(expected);
  });

  it('preserves a representative run-path report shape', async () => {
    const agentsDir = createRepresentativeAgentsDir();
    try {
      const definition = resolveAgent('hello-world', agentsDir);
      expect(definition).not.toBeNull();
      if (!definition) throw new Error('expected hello-world to resolve');

      const output = validSystemOutput({
        environment: { agent: 'hello-world', mode: 'regression' },
      });
      const fake = new FakeAgentAdapter({ output });
      const result = await runAgent(
        fake,
        definition,
        { slug: 'hello-world', cwd: repoRoot, model: 'regression-model' },
        undefined,
        agentsDir,
      );

      const report = JSON.parse(
        fs.readFileSync(
          path.join(result.runDir, 'output/report.json'),
          'utf-8',
        ),
      );

      expect(result.metadata.result).toBe('completed');
      expect(result.metadata.systemValidated).toBe(true);
      expect(stripTransientKeys(report)).toEqual(
        stripTransientKeys(JSON.parse(output)),
      );
    } finally {
      fs.rmSync(agentsDir, { recursive: true, force: true });
    }
  });
});
