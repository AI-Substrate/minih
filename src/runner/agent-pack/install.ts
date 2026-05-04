import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { extractTarball } from './extractor.js';
import type { IAgentPackFetcher } from './fetcher.js';
import {
  AGENT_MANIFEST_FILENAME,
  readAgentManifest,
  synthesizeImplicitManifest,
} from './manifest.js';
import {
  computeFileChecksums,
  readSourceSidecar,
  writeSourceSidecar,
} from './source.js';
import type {
  AgentPackManifest,
  AgentPackSource,
  InstallAction,
  MinihSourceSidecar,
} from './types.js';

/**
 * Source descriptor for an install request. Mirrors the (smaller subset of)
 * `AgentPackSource` discriminated union, but `commitSha`/`resolvedAt` are
 * computed by the orchestrator — callers don't supply them.
 */
export type InstallSource =
  | {
      type: 'local';
      /** Absolute or relative path to the source folder. Resolved at install time. */
      localPath: string;
    }
  | {
      type: 'url';
      url: string;
      ref: string;
      subpath?: string;
    }
  | {
      type: 'registry';
      registrySlug: string;
      url: string;
      ref: string;
      subpath?: string;
    };

export interface InstallOptions {
  source: InstallSource;
  /** Where to install (matches the `--agents-dir` global flag). */
  agentsDir: string;
  /** Override the install slug (`--as <new-slug>`). Defaults to source-derived. */
  asSlug?: string;
  /** Bypass E183 collision (overwrites existing folder without sidecar). DESTRUCTIVE. */
  force?: boolean;
  /** Skip confirmation prompts (CLI integration only — runner doesn't prompt). */
  yes?: boolean;
  /**
   * Fetcher implementation used when `source.type === 'url'`. Required for
   * URL installs; ignored for local sources. The CLI composition root is
   * responsible for passing in a `GitHubAgentPackFetcher` (production) or
   * a `FakeAgentPackFetcher` (tests).
   */
  fetcher?: IAgentPackFetcher;
  /**
   * Plan 018 R3 (T-R3.4) — interactive prompt result for
   * manifest-recommended permissions. `true` = `[A]ccept`, `false` =
   * `[F]allback`, `undefined` = no manifest recommendation OR user chose
   * `[Y]olo` / `[C]ancel` upstream.
   */
  permissionsAccept?: boolean;
  /**
   * Plan 018 R3 — explicit user override (e.g., `--permissions yolo`).
   * Wins over `permissionsAccept` when set.
   */
  permissionsOverride?: string;
}

export interface InstallResult {
  action: InstallAction;
  slug: string;
  installPath: string;
  source: AgentPackSource;
  files: string[];
  /** Set on `'upgraded'` action: which manifest-listed files actually changed. */
  changedFiles?: string[];
}

/**
 * Runtime directories an installed agent owns. NEVER touched on install or
 * upgrade — this is the single guarantee that re-install preserves user
 * runtime data.
 */
const RUNTIME_PRESERVE = new Set(['runs', 'inbox', 'state']);

/**
 * Install (or re-install / upgrade / no-op) an agent pack.
 *
 * For v1 (FX001), only `source.type === 'local'` is implemented end-to-end.
 * URL and registry sources stub-fail with E182 directing callers to Phase 3/4.
 *
 * Idempotent: calling with the same source repeatedly is safe.
 *   - First call: `action: 'installed'`
 *   - Same content: `action: 'unchanged'`
 *   - Changed content: `action: 'upgraded'` + atomic-swap of manifest files
 *
 * Always preserves `runs/`, `inbox/`, `state/` subdirectories.
 */
export async function installAgentPack(
  opts: InstallOptions,
): Promise<InstallResult> {
  if (opts.source.type === 'url') {
    if (!opts.fetcher) {
      throw new Error(
        'agent install: internal error — fetcher is required for URL source. The CLI composition root must pass `fetcher` to installAgentPack({source:{type:"url"}, fetcher: ...}). See plan-017 Phase 3 T007.',
      );
    }
    return installFromUrl(opts.source, opts, opts.fetcher);
  }
  if (opts.source.type === 'registry') {
    if (!opts.fetcher) {
      throw new Error(
        'agent install: internal error — fetcher is required for registry source. The CLI composition root must pass `fetcher` when source.type === "registry". See plan-017 Phase 5.',
      );
    }
    return installFromRegistry(opts.source, opts, opts.fetcher);
  }

  return installFromLocal(opts.source, opts);
}

