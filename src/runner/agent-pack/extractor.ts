import * as fs from 'node:fs';
import * as path from 'node:path';
import { Writable } from 'node:stream';
import * as zlib from 'node:zlib';
import type { ReadEntry } from 'tar';
import { Parser } from 'tar';
import { RUNTIME_DIR_NAMES } from './manifest.js';

/**
 * Tarball extractor — gunzip + tar parse → write to disk under `destDir`.
 *
 * Used by the agent-pack install path (Phase 3 of plan-017). The input is
 * a `.tar.gz` Buffer fetched from GitHub's tarball endpoint. The output is
 * a list of relative file paths written to `destDir`.
 *
 * **Security guards** (T004 — see `extractor.test.ts` for the full attack
 * matrix). Every byte we receive is treated as adversarial. We reject any
 * entry that fails any guard and abort with `(E182)` literal in the error
 * message so the CLI's `pickErrorCode` regex can lift it out cleanly.
 *
 * **Top-level prefix strip**: GitHub tarballs wrap every entry in a
 * `<repo>-<sha-prefix>/` directory. We detect the prefix from the first
 * entry's leading path segment and strip it from every subsequent entry.
 * If a later entry doesn't share the prefix, we abort.
 *
 * **Pax / GlobalHeader / NextFileHasLongPath / NextFileHasLongLinkpath**:
 * these are tar metadata extension entries (typeflag `'x'`/`'g'`/`'L'`/`'K'`).
 * They modify the next-or-current entry's metadata. We can safely ignore
 * them — `tar.Parser` already applies their effects to the subsequent
 * `ReadEntry` it emits.
 */

/** What the extractor returns on success. */
export interface ExtractTarballResult {
  /** Manifest-relative paths of every regular-file entry written. */
  filesWritten: string[];
}

/** Tunable limits — exported for tests and forward-compat. */
export interface ExtractOptions {
  /** Cumulative decompressed bytes across all entries. Default 10 * 1024 * 1024. */
  maxTotalSize?: number;
  /** Per-entry decompressed bytes. Default 2 * 1024 * 1024. */
  maxEntrySize?: number;
  /** Total number of entries (incl. dirs and metadata entries). Default 5000. */
  maxEntries?: number;
  /** Per-entry path length in BYTES (after prefix strip). Default 255. */
  maxPathLength?: number;
  /** Compressed → decompressed ratio. Default 100. */
  maxExpansionRatio?: number;
  /** Wall-clock soft budget for gunzip+parse, in milliseconds. Default 5000. */
  gunzipTimeoutMs?: number;
}

const DEFAULTS: Required<ExtractOptions> = {
  maxTotalSize: 10 * 1024 * 1024,
  maxEntrySize: 2 * 1024 * 1024,
  maxEntries: 5000,
  maxPathLength: 255,
  maxExpansionRatio: 100,
  gunzipTimeoutMs: 5000,
};

