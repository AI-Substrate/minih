import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { inboxLanePath } from '../../src/runner/folder.js';
import type { InboxMessage } from '../../src/runner/types.js';

let tmpDir: string;
let agentsDir: string;
const cliPath = path.resolve('dist/cli/index.js');

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-retros-'));
  agentsDir = path.join(tmpDir, 'agents');
  writeAgent('demo');
  writeAgent('other');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function run(args: string[]): { stdout: string; exitCode: number } {
  try {
    const stdout = execFileSync('node', [cliPath, ...args], {
      cwd: tmpDir,
      env: { ...process.env, NO_COLOR: '1' },
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { stdout, exitCode: 0 };
  } catch (error) {
    const err = error as { stdout?: Buffer | string; status?: number };
    return { stdout: String(err.stdout ?? ''), exitCode: err.status ?? 1 };
  }
}

function writeAgent(slug: string): void {
  const dir = path.join(agentsDir, slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'prompt.md'),
    `---
description: "${slug} agent"
tags: []
---

# ${slug}
`,
  );
}

function writeCompletedReport(
  slug: string,
  runId: string,
  retrospective: Record<string, unknown>,
): void {
  const runDir = path.join(agentsDir, slug, 'runs', runId);
  fs.mkdirSync(path.join(runDir, 'output'), { recursive: true });
  fs.writeFileSync(
    path.join(runDir, 'completed.json'),
    JSON.stringify({ result: 'completed' }),
  );
  fs.writeFileSync(
    path.join(runDir, 'output', 'report.json'),
    JSON.stringify({ retrospective }),
  );
}

function writeOutsideMessage(slug: string, message: InboxMessage): void {
  const filePath = inboxLanePath(slug, agentsDir, 'outside');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(message)}\n`);
}

function retroMessage(
  id: string,
  body: string,
  target: string | null,
): InboxMessage {
  return {
    id,
    sender: 'outside',
    type: 'retro',
    subject: 'outside session retro',
    body,
    ts: '2026-04-26T00:00:00.000Z',
    ...(target && { meta: { magicWandTarget: target } }),
  };
}

describe('retros', () => {
  it('aggregates inside reports and outside retro messages', () => {
    writeCompletedReport('demo', 'run-1', {
      workedWell: 'Inside worked well.',
      confusing: 'Inside was clear.',
      magicWand: 'Give me better coordination visibility.',
      magicWandTarget: 'minih',
    });
    writeOutsideMessage(
      'demo',
      retroMessage(
        '01ARZ3NDEKTSV4RRFFQ69G5FAV',
        'Outside wants clearer state.',
        'coordination',
      ),
    );

    const { stdout, exitCode } = run(['retros', '--agents-dir', agentsDir]);

    expect(exitCode).toBe(0);
    const entries = JSON.parse(stdout).data.entries;
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          agent: 'demo',
          side: 'inside',
          target: 'minih',
          magicWand: 'Give me better coordination visibility.',
        }),
        expect.objectContaining({
          agent: 'demo',
          side: 'outside',
          target: 'coordination',
          body: 'Outside wants clearer state.',
        }),
      ]),
    );
  });

  it('applies agent, side, and target filters', () => {
    writeCompletedReport('demo', 'run-1', {
      workedWell: 'Inside worked well.',
      confusing: 'Inside was clear.',
      magicWand: 'Old targetless inside report still appears without target.',
    });
    writeOutsideMessage(
      'demo',
      retroMessage(
        '01ARZ3NDEKTSV4RRFFQ69G5FAW',
        'Project outside feedback.',
        'project',
      ),
    );
    writeOutsideMessage(
      'other',
      retroMessage(
        '01ARZ3NDEKTSV4RRFFQ69G5FAX',
        'Other coordination feedback.',
        'coordination',
      ),
    );

    const outsideProject = JSON.parse(
      run([
        'retros',
        '--agent',
        'demo',
        '--side',
        'outside',
        '--target',
        'project',
        '--agents-dir',
        agentsDir,
      ]).stdout,
    ).data.entries;
    expect(outsideProject).toEqual([
      expect.objectContaining({
        agent: 'demo',
        side: 'outside',
        target: 'project',
      }),
    ]);

    const targetlessExcluded = JSON.parse(
      run([
        'retros',
        '--agent',
        'demo',
        '--target',
        'coordination',
        '--agents-dir',
        agentsDir,
      ]).stdout,
    ).data.entries;
    expect(targetlessExcluded).toEqual([]);
  });

  it('fails on corrupt outside retro lanes instead of swallowing them', () => {
    const filePath = inboxLanePath('demo', agentsDir, 'outside');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, '{"id":');

    const result = run([
      'retros',
      '--agent',
      'demo',
      '--agents-dir',
      agentsDir,
    ]);

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout).error.code).toBe('E124');
  });
});