/**
 * Install via registry slug: pivot to URL fetch using the registry-resolved
 * url/ref/subpath, but tag the sidecar source as `'registry'` (with both
 * `registrySlug` and resolved `commitSha`) so re-install can re-resolve
 * through the catalog and `agent info` shows the curated origin.
 */
async function installFromRegistry(
  source: {
    type: 'registry';
    registrySlug: string;
    url: string;
    ref: string;
    subpath?: string;
  },
  opts: InstallOptions,
  fetcher: IAgentPackFetcher,
): Promise<InstallResult> {
  // F001 fix (companion review): self-install / collision protection MUST
  // fire BEFORE any network call, so a network failure can't bypass spec
  // AC11. Check that target slug is either empty or already a managed
  // (`.minih-source.json`-bearing) install — refuse otherwise. The full
  // sidecar-source-mismatch check happens in `installFromStagedDir` after
  // the staged tree exists.
  const slug = opts.asSlug ?? source.registrySlug;
  const agentsDirAbs = path.resolve(opts.agentsDir);
  const targetDir = path.join(agentsDirAbs, slug);
  if (fs.existsSync(targetDir) && !opts.force) {
    let priorSidecar: MinihSourceSidecar | null = null;
    try {
      priorSidecar = readSourceSidecar(targetDir);
    } catch {
      priorSidecar = null;
    }
    if (priorSidecar === null) {
      throw new Error(
        `agent install: target folder exists without .minih-source.json (E183) — looks like a hand-rolled agent at ${targetDir}. Use --as <new-slug> to install alongside, or --force to overwrite (destructive).`,
      );
    }
  }

  const { commitSha, tarball } = await fetcher.fetchTarball(
    source.url,
    source.ref,
  );

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-agent-pack-'));
  try {
    await extractTarball(tarball, tmpRoot);

    const stagedSourcePath = source.subpath
      ? path.join(tmpRoot, source.subpath)
      : tmpRoot;

    if (
      !fs.existsSync(stagedSourcePath) ||
      !fs.statSync(stagedSourcePath).isDirectory()
    ) {
      throw new Error(
        `agent install: registry slug "${source.registrySlug}" subpath "${source.subpath ?? ''}" not found in tarball from ${source.url}@${source.ref} (E182). The registry catalog may point at a stale ref or subpath.`,
      );
    }

    const sidecarSource: AgentPackSource = {
      type: 'registry',
      registrySlug: source.registrySlug,
      url: source.url,
      ref: source.ref,
      subpath: source.subpath,
      commitSha,
    };

    return installFromStagedDir({
      stagedSourcePath,
      slug,
      sidecarSource,
      opts,
    });
  } finally {
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup; if it fails the OS will eventually clean tmpdir.
    }
  }
}

async function installFromLocal(
  source: { type: 'local'; localPath: string },
  opts: InstallOptions,
): Promise<InstallResult> {
  const localPath = path.resolve(source.localPath);
  if (!fs.existsSync(localPath)) {
    throw new Error(
      `agent install: source path does not exist (E182): ${localPath}`,
    );
  }
  const stat = fs.statSync(localPath);
  if (!stat.isDirectory()) {
    throw new Error(
      `agent install: source path is not a directory (E182): ${localPath}`,
    );
  }

  const slug = opts.asSlug ?? path.basename(localPath);
  const sidecarSource: AgentPackSource = {
    type: 'local',
    localPath,
    resolvedAt: new Date().toISOString(),
  };

  return installFromStagedDir({
    stagedSourcePath: localPath,
    slug,
    sidecarSource,
    opts,
    selfInstallGuardLocalPath: localPath,
  });
}

