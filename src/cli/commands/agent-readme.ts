/**
 * minih agent-readme — dump the bundled AGENTS_README.md to stdout as raw markdown.
 *
 * **Deliberate deviation from the JSON-envelope rule**: this command writes raw
 * markdown to stdout so agents on any project (with minih installed) can read
 * the canonical agent-facing docs locally without internet access.
 *
 * On success: the bundled doc bytes are written to stdout, exit 0, stderr empty.
 * On missing doc: a JSON error envelope (E160 README_NOT_FOUND) is written to
 * stderr, exit 1, stdout empty. SIGPIPE is silenced so `minih agent-readme | head`
 * does not crash with EPIPE.
 *
 * Path resolution: the file is bundled into `dist/AGENTS_README.md` by
 * `scripts/copy-schemas.js` at build time. This module's runtime location is
 * `dist/cli/commands/agent-readme.js`, so from `dirname(import.meta.url)` the
 * README sits at `../../AGENTS_README.md` (two `..` up: `commands/` → `cli/` → `dist/`).
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Command } from 'commander';
import { ErrorCodes, formatError } from '../output.js';

function resolveBundledReadmePath(): string {
  // dist/cli/commands/agent-readme.js → dist/AGENTS_README.md
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', '..', 'AGENTS_README.md');
}

export function registerAgentReadmeCommand(program: Command): void {
  program
    .command('agent-readme')
    .description(
      'Dump the bundled AGENTS_README.md to stdout (raw markdown — does NOT use the JSON envelope, by design)',
    )
    .action(() => {
      // Silence EPIPE so `minih agent-readme | head` exits cleanly.
      process.stdout.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EPIPE') {
          process.exit(0);
        }
        throw err;
      });

      const readmePath = resolveBundledReadmePath();

      if (!existsSync(readmePath)) {
        const envelope = formatError(
          'agent-readme',
          ErrorCodes.README_NOT_FOUND,
          `Bundled AGENTS_README.md not found at expected path. This usually means the package was installed without the bundle step (\`scripts/copy-schemas.js\` did not run).`,
          { expectedPath: readmePath },
        );
        process.stderr.write(`${JSON.stringify(envelope)}\n`);
        process.exit(1);
      }

      const buf = readFileSync(readmePath);
      process.stdout.write(buf);
    });
}
