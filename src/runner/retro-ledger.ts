/**
 * Retro ledger writer — Plan 011 / Workshop 002.
 *
 * Append-only Markdown writer for `<ledgerDir>/<slug>.md` and (optionally)
 * `<ledgerDir>/<planId>.md`. Idempotent on `runId`, atomic-rename per write,
 * with a small retry-on-conflict loop for best-effort tolerance under
 * simultaneous same-slug writers.
 *
 * Design (locked in Plan 011 § Implementation):
 * - **Idempotent**: scan target file for `runId: <id>` line; if present, skip.
 * - **Atomic-append**: read-modify-write via `writeFileAtomicAsync` (POSIX
 *   write-temp + rename). Single-writer torn-write safe.
 * - **Concurrent-writer policy**: BEST-EFFORT, NOT a strict multi-writer
 *   protocol. Two simultaneous writers may both read the pre-state, both
 *   compute a different post-state, and the second writer overwrites the
 *   first's append. The retry-on-conflict loop (up to 3 attempts) plus the
 *   idempotency check together close most of the gap — a duplicate runId
 *   from a race-retry is still a no-op. Intentional accepted trade-off.
 * - **Failure surfacing**: throws `RetroLedgerError` on unwritable target;
 *   caller (runner) is responsible for the silent-skip on auto-append.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { writeFileAtomicAsync } from './atomic-write.js';

const MAX_RETRY_ATTEMPTS = 3;

/**
 * Per-file in-process write queue. Two parallel `appendRetro*` calls for
 * the same path serialize through this map — solves the in-process race
 * where both writers read empty state and the second clobbers the first.
 *
 * Cross-process concurrency is still best-effort (the retry loop catches
 * many cases); strict multi-writer safety is an explicit non-goal per
 * Workshop 002.
 */
const writeQueues = new Map<string, Promise<void>>();

export type RetroResult = 'timeout' | 'failed' | 'crashed';

export interface RetrospectiveLike {
  summary?: string | null;
  magicWand?: string | null;
  magicWandTarget?: string | null;
  difficulties?: Array<{
    category: string;
    description: string;
    workaround?: string | null;
    severity: string;
  }> | null;
}

export interface AppendRetroEntryArgs {
  slug: string;
  runId: string;
  runDir: string;
  retrospective: RetrospectiveLike;
  /** Optional plan context — when set, also writes to `<ledgerDir>/<planId>.md`. */
  planId?: string;
  ledgerDir: string;
  /** Override timestamp for deterministic tests. */
  now?: () => Date;
}

export interface AppendRetroStubArgs {
  slug: string;
  runId: string;
  runDir: string;
  result: RetroResult;
  stderrTail: string;
  planId?: string;
  ledgerDir: string;
  now?: () => Date;
}

export class RetroLedgerError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'RetroLedgerError';
  }
}

function ledgerPath(ledgerDir: string, name: string): string {
  return path.join(ledgerDir, `${name}.md`);
}

function alreadyContainsRunId(content: string, runId: string): boolean {
  return content.includes(`runId: ${runId}`);
}

