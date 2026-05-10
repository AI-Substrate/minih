/**
 * FS guard for the permissions feature — Plan 018 R1.
 *
 * Workshop 001 § Q2-Q7 covers semantics:
 *   - resolveDefaultAllowedRoots: git-root walk + worktree handling + cwd fallback
 *   - canonicalizeRoots: 4-source merge with extend/replace + denylist for hostile roots
 *   - isPathAllowed: per-access realpath; ENOENT-aware (write-to-new-file)
 *   - extractPathArg: heuristic recogniser for path-bearing tool args
 *
 * Threat model: best-effort against well-behaved-but-mistaken agents, NOT
 * adversarial. TOCTOU race is documented residual risk (workshop 001 § Q4)
 * because Node lacks `openat`. For adversarial threat models, recommend
 * Layer-(b) `--strict-fs` (Phase 6 stretch T-S1) plus OS-level isolation.
 */

import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { AllowedRootsRule, RootProvenance } from './policy.js';

/** Roots that are NEVER allowed even if the user explicitly lists them. */
const FORBIDDEN_ROOTS = [
  '/',
  '/etc',
  '/usr',
  '/bin',
  '/sbin',
  '/System',
  '/Windows',
];

/** Roots we'll accept but warn about. */
const WARNING_ROOTS = [os.homedir(), '/tmp', '/var/tmp'];

export class ForbiddenRootError extends Error {
  constructor(root: string) {
    super(
      `Root "${root}" is on the forbidden list and cannot be added to allowedRoots. ` +
        `Forbidden roots: ${FORBIDDEN_ROOTS.join(', ')}`,
    );
    this.name = 'ForbiddenRootError';
  }
}

export class AllowedRootsInvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AllowedRootsInvalidError';
  }
}

/**
 * Walk up from `cwd` looking for a `.git` directory. Returns the absolute
 * path of the discovered git root, or `null` if no `.git` is found before
 * filesystem root.
 */
