import { execSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let tmpDir: string;
const cliPath = path.resolve('dist/cli/index.js');

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-cli-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function run(
  args: string,
  env: Record<string, string | undefined> = {},
): { stdout: string; exitCode: number } {
  try {
    const stdout = execSync(`node ${cliPath} ${args}`, {
      cwd: tmpDir,
      env: { ...process.env, NO_COLOR: '1', ...env },
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { stdout, exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; status?: number };
    return { stdout: e.stdout ?? '', exitCode: e.status ?? 1 };
  }
}

function runArgs(args: string[]): {
  stdout: string;
  stderr: string;
  exitCode: number;
} {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: tmpDir,
    env: { ...process.env, NO_COLOR: '1' },
    encoding: 'utf-8',
  });
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.status ?? 0,
  };
}

describe('CLI commands', () => {
  it('root help lists outside coordination commands', () => {
    const help = execSync(`node ${cliPath} --help`, {
      cwd: tmpDir,
      env: { ...process.env, NO_COLOR: '1' },
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    for (const command of [
      'outside-send',
      'outside-inbox-list',
      'state',
      'outside-context',
      'outside-retro',
      'retros',
    ]) {
      expect(help).toContain(command);
    }
  });

  it('init scaffolds files and preamble', () => {
    const { stdout, exitCode } = run(`init demo --agents-dir ${tmpDir}`);
    expect(exitCode).toBe(0);

    const env = JSON.parse(stdout);
    expect(env.status).toBe('ok');
    expect(env.data.files).toContain('prompt.md');
    expect(env.data.files).toContain('output-schema.json');
    expect(env.data.files).toContain('instructions.md');
    expect(env.data.preambleCreated).toBe(true);

    // Verify files exist
    expect(fs.existsSync(path.join(tmpDir, 'demo', 'prompt.md'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'demo', 'output-schema.json'))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(tmpDir, '_shared', 'preamble.md'))).toBe(
      true,
    );
    const scaffoldedPreamble = fs.readFileSync(
      path.join(tmpDir, '_shared', 'preamble.md'),
      'utf-8',
    );
    const canonicalPreamble = fs.readFileSync(
      path.resolve('src/templates/shared-preamble.md'),
      'utf-8',
    );
    expect(scaffoldedPreamble).toBe(canonicalPreamble);
    expect(
      fs.readFileSync(path.resolve('agents/_shared/preamble.md'), 'utf-8'),
    ).toBe(canonicalPreamble);

    // Verify frontmatter in prompt
    const prompt = fs.readFileSync(
      path.join(tmpDir, 'demo', 'prompt.md'),
      'utf-8',
    );
    expect(prompt).toContain('description:');
    expect(prompt).not.toContain('coordination: enabled');
    expect(env.data.files).not.toContain('outside.md');
    expect(
      fs.existsSync(path.join(tmpDir, 'demo', 'inside-state.schema.json')),
    ).toBe(false);
  });

  it('init rejects existing agent', () => {
    run(`init demo --agents-dir ${tmpDir}`);
    const { exitCode, stdout } = run(`init demo --agents-dir ${tmpDir}`);
    expect(exitCode).toBe(1);
    expect(JSON.parse(stdout).error.code).toBe('E130');
  });

  it('doctor reports per-agent checks', () => {
    // Create an agent
    run(`init myagent --agents-dir ${tmpDir}`);

    const { stdout, exitCode } = run(`doctor --agents-dir ${tmpDir}`);
    expect(exitCode).toBe(0);

    const env = JSON.parse(stdout);
    expect(env.data.summary.total).toBe(1);
    expect(env.data.agents[0].slug).toBe('myagent');
    expect(
      env.data.agents[0].checks.find(
        (c: { check: string }) => c.check === 'frontmatter',
      ).status,
    ).toBe('pass'); // init template has a TODO description — still counts as present
  });

  it('check validates system output', () => {
    run(`init checker --agents-dir ${tmpDir}`);
    const outputDir = path.join(tmpDir, 'checker', 'test-output');
    fs.mkdirSync(outputDir, { recursive: true });
    const outputFile = path.join(outputDir, 'report.json');
    fs.writeFileSync(
      outputFile,
      JSON.stringify({
        result: {},
        summary: 'This is a valid test summary that is long enough to pass.',
        retrospective: {
          workedWell: 'Everything worked well in this test.',
          confusing: 'Nothing was confusing here.',
          magicWand: 'I wish the tests ran even faster than they already do.',
        },
      }),
    );

    const { stdout, exitCode } = run(
      `check checker --file ${outputFile} --agents-dir ${tmpDir}`,
    );
    expect(exitCode).toBe(0);
    const env = JSON.parse(stdout);
    expect(env.data.valid).toBe(true);
    expect(env.data.systemValid).toBe(true);
  });

  it('check accepts coordination retrospective fields', () => {
    run(`init checker-coordination --agents-dir ${tmpDir}`);
    const outputDir = path.join(tmpDir, 'checker-coordination', 'test-output');
    fs.mkdirSync(outputDir, { recursive: true });
    const outputFile = path.join(outputDir, 'report.json');
    fs.writeFileSync(
      outputFile,
      JSON.stringify({
        result: {},
        summary:
          'This is a valid coordinated test summary that is long enough.',
        retrospective: {
          workedWell: 'The coordination fields were accepted by check.',
          confusing: 'Nothing was confusing in this test.',
          magicWand: 'Make coordination feedback easier to inspect in history.',
          magicWandTarget: 'coordination',
          coordination: {
            peerUpdatesSent: 1,
            unresolvedPeerRequests: 0,
            statePublished: true,
          },
        },
      }),
    );

    const { stdout, exitCode } = run(
      `check checker-coordination --file ${outputFile} --agents-dir ${tmpDir}`,
    );
    expect(exitCode).toBe(0);
    const env = JSON.parse(stdout);
    expect(env.data.valid).toBe(true);
    expect(env.data.systemValid).toBe(true);
  });

  it('check --input does not apply system validation', () => {
    run(`init inputtest --with-input --agents-dir ${tmpDir}`);
    const inputFile = path.join(tmpDir, 'input.json');
    fs.writeFileSync(inputFile, '{}');

    const { stdout, exitCode } = run(
      `check inputtest --input --file ${inputFile} --agents-dir ${tmpDir}`,
    );
    expect(exitCode).toBe(0);
    const env = JSON.parse(stdout);
    // System validation should be null in input mode
    expect(env.data.systemValid).toBeNull();
  });

  it('check rejects nonexistent agent', () => {
    const { exitCode, stdout } = run(
      `check nonexistent --file /tmp/x.json --agents-dir ${tmpDir}`,
    );
    expect(exitCode).toBe(1);
    expect(JSON.parse(stdout).error.code).toBe('E121');
  });

  it('check --run returns a friendly file-vs-run validation error', () => {
    const { exitCode, stdout } = run(
      `check checker --run run-1 --agents-dir ${tmpDir}`,
    );

    expect(exitCode).toBe(1);
    const env = JSON.parse(stdout);
    expect(env.error.code).toBe('E108');
    expect(env.error.message).toContain('check` validates files');
    expect(env.error.message).toContain('minih validate <slug> --run <runId>');
    expect(env.error.message).toContain('minih check <slug> --file <path>');
  });

  it('check and validate help distinguish file validation from run validation', () => {
    const checkHelp = execSync(`node ${cliPath} check --help`, {
      cwd: tmpDir,
      env: { ...process.env, NO_COLOR: '1' },
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const validateHelp = execSync(`node ${cliPath} validate --help`, {
      cwd: tmpDir,
      env: { ...process.env, NO_COLOR: '1' },
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    expect(checkHelp).toContain('Validate an explicit file');
    expect(checkHelp).toContain('--file <path>');
    expect(checkHelp).not.toContain('--run <runId>');
    expect(validateHelp).toContain('completed run output');
    expect(validateHelp).toContain('--run <runId>');
  });

  it('tail snapshot honors --lines and exits without following', () => {
    run(`init tailer --agents-dir ${tmpDir}`);
    const runDir = path.join(tmpDir, 'tailer', 'runs', 'run-1');
    fs.mkdirSync(runDir, { recursive: true });
    const events = [
      textDeltaEvent('event-1'),
      textDeltaEvent('event-2'),
      textDeltaEvent('event-3'),
    ];
    fs.writeFileSync(
      path.join(runDir, 'events.ndjson'),
      `${events.map((event) => JSON.stringify(event)).join('\n')}\n`,
    );
    fs.writeFileSync(
      path.join(runDir, 'completed.json'),
      JSON.stringify({
        result: 'completed',
        durationMs: 1234,
        eventCount: 3,
        toolCallCount: 0,
        validated: true,
      }),
    );

    const { exitCode, stderr } = runArgs([
      'tail',
      'tailer',
      '--run',
      'run-1',
      '--lines',
      '2',
      '--snapshot',
      '--agents-dir',
      tmpDir,
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).toContain('snapshot');
    expect(stderr).toContain('event-2');
    expect(stderr).toContain('event-3');
    expect(stderr).not.toContain('event-1');
    expect(stderr).toContain('Run Complete');
  });

  it('dry-run works without GH_TOKEN', () => {
    // Create agent to dry-run against
    run(`init drytest --agents-dir ${tmpDir}`);

    const result = execSync(
      `node ${cliPath} run drytest --dry-run --agents-dir ${tmpDir}`,
      {
        cwd: tmpDir,
        env: {
          ...process.env,
          GH_TOKEN: undefined,
          NO_COLOR: '1',
        },
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );

    const env = JSON.parse(result);
    expect(env.status).toBe('ok');
    expect(env.data.dryRun).toBe(true);
    expect(env.data.prompt).toContain('## Required Output Format');
    expect(env.data.parts).toContain('SYSTEM REQUIREMENTS');
    expect(env.data.parts).toContain('PROMPT');
  });

  it.each([
    ['run', 'run demo'],
    ['resume', 'resume demo "hello"'],
    ['quickstart', 'quickstart'],
    ['tail', 'tail demo'],
    ['init', 'init demo'],
  ])('%s is blocked inside a minih session', (command, args) => {
    const { stdout, exitCode } = run(`${args} --agents-dir ${tmpDir}`, {
      MINIH: '1',
    });

    expect(exitCode).toBe(1);
    const env = JSON.parse(stdout);
    expect(env.command).toBe(command);
    expect(env.status).toBe('error');
    expect(env.error.code).toBe('E128');
    expect(env.error.details.context).toBe('inside');
  });
});

function textDeltaEvent(content: string) {
  return {
    type: 'text_delta',
    timestamp: '2026-04-26T00:00:00Z',
    data: { content },
  };
}
