/**
 * `minih agent <verb>` — agent pack management.
 *
 * Plan 017 — Phase 3 lands the URL fetch path. Local-path source still
 * works (FX001). Registry slug still throws E182 (Phase 4).
 *
 * **Fetcher composition root** (T007): defaults to `GitHubAgentPackFetcher`
 * (real `fetch()`); honors `MINIH_AGENT_PACK_FETCHER=fake:<json>` env var
 * ONLY when `NODE_ENV === 'test'` so production sets fail loudly. The
 * `<json>` payload maps `<url>\u0001<ref>` keys to
 * `{commitSha, tarballBase64}` responses for `FakeAgentPackFetcher`.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import chalk from 'chalk';
import type { Command } from 'commander';
import {
  type AgentPackSource,
  FakeAgentPackFetcher,
  GitHubAgentPackFetcher,
  type IAgentPackFetcher,
  type InstallSource,
  installAgentPack,
  listAgents,
  listRegistryAgents,
  parseAgentUrl,
  parseFrontmatter,
  readAgentManifest,
  readRegistryCatalog,
  readSourceSidecar,
  resolveAgent,
  validateSlug,
  verifyChecksums,
} from '../../runner/index.js';
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
        'Remote git URLs and registry slugs ship in Phase 3/4. ' +
        'URL syntax (designed; fetch lands Phase 3): `github:owner/repo#branch:subpath`, `https://github.com/owner/repo#tag`.',
    )
    .option('--as <slug>', 'Install under a different local slug')
    .option(
      '--force',
      'Overwrite an existing folder even if it has no .minih-source.json',
    )
    .option(
      '--ref <branch-tag-or-sha>',
      'Override the source ref (branch/tag/commit) — works like npm `#branch` or uv `@branch`',
    )
    .option(
      '--subpath <path>',
      'Override the source subpath (path inside the repo)',
    )
    .option('--yes', 'Skip confirmation prompts (CI mode)', false)
    .action(
      async (
        argRef: string,
        opts: {
          as?: string;
          force?: boolean;
          ref?: string;
          subpath?: string;
          yes?: boolean;
        },
      ) => {
        const agentsDir = program.opts().agentsDir ?? 'agents';
        try {
          const source = parseRefToInstallSource(argRef, {
            refOverride: opts.ref,
            subpathOverride: opts.subpath,
          });
          const result = await installAgentPack({
            source,
            agentsDir,
            asSlug: opts.as,
            force: opts.force,
            yes: opts.yes,
            fetcher: source.type === 'url' ? resolveFetcher() : undefined,
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

  registerInfoSubcommand(agent, program);
  registerListSubcommand(agent, program);
}

/**
 * Map a user-supplied install reference to an `InstallSource`. For FX001
 * scope:
 *   - Absolute path or relative path (`/`, `./`, `../`, Windows drive) → `local`
 *   - URL forms (`github:`, `gitlab:`, `https://`, `http://`, `git@`) → `url`
 *     (parsed via `parseAgentUrl`; ref/subpath taken from the URL fragment
 *     unless explicitly overridden by `--ref` / `--subpath`)
 *   - Otherwise → registry slug (Phase 4 will resolve)
 *
 * `--ref` / `--subpath` flags override the URL-embedded equivalents (matches
 * npm/uv ergonomics where `#branch` or `@branch` work but a flag wins).
 */
