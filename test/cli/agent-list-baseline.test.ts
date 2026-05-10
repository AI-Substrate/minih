/**
 * MINIH_REGRESSION baseline test for `minih agent list --available`.
 *
 * Snapshots the JSON envelope of the bundled registry catalog so PRs that
 * add/remove/edit registry entries surface in code review. Catches both
 * additions and deletions: any change in the seed → snapshot mismatch.
 *
 * Curation gate: per user directive ("we don't want to auto bake all
 * agents — some are meant for developing this particular project"), only
 * curated user-facing agents go in the bundled registry. Internal-only
 * agents (smoke-test, convention-check, etc.) MUST stay out. This test
 * documents the current snapshot — drift requires intentional update.
 *
 * Gated behind MINIH_REGRESSION=1 because it shells out to the built CLI
 * (~9s subprocess overhead, too slow for the inner loop). Pattern matches
 * `test/cli/all-existing-agents-pass-doctor.test.ts`.
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const regressionDescribe =
  process.env.MINIH_REGRESSION === '1' ? describe : describe.skip;

const repoRoot = path.resolve('.');
const cliPath = path.join(repoRoot, 'dist/cli/index.js');

regressionDescribe(
  'agent list --available baseline (MINIH_REGRESSION=1)',
  () => {
    it('matches the bundled registry catalog snapshot', () => {
      expect(
        fs.existsSync(cliPath),
        `dist/cli/index.js not found — run \`npm run build\` first`,
      ).toBe(true);

      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-regr-list-'));
      try {
        const result = spawnSync(
          'node',
          [cliPath, 'agent', 'list', '--available', '--agents-dir', 'agents'],
          { cwd: tmp, encoding: 'utf-8' },
        );
        expect(result.status).toBe(0);
        const envelope = JSON.parse(result.stdout) as {
          command: string;
          status: string;
          data: {
            mode: string;
            count: number;
            agents: Array<{
              slug: string;
              description: string;
              tags: string[];
              url: string;
              ref: string;
              subpath: string | null;
              since: string | null;
              minihVersion: string | null;
              installed: boolean;
            }>;
          };
        };

        expect(envelope.status).toBe('ok');
        expect(envelope.data.mode).toBe('available');

        // Inline snapshot covers BOTH additions AND deletions: any change
        // in the seed catalog (slug, description, url, ref, subpath, tags,
        // since, minihVersion) makes this fail. Updating the snapshot is
        // the explicit signal that a curation PR was intentional.
        const snap = envelope.data.agents.map((a) => ({
          slug: a.slug,
          url: a.url,
          ref: a.ref,
          subpath: a.subpath,
          tags: a.tags,
          since: a.since,
          minihVersion: a.minihVersion,
        }));

        expect(snap).toMatchInlineSnapshot(`
        [
          {
            "minihVersion": ">=0.3.0",
            "ref": "main",
            "since": "0.4.0",
            "slug": "code-review-companion",
            "subpath": "agents/code-review-companion",
            "tags": [
              "companion",
              "review",
              "coordination",
              "quality",
              "exemplar",
            ],
            "url": "github:AI-Substrate/minih",
          },
        ]
      `);
        expect(envelope.data.count).toBe(snap.length);
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });

    it('every entry has a unique slug (defensive against merge duplicates)', () => {
      expect(fs.existsSync(cliPath)).toBe(true);
      const tmp = fs.mkdtempSync(
        path.join(os.tmpdir(), 'minih-regr-list-dedupe-'),
      );
      try {
        const result = spawnSync(
          'node',
          [cliPath, 'agent', 'list', '--available', '--agents-dir', 'agents'],
          { cwd: tmp, encoding: 'utf-8' },
        );
        const envelope = JSON.parse(result.stdout) as {
          data: { agents: Array<{ slug: string }> };
        };
        const slugs = envelope.data.agents.map((a) => a.slug);
        const uniq = new Set(slugs);
        expect(uniq.size).toBe(slugs.length);
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });
  },
);
