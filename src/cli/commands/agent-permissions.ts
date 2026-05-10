/**
 * `minih agent permissions <verb>` — Plan 018 R2.
 *
 * Subcommand family: list-available / list / set / clear / migrate.
 * Mutating commands (`set`, `clear`, `migrate`) edit the agent's
 * `prompt.md` frontmatter idempotently.
 */

import * as fs from 'node:fs';
import type { Command } from 'commander';
import {
  buildPresetCatalog,
  compilePermissionPolicy,
  formatCatalogAsTable,
  isPresetName,
  listAgents,
  listPresetNames,
  type PermissionPolicy,
  type PermissionPresetName,
  parseFrontmatter,
  resolveAgent,
} from '../../runner/index.js';
import {
  ErrorCodes,
  exitWithEnvelope,
  formatError,
  formatSuccess,
} from '../output.js';

export function registerPermissionsSubcommands(
  agent: Command,
  program: Command,
): void {
  const perms = agent
    .command('permissions')
    .description(
      'Inspect and manage permission policies for installed agents (plan 018).',
    );

  perms
    .command('list-available')
    .description(
      'List all built-in permission presets with their per-kind decision matrix.',
    )
    .option('--json', 'Output as JSON envelope')
    .action((opts: { json?: boolean }) => {
      const catalog = buildPresetCatalog();
      if (process.stderr.isTTY && !opts.json) {
        process.stderr.write(formatCatalogAsTable(catalog));
        process.stderr.write('\n\n');
        for (const entry of catalog) {
          process.stderr.write(`${entry.name}: ${entry.description}\n`);
        }
      }
      exitWithEnvelope(
        formatSuccess('agent permissions list-available', {
          presets: catalog,
          count: catalog.length,
        }),
      );
    });

  perms
    .command('list <slug>')
    .description(
      "Show an agent's declared permissions (raw frontmatter). With `--effective`, shows the resolved policy after the 4-layer override chain.",
    )
    .option(
      '--effective',
      'Resolve through frontmatter→sidecar→env→release-default and show the final policy',
    )
    .option('--json', 'Output as JSON envelope')
    .action((slug: string, opts: { effective?: boolean; json?: boolean }) => {
      const agentsDir = program.opts().agentsDir ?? 'agents';
      const def = resolveAgent(slug, agentsDir);
      if (!def) {
        exitWithEnvelope(
          formatError(
            'agent permissions list',
            ErrorCodes.AGENT_NOT_FOUND,
            `Agent "${slug}" not found.`,
          ),
        );
        return;
      }

      if (opts.effective) {
        try {
          const resolved = compilePermissionPolicy({
            frontmatter: def.permissions,
            releaseDefault: { preset: 'yolo' },
            cwd: process.cwd(),
          });
          exitWithEnvelope(
            formatSuccess('agent permissions list', {
              slug,
              effective: resolved,
              resolutionChain: {
                frontmatter: def.permissions ?? null,
                sidecar: null,
                env: process.env.MINIH_PERMISSIONS_DEFAULT
                  ? { preset: process.env.MINIH_PERMISSIONS_DEFAULT }
                  : null,
                releaseDefault: { preset: 'yolo' },
              },
            }),
          );
        } catch (err) {
          exitWithEnvelope(
            formatError(
              'agent permissions list',
              ErrorCodes.PERMISSIONS_FRONTMATTER_INVALID,
              `Could not resolve effective policy: ${(err as Error).message}`,
            ),
          );
        }
        return;
      }

      exitWithEnvelope(
        formatSuccess('agent permissions list', {
          slug,
          permissions: def.permissions ?? null,
        }),
      );
    });

  perms
    .command('set <slug> <preset>')
    .description(
      "Write `permissions: <preset>` into the agent's prompt.md frontmatter. Idempotent — same preset twice is a no-op diff.",
    )
    .action((slug: string, preset: string) => {
      const agentsDir = program.opts().agentsDir ?? 'agents';
      if (!isPresetName(preset)) {
        exitWithEnvelope(
          formatError(
            'agent permissions set',
            ErrorCodes.PERMISSION_PRESET_UNKNOWN,
            `Unknown preset "${preset}". Valid: ${listPresetNames().join(', ')}`,
          ),
        );
        return;
      }
      const def = resolveAgent(slug, agentsDir);
      if (!def) {
        exitWithEnvelope(
          formatError(
            'agent permissions set',
            ErrorCodes.AGENT_NOT_FOUND,
            `Agent "${slug}" not found.`,
          ),
        );
        return;
      }
      const result = writePermissionsField(
        def.promptPath,
        preset as PermissionPresetName,
      );
      exitWithEnvelope(
        formatSuccess('agent permissions set', {
          slug,
          preset,
          changed: result.changed,
          previousPolicy: result.previous,
        }),
      );
    });

  perms
    .command('clear <slug>')
    .description(
      "Remove the `permissions:` field from the agent's prompt.md frontmatter.",
    )
    .action((slug: string) => {
      const agentsDir = program.opts().agentsDir ?? 'agents';
      const def = resolveAgent(slug, agentsDir);
      if (!def) {
        exitWithEnvelope(
          formatError(
            'agent permissions clear',
            ErrorCodes.AGENT_NOT_FOUND,
            `Agent "${slug}" not found.`,
          ),
        );
        return;
      }
      const result = clearPermissionsField(def.promptPath);
      exitWithEnvelope(
        formatSuccess('agent permissions clear', {
          slug,
          changed: result.changed,
          previousPolicy: result.previous,
        }),
      );
    });

  perms
    .command('migrate [slug]')
    .description(
      'Heuristic-recommend a preset for one or all agents based on tags. ' +
        'Use `--all` for bulk migrate; `--dry-run` to preview without writing.',
    )
    .option('--all', 'Migrate every agent without explicit permissions')
    .option('--preset <name>', 'Override the heuristic; force this preset')
    .option('--dry-run', 'Show diff without writing')
    .option('--yes', 'Non-interactive: accept recommendations')
    .action(
      (
        slug: string | undefined,
        opts: {
          all?: boolean;
          preset?: string;
          dryRun?: boolean;
          yes?: boolean;
        },
      ) => {
        const agentsDir = program.opts().agentsDir ?? 'agents';

        if (!opts.all && !slug) {
          exitWithEnvelope(
            formatError(
              'agent permissions migrate',
              ErrorCodes.INVALID_ARGS,
              'Either provide a <slug> or use --all',
            ),
          );
          return;
        }

        const targets = opts.all
          ? listAgents(agentsDir).filter((d) => !d.permissions)
          : slug
            ? [resolveAgent(slug, agentsDir)].filter(
                (d): d is NonNullable<typeof d> => d !== null,
              )
            : [];

        const actions = targets.map((def) => {
          const recommended =
            opts.preset && isPresetName(opts.preset)
              ? (opts.preset as PermissionPresetName)
              : recommendPreset(def.tags, def.slug);
          return {
            slug: def.slug,
            recommended,
            reasoning: opts.preset
              ? `forced via --preset ${opts.preset}`
              : reasoningFor(def.tags, def.slug),
            promptPath: def.promptPath,
            currentPolicy: def.permissions ?? null,
          };
        });

        if (opts.dryRun) {
          if (process.stderr.isTTY) {
            for (const a of actions) {
              process.stderr.write(
                `[DRY] ${a.slug}: → ${a.recommended} (${a.reasoning})\n`,
              );
            }
          }
          exitWithEnvelope(
            formatSuccess('agent permissions migrate', {
              dryRun: true,
              actions,
              count: actions.length,
            }),
          );
          return;
        }

        if (!opts.yes && !opts.all && actions.length === 1) {
          // Single-target without --yes: still apply (matches `set` semantics)
          // — interactive accept/decline prompt is FX001 work.
        } else if (!opts.yes && opts.all) {
          exitWithEnvelope(
            formatError(
              'agent permissions migrate',
              ErrorCodes.INVALID_ARGS,
              '--all requires --yes (non-interactive). Use --dry-run to preview first.',
            ),
          );
          return;
        }

        const applied: typeof actions = [];
        for (const a of actions) {
          const r = writePermissionsField(a.promptPath, a.recommended);
          if (r.changed) applied.push(a);
        }

        exitWithEnvelope(
          formatSuccess('agent permissions migrate', {
            applied,
            count: applied.length,
            total: actions.length,
          }),
        );
      },
    );
}

