import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * Plan 027 Phase 6 — T004/T005. Sensor B: `contract-phrase-drift`. Mirrors
 * `doctor-state-vocabulary.test.ts` (spawns the built CLI, reads the JSON
 * envelope). Guards three PACK-INTERNAL contract phrases that this phase
 * reconciled, returning 'fail' on drift (promoted from 'warning'):
 *   1. exit-reason vocabulary — `no_engagement` parity between prompt + enum
 *   2. findings-home wording   — live `inbox_send type:'finding'` + `findings[]`
 *   3. state-vocab description — not reverted to the stale "not yet enforced"
 *
 * Tool-count / cross-doc prose are NOT scanned here (recon row 5) — they are
 * deterministic file edits (T006/T007) verified by this doctor pass.
 */

let tmpDir: string;
let agentsDir: string;
const cliPath = path.resolve('dist/cli/index.js');

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-doctor-contract-'));
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

const FULL_EXIT_ENUM = [
  'stop_requested',
  'idle_budget',
  'no_engagement',
  'timeout',
  'error',
];
const ENFORCED_DESC =
  'Lifecycle status. The minih MCP runtime validates every state_transition against this enum: an out-of-enum status is rejected with MCP_INVALID_ARGUMENT.';
// Documents no_engagement (parity with the enum) AND the findings-home contract.
const CLEAN_BODY = [
  'On the run-timeout backstop the runner farewells `no_engagement`.',
  'Other exits: `stop_requested`, `idle_budget`, `timeout`, `error`.',
  '',
  "As findings emerge, send one `inbox_send({ type: 'finding', ackOf: task.id })`",
  'per finding. The envelope `findings[]` mirrors what you sent inbox-style.',
].join('\n');

function writeCompanionFixture(
  slug: string,
  opts: { promptBody?: string; exitEnum?: string[]; statusDesc?: string } = {},
): void {
  const dir = path.join(agentsDir, slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'prompt.md'),
    `---\ndescription: "${slug}"\ncoordination: enabled\n---\n\n# ${slug}\n\n${opts.promptBody ?? CLEAN_BODY}\n`,
  );
  fs.writeFileSync(
    path.join(dir, 'output-schema.json'),
    JSON.stringify(
      {
        type: 'object',
        properties: {
          session: {
            type: 'object',
            properties: {
              exitReason: {
                type: 'string',
                enum: opts.exitEnum ?? FULL_EXIT_ENUM,
              },
            },
          },
          findings: { type: 'array', items: { type: 'object' } },
        },
      },
      null,
      2,
    ),
  );
  // PIC-1: the per-pack inside-state schema lives at the agent ROOT.
  fs.writeFileSync(
    path.join(dir, 'inside-state.schema.json'),
    JSON.stringify(
      {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['idle', 'reading', 'reviewing', 'reporting', 'blocked'],
            description: opts.statusDesc ?? ENFORCED_DESC,
          },
        },
      },
      null,
      2,
    ),
  );
}

describe('doctor contract-phrase-drift check (Sensor B)', () => {
  it('passes for a clean companion-shaped fixture', () => {
    writeCompanionFixture('clean');
    const { stdout } = run(['doctor', '--agents-dir', agentsDir]);
    expect(checkFor(stdout, 'clean', 'contract-phrase-drift')?.status).toBe(
      'pass',
    );
  });

  it("FAILS when output-schema's exitReason enum drops no_engagement while the prompt still documents it", () => {
    writeCompanionFixture('enum-drift', {
      exitEnum: ['stop_requested', 'idle_budget', 'timeout', 'error'],
    });
    const { stdout, exitCode } = run(['doctor', '--agents-dir', agentsDir]);
    const c = checkFor(stdout, 'enum-drift', 'contract-phrase-drift');
    expect(c?.status).toBe('fail');
    expect(c?.message).toContain('no_engagement');
    expect(exitCode).not.toBe(0); // a 'fail' check → non-zero doctor exit
  });

  it('FAILS when the prompt drops the findings-home contract wording', () => {
    writeCompanionFixture('findings-drift', {
      promptBody:
        'On the run-timeout backstop the runner farewells `no_engagement`. Other exits: `stop_requested`, `idle_budget`, `timeout`, `error`.',
    });
    const { stdout } = run(['doctor', '--agents-dir', agentsDir]);
    const c = checkFor(stdout, 'findings-drift', 'contract-phrase-drift');
    expect(c?.status).toBe('fail');
    expect(c?.message).toContain('findings-home');
  });

  it('FAILS when the inside-state schema description reverts to "not yet enforced"', () => {
    writeCompanionFixture('desc-drift', {
      statusDesc: 'Lifecycle status. Validation is not yet enforced.',
    });
    const { stdout } = run(['doctor', '--agents-dir', agentsDir]);
    const c = checkFor(stdout, 'desc-drift', 'contract-phrase-drift');
    expect(c?.status).toBe('fail');
    expect(c?.message).toContain('not yet enforced');
  });

  it('passes for the real shipped code-review-companion pack (Sensor B green today)', () => {
    // Pin the REAL pack: doctor must report no contract-phrase drift for
    // code-review-companion, resolving its schema at the agent root (PIC-1).
    // RED the moment the prompt, output-schema enum, or schema description drift.
    const realAgentsDir = path.resolve('agents');
    const { stdout } = run(['doctor', '--agents-dir', realAgentsDir]);
    expect(
      checkFor(stdout, 'code-review-companion', 'contract-phrase-drift')
        ?.status,
    ).toBe('pass');
  });
});