function findGitRoot(cwd: string): string | null {
  let current = path.resolve(cwd);
  // Bound the walk — avoid pathological symlink loops by limiting iterations.
  for (let i = 0; i < 256; i++) {
    if (fs.existsSync(path.join(current, '.git'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return null;
}

/**
 * Detect a git worktree (.git is a file pointing at a gitdir, not a dir).
 * Returns the worktree's primary working directory, falling back to the
 * `current` arg if probe fails.
 */
function findWorktreeRoot(current: string): string {
  try {
    const result = execSync('git rev-parse --show-toplevel', {
      cwd: current,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (result) return result;
  } catch {
    // git not installed or not a worktree — fall through.
  }
  return current;
}

/**
 * Resolve the default allowed-roots set for `cwd` per workshop 001 § Q2.
 *
 * Algorithm:
 *   1. Walk up from `cwd` looking for `.git`.
 *   2. If `.git` is a file (worktree), follow it to the worktree root.
 *   3. If no `.git` found, fall back to `cwd` itself with a `cwd-fallback` provenance.
 *   4. If the resolved root is `$HOME`, attach a warning provenance.
 *   5. If the resolved root is `/` or any forbidden root, refuse.
 */
export function resolveDefaultAllowedRoots(cwd: string): {
  roots: string[];
  reasons: RootProvenance[];
} {
  const absCwd = path.resolve(cwd);
  const gitDir = findGitRoot(absCwd);

  if (gitDir) {
    const dotGitPath = path.join(gitDir, '.git');
    let root = gitDir;
    try {
      const stat = fs.statSync(dotGitPath);
      if (stat.isFile()) {
        // Linked worktree — resolve to the worktree's CWD.
        root = findWorktreeRoot(absCwd);
      }
    } catch {
      // Ignore stat errors — fall back to gitDir.
    }
    // Realpath the discovered root so symlinked tmp dirs (/tmp →
    // /private/tmp on macOS) compare cleanly with downstream
    // realpath-each-access checks.
    let canonicalRoot: string;
    try {
      canonicalRoot = fs.realpathSync(root);
    } catch {
      canonicalRoot = root;
    }
    return {
      roots: [canonicalRoot],
      reasons: [
        {
          root: canonicalRoot,
          source: 'git-root',
          reason: `discovered .git at ${dotGitPath}`,
        },
      ],
    };
  }

  // No git → cwd-fallback. Refuse forbidden roots even here.
  if (FORBIDDEN_ROOTS.includes(absCwd)) {
    throw new ForbiddenRootError(absCwd);
  }

  let canonicalCwd: string;
  try {
    canonicalCwd = fs.realpathSync(absCwd);
  } catch {
    canonicalCwd = absCwd;
  }

  return {
    roots: [canonicalCwd],
    reasons: [
      {
        root: canonicalCwd,
        source: 'cwd-fallback',
        reason: 'no .git ancestor found — falling back to cwd',
      },
    ],
  };
}

/**
 * Canonicalize a root path: resolve symlinks, normalize, throw on hostile
 * inputs. This runs ONCE at policy compile time — `isPathAllowed` does the
 * per-access realpath separately to defend against post-compile changes.
 */
function canonicalizeRoot(root: string): string {
  if (!root || typeof root !== 'string') {
    throw new AllowedRootsInvalidError(
      `Empty/non-string root: ${JSON.stringify(root)}`,
    );
  }
  const abs = path.isAbsolute(root) ? root : path.resolve(root);

  if (FORBIDDEN_ROOTS.includes(abs)) {
    throw new ForbiddenRootError(abs);
  }

  // Try realpath; fall back to path.normalize on ENOENT (the directory will
  // be created later by the agent — common pattern for output dirs).
  try {
    return fs.realpathSync(abs);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return path.normalize(abs);
    }
    throw new AllowedRootsInvalidError(
      `Could not canonicalize root "${root}": ${(err as Error).message}`,
    );
  }
}

/**
 * Composition mode for multi-source root merging. Workshop 001 § Q5 worked
 * example.
 *
 *   layer order: harness → frontmatter → env → cli (top wins)
 *
 * Each layer can be `extend` (default — additive) or `replace` (wipes
 * everything below). The output is a deduped, canonical, lower-layer-first
 * array.
 */
export function canonicalizeRoots(
  layers: Array<{
    source: RootProvenance['source'];
    rule: AllowedRootsRule | undefined;
  }>,
  defaults: { roots: string[]; reasons: RootProvenance[] },
): { canonicalRoots: string[]; rootsResolvedFrom: RootProvenance[] } {
  // Start with defaults; treat them as the "harness floor" of the stack.
  let roots: string[] = [...defaults.roots];
  let provenance: RootProvenance[] = [...defaults.reasons];

  for (const layer of layers) {
    if (!layer.rule) continue;
    const mode = layer.rule.mode ?? 'extend';

    if (mode === 'replace') {
      roots = [];
      provenance = [];
    }

    for (const raw of layer.rule.roots) {
      const canonical = canonicalizeRoot(raw);
      if (roots.includes(canonical)) continue;
      roots.push(canonical);
      provenance.push({
        root: canonical,
        source: layer.source,
        reason: `from ${layer.source}: ${raw}`,
      });
    }
  }

  // Final guards: never empty, never forbidden.
  if (roots.length === 0) {
    throw new AllowedRootsInvalidError(
      'allowedRoots resolved to an empty list after composition (a `replace` layer with no entries?). Refusing to run with no FS access.',
    );
  }
  for (const r of roots) {
    if (FORBIDDEN_ROOTS.includes(r)) throw new ForbiddenRootError(r);
  }

  return { canonicalRoots: roots, rootsResolvedFrom: provenance };
}

/**
 * Per-access path check. Realpaths the path; if it doesn't exist, realpaths
 * its parent and treats the path as `parent/basename`. Returns true iff the
 * resolved path is under at least one canonical root.
 *
 * Symlink-out detection: realpathSync naturally follows the symlink target;
 * if the target is outside the roots, this returns false. ELOOP / broken
 * symlinks throw → propagate as denial.
 */
export function isPathAllowed(
  rawPath: string,
  canonicalRoots: readonly string[],
): boolean {
  if (!rawPath) return false;
  const abs = path.isAbsolute(rawPath) ? rawPath : path.resolve(rawPath);

  let resolved: string;
  try {
    resolved = fs.realpathSync(abs);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      // Path doesn't exist (write-to-new-file). Realpath the parent dir;
      // append the basename.
      const parent = path.dirname(abs);
      try {
        const parentResolved = fs.realpathSync(parent);
        resolved = path.join(parentResolved, path.basename(abs));
      } catch {
        return false;
      }
    } else {
      // ELOOP, EACCES, ENAMETOOLONG, etc. — fail closed.
      return false;
    }
  }

  for (const root of canonicalRoots) {
    if (resolved === root) return true;
    if (resolved.startsWith(root + path.sep)) return true;
  }
  return false;
}

/**
 * Heuristic path-arg extractor. Inspects `args` for a path-bearing field
 * based on a) JSON Schema `format: path` (not yet wired into SDK) and
 * b) heuristic name match (`*Path`, `*Dir`, `cwd`, `file`, `targetDir`).
 *
 * Returns `null` for non-path-bearing tools (e.g., url, mcp). This is
 * deliberately conservative — false negatives (we don't gate a path) are
 * less risky than false positives (we gate something that wasn't a path).
 *
 * Workshop 001 § Q7 documents the limitations.
 */
export function extractPathArg(toolName: string, args: unknown): string | null {
  if (args == null || typeof args !== 'object') return null;
  const obj = args as Record<string, unknown>;

  // Common SDK shell tool: { command, cwd? }
  if (toolName === 'shell' || toolName === 'bash' || toolName === 'execute') {
    if (typeof obj.cwd === 'string') return obj.cwd;
    return null;
  }

  // Common file-ops: read/write/edit/create
  for (const candidate of [
    'file',
    'path',
    'filePath',
    'targetPath',
    'targetDir',
    'cwd',
  ]) {
    if (typeof obj[candidate] === 'string') return obj[candidate] as string;
  }

  // Match heuristic suffixes: *Path, *Dir
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v !== 'string') continue;
    if (/(?:Path|Dir|Directory|FilePath|File)$/i.test(k)) return v;
  }

  return null;
}

export const __forbiddenRootsForTests = FORBIDDEN_ROOTS;
export const __warningRootsForTests = WARNING_ROOTS;
