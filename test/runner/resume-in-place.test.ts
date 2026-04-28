/**
 * T013 + T014 (Plan 010 HF-003) — Resume-in-place runner branch.
 *
 * When `config.resumeInPlace === true` and `config.resumedFromRunId` points
 * at an existing run dir, runAgent must:
 *   1. Skip `createRunFolder` — reuse the original runDir.
 *   2. Mutate run.json: update pid + status='active' + append resumes[].
 *   3. If completed.json present, rename → completed-N.json (N = resumes.length).
 *   4. Append synthetic `{type: 'resume'}` event to events.ndjson (do not truncate).
 *   5. MCP env vars (MINIH_INBOX_DIR, MINIH_STATE_DIR, MINIH_RUN_ID, MINIH_RUN_DIR)
 *      bind to the original runDir.
 *
 * Workshop 001 § What changes vs today + § Manifest Evolution.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeAgentAdapter } from '../../src/adapter/index.js';
import { resolveAgent } from '../../src/runner/folder.js';
import { runAgent } from '../../src/runner/runner.js';
import { validSystemOutput } from '../helpers/fixtures.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-resume-place-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function createSimpleAgent(slug: string) {
  const agentDir = path.join(tmpDir, slug);
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(
    path.join(agentDir, 'prompt.md'),
    `---\ndescription: "Test"\n---\n\n# ${slug}\n\nDo the thing.`,
  );
  fs.writeFileSync(
    path.join(agentDir, 'output-schema.json'),
    JSON.stringify({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      required: ['result'],
      properties: { result: { type: 'string' } },
    }),
  );
  const def = resolveAgent(slug, tmpDir);
  if (!def) throw new Error(`expected agent ${slug} to resolve`);
  return def;
}

describe('runAgent resume-in-place', () => {
  it('reuses original runDir when resumeInPlace=true + resumedFromRunId', async () => {
    const def = createSimpleAgent('rip-reuse');

    // First run — creates the run dir.
    const fake1 = new FakeAgentAdapter({ output: validSystemOutput() });
    const first = await runAgent(
      fake1,
      def,
      { slug: 'rip-reuse' },
      undefined,
      tmpDir,
    );
    expect(fs.existsSync(first.runDir)).toBe(true);
    const originalRunId = first.metadata.runId;

    // Resume in place — must reuse the same runDir.
    const fake2 = new FakeAgentAdapter({ output: validSystemOutput() });
    const second = await runAgent(
      fake2,
      def,
      {
        slug: 'rip-reuse',
        sessionId: first.metadata.sessionId,
        resumedFromRunId: originalRunId,
        resumeInPlace: true,
        promptOverride: 'follow-up',
      },
      undefined,
      tmpDir,
    );

    expect(second.metadata.runId).toBe(originalRunId);
    expect(second.runDir).toBe(first.runDir);

    // No second run dir was created under runs/.
    const runsDir = path.join(tmpDir, 'rip-reuse', 'runs');
    const entries = fs.readdirSync(runsDir);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toBe(originalRunId);
  });

  it('appends resumes[] to run.json with previousPid + fromState', async () => {
    const def = createSimpleAgent('rip-manifest');

    const fake1 = new FakeAgentAdapter({ output: validSystemOutput() });
    const first = await runAgent(
      fake1,
      def,
      { slug: 'rip-manifest' },
      undefined,
      tmpDir,
    );

    // Read the first manifest to capture pid that should land in previousPid.
    const firstManifest = JSON.parse(
      fs.readFileSync(path.join(first.runDir, 'run.json'), 'utf8'),
    );
    expect(firstManifest.pid).toBe(process.pid);

    const fake2 = new FakeAgentAdapter({ output: validSystemOutput() });
    await runAgent(
      fake2,
      def,
      {
        slug: 'rip-manifest',
        sessionId: first.metadata.sessionId,
        resumedFromRunId: first.metadata.runId,
        resumeInPlace: true,
        resumeFromState: 'completed',
        resumePreviousPid: firstManifest.pid,
        promptOverride: 'follow-up',
      },
      undefined,
      tmpDir,
    );

    const after = JSON.parse(
      fs.readFileSync(path.join(first.runDir, 'run.json'), 'utf8'),
    );
    expect(Array.isArray(after.resumes)).toBe(true);
    expect(after.resumes).toHaveLength(1);
    expect(after.resumes[0]).toMatchObject({
      fromState: 'completed',
      previousPid: firstManifest.pid,
    });
    expect(typeof after.resumes[0].ts).toBe('string');
  });

  it('renames completed.json -> completed-1.json on first resume', async () => {
    const def = createSimpleAgent('rip-rename');

    const fake1 = new FakeAgentAdapter({ output: validSystemOutput() });
    const first = await runAgent(
      fake1,
      def,
      { slug: 'rip-rename' },
      undefined,
      tmpDir,
    );

    const completedPath = path.join(first.runDir, 'completed.json');
    expect(fs.existsSync(completedPath)).toBe(true);

    const fake2 = new FakeAgentAdapter({ output: validSystemOutput() });
    await runAgent(
      fake2,
      def,
      {
        slug: 'rip-rename',
        sessionId: first.metadata.sessionId,
        resumedFromRunId: first.metadata.runId,
        resumeInPlace: true,
        promptOverride: 'follow-up',
      },
      undefined,
      tmpDir,
    );

    // Original completed.json was renamed before the new completion was written;
    // the new run wrote a fresh completed.json at the end. So both files exist.
    expect(fs.existsSync(path.join(first.runDir, 'completed-1.json'))).toBe(
      true,
    );
    expect(fs.existsSync(completedPath)).toBe(true);
  });

  it('appends to events.ndjson without truncating prior events', async () => {
    const def = createSimpleAgent('rip-events');

    const fake1 = new FakeAgentAdapter({ output: validSystemOutput() });
    const first = await runAgent(
      fake1,
      def,
      { slug: 'rip-events' },
      undefined,
      tmpDir,
    );
    const eventsPath = path.join(first.runDir, 'events.ndjson');
    // Fake adapter emits zero events; inject a sentinel line so we can
    // assert that resume-in-place preserves prior content.
    fs.appendFileSync(eventsPath, `${JSON.stringify({ type: 'sentinel' })}\n`);
    const beforeContent = fs.readFileSync(eventsPath, 'utf8');

    const fake2 = new FakeAgentAdapter({ output: validSystemOutput() });
    await runAgent(
      fake2,
      def,
      {
        slug: 'rip-events',
        sessionId: first.metadata.sessionId,
        resumedFromRunId: first.metadata.runId,
        resumeInPlace: true,
        promptOverride: 'follow-up',
      },
      undefined,
      tmpDir,
    );

    const afterContent = fs.readFileSync(eventsPath, 'utf8');
    expect(afterContent.startsWith(beforeContent)).toBe(true);

    const lines = afterContent.split('\n').filter((l) => l.length > 0);
    const resumeMarker = lines
      .map((l) => {
        try {
          return JSON.parse(l) as { type?: string };
        } catch {
          return null;
        }
      })
      .find((e) => e?.type === 'resume');
    expect(resumeMarker).toBeTruthy();
  });

  it('preserves existing inbox + state files on resume', async () => {
    const def = createSimpleAgent('rip-inbox');

    const fake1 = new FakeAgentAdapter({ output: validSystemOutput() });
    const first = await runAgent(
      fake1,
      def,
      { slug: 'rip-inbox' },
      undefined,
      tmpDir,
    );

    // Simulate a leftover inside-lane inbox file (write outside the run path
    // — it's at agents/<slug>/inbox/inside/messages.ndjson per the
    // run-scoped + per-agent shared coordination layout).
    const inboxFile = path.join(first.runDir, 'sentinel.txt');
    fs.writeFileSync(inboxFile, 'sentinel-content');

    const fake2 = new FakeAgentAdapter({ output: validSystemOutput() });
    await runAgent(
      fake2,
      def,
      {
        slug: 'rip-inbox',
        sessionId: first.metadata.sessionId,
        resumedFromRunId: first.metadata.runId,
        resumeInPlace: true,
        promptOverride: 'follow-up',
      },
      undefined,
      tmpDir,
    );

    expect(fs.existsSync(inboxFile)).toBe(true);
    expect(fs.readFileSync(inboxFile, 'utf8')).toBe('sentinel-content');
  });

  it('errors cleanly when resumeInPlace=true but resumedFromRunId is missing', async () => {
    const def = createSimpleAgent('rip-missing-id');
    const fake = new FakeAgentAdapter({ output: validSystemOutput() });
    await expect(
      runAgent(
        fake,
        def,
        {
          slug: 'rip-missing-id',
          sessionId: 'sess',
          resumeInPlace: true,
          promptOverride: 'follow-up',
        },
        undefined,
        tmpDir,
      ),
    ).rejects.toThrow(/resumedFromRunId/i);
  });

  it('errors cleanly when resumeInPlace=true but the run dir does not exist', async () => {
    const def = createSimpleAgent('rip-missing-dir');
    const fake = new FakeAgentAdapter({ output: validSystemOutput() });
    await expect(
      runAgent(
        fake,
        def,
        {
          slug: 'rip-missing-dir',
          sessionId: 'sess',
          resumedFromRunId: '2099-99-99T99-99-99-999Z-9999',
          resumeInPlace: true,
          promptOverride: 'follow-up',
        },
        undefined,
        tmpDir,
      ),
    ).rejects.toThrow(/run dir/i);
  });
});
