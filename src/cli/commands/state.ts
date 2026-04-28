/**
 * `minih state get <slug>` — cross-lane "both lanes" view.
 *
 * Plan 010 — HF-002. The only `state` command surviving at the top level
 * (per spec clarify Q8). `state set` and `state transition` moved to
 * `outside state set` / `outside state transition`. `state get` for one lane
 * moved to `outside state get` / `inside state get`.
 *
 * This top-level form returns BOTH lanes in one envelope — useful for
 * "show me everything" inspection.
 */

import type { Command } from 'commander';
import { readStateLazy } from '../../runner/index.js';
import { resolveCoordinationRunOrExit } from '../coordination.js';
import { exitWithEnvelope, formatSuccess } from '../output.js';
import { parseOptionalKey, readStateKey, withStateErrors } from './outside.js';

export function registerStateCommand(program: Command): void {
  const state = program
    .command('state')
    .description('Read both inside and outside coordination state in one call');

  state
    .command('get <slug>')
    .description('Read both inside and outside coordination state')
    .option('--key <dotPath>', 'Optional dot-path to read on both lanes')
    .option('--run <runId>', 'Target run ID (default: only active run)')
    .action((slug: string, opts: { key?: string; run?: string }) => {
      const cmd = 'state.get';
      const agentsDir = program.opts().agentsDir ?? 'agents';
      const target = resolveCoordinationRunOrExit(
        cmd,
        slug,
        agentsDir,
        opts.run,
      );
      const key = parseOptionalKey(cmd, opts.key);

      withStateErrors(cmd, () => {
        const outside = readStateLazy(target.location, 'outside');
        const inside = readStateLazy(target.location, 'inside');
        const payload =
          key !== undefined
            ? {
                side: 'both',
                key,
                outside: readStateKey(outside, key) ?? null,
                inside: readStateKey(inside, key) ?? null,
              }
            : { side: 'both', outside, inside };
        exitWithEnvelope(
          formatSuccess(cmd, { slug, runId: target.runId, ...payload }),
        );
      });
    });
}
