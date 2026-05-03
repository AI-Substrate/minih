/**
 * `minih agent <verb>` — agent pack management.
 *
 * Plan 017 — FX001 ships the LOCAL-PATH branch of `agent install` only.
 * URL/registry inputs return E182 directing callers to Phase 3/4. Other
 * verbs (`info`, `list`, `remove`) ship in Phase 4.
 */

import * as path from 'node:path';
import chalk from 'chalk';
import type { Command } from 'commander';
import { type InstallSource, installAgentPack } from '../../runner/index.js';
import {
  ErrorCodes,
  exitWithEnvelope,
  formatError,
  formatSuccess,
} from '../output.js';

export function registerAgentCommand(program: Command): void {
  const agent = program
    .command('agent')
    .description('Manage agent packs (install, info, list, remove)');

  agent
    .command('install <ref>')
    .description(
      'Install (or upgrade) an agent pack from a local filesystem path. ' +
        'Remote git URLs and registry slugs ship in Phase 3/4.',
    )
    .option('--as <slug>', 'Install under a different local slug')
    .option(
      '--force',
      'Overwrite an existing folder even if it has no .minih-source.json',
    )
    .option('--yes', 'Skip confirmation prompts (CI mode)', false)
    .action(
      async (
        ref: string,
        opts: { as?: string; force?: boolean; yes?: boolean },
      ) => {
        const agentsDir = program.opts().agentsDir ?? 'agents';
        try {
          const source = parseRefToInstallSource(ref);
          const result = await installAgentPack({
            source,
            agentsDir,
            asSlug: opts.as,
            force: opts.force,
            yes: opts.yes,
          });

          if (process.stderr.isTTY) {
            const verb =
              result.action === 'installed'
                ? '✓ Installed'
                : result.action === 'upgraded'
                  ? '↻ Upgraded'
                  : '= Unchanged';
            process.stderr.write(
              `\n  ${chalk.bold(verb)} ${chalk.cyan(result.slug)}\n` +
                `  ${chalk.dim('Source:')} ${formatSourceForDisplay(result.source)}\n` +
                `  ${chalk.dim('Location:')} ${chalk.dim(result.installPath)}\n` +
                `  ${chalk.dim('Files:')} ${result.files.length}\n\n`,
            );
            if (result.action === 'upgraded' && result.changedFiles?.length) {
              process.stderr.write(
                `  ${chalk.yellow('Changed:')} ${result.changedFiles.join(', ')}\n\n`,
              );
            }
          }

          exitWithEnvelope(formatSuccess('agent install', result));
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const code = pickErrorCode(message);
          exitWithEnvelope(formatError('agent install', code, message));
        }
      },
    );
}

/**
 * Map a user-supplied install reference to an `InstallSource`. For FX001
 * scope:
 *   - Absolute path or relative path (`/`, `./`, `../`) → `local`
 *   - Otherwise — let the runner reject with E182 (URL/registry stubs)
 *
 * Phase 4 will replace this with a richer parser that routes registry slugs
 * and URLs through their own resolution paths.
 */
function parseRefToInstallSource(ref: string): InstallSource {
  if (ref === '') {
    throw new Error('agent install: <ref> argument cannot be empty');
  }
  if (
    ref.startsWith('/') ||
    ref.startsWith('./') ||
    ref.startsWith('../') ||
    /^[a-zA-Z]:[\\/]/.test(ref) // Windows drive
  ) {
    return { type: 'local', localPath: path.resolve(ref) };
  }
  if (
    ref.startsWith('http://') ||
    ref.startsWith('https://') ||
    ref.startsWith('github:') ||
    ref.startsWith('gitlab:') ||
    ref.startsWith('git@')
  ) {
    return { type: 'url', url: ref, ref: 'main' };
  }
  // Bare slug — assumed to be a registry lookup.
  return {
    type: 'registry',
    registrySlug: ref,
    url: `<registry:${ref}>`,
    ref: 'main',
  };
}

function formatSourceForDisplay(source: {
  type: string;
  [k: string]: unknown;
}): string {
  if (source.type === 'local') {
    return `local ${String(source.localPath)}`;
  }
  if (source.type === 'url') {
    return String(source.url);
  }
  if (source.type === 'registry') {
    return `registry:${String(source.registrySlug)}`;
  }
  return JSON.stringify(source);
}

function pickErrorCode(
  message: string,
): (typeof ErrorCodes)[keyof typeof ErrorCodes] {
  // Strict precedence: explicit E-code embedded in the error message wins.
  // Source-of-truth errors say "(E182)" / "(E183)" / etc inline so this
  // mapping survives any wording changes.
  if (/\bE183\b|already installed|hand-rolled/i.test(message)) {
    return ErrorCodes.AGENT_PACK_ALREADY_INSTALLED;
  }
  if (/\bE184\b|source mismatch/i.test(message)) {
    return ErrorCodes.AGENT_PACK_SOURCE_MISMATCH;
  }
  if (/\bE182\b/.test(message)) {
    return ErrorCodes.AGENT_PACK_INVALID;
  }
  if (/\bE181\b/.test(message)) {
    return ErrorCodes.AGENT_PACK_FETCH_FAILED;
  }
  // Fallback — generic invalid input.
  return ErrorCodes.AGENT_PACK_INVALID;
}