function recommendPreset(tags: string[], slug: string): PermissionPresetName {
  // Workshop 003 § Q6 heuristic table.
  const tagSet = new Set(tags.map((t) => t.toLowerCase()));
  const slugLower = slug.toLowerCase();

  if (
    tagSet.has('review') ||
    tagSet.has('companion') ||
    slugLower.includes('review') ||
    slugLower.includes('companion')
  ) {
    return 'read-only';
  }
  if (
    tagSet.has('build') ||
    tagSet.has('lint') ||
    slugLower.includes('build')
  ) {
    return 'trusted';
  }
  if (tagSet.has('coordination') || tagSet.has('inspector')) {
    return 'restricted';
  }
  if (tagSet.has('network') || tagSet.has('web') || tagSet.has('fetch')) {
    return 'network';
  }
  // Default: yolo (preserve current behavior; user can override)
  return 'yolo';
}

function reasoningFor(tags: string[], slug: string): string {
  const tagSet = new Set(tags.map((t) => t.toLowerCase()));
  const slugLower = slug.toLowerCase();
  if (
    tagSet.has('review') ||
    tagSet.has('companion') ||
    slugLower.includes('review') ||
    slugLower.includes('companion')
  ) {
    return 'review/companion → read-only (workshop 003 heuristic)';
  }
  if (
    tagSet.has('build') ||
    tagSet.has('lint') ||
    slugLower.includes('build')
  ) {
    return 'build/lint → trusted (needs shell+write, no custom-tool/memory/hook)';
  }
  if (tagSet.has('coordination') || tagSet.has('inspector')) {
    return 'coordination/inspector → restricted';
  }
  return 'no clear signal from tags → yolo (no behavior change)';
}

