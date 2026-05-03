import * as fs from 'node:fs';
import * as path from 'node:path';
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
    throw new Error(
      'agent install from URL is not yet available in this build (E182). The remote-fetch implementation lands in Phase 3.2 of plan-017. For now, use a local filesystem path: `minih agent install /abs/path/to/agent`.',
    );
  }
  if (opts.source.type === 'registry') {
    throw new Error(
      'agent install from registry slug is not yet available in this build (E182). Registry resolution lands in Phase 4 of plan-017. For now, use a local filesystem path: `minih agent install /abs/path/to/agent`.',
    );
  }

  return installFromLocal(opts.source, opts);
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

  // Read OR synthesize manifest. Both throw on validation failure — no disk
  // writes happen until we have a known-good manifest in hand.
  let manifest: AgentPackManifest;
  const explicit = readAgentManifest(localPath);
  if (explicit) {
    manifest = explicit;
  } else {
    manifest = synthesizeImplicitManifest(localPath);
  }

  // Determine install destination + slug.
  const slug = opts.asSlug ?? path.basename(localPath);
  const agentsDirAbs = path.resolve(opts.agentsDir);
  const targetDir = path.join(agentsDirAbs, slug);

  // Guard: self-install (source path === target path).
  if (path.resolve(targetDir) === localPath) {
    throw new Error(
      `agent install: refusing self-install — source and target are the same path (${localPath}). Use --as <new-slug> to install under a different name.`,
    );
  }

  // Determine action: install vs upgrade vs unchanged vs E183 collision.
  const targetExists = fs.existsSync(targetDir);
  let priorSidecar: MinihSourceSidecar | null = null;
  if (targetExists) {
    try {
      priorSidecar = readSourceSidecar(targetDir);
    } catch {
      // Malformed sidecar treated as if missing — caller can --force.
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
  // Manifest files may include `agent.json` itself; if it's NOT listed but exists, we still
  // copy it (so `info` can re-read). Track this set for atomic-swap.
  const filesToCopy = new Set(filePaths);
  if (
    !filesToCopy.has(AGENT_MANIFEST_FILENAME) &&
    fs.existsSync(path.join(localPath, AGENT_MANIFEST_FILENAME))
  ) {
    filesToCopy.add(AGENT_MANIFEST_FILENAME);
  }
  const filesToCopyList = [...filesToCopy];
  const sourceChecksums = computeFileChecksums(localPath, filesToCopyList);

  // No-op detection: matching sidecar source (local + same path) AND every
  // manifest checksum matches what's recorded.
  if (priorSidecar && priorSidecar.source.type === 'local') {
    const samePath = path.resolve(priorSidecar.source.localPath) === localPath;
    const allMatch =
      Object.keys(sourceChecksums).every(
        (k) => priorSidecar?.fileChecksums[k] === sourceChecksums[k],
      ) &&
      Object.keys(priorSidecar.fileChecksums).every(
        (k) => sourceChecksums[k] === priorSidecar?.fileChecksums[k],
      );
    if (samePath && allMatch) {
      return {
        action: 'unchanged',
        slug,
        installPath: targetDir,
        source: cloneSidecarSource(priorSidecar.source),
        files: filesToCopyList,
      };
    }
  }

  // Determine whether this is fresh install or upgrade.
  const action: InstallAction = priorSidecar ? 'upgraded' : 'installed';

  // Compute changed files (relevant for upgrade reporting).
  let changedFiles: string[] | undefined;
  if (priorSidecar) {
    changedFiles = filesToCopyList.filter(
      (f) => priorSidecar?.fileChecksums[f] !== sourceChecksums[f],
    );
  }

  // Atomic-swap: write to a temp directory inside the target's parent, then
  // rename source files atomically into place. Runtime dirs are NEVER touched.
  fs.mkdirSync(targetDir, { recursive: true });

  // For force overwrite, remove non-runtime files first.
  if (priorSidecar === null && opts.force) {
    for (const entry of fs.readdirSync(targetDir, { withFileTypes: true })) {
      if (RUNTIME_PRESERVE.has(entry.name)) continue;
      const entryPath = path.join(targetDir, entry.name);
      fs.rmSync(entryPath, { recursive: true, force: true });
    }
  }

  // Surgical sync: remove files present in the OLD manifest but not in the new.
  if (priorSidecar) {
    const oldFiles = Object.keys(priorSidecar.fileChecksums);
    for (const oldFile of oldFiles) {
      if (!filesToCopy.has(oldFile)) {
        const abs = path.join(targetDir, oldFile);
        if (fs.existsSync(abs)) fs.rmSync(abs, { force: true });
      }
    }
  }

  // Copy each manifest file. Each copy is a tmp+rename for atomicity per-file.
  for (const rel of filesToCopyList) {
    const src = path.join(localPath, rel);
    const dst = path.join(targetDir, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    const tmp = `${dst}.minih-tmp-${process.pid}`;
    fs.copyFileSync(src, tmp);
    fs.renameSync(tmp, dst);
  }

  // Write the provenance sidecar last (after all source files are in place).
  const sidecarSource: AgentPackSource = {
    type: 'local',
    localPath,
    resolvedAt: new Date().toISOString(),
  };
  const sidecar: MinihSourceSidecar = {
    schemaVersion: '1',
    slug,
    source: sidecarSource,
    installedAt: new Date().toISOString(),
    manifestVersion: manifest.version,
    fileChecksums: sourceChecksums,
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

function cloneSidecarSource(s: AgentPackSource): AgentPackSource {
  return JSON.parse(JSON.stringify(s)) as AgentPackSource;
}