export async function extractTarball(
  tarball: Buffer,
  destDir: string,
  opts: ExtractOptions = {},
): Promise<ExtractTarballResult> {
  const limits = { ...DEFAULTS, ...opts };
  const compressedSize = tarball.byteLength;

  fs.mkdirSync(destDir, { recursive: true });

  const filesWritten: string[] = [];
  let prefix: string | null = null;
  let entryCount = 0;
  let totalBytes = 0;
  const seenPaths = new Set<string>();

  return await new Promise<ExtractTarballResult>((resolve, reject) => {
    let aborted = false;
    let parserEnded = false;
    let pendingWrites = 0;
    const wallClockTimer = setTimeout(() => {
      if (!aborted) {
        const err = new Error(
          `agent-pack extractor (E182): gunzip+parse exceeded ${limits.gunzipTimeoutMs} ms wall-clock budget`,
        );
        fail(err.message);
      }
    }, limits.gunzipTimeoutMs);

    function fail(message: string): void {
      if (aborted) return;
      aborted = true;
      clearTimeout(wallClockTimer);
      const err = new Error(`agent-pack extractor (E182): ${message}`);
      try {
        gunzip.destroy(err);
      } catch {
        /* ignore */
      }
      try {
        parser.abort(err);
      } catch {
        /* ignore */
      }
      reject(err);
    }

    function maybeFinish(): void {
      if (aborted) return;
      if (parserEnded && pendingWrites === 0) {
        clearTimeout(wallClockTimer);
        resolve({ filesWritten });
      }
    }

    const parser = new Parser({
      strict: false,
      onReadEntry: (entry: ReadEntry) => {
        if (aborted) {
          entry.resume();
          return;
        }
        try {
          handleEntry(entry);
        } catch (err) {
          fail((err as Error).message);
        }
      },
      onwarn: (_code: string, _message: string) => {
        // tar.Parser emits warnings for non-strict format issues; we treat
        // most as benign (malformed-tar reject is handled by the explicit
        // 'error' event below). Silence the channel; rely on entry-level
        // policy for the security guards.
      },
    });

    parser.on('error', (err: Error) => {
      fail(`malformed tar: ${err.message}`);
    });
    parser.on('end', () => {
      if (aborted) return;
      parserEnded = true;
      maybeFinish();
    });

    function handleEntry(entry: ReadEntry): void {
      entryCount++;
      if (entryCount > limits.maxEntries) {
        throw new Error(
          `entry count exceeded limit (${limits.maxEntries}) — possible entry-flood attack`,
        );
      }

      // Pax / GlobalHeader / long-name extensions — `tar.Parser` applies
      // their effects to subsequent entries, so we just skip them here.
      // They DO count toward the entry budget (defensive — malicious
      // tarballs could pad with 10 K pax entries).
      if (
        entry.type === 'GlobalExtendedHeader' ||
        entry.type === 'ExtendedHeader' ||
        entry.type === 'NextFileHasLongPath' ||
        entry.type === 'NextFileHasLongLinkpath' ||
        entry.type === 'OldGnuLongPath' ||
        entry.meta === true
      ) {
        entry.resume();
        return;
      }

      // T004 security guards land here in the next pass. T003 happy path
      // assumes the input is well-formed.
      const rawPath = entry.path;

      // Reject hard-links / symlinks / device / FIFO / sparse / contiguous /
      // unsupported entries BEFORE prefix processing — even an entry that
      // never gets written can have a malicious typeflag we want to surface.
      if (entry.type === 'SymbolicLink' || entry.type === 'Link') {
        throw new Error(
          `entry "${rawPath}" is a ${entry.type} — symlinks and hard-links are forbidden`,
        );
      }
      if (
        entry.type === 'CharacterDevice' ||
        entry.type === 'BlockDevice' ||
        entry.type === 'FIFO' ||
        entry.type === 'ContiguousFile' ||
        entry.type === 'SparseFile'
      ) {
        throw new Error(
          `entry "${rawPath}" has unsupported type "${entry.type}" — only regular files and directories are allowed`,
        );
      }

      // File-mode check: reject anything with setuid/setgid/sticky bits
      // (the actual elevation/persistence risks). Lower bits (rwxrwxrwx)
      // are not honored on disk by us — we copy via stream and let the
      // OS apply default umask — so we don't need to gate them.
      if (entry.mode !== undefined) {
        const mode = entry.mode & 0o7777;
        if ((mode & 0o7000) !== 0) {
          throw new Error(
            `entry "${rawPath}" has unsafe file mode 0o${mode.toString(8)} — setuid/setgid/sticky bits are forbidden`,
          );
        }
      }

      // Path-shape rejections — apply BEFORE prefix-strip so attacks
      // wrapped in a prefix can't slip through.
      checkPathShape(rawPath, limits.maxPathLength);

      const stripped = stripPrefix(rawPath);
      if (stripped === null) {
        throw new Error(
          `entry path "${rawPath}" does not share the top-level prefix "${prefix}"`,
        );
      }
      if (stripped === '') {
        // The top-level dir entry itself; skip silently.
        entry.resume();
        return;
      }

      // After strip: re-check path-shape (the stripped tail must also be
      // safe — covers `<safe-prefix>/../etc` which strips to `../etc`).
      checkPathShape(stripped, limits.maxPathLength);

      // Runtime-dir denylist (Finding 03). The first path component of
      // the stripped name must not be `runs`/`inbox`/`state`/`.git`.
      const firstComponent = stripped.split('/')[0];
      if (RUNTIME_DIR_NAMES.includes(firstComponent)) {
        throw new Error(
          `entry "${stripped}" begins with reserved runtime directory "${firstComponent}" — manifest paths into runs/inbox/state/.git are forbidden`,
        );
      }

      if (entry.type === 'Directory') {
        const absDir = path.join(destDir, stripped);
        fs.mkdirSync(absDir, { recursive: true });
        entry.resume();
        return;
      }

      // Non-regular-file types beyond what's already rejected → reject.
      if (entry.type !== 'File' && entry.type !== 'OldFile') {
        throw new Error(
          `entry "${stripped}" has unexpected type "${entry.type}" — only regular files are accepted`,
        );
      }

      if (seenPaths.has(stripped)) {
        throw new Error(
          `entry path "${stripped}" appears more than once in tarball — refusing to overwrite`,
        );
      }
      seenPaths.add(stripped);

      const absDest = path.join(destDir, stripped);
      fs.mkdirSync(path.dirname(absDest), { recursive: true });

      let bytesThisEntry = 0;
      pendingWrites++;
      const writeStream = fs.createWriteStream(absDest, {
        flags: 'wx', // exclusive — fail if file exists (defense in depth)
      });

      const sink = new Writable({
        write(chunk: Buffer, _enc, cb) {
          if (aborted) {
            cb();
            return;
          }
          bytesThisEntry += chunk.length;
          totalBytes += chunk.length;
          if (bytesThisEntry > limits.maxEntrySize) {
            cb(
              new Error(
                `entry "${stripped}" exceeded per-entry size limit (${limits.maxEntrySize} bytes)`,
              ),
            );
            return;
          }
          if (totalBytes > limits.maxTotalSize) {
            cb(
              new Error(
                `cumulative decompressed size exceeded limit (${limits.maxTotalSize} bytes)`,
              ),
            );
            return;
          }
          if (
            compressedSize > 0 &&
            totalBytes / compressedSize > limits.maxExpansionRatio
          ) {
            cb(
              new Error(
                `decompression expansion ratio exceeded ${limits.maxExpansionRatio}x — possible decompression bomb`,
              ),
            );
            return;
          }
          writeStream.write(chunk, cb);
        },
        final(cb) {
          writeStream.end(cb);
        },
      });

      sink.on('error', (err) => {
        fail(err.message);
      });
      writeStream.on('error', (err) => {
        fail(`write failed for "${stripped}": ${err.message}`);
      });
      writeStream.on('close', () => {
        if (!aborted) filesWritten.push(stripped);
        pendingWrites--;
        maybeFinish();
      });

      entry.pipe(sink);
    }

    function stripPrefix(rawPath: string): string | null {
      // Normalize backslashes are NOT allowed (T004 will reject them);
      // here we only handle forward slashes.
      const firstSlash = rawPath.indexOf('/');
      if (firstSlash === -1) {
        // No slash → entry is at root. We accept this only if no prefix
        // has been established (e.g. tarballs without a wrapping dir).
        if (prefix === null) {
          prefix = ''; // empty prefix → no stripping
          return rawPath;
        }
        if (prefix === '') return rawPath;
        return null;
      }
      const head = `${rawPath.slice(0, firstSlash)}/`;
      const tail = rawPath.slice(firstSlash + 1);
      if (prefix === null) {
        prefix = head;
        return tail;
      }
      if (head === prefix) {
        return tail;
      }
      return null;
    }

    const gunzip = zlib.createGunzip();
    gunzip.on('error', (err) => {
      fail(`gunzip failed: ${err.message}`);
    });
    gunzip.on('data', (chunk: Buffer) => {
      if (aborted) return;
      try {
        parser.write(chunk);
      } catch (err) {
        fail((err as Error).message);
      }
    });
    gunzip.on('end', () => {
      if (aborted) return;
      try {
        parser.end();
      } catch (err) {
        fail((err as Error).message);
      }
    });
    gunzip.end(tarball);
  });
}