/**
 * Install via remote URL: fetch tarball → extract to temp dir → optionally
 * slice into `subpath` → run the same atomic-swap install logic as local
 * sources but with `sidecar.source.type = 'url'`.
 *
 * Tmp dir uses the canonical `minih-agent-pack-` prefix so test cleanup
 * can scope assertions to entries we own. Always cleaned up via
 * try/finally — even on extract or copy failure.
 */
async function installFromUrl(
  source: { type: 'url'; url: string; ref: string; subpath?: string },
  opts: InstallOptions,
  fetcher: IAgentPackFetcher,
): Promise<InstallResult> {
  const { commitSha, tarball } = await fetcher.fetchTarball(
    source.url,
    source.ref,
  );

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-agent-pack-'));
  try {
    await extractTarball(tarball, tmpRoot);

    const stagedSourcePath = source.subpath
      ? path.join(tmpRoot, source.subpath)
      : tmpRoot;

    if (
      !fs.existsSync(stagedSourcePath) ||
      !fs.statSync(stagedSourcePath).isDirectory()
    ) {
      throw new Error(
        `agent install: subpath "${source.subpath ?? ''}" not found in tarball from ${source.url}@${source.ref} (E182)`,
      );
    }

    const slug =
      opts.asSlug ??
      (source.subpath
        ? path.basename(source.subpath)
        : extractRepoNameFromUrl(source.url));

    const sidecarSource: AgentPackSource = {
      type: 'url',
      url: source.url,
      ref: source.ref,
      subpath: source.subpath,
      commitSha,
    };

    return installFromStagedDir({
      stagedSourcePath,
      slug,
      sidecarSource,
      opts,
    });
  } finally {
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup; if it fails the OS will eventually clean tmpdir.
    }
  }
}

/**
 * Derive a default install slug from a URL when no subpath is provided.
 * Examples:
 *   `github:foo/my-agent` → `my-agent`
 *   `https://github.com/foo/my-agent.git` → `my-agent`
 */
function extractRepoNameFromUrl(url: string): string {
  let repoSlug: string;
  if (url.startsWith('github:')) {
    repoSlug = url.slice('github:'.length);
  } else if (url.startsWith('https://github.com/')) {
    repoSlug = url.slice('https://github.com/'.length);
  } else {
    repoSlug = url;
  }
  repoSlug = repoSlug.replace(/\.git$/, '').replace(/\/$/, '');
  const parts = repoSlug.split('/');
  return parts[parts.length - 1] || 'unnamed-agent';
}

/**
 * The shared post-source-resolution install path. Both `installFromLocal`
 * and `installFromUrl` end up here once they've staged the source files
 * to a directory on disk.
 *
 * Side effects (in order):
 *   1. Read or synthesize manifest from `stagedSourcePath`
 *   2. Compute fresh checksums of files-to-copy
 *   3. Read prior sidecar from `targetDir` if present
 *   4. Detect collision (existing folder w/o sidecar) → E183 unless `force`
 *   5. Detect no-op (sidecar source matches AND checksums match) → return 'unchanged'
 *   6. Atomic per-file copy (tmp + rename)
 *   7. Surgical sync (delete files in OLD manifest but not NEW)
 *   8. Write provenance sidecar
 *
 * Runtime dirs (`runs/`, `inbox/`, `state/`) are NEVER touched — single
 * source of truth for the preservation guarantee.
 */