function parseRefToInstallSource(
  ref: string,
  opts?: { refOverride?: string; subpathOverride?: string },
): InstallSource {
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
    // Parse via the shared URL parser so #ref and ?path= work correctly.
    // --subpath flag (if provided) overrides the URL fragment.
    const parsed = parseAgentUrl(ref, {
      subpathOverride: opts?.subpathOverride,
    });
    if (parsed.type === 'github' || parsed.type === 'https') {
      // Canonicalize the URL we pass downstream — the fetcher receives a
      // stable identity-only form (`github:owner/repo`); ref + subpath
      // travel as separate fields. Without this, `github:foo/bar#main`
      // and `https://github.com/foo/bar.git#main` would hit different
      // fake-fetcher preset keys for the same logical source.
      const cleanUrl = `github:${parsed.owner}/${parsed.repo}`;
      return {
        type: 'url',
        url: cleanUrl,
        // --ref flag wins over URL-embedded #ref (npm-style override)
        ref: opts?.refOverride ?? parsed.ref,
        subpath: parsed.subpath,
      };
    }
    // Local path returned by parseAgentUrl — shouldn't happen given the prefix
    // checks above, but handle defensively.
    return { type: 'local', localPath: parsed.path };
  }
  // Bare slug — assumed to be a registry lookup.
  return {
    type: 'registry',
    registrySlug: ref,
    url: `<registry:${ref}>`,
    ref: opts?.refOverride ?? 'main',
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

/**
 * Composition root for the agent-pack fetcher (T007).
 *
 * Default: `GitHubAgentPackFetcher` — real `fetch()` against the GitHub
 * API.
 *
 * **Test-only injection seam**: when `MINIH_AGENT_PACK_FETCHER` env var
 * is set, we honor it ONLY if `NODE_ENV === 'test'`. Otherwise we hard-
 * fail with E181 to prevent production from silently using a fake fetcher.
 *
 * Format: `MINIH_AGENT_PACK_FETCHER=fake:<json>` where `<json>` is a
 * stringified object: `{ "<url>\u0001<ref>": { commitSha, tarballBase64 } }`.
 *
 * On every fake-fetcher invocation, a one-line warning is written to
 * stderr so a developer never silently runs against the fake.
 *
 * Phase 4.10 may add additional hardening (e.g. `--allow-fake-fetcher`
 * dev flag); the format here stays compatible.
 */
function resolveFetcher(): IAgentPackFetcher {
  const envVal = process.env.MINIH_AGENT_PACK_FETCHER;
  if (envVal === undefined) {
    return new GitHubAgentPackFetcher({
      userAgent: `minih/${getMinihVersion()}`,
    });
  }

  // Env var IS set — apply production-safety gate.
  if (process.env.NODE_ENV !== 'test') {
    throw new Error(
      'MINIH_AGENT_PACK_FETCHER is set but NODE_ENV is not "test" — refusing to use a fake fetcher in production (E181). Unset MINIH_AGENT_PACK_FETCHER, or set NODE_ENV=test if you are running a test harness.',
    );
  }

  if (!envVal.startsWith('fake:')) {
    throw new Error(
      `MINIH_AGENT_PACK_FETCHER value malformed (E181): expected "fake:<json>", got "${envVal.slice(0, 40)}..."`,
    );
  }
  const jsonText = envVal.slice('fake:'.length);
  let parsed: Record<string, { commitSha: string; tarballBase64: string }>;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(
      `MINIH_AGENT_PACK_FETCHER value malformed (E181): could not parse JSON — ${
        (err as Error).message
      }`,
    );
  }

  process.stderr.write(
    `[minih] using FakeAgentPackFetcher (NODE_ENV=test, MINIH_AGENT_PACK_FETCHER set with ${
      Object.keys(parsed).length
    } preset response(s))\n`,
  );

  const fake = new FakeAgentPackFetcher();
  for (const [key, val] of Object.entries(parsed)) {
    const sep = key.indexOf('\u0001');
    if (sep === -1) {
      throw new Error(
        `MINIH_AGENT_PACK_FETCHER value malformed (E181): preset key "${key}" missing url\\u0001ref separator`,
      );
    }
    const url = key.slice(0, sep);
    const ref = key.slice(sep + 1);
    fake.setSuccess(url, ref, {
      commitSha: val.commitSha,
      tarball: Buffer.from(val.tarballBase64, 'base64'),
    });
  }
  return fake;
}