interface FrontmatterEditResult {
  changed: boolean;
  previous: PermissionPolicy | null;
}

function writePermissionsField(
  promptPath: string,
  preset: PermissionPresetName,
): FrontmatterEditResult {
  const raw = fs.readFileSync(promptPath, 'utf-8');
  const fm = parseFrontmatter(raw);

  if (
    fm.permissions?.preset === preset &&
    !fm.permissions.overrides &&
    !fm.permissions.allowedRoots
  ) {
    return { changed: false, previous: fm.permissions };
  }

  // Idempotent re-write — replace existing `permissions:` block or insert.
  const newRaw = upsertFrontmatterField(raw, 'permissions', preset);
  fs.writeFileSync(promptPath, newRaw);
  return { changed: true, previous: fm.permissions ?? null };
}

function clearPermissionsField(promptPath: string): FrontmatterEditResult {
  const raw = fs.readFileSync(promptPath, 'utf-8');
  const fm = parseFrontmatter(raw);
  if (!fm.permissions) {
    return { changed: false, previous: null };
  }
  const newRaw = removeFrontmatterField(raw, 'permissions');
  fs.writeFileSync(promptPath, newRaw);
  return { changed: true, previous: fm.permissions };
}

/**
 * Replace OR insert a top-level field in the frontmatter block.
 * Idempotent text edit — preserves existing formatting around it.
 */
function upsertFrontmatterField(
  raw: string,
  field: string,
  value: string,
): string {
  // Frontmatter delimiter detection (matches parseFrontmatter)
  if (!raw.startsWith('---\n') && !raw.startsWith('---\r\n')) {
    // No frontmatter — insert one.
    return `---\n${field}: ${value}\n---\n${raw}`;
  }

  // Find closing fence
  const normalized = raw.replace(/\r\n/g, '\n');
  const closeIdx = normalized.indexOf('\n---\n', 4);
  if (closeIdx === -1) {
    // Unclosed frontmatter — bail (don't touch malformed files)
    throw new Error(`Could not find closing --- in ${raw.slice(0, 200)}…`);
  }
  const fmBlock = normalized.slice(4, closeIdx);
  const body = normalized.slice(closeIdx + 5);

  // Replace existing single-line field, OR multi-line field block, OR insert.
  const fieldLineRe = new RegExp(`^${field}:.*$`, 'm');
  if (fieldLineRe.test(fmBlock)) {
    // Strip the entire block (single-line or multi-line) and reinsert as single-line.
    const lines = fmBlock.split('\n');
    const newLines: string[] = [];
    let inBlock = false;
    for (const line of lines) {
      if (line.match(fieldLineRe)) {
        inBlock = line.endsWith(':') || line.endsWith(': '); // empty value = block form
        newLines.push(`${field}: ${value}`);
        continue;
      }
      if (inBlock) {
        if (line.match(/^\s/) || line.trim() === '') continue;
        inBlock = false;
      }
      newLines.push(line);
    }
    return `---\n${newLines.join('\n')}\n---\n${body}`;
  }

  // Insert at end of frontmatter block
  return `---\n${fmBlock}\n${field}: ${value}\n---\n${body}`;
}

function removeFrontmatterField(raw: string, field: string): string {
  if (!raw.startsWith('---\n') && !raw.startsWith('---\r\n')) return raw;
  const normalized = raw.replace(/\r\n/g, '\n');
  const closeIdx = normalized.indexOf('\n---\n', 4);
  if (closeIdx === -1) return raw;

  const fmBlock = normalized.slice(4, closeIdx);
  const body = normalized.slice(closeIdx + 5);

  const fieldLineRe = new RegExp(`^${field}:.*$`, 'm');
  if (!fieldLineRe.test(fmBlock)) return raw;

  const lines = fmBlock.split('\n');
  const newLines: string[] = [];
  let inBlock = false;
  for (const line of lines) {
    if (line.match(fieldLineRe)) {
      inBlock = line.endsWith(':') || line.endsWith(': ');
      continue;
    }
    if (inBlock) {
      if (line.match(/^\s/) || line.trim() === '') continue;
      inBlock = false;
    }
    newLines.push(line);
  }
  return `---\n${newLines.join('\n')}\n---\n${body}`;
}