async function installFromStagedDir(args: {
  stagedSourcePath: string;
  slug: string;
  sidecarSource: AgentPackSource;
  opts: InstallOptions;
  /** When set, refuse if `agentsDir/slug` resolves to this path (self-install protection). */
  selfInstallGuardLocalPath?: string;
}): Promise<InstallResult> {
  const { stagedSourcePath, slug, sidecarSource, opts } = args;

  // Read OR synthesize manifest. Both throw on validation failure — no disk
  // writes happen until we have a known-good manifest in hand.
  let manifest: AgentPackManifest;
  const explicit = readAgentManifest(stagedSourcePath);
  if (explicit) {
    manifest = explicit;
  } else {
    manifest = synthesizeImplicitManifest(stagedSourcePath);
  }

  const agentsDirAbs = path.resolve(opts.agentsDir);
  const targetDir = path.join(agentsDirAbs, slug);

  if (
    args.selfInstallGuardLocalPath &&
    path.resolve(targetDir) === args.selfInstallGuardLocalPath
  ) {
    throw new Error(
      `agent install: refusing self-install — source and target are the same path (${args.selfInstallGuardLocalPath}). Use --as <new-slug> to install under a different name.`,
    );
  }

  // Determine action: install vs upgrade vs unchanged vs E183 collision.
  const targetExists = fs.existsSync(targetDir);
  let priorSidecar: MinihSourceSidecar | null = null;
  if (targetExists) {
    try {
      priorSidecar = readSourceSidecar(targetDir);
    } catch {
      priorSidecar = null;
    }
    if (!priorSidecar && !opts.force) {
      throw new Error(
        `agent install: target folder exists without .minih-source.json (E183) — looks like a hand-rolled agent at ${targetDir}. Use --as <new-slug> to install alongside, or --force to overwrite (destructive).`,
      );
    }
  }

  // Compute fresh checksums BEFORE any writes — needed for upgrade-vs-no-op decision.
  const filePaths = manifest.files.map((f) => f.path);
  const filesToCopy = new Set(filePaths);
  if (
    !filesToCopy.has(AGENT_MANIFEST_FILENAME) &&
    fs.existsSync(path.join(stagedSourcePath, AGENT_MANIFEST_FILENAME))
  ) {
    filesToCopy.add(AGENT_MANIFEST_FILENAME);
  }
  const filesToCopyList = [...filesToCopy];
  const sourceChecksums = computeFileChecksums(
    stagedSourcePath,
    filesToCopyList,
  );

  // No-op detection. The sidecar source must match the new source AND
  // every file checksum must match what's recorded.
  if (priorSidecar && sourcesEquivalent(priorSidecar.source, sidecarSource)) {
    const allMatch =
      Object.keys(sourceChecksums).every(
        (k) => priorSidecar?.fileChecksums[k] === sourceChecksums[k],
      ) &&
      Object.keys(priorSidecar.fileChecksums).every(
        (k) => sourceChecksums[k] === priorSidecar?.fileChecksums[k],
      );
    if (allMatch) {
      // F002 fix (companion review): for `url`/`registry` sources, content
      // bytes can match while the upstream commit advanced. The contract
      // (domain.md + spec) says `commitSha` drives provenance, so when the
      // remote sha changed we MUST refresh the sidecar even on no-op file
      // bytes — otherwise `agent info` shows stale provenance forever.
      const priorSha = sidecarCommitSha(priorSidecar.source);
      const newSha = sidecarCommitSha(sidecarSource);
      if (priorSha !== null && newSha !== null && priorSha !== newSha) {
        const refreshedSidecar: MinihSourceSidecar = {
          ...priorSidecar,
          source: sidecarSource,
          installedAt: new Date().toISOString(),
        };
        writeSourceSidecar(targetDir, refreshedSidecar);
      }
      return {
        action: 'unchanged',
        slug,
        installPath: targetDir,
        source: cloneSidecarSource(sidecarSource),
        files: filesToCopyList,
      };
    }
  }

  const action: InstallAction = priorSidecar ? 'upgraded' : 'installed';

  let changedFiles: string[] | undefined;
  if (priorSidecar) {
    changedFiles = filesToCopyList.filter(
      (f) => priorSidecar?.fileChecksums[f] !== sourceChecksums[f],
    );
  }

  fs.mkdirSync(targetDir, { recursive: true });

  if (priorSidecar === null && opts.force) {
    for (const entry of fs.readdirSync(targetDir, { withFileTypes: true })) {
      if (RUNTIME_PRESERVE.has(entry.name)) continue;
      const entryPath = path.join(targetDir, entry.name);
      fs.rmSync(entryPath, { recursive: true, force: true });
    }
  }

  if (priorSidecar) {
    const oldFiles = Object.keys(priorSidecar.fileChecksums);
    for (const oldFile of oldFiles) {
      if (!filesToCopy.has(oldFile)) {
        const abs = path.join(targetDir, oldFile);
        if (fs.existsSync(abs)) fs.rmSync(abs, { force: true });
      }
    }
  }

  for (const rel of filesToCopyList) {
    const src = path.join(stagedSourcePath, rel);
    const dst = path.join(targetDir, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    const tmp = `${dst}.minih-tmp-${process.pid}`;
    fs.copyFileSync(src, tmp);
    fs.renameSync(tmp, dst);
  }

  // Plan 018 R3 (T-R3.2) — capture lockedDefault on the new sidecar.
  // Lossless-preservation invariant: if priorSidecar already had
  // `lockedDefault`, NEVER overwrite it. The only legitimate path to
  // changing it is FX001 `permissions reset` (deferred).
  let lockedDefault: string | undefined =
    priorSidecar?.lockedDefault ?? undefined;
  let lockedDefaultRecordedAt: string | undefined =
    priorSidecar?.lockedDefaultRecordedAt ?? undefined;
  let lockedDefaultReason: string | undefined =
    priorSidecar?.lockedDefaultReason ?? undefined;

  if (!lockedDefault) {
    const recommended = manifest.permissions?.recommended;
    if (opts.permissionsAccept === true && typeof recommended === 'string') {
      lockedDefault = recommended;
      lockedDefaultReason = 'manifest-recommended';
    } else if (
      opts.permissionsAccept === false &&
      manifest.permissions?.fallback
    ) {
      lockedDefault = manifest.permissions.fallback;
      lockedDefaultReason = 'manifest-fallback';
    } else if (opts.permissionsOverride) {
      lockedDefault = opts.permissionsOverride;
      lockedDefaultReason = 'user-override';
    } else {
      // Plan 018 R5 (T-R5.2) — new installs use the current release default.
      // R1-R4: 'yolo' (no behaviour change). R5+: 'restricted'.
      // Existing sidecars with lockedDefault are preserved (lossless invariant).
      lockedDefault = (await import('./../permissions/presets.js'))
        .minihReleaseDefault;
      lockedDefaultReason = 'minih-default';
    }
    lockedDefaultRecordedAt = new Date().toISOString();
  }

  const sidecar: MinihSourceSidecar = {
    schemaVersion: '1',
    slug,
    source: sidecarSource,
    installedAt: new Date().toISOString(),
    manifestVersion: manifest.version,
    fileChecksums: sourceChecksums,
    ...(lockedDefault !== undefined && { lockedDefault }),
    ...(lockedDefaultRecordedAt !== undefined && { lockedDefaultRecordedAt }),
    ...(lockedDefaultReason !== undefined && { lockedDefaultReason }),
  };
  writeSourceSidecar(targetDir, sidecar);

  return {
    action,
    slug,
    installPath: targetDir,
    source: cloneSidecarSource(sidecarSource),
    files: filesToCopyList,
    changedFiles,
  };
}

/**
 * Compare two sidecar source descriptors for "is this the same source?".
 * Local: same `localPath`. URL: same url/ref/subpath (commitSha is allowed
 * to differ — that's what triggers an upgrade). Registry: same registrySlug.
 */
function sourcesEquivalent(a: AgentPackSource, b: AgentPackSource): boolean {
  if (a.type !== b.type) return false;
  if (a.type === 'local' && b.type === 'local') {
    return path.resolve(a.localPath) === path.resolve(b.localPath);
  }
  if (a.type === 'url' && b.type === 'url') {
    return a.url === b.url && a.ref === b.ref && a.subpath === b.subpath;
  }
  if (a.type === 'registry' && b.type === 'registry') {
    return a.registrySlug === b.registrySlug;
  }
  return false;
}

function sidecarCommitSha(s: AgentPackSource): string | null {
  if (s.type === 'url' || s.type === 'registry') return s.commitSha;
  return null;
}

function cloneSidecarSource(s: AgentPackSource): AgentPackSource {
  return JSON.parse(JSON.stringify(s)) as AgentPackSource;
}
