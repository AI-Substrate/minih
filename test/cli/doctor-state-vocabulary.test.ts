import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { extractPromptStateValues } from '../../src/cli/commands/doctor.js';

let tmpDir: string;
let agentsDir: string;
const cliPath = path.resolve('dist/cli/index.js');

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-doctor-vocab-'));
  agentsDir = path.join(tmpDir, 'agents');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function run(args: string[]): { stdout: string; exitCode: number } {
  try {
    const stdout = execFileSync('node', [cliPath, ...args], {
      cwd: tmpDir,
      env: { ...process.env, FORCE_COLOR: undefined, NO_COLOR: '1' },
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { stdout, exitCode: 0 };
  } catch (error) {
    const err = error as { stdout?: Buffer | string; status?: number };
    return { stdout: String(err.stdout ?? ''), exitCode: err.status ?? 1 };
  }
}

interface AgentCheck {
  check: string;
  status: string;
  message?: string;
}

function checkFor(
  stdout: string,
  slug: string,
  checkName: string,
): AgentCheck | undefined {
  const envelope = JSON.parse(stdout);
  const agents = envelope.data?.agents ?? envelope.error?.details?.agents;
  const agent = agents.find((a: { slug: string }) => a.slug === slug);
  return agent?.checks?.find((c: AgentCheck) => c.check === checkName);
}

function writeAgent(
  slug: string,
  options: {
    coordinated?: boolean;
    promptBody?: string;
    insideStateSchema?: object | null;
  },
): void {
  const dir = path.join(agentsDir, slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'prompt.md'),
    `---\ndescription: "${slug}"\n${options.coordinated ? 'coordination: enabled\n' : ''}---\n\n# ${slug}\n\n${options.promptBody ?? ''}\n`,
  );
  if (
    options.insideStateSchema !== null &&
    options.insideStateSchema !== undefined
  ) {
    const stateDir = path.join(dir, 'state');
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(
      path.join(stateDir, 'inside-state.schema.json'),
      JSON.stringify(options.insideStateSchema, null, 2),
    );
  }
}

describe('extractPromptStateValues', () => {
  it('captures `state_transition status=X` pseudocode', () => {
    const values = extractPromptStateValues(
      "state_transition status='reading', reason='preparing'",
    );
    expect([...values].sort()).toEqual(['reading']);
  });

  it('captures `state_transition({to: X})` tool-call style', () => {
    const values = extractPromptStateValues(
      "state_transition({ to: 'blocked', reason: 'waiting' })",
    );
    expect([...values].sort()).toEqual(['blocked']);
  });

  it('captures `state_transition` with double quotes', () => {
    const values = extractPromptStateValues(
      'state_transition status="reporting"',
    );
    expect([...values].sort()).toEqual(['reporting']);
  });

  it('captures multiple distinct values across the prompt', () => {
    const prompt = `
state_transition status='idle'
state_transition status='reading'
state_transition({ to: 'reporting' })
state_set status='blocked'
`;
    const values = extractPromptStateValues(prompt);
    expect([...values].sort()).toEqual([
      'blocked',
      'idle',
      'reading',
      'reporting',
    ]);
  });

  it('does NOT capture `status: X` mentions outside state_transition/state_set', () => {
    const prompt = `
record \`status: 'fail'\` if the artifact is missing
the report has \`"status": "skip"\` for skipped checks
`;
    const values = extractPromptStateValues(prompt);
    expect(values.size).toBe(0);
  });

  it('captures table cells under "State Vocabulary" heading', () => {
    const prompt = `
## 3. State Vocabulary

| status | When |
|---|---|
| \`idle\` | Long-polling |
| \`reading\` | Just received a task |

## 4. Inbox Vocabulary

| type | Meaning |
|---|---|
| \`task\` | New review request |
| \`question\` | Clarification |
`;
    const values = extractPromptStateValues(prompt);
    expect([...values].sort()).toEqual(['idle', 'reading']);
  });

  it('does NOT capture table cells under non-state headings', () => {
    const prompt = `
## Inbox Types

| type |
|---|
| \`briefing\` |
| \`task\` |

## Severity

| level |
|---|
| \`critical\` |
`;
    const values = extractPromptStateValues(prompt);
    expect(values.size).toBe(0);
  });

  it('captures table cells under "State Machine" / "State Values" / "State Enum" headings', () => {
    const prompt = `
### State Machine
| status |
|---|
| \`alpha\` |

#### State values
| status |
|---|
| \`beta\` |

## State enum
| status |
|---|
| \`gamma\` |
`;
    const values = extractPromptStateValues(prompt);
    expect([...values].sort()).toEqual(['alpha', 'beta', 'gamma']);
  });
});

describe('doctor prompt-state-vocabulary-drift check', () => {
  it('warns when prompt mentions a state value not in the inside-state schema enum', () => {
    writeAgent('drifted', {
      coordinated: true,
      promptBody:
        "state_transition status='reading', reason='loading'\nstate_transition status='undeclared'",
      insideStateSchema: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['idle', 'reading'],
          },
        },
      },
    });

    const { stdout } = run(['doctor', '--agents-dir', agentsDir]);
    const check = checkFor(stdout, 'drifted', 'prompt-state-vocabulary-drift');

    expect(check?.status).toBe('warning');
    expect(check?.message).toContain("'undeclared'");
    expect(check?.message).toContain('silently rejected');
  });

  it('passes when every prompt-mentioned state value is in the schema enum', () => {
    writeAgent('aligned', {
      coordinated: true,
      promptBody:
        "state_transition status='idle'\nstate_transition status='reading'",
      insideStateSchema: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['idle', 'reading', 'reporting', 'blocked', 'stopping'],
          },
        },
      },
    });

    const { stdout } = run(['doctor', '--agents-dir', agentsDir]);
    const check = checkFor(stdout, 'aligned', 'prompt-state-vocabulary-drift');

    expect(check?.status).toBe('pass');
  });

  it('falls back to the default schema when no per-agent schema exists', () => {
    // Default enum is `idle | in-progress | paused | reviewing | complete | error`.
    // The prompt asks for `reading` which is NOT in the default — must warn.
    writeAgent('default-fallback', {
      coordinated: true,
      promptBody: "state_transition status='reading'",
      insideStateSchema: null,
    });

    const { stdout } = run(['doctor', '--agents-dir', agentsDir]);
    const check = checkFor(
      stdout,
      'default-fallback',
      'prompt-state-vocabulary-drift',
    );

    expect(check?.status).toBe('warning');
    expect(check?.message).toContain("'reading'");
  });

  it('skips the check entirely for non-coordinated agents', () => {
    writeAgent('one-shot', {
      coordinated: false,
      promptBody: "state_transition status='wat'",
      insideStateSchema: null,
    });

    const { stdout } = run(['doctor', '--agents-dir', agentsDir]);
    const check = checkFor(stdout, 'one-shot', 'prompt-state-vocabulary-drift');

    // Non-coordinated agents shouldn't have this check at all
    expect(check).toBeUndefined();
  });

  it('skips with a message when the schema has no status enum', () => {
    writeAgent('no-enum', {
      coordinated: true,
      promptBody: "state_transition status='whatever'",
      insideStateSchema: {
        type: 'object',
        properties: {
          status: { type: 'string' },
        },
      },
    });

    const { stdout } = run(['doctor', '--agents-dir', agentsDir]);
    const check = checkFor(stdout, 'no-enum', 'prompt-state-vocabulary-drift');

    expect(check?.status).toBe('skip');
    expect(check?.message).toContain('no `properties.status.enum`');
  });
});
