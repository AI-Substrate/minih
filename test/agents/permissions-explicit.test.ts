/**
 * Plan 018 R4 (T-R4.2) — fft-blocking regression: every agent under
 * `agents/` (excluding `_shared/`) MUST declare `permissions:` explicitly.
 *
 * This is THE gate for R4. After every internal agent is migrated,
 * adding a new agent without `permissions:` should fail this test loudly.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseFrontmatter } from '../../src/runner/folder.js';

describe('agents/* must declare explicit permissions (T-R4.2)', () => {
  it('every prompt.md (excluding _shared/) has a `permissions:` field', () => {
    const agentsDir = path.resolve('agents');
    const entries = fs.readdirSync(agentsDir, { withFileTypes: true });
    const missing: string[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('_')) continue; // _shared, _templates, etc.

      const promptPath = path.join(agentsDir, entry.name, 'prompt.md');
      if (!fs.existsSync(promptPath)) continue;

      const content = fs.readFileSync(promptPath, 'utf-8');
      const { permissions } = parseFrontmatter(content);
      if (!permissions) {
        missing.push(entry.name);
      }
    }

    expect(
      missing,
      `These agents are missing explicit \`permissions:\` frontmatter:\n  ${missing.join('\n  ')}\n\nFix: run \`minih agent permissions migrate <slug> --dry-run\` to preview, then \`minih agent permissions set <slug> <preset>\` to apply.`,
    ).toEqual([]);
  });
});