let cachedMinihVersion: string | null = null;
function getMinihVersion(): string {
  if (cachedMinihVersion !== null) return cachedMinihVersion;
  try {
    // src/cli/commands/agent.ts → walk up to repo root
    const here = path.dirname(new URL(import.meta.url).pathname);
    const pkgPath = path.resolve(here, '..', '..', '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    cachedMinihVersion = String(pkg.version ?? '0.0.0');
  } catch {
    cachedMinihVersion = '0.0.0';
  }
  return cachedMinihVersion;
}

// ─── info / list helpers ─────────────────────────────────────────────────

interface AgentInfoEntry {
  slug: string;
  description: string | null;
  tags: string[];
  coordination: string | null;
  source: AgentPackSource | null;
  installedAt: string | null;
  manifestVersion: string | null;
  files: Array<{
    path: string;
    description: string | null;
    status: 'unchanged' | 'modified' | 'missing' | 'unknown';
  }>;
  /** True when no `.minih-source.json` is present (agent was hand-rolled). */
  handRolled: boolean;
}

function registerInfoSubcommand(agent: Command, program: Command): void {
  agent
    .command('info <slug>')
    .description(
      'Show provenance, manifest, and per-file drift status for an installed agent.',
    )
    .action((slug: string) => {
      const agentsDir = program.opts().agentsDir ?? 'agents';
      const slugErr = validateSlug(slug);
      if (slugErr) {
        exitWithEnvelope(
          formatError('agent info', ErrorCodes.INVALID_ARGS, slugErr),
        );
        return;
      }

      const def = resolveAgent(slug, agentsDir);
      if (!def) {
        const available = listAgents(agentsDir).map((a) => a.slug);
        exitWithEnvelope(
          formatError(
            'agent info',
            ErrorCodes.AGENT_NOT_FOUND,
            `Agent "${slug}" not found.${available.length ? ` Available: ${available.join(', ')}` : ''}`,
          ),
        );
        return;
      }

      const entry = buildInfoEntry(def.dir, slug);

      if (process.stderr.isTTY) {
        renderInfoHuman(entry);
      }

      exitWithEnvelope(formatSuccess('agent info', entry));
    });
}

function registerListSubcommand(agent: Command, program: Command): void {
  agent
    .command('list')
    .description(
      'List installed agents in the project, with source-type column ' +
        '(local / url / registry / hand-rolled). Use --available to list ' +
        'installable agents from the bundled registry catalog instead.',
    )
    .option(
      '--available',
      'List installable agents from the bundled registry catalog (with installed/not-installed status) instead of installed agents.',
    )
    .action((opts: { available?: boolean }) => {
      const agentsDir = program.opts().agentsDir ?? 'agents';

      if (opts.available) {
        const catalog = readRegistryCatalog();
        const installed = new Set(listAgents(agentsDir).map((a) => a.slug));
        const entries = listRegistryAgents(catalog).map((entry) => ({
          slug: entry.slug,
          description: entry.description,
          tags: entry.tags ?? [],
          url: entry.url,
          ref: entry.ref,
          subpath: entry.subpath ?? null,
          since: entry.since ?? null,
          minihVersion: entry.minihVersion ?? null,
          installed: installed.has(entry.slug),
        }));

        if (process.stderr.isTTY) {
          renderAvailableListHuman(entries);
        }

        exitWithEnvelope(
          formatSuccess('agent list', {
            mode: 'available',
            agents: entries,
            count: entries.length,
          }),
        );
        return;
      }

      const agents = listAgents(agentsDir);

      const entries = agents.map((def) => {
        const sidecar = safeReadSidecar(def.dir);
        return {
          slug: def.slug,
          description: def.description,
          tags: def.tags,
          source: sidecar?.source ?? null,
          installedAt: sidecar?.installedAt ?? null,
          handRolled: sidecar === null,
        };
      });

      if (process.stderr.isTTY) {
        renderListHuman(entries);
      }

      exitWithEnvelope(
        formatSuccess('agent list', {
          agents: entries,
          count: entries.length,
        }),
      );
    });
}

function buildInfoEntry(agentDir: string, slug: string): AgentInfoEntry {
  const sidecar = safeReadSidecar(agentDir);
  const manifest = safeReadManifest(agentDir);
  const promptPath = path.join(agentDir, 'prompt.md');
  let description: string | null = null;
  let tags: string[] = [];
  let coordination: string | null = null;
  if (fs.existsSync(promptPath)) {
    const content = fs.readFileSync(promptPath, 'utf-8');
    const fm = parseFrontmatter(content);
    description = fm.description || manifest?.description || null;
    tags = fm.tags?.length ? fm.tags : (manifest?.tags ?? []);
    coordination = fm.coordination?.enabled === true ? 'enabled' : null;
  } else if (manifest) {
    description = manifest.description;
    tags = manifest.tags ?? [];
  }

  // Determine drift status per manifest-listed file.
  const files: AgentInfoEntry['files'] = [];
  if (sidecar) {
    const drift = verifyChecksums(agentDir, sidecar.fileChecksums);
    for (const [filePath, status] of Object.entries(drift)) {
      const manifestEntry = manifest?.files.find((f) => f.path === filePath);
      files.push({
        path: filePath,
        description: manifestEntry?.description ?? null,
        status,
      });
    }
  } else if (manifest) {
    for (const f of manifest.files) {
      const abs = path.join(agentDir, f.path);
      files.push({
        path: f.path,
        description: f.description,
        status: fs.existsSync(abs) ? 'unknown' : 'missing',
      });
    }
  }
  files.sort((a, b) => a.path.localeCompare(b.path));

  return {
    slug,
    description,
    tags,
    coordination,
    source: sidecar?.source ?? null,
    installedAt: sidecar?.installedAt ?? null,
    manifestVersion: sidecar?.manifestVersion ?? manifest?.version ?? null,
    files,
    handRolled: sidecar === null,
  };
}

function safeReadSidecar(agentDir: string) {
  try {
    return readSourceSidecar(agentDir);
  } catch {
    return null;
  }
}

function safeReadManifest(agentDir: string) {
  try {
    return readAgentManifest(agentDir);
  } catch {
    return null;
  }
}

function sourceIcon(
  source: AgentPackSource | null,
  handRolled: boolean,
): string {
  if (handRolled) return '👋';
  if (!source) return '?';
  switch (source.type) {
    case 'local':
      return '📦';
    case 'url':
      return '☁️';
    case 'registry':
      return '🏪';
    default:
      return '?';
  }
}

function sourceLabel(
  source: AgentPackSource | null,
  handRolled: boolean,
): string {
  if (handRolled) return 'hand-rolled (no sidecar)';
  if (!source) return 'unknown';
  if (source.type === 'local') return `local ${source.localPath}`;
  if (source.type === 'url') return `${source.url}@${source.ref}`;
  if (source.type === 'registry') {
    return `registry:${source.registrySlug} (${source.url}@${source.ref})`;
  }
  return 'unknown';
}

function renderInfoHuman(entry: AgentInfoEntry): void {
  process.stderr.write(
    `\n  ${chalk.bold('Slug:')} ${chalk.cyan(entry.slug)}\n`,
  );
  if (entry.description) {
    process.stderr.write(
      `  ${chalk.bold('Description:')} ${entry.description}\n`,
    );
  }
  if (entry.tags.length) {
    process.stderr.write(`  ${chalk.bold('Tags:')} ${entry.tags.join(', ')}\n`);
  }
  if (entry.coordination) {
    process.stderr.write(
      `  ${chalk.bold('Coordinated:')} ${chalk.green('✓')} ${entry.coordination}\n`,
    );
  }
  if (entry.manifestVersion) {
    process.stderr.write(
      `  ${chalk.bold('Manifest:')} v${entry.manifestVersion}\n`,
    );
  }

  if (entry.handRolled) {
    process.stderr.write(
      `\n  ${chalk.yellow('👋 Hand-rolled')} — no .minih-source.json found. ` +
        'This agent was not installed via `minih agent install`.\n',
    );
  } else if (entry.source) {
    process.stderr.write(
      `\n  ${chalk.bold('Source:')} ${sourceIcon(entry.source, false)}  ${sourceLabel(entry.source, false)}\n`,
    );
    if (entry.source.type === 'url' || entry.source.type === 'registry') {
      process.stderr.write(
        `  ${chalk.bold('Commit:')} ${entry.source.commitSha}\n`,
      );
    }
    if (entry.source.type === 'local') {
      process.stderr.write(
        `  ${chalk.bold('Resolved:')} ${entry.source.resolvedAt}\n`,
      );
    }
    if (entry.installedAt) {
      process.stderr.write(
        `  ${chalk.bold('Installed:')} ${entry.installedAt}\n`,
      );
    }
  }

  if (entry.files.length) {
    process.stderr.write(`\n  ${chalk.bold('Files:')}\n`);
    for (const f of entry.files) {
      const statusIcon =
        f.status === 'unchanged'
          ? chalk.green('✓')
          : f.status === 'modified'
            ? chalk.yellow('⚠️')
            : f.status === 'missing'
              ? chalk.red('✗')
              : chalk.dim('?');
      const desc = f.description ? chalk.dim(`— ${f.description}`) : '';
      process.stderr.write(`    ${statusIcon}  ${f.path.padEnd(36)} ${desc}\n`);
    }
  }

  process.stderr.write('\n');
}

function renderListHuman(
  entries: Array<{
    slug: string;
    description: string;
    source: AgentPackSource | null;
    handRolled: boolean;
  }>,
): void {
  if (entries.length === 0) {
    process.stderr.write(
      chalk.yellow('\n  No agents found in this project.\n\n'),
    );
    return;
  }

  process.stderr.write('\n');
  process.stderr.write(
    `  ${chalk.bold('Slug'.padEnd(28))} ${chalk.bold('Source'.padEnd(8))} ${chalk.bold('Description')}\n`,
  );
  process.stderr.write(
    `  ${'─'.repeat(28)} ${'─'.repeat(8)} ${'─'.repeat(40)}\n`,
  );
  for (const e of entries) {
    const icon = sourceIcon(e.source, e.handRolled);
    const desc = (e.description ?? '').slice(0, 60);
    process.stderr.write(
      `  ${chalk.cyan(e.slug.padEnd(28))} ${icon.padEnd(8)} ${desc}\n`,
    );
  }
  process.stderr.write(
    `\n  ${chalk.dim('Legend:')} ${chalk.dim('📦 local · ☁️ url · 🏪 registry · 👋 hand-rolled · ? unknown')}\n\n`,
  );
}

function renderAvailableListHuman(
  entries: Array<{
    slug: string;
    description: string;
    installed: boolean;
  }>,
): void {
  if (entries.length === 0) {
    process.stderr.write(
      chalk.yellow(
        '\n  No agents in the bundled registry catalog.\n  (This is unusual — the registry should ship at least the canonical companion. Is the build artifact missing?)\n\n',
      ),
    );
    return;
  }

  process.stderr.write('\n');
  process.stderr.write(
    `  ${chalk.bold('Slug'.padEnd(28))} ${chalk.bold('Status'.padEnd(14))} ${chalk.bold('Description')}\n`,
  );
  process.stderr.write(
    `  ${'─'.repeat(28)} ${'─'.repeat(14)} ${'─'.repeat(40)}\n`,
  );
  for (const e of entries) {
    const status = e.installed
      ? chalk.green('✓ installed')
      : chalk.dim('  available');
    const desc = (e.description ?? '').slice(0, 60);
    process.stderr.write(
      `  ${chalk.cyan(e.slug.padEnd(28))} ${status.padEnd(14)} ${desc}\n`,
    );
  }
  process.stderr.write(
    `\n  ${chalk.dim('Install with:')} minih agent install <slug>\n\n`,
  );
}
