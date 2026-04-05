import { execSync } from 'node:child_process';
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

function run(args: string): { stdout: string; exitCode: number } {
  try {
    const stdout = execSync(`node ${cliPath} ${args}`, {
      cwd: tmpDir,
      env: { ...process.env, NO_COLOR: '1' },
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { stdout, exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; status?: number };
    return { stdout: e.stdout ?? '', exitCode: e.status ?? 1 };
  }
}

describe('CLI commands', () => {
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

    // Verify frontmatter in prompt
    const prompt = fs.readFileSync(
      path.join(tmpDir, 'demo', 'prompt.md'),
      'utf-8',
    );
    expect(prompt).toContain('description:');
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
    expect(env.data.parts).toContain('SYSTEM REQUIREMENTS');
    expect(env.data.parts).toContain('PROMPT');
  });
});
