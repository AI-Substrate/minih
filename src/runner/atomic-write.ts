/**
 * Write-then-rename atomic file writer.
 *
 * Pattern: write to `${path}.tmp.${pid}.${counter}`, fsync, rename. POSIX `rename(2)`
 * is atomic within the same filesystem. Used for state JSON files and the P3
 * watermark file (workshop 001 + 007).
 *
 * Failure modes (specified, not assumed):
 * - Tmp-file collision from prior crash: monotonic counter prevents collision.
 * - EXDEV (cross-fs rename): typed `AtomicWriteCrossFsError` thrown; caller
 *   must keep state on same filesystem.
 * - fsync failure (e.g., tmpfs): tmp file unlinked before re-throwing.
 * - Missing parent directory: throws clear `ENOENT`. Callers (state.ts) own
 *   `mkdirSync({recursive:true})` before calling.
 * - Orphaned tmp files: NOT auto-cleaned in v1; counter ensures fresh writes
 *   succeed regardless. Document in operator notes if a cleanup story is needed.
 *
 * POSIX-only. Windows is OUT OF SCOPE for atomic semantics; Windows users run
 * via WSL2.
 */

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';

let counter = 0;

export class AtomicWriteCrossFsError extends Error {
  constructor(target: string) {
    super(
      `atomic-write: cross-filesystem rename (EXDEV) not supported. ` +
        `The target file ${target} and its tmp file must live on the same filesystem.`,
    );
    this.name = 'AtomicWriteCrossFsError';
  }
}

function tmpPath(target: string): string {
  counter = (counter + 1) >>> 0;
  return `${target}.tmp.${process.pid}.${counter}`;
}

function isExdev(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: string }).code === 'EXDEV'
  );
}

/**
 * Atomically write `content` to `path` (sync). Writes to a temp file, fsyncs,
 * then renames over the target. Throws on EXDEV / missing parent / fsync errors.
 */
export function writeFileAtomic(path: string, content: string | Buffer): void {
  const tmp = tmpPath(path);
  let fd: number | null = null;
  try {
    fd = fs.openSync(tmp, 'w');
    if (typeof content === 'string') {
      fs.writeSync(fd, content);
    } else {
      fs.writeSync(fd, content);
    }
    fs.fsyncSync(fd);
  } catch (err) {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // ignore — we're already in an error path
      }
      fd = null;
    }
    try {
      fs.unlinkSync(tmp);
    } catch {
      // ignore — tmp may not exist
    }
    throw err;
  }
  try {
    fs.closeSync(fd);
  } catch {
    // ignore close errors after successful fsync
  }
  try {
    fs.renameSync(tmp, path);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // ignore
    }
    if (isExdev(err)) throw new AtomicWriteCrossFsError(path);
    throw err;
  }
}

/**
 * Async variant of {@link writeFileAtomic}. Same semantics; uses `fs/promises`.
 */
export async function writeFileAtomicAsync(
  path: string,
  content: string | Buffer,
): Promise<void> {
  const tmp = tmpPath(path);
  let handle: Awaited<ReturnType<typeof fsp.open>> | null = null;
  try {
    handle = await fsp.open(tmp, 'w');
    await handle.writeFile(content);
    await handle.sync();
  } catch (err) {
    if (handle) {
      try {
        await handle.close();
      } catch {
        // ignore
      }
      handle = null;
    }
    try {
      await fsp.unlink(tmp);
    } catch {
      // ignore
    }
    throw err;
  }
  try {
    await handle.close();
  } catch {
    // ignore close errors after successful fsync
  }
  try {
    await fsp.rename(tmp, path);
  } catch (err) {
    try {
      await fsp.unlink(tmp);
    } catch {
      // ignore
    }
    if (isExdev(err)) throw new AtomicWriteCrossFsError(path);
    throw err;
  }
}