function readSafely(file: string): string {
  try {
    return fs.readFileSync(file, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw err;
  }
}

function ensureLedgerDir(ledgerDir: string): void {
  try {
    fs.mkdirSync(ledgerDir, { recursive: true });
  } catch (err) {
    throw new RetroLedgerError(
      `Failed to create ledger directory ${ledgerDir}: ${
        (err as Error).message
      }`,
      err,
    );
  }
}

function renderRetroEntry(args: AppendRetroEntryArgs, ts: string): string {
  const r = args.retrospective;
  const lines: string[] = [];
  lines.push('');
  lines.push(`## ${ts} — ${args.slug} / ${args.runId}`);
  lines.push('');
  lines.push(`- runId: ${args.runId}`);
  lines.push(`- runDir: ${args.runDir}`);
  if (args.planId) lines.push(`- planId: ${args.planId}`);
  if (r.summary) lines.push(`- summary: ${r.summary}`);
  if (r.magicWand) {
    const target = r.magicWandTarget ?? 'project';
    lines.push(`- **magicWand** (target: ${target}): ${r.magicWand}`);
  }
  if (r.difficulties && r.difficulties.length > 0) {
    lines.push('- difficulties:');
    for (const d of r.difficulties) {
      const wo = d.workaround ? ` (workaround: ${d.workaround})` : '';
      lines.push(`  - [${d.severity}] ${d.category}: ${d.description}${wo}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

function renderRetroStub(args: AppendRetroStubArgs, ts: string): string {
  const lines: string[] = [];
  lines.push('');
  lines.push(`> ⚠️ ## ${ts} — ${args.slug} / ${args.runId}`);
  lines.push('>');
  lines.push(`> - runId: ${args.runId}`);
  lines.push(`> - runDir: ${args.runDir}`);
  lines.push(`> - result: ${args.result}`);
  if (args.planId) lines.push(`> - planId: ${args.planId}`);
  lines.push(`> - magicWand: (unavailable — run terminated as ${args.result})`);
  if (args.stderrTail) {
    const oneLine = args.stderrTail.split('\n').slice(-1)[0]?.trim() ?? '';
    if (oneLine) lines.push(`> - stderr (last line): ${oneLine}`);
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * Append a normal retro entry to the per-agent (and optionally per-plan) ledger.
 *
 * Idempotent on (runId, target file). Throws RetroLedgerError on filesystem
 * errors that prevent the write (caller should decide whether to silent-skip).
 */
export async function appendRetroEntry(
  args: AppendRetroEntryArgs,
): Promise<void> {
  ensureLedgerDir(args.ledgerDir);
  const ts = (args.now ?? (() => new Date()))().toISOString();
  const block = renderRetroEntry(args, ts);

  await writeWithRetry(
    ledgerPath(args.ledgerDir, args.slug),
    args.runId,
    block,
  );
  if (args.planId) {
    await writeWithRetry(
      ledgerPath(args.ledgerDir, args.planId),
      args.runId,
      block,
    );
  }
}

/**
 * Append a stub entry for a run that terminated without a `report.json`.
 *
 * Same idempotency / dual-write semantics as `appendRetroEntry`. Block is
 * blockquote-prefixed so it's visually distinct in the ledger.
 */
export async function appendRetroStub(
  args: AppendRetroStubArgs,
): Promise<void> {
  ensureLedgerDir(args.ledgerDir);
  const ts = (args.now ?? (() => new Date()))().toISOString();
  const block = renderRetroStub(args, ts);

  await writeWithRetry(
    ledgerPath(args.ledgerDir, args.slug),
    args.runId,
    block,
  );
  if (args.planId) {
    await writeWithRetry(
      ledgerPath(args.ledgerDir, args.planId),
      args.runId,
      block,
    );
  }
}

async function writeWithRetry(
  filePath: string,
  runId: string,
  block: string,
): Promise<void> {
  // Serialize in-process writes for the same target path — see writeQueues
  // doc comment. Cross-process is still racy and intentional best-effort.
  const prior = writeQueues.get(filePath) ?? Promise.resolve();
  const next = prior
    .catch(() => undefined)
    .then(() => writeWithRetryUnsafe(filePath, runId, block));
  writeQueues.set(filePath, next);
  try {
    await next;
  } finally {
    if (writeQueues.get(filePath) === next) writeQueues.delete(filePath);
  }
}

async function writeWithRetryUnsafe(
  filePath: string,
  runId: string,
  block: string,
): Promise<void> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < MAX_RETRY_ATTEMPTS; attempt++) {
    try {
      const before = readSafely(filePath);
      if (alreadyContainsRunId(before, runId)) return; // idempotent no-op
      const expected = before + block;
      await writeFileAtomicAsync(filePath, expected);
      const after = readSafely(filePath);
      if (after === expected) return;
      if (alreadyContainsRunId(after, runId)) return;
      lastError = new Error(
        `cross-process concurrent write detected for ${runId} on attempt ${attempt + 1}`,
      );
    } catch (err) {
      lastError = err;
    }
  }
  throw new RetroLedgerError(
    `Failed to append retro entry for runId ${runId} after ${MAX_RETRY_ATTEMPTS} attempts: ${
      (lastError as Error)?.message ?? 'unknown error'
    }`,
    lastError,
  );
}