/**
 * Reject path shapes that are unsafe regardless of context. Applies to
 * raw entry paths (before prefix-strip) AND stripped tails.
 *
 * Rejections:
 *  - empty path
 *  - path-length > maxPathLength bytes
 *  - null byte anywhere
 *  - backslash anywhere (Windows-style; we don't translate)
 *  - leading `/` (absolute path)
 *  - leading drive letter (`C:\`, `D:`, etc.)
 *  - any path component that is `..` (after Unicode NFKC normalization to
 *    catch fullwidth `．．` and other compat forms)
 *  - any path component that is `.` (current-dir; suspicious in a tarball)
 */
function checkPathShape(p: string, maxPathLength: number): void {
  if (p === '') {
    throw new Error('entry has empty path');
  }
  if (Buffer.byteLength(p, 'utf8') > maxPathLength) {
    throw new Error(
      `entry path exceeds max length (${maxPathLength} bytes) — possible path-length attack`,
    );
  }
  if (p.includes('\0')) {
    throw new Error(`entry path "${p}" contains null byte`);
  }
  if (p.includes('\\')) {
    throw new Error(
      `entry path "${p}" contains backslash — Windows-style paths are not accepted`,
    );
  }
  if (p.startsWith('/')) {
    throw new Error(`entry path "${p}" is absolute (leading "/")`);
  }
  // Drive-letter check: `C:`, `C:/`, `C:\` (backslash already rejected above).
  if (/^[a-zA-Z]:/.test(p)) {
    throw new Error(
      `entry path "${p}" begins with a drive letter — Windows-style paths are not accepted`,
    );
  }
  // Normalize then re-split. Catches fullwidth `．．` (NFKC → `..`).
  const normalized = p.normalize('NFKC');
  for (const segment of normalized.split('/')) {
    if (segment === '..') {
      throw new Error(
        `entry path "${p}" contains parent-directory traversal ".."`,
      );
    }
    if (segment === '.') {
      throw new Error(
        `entry path "${p}" contains current-directory segment "." (suspicious)`,
      );
    }
  }
}
