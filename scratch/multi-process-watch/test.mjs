#!/usr/bin/env node

/**
 * Pre-Work Test #4 (workshop 007 § Pre-Work test #4 + Critical Insights #1) — Plan 007-backgrounding
 *
 * THIS TEST WAS ELEVATED FROM OPTIONAL TO REQUIRED PER didyouknow #1 (2026-04-26).
 *
 * HYPOTHESES:
 *   (A) Multiple sibling processes appending to the same NDJSON inbox file
 *       (single-call appendFile per write) do NOT corrupt the file. POSIX
 *       guarantees write(2) ≤ PIPE_BUF (4KB) is atomic — every appendFile
 *       call lands as one atomic chunk; concurrent appends interleave at
 *       line granularity, never within a line.
 *
 *   (B) A reader (forwarder) that reads the file while a writer is mid-append
 *       (the rare case where a write exceeds PIPE_BUF, OR the writer hasn't
 *       finished its single fwrite yet) either gets a complete line or a
 *       JSON.parse failure that's safely skipped without advancing the
 *       watermark, and the next read attempt sees the now-complete line.
 *
 * WHY IT MATTERS:
 *   Workshop 001 §Forwarder-side robustness (added per Critical Insights #1)
 *   specifies the skip-on-parse-fail-without-watermark-advance protocol.
 *   T004 is the empirical proof that this protocol is self-healing under
 *   adversarial conditions.
 *
 * SCENARIOS:
 *   A) multi-writer: two child processes append N lines each in parallel;
 *      assert all 2N lines are present and parseable; assert no truncation.
 *
 *   B) torn-line: a single writer deliberately writes a partial JSON line
 *      (no closing newline), then sleeps; the parent reader uses the
 *      forwarder protocol — read from byte 0, parse line by line, skip
 *      on parse failure WITHOUT advancing watermark; the writer then
 *      finishes the line; the next reader pass sees the now-complete
 *      line and forwards it.
 *
 * USAGE:
 *   node /Users/jordanknight/substrate/minih/scratch/multi-process-watch/test.mjs all 2>&1 | tee /tmp/t004.log
 *   node /Users/jordanknight/substrate/minih/scratch/multi-process-watch/test.mjs multi-writer
 *   node /Users/jordanknight/substrate/minih/scratch/multi-process-watch/test.mjs torn-line
 *
 * NO GH_TOKEN REQUIRED.
 */

import { spawn } from 'node:child_process';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const SCENARIO = process.argv[2] || 'all';
const MULTI_WRITER_COUNT = 2;
const MULTI_WRITER_LINES_EACH = 100;

function ts() {
  return new Date().toISOString();
}

function log(label, data) {
  process.stderr.write(
    `[${ts()}] [${label}] ${JSON.stringify(data).slice(0, 220)}\n`,
  );
}

/**
 * The forwarder protocol from workshop 001 §Forwarder-side robustness.
 * Read NDJSON from `inboxPath` starting at `watermarkBytes`. Parse each
 * complete (newline-terminated) line. On JSON.parse failure of any line,
 * STOP — return parseFailed=true, do NOT advance watermark past the bad
 * line. The next call (after the writer finishes) will retry from the
 * same byte offset.
 */
async function readNewMessages(inboxPath, watermarkBytes) {
  const buf = await fsp.readFile(inboxPath);
  if (buf.length <= watermarkBytes) {
    return {
      newMessages: [],
      newWatermark: watermarkBytes,
      parseFailed: false,
    };
  }
  const slice = buf.subarray(watermarkBytes).toString('utf-8');
  const parts = slice.split('\n');
  const completeLines = parts.slice(0, -1);
  const tailIncomplete = parts[parts.length - 1];

  const messages = [];
  let bytesConsumed = 0;
  for (const line of completeLines) {
    if (!line.length) {
      bytesConsumed += 1;
      continue;
    }
    try {
      messages.push(JSON.parse(line));
      bytesConsumed += Buffer.byteLength(line, 'utf-8') + 1;
    } catch (err) {
      return {
        newMessages: messages,
        newWatermark: watermarkBytes + bytesConsumed,
        parseFailed: true,
        failureLinePreview: line.slice(0, 80),
        parseError: String(err.message || err),
      };
    }
  }

  return {
    newMessages: messages,
    newWatermark: watermarkBytes + bytesConsumed,
    parseFailed: false,
    incompleteTailBytes: Buffer.byteLength(tailIncomplete, 'utf-8'),
  };
}

// =====================================================================
// Scenario A — multi-writer
// =====================================================================
async function scenarioMultiWriter(workDir) {
  const inboxPath = path.join(workDir, 'multi.ndjson');
  await fsp.writeFile(inboxPath, '');

  // Spawn N child writers
  const childCode = (writerId) => `
    import * as fs from 'node:fs/promises';
    const path = '${inboxPath}';
    const N = ${MULTI_WRITER_LINES_EACH};
    for (let i = 0; i < N; i++) {
      const line = JSON.stringify({ writer: ${writerId}, i, ts: Date.now() }) + '\\n';
      // Single appendFile = one fwrite, atomic per POSIX for ≤ PIPE_BUF
      await fs.appendFile(path, line);
    }
  `;

  const children = [];
  for (let w = 0; w < MULTI_WRITER_COUNT; w++) {
    children.push(
      spawn(process.execPath, ['--input-type=module', '-e', childCode(w)], {
        stdio: ['ignore', 'inherit', 'inherit'],
      }),
    );
  }
  await Promise.all(
    children.map(
      (c) =>
        new Promise((res, rej) => {
          c.on('exit', (code) =>
            code === 0 ? res() : rej(new Error(`child exit ${code}`)),
          );
          c.on('error', rej);
        }),
    ),
  );

  // Read everything; verify integrity
  const content = await fsp.readFile(inboxPath, 'utf-8');
  const rawLines = content.split('\n');
  const linesNonEmpty = rawLines.filter((l) => l.length > 0);

  let parseFailures = 0;
  const perWriterCounts = new Array(MULTI_WRITER_COUNT).fill(0);
  for (const line of linesNonEmpty) {
    try {
      const obj = JSON.parse(line);
      if (typeof obj.writer === 'number') perWriterCounts[obj.writer]++;
    } catch {
      parseFailures++;
    }
  }

  const totalExpected = MULTI_WRITER_COUNT * MULTI_WRITER_LINES_EACH;
  const tailEmpty = rawLines[rawLines.length - 1] === '';
  const fileEndsInNewline = content.endsWith('\n');

  return {
    name: 'multi-writer',
    writerCount: MULTI_WRITER_COUNT,
    linesPerWriter: MULTI_WRITER_LINES_EACH,
    expectedLines: totalExpected,
    observedLines: linesNonEmpty.length,
    parseFailures,
    perWriterCounts,
    fileEndsInNewline,
    tailEmpty,
    interpretation:
      parseFailures === 0 && linesNonEmpty.length === totalExpected
        ? 'PASS — all lines present, all parseable, no truncation. Confirms workshop 001 single-call appendFile atomicity for messages ≤ PIPE_BUF.'
        : `FAIL — observed ${linesNonEmpty.length}/${totalExpected} lines, ${parseFailures} parse failures.`,
    pass: parseFailures === 0 && linesNonEmpty.length === totalExpected,
  };
}

// =====================================================================
// Scenario B — torn-line resilience
// =====================================================================
async function scenarioTornLine(workDir) {
  const inboxPath = path.join(workDir, 'torn.ndjson');
  await fsp.writeFile(inboxPath, '');

  // Step 1: writer appends a complete line atomically
  const completeLine1 = `${JSON.stringify({ id: 'msg-1', body: 'first complete' })}\n`;
  await fsp.appendFile(inboxPath, completeLine1);

  // Step 2: simulate a TORN write — open the file and write only PART of a JSON
  // object (no closing brace, no newline). This is the worst case for the
  // forwarder: the line on disk is structurally invalid JSON.
  const partialLine = '{"id":"msg-2","body":"partial — wri';
  await fsp.appendFile(inboxPath, partialLine);
  // (Imagine a writer crashed here, or a write that exceeded PIPE_BUF and
  // got split. The next reader will see this partial line + no newline.)

  // Step 3: forwarder reads the file. Per workshop 001 §Forwarder-side
  // robustness, it should:
  //   - get newMessages = [msg-1] (the complete line)
  //   - NOT get the partial as a "complete" line (no \n terminator)
  //   - watermark advances past msg-1's bytes only
  //   - NOT advance past the partial bytes
  let watermark = 0;
  const pass1 = await readNewMessages(inboxPath, watermark);
  watermark = pass1.newWatermark;

  // Step 4: writer finishes the line — appends the closing `tten"} + \n`
  await sleep(50);
  await fsp.appendFile(inboxPath, 'tten"}\n');

  // Step 5: forwarder reads again. The previously-incomplete tail is now
  // a complete line; it should parse and forward.
  const pass2 = await readNewMessages(inboxPath, watermark);
  watermark = pass2.newWatermark;

  // Step 6 (adversarial): inject a STRUCTURALLY INVALID complete line
  // (closing brace + newline but malformed JSON inside). The forwarder
  // must NOT advance past this, and a next call must see it.
  await fsp.appendFile(inboxPath, 'this is not json{garbage\n');
  const pass3 = await readNewMessages(inboxPath, watermark);
  // Watermark should be at the same byte (parse failed before advancing).

  // Step 7: simulate a recovery — author manually corrects (or in real
  // life, a tooling pass repairs). For the test, we add a NEW complete
  // line AFTER the bad one. The forwarder's behavior:
  //   - tries the bad line first → parse failure → STOP (correct)
  //   - watermark stays at the start of the bad line
  //   - so the next legit line is NEVER processed unless we manually
  //     skip the bad one.
  await fsp.appendFile(
    inboxPath,
    `${JSON.stringify({ id: 'msg-3', body: 'after garbage' })}\n`,
  );
  const pass4 = await readNewMessages(inboxPath, watermark);

  return {
    name: 'torn-line',
    pass1_completeFollowedByPartial: {
      messageCount: pass1.newMessages.length,
      messageIds: pass1.newMessages.map((m) => m.id),
      parseFailed: pass1.parseFailed,
      newWatermark: pass1.newWatermark,
      incompleteTailBytes: pass1.incompleteTailBytes,
      expected:
        'messageIds=["msg-1"], parseFailed=false, incompleteTailBytes>0',
      ok:
        pass1.newMessages.length === 1 &&
        pass1.newMessages[0]?.id === 'msg-1' &&
        !pass1.parseFailed &&
        (pass1.incompleteTailBytes ?? 0) > 0,
    },
    pass2_partialNowComplete: {
      messageCount: pass2.newMessages.length,
      messageIds: pass2.newMessages.map((m) => m.id),
      parseFailed: pass2.parseFailed,
      expected:
        'messageIds=["msg-2"], parseFailed=false (partial completed; forwarder picked it up)',
      ok:
        pass2.newMessages.length === 1 &&
        pass2.newMessages[0]?.id === 'msg-2' &&
        !pass2.parseFailed,
    },
    pass3_garbageLine: {
      messageCount: pass3.newMessages.length,
      parseFailed: pass3.parseFailed,
      failureLinePreview: pass3.failureLinePreview,
      expected: 'parseFailed=true, watermark NOT advanced past bad line',
      ok: pass3.parseFailed === true && pass3.newMessages.length === 0,
    },
    pass4_garbageBlocksFollowing: {
      messageCount: pass4.newMessages.length,
      parseFailed: pass4.parseFailed,
      expected:
        'parseFailed=true again — the garbage line BLOCKS forward progress until manually recovered. This is INTENTIONAL safety: better to halt than to skip silently.',
      ok: pass4.parseFailed === true,
      caveat:
        'This documents a known design tradeoff: the forwarder is conservative. A persistent garbage line (e.g., file corruption, hand-edit) requires operator intervention. For v1 this is acceptable; future enhancement: configurable max-skip-attempts before logging + skipping.',
    },
    pass:
      pass1.newMessages.length === 1 &&
      pass1.newMessages[0]?.id === 'msg-1' &&
      pass2.newMessages.length === 1 &&
      pass2.newMessages[0]?.id === 'msg-2' &&
      pass3.parseFailed === true &&
      pass4.parseFailed === true,
  };
}

// =====================================================================
async function main() {
  const workDir = await fsp.mkdtemp(
    path.join(os.tmpdir(), 't004-multi-watch-'),
  );
  log('boot', { workDir, scenario: SCENARIO });

  const results = [];
  try {
    if (SCENARIO === 'multi-writer' || SCENARIO === 'all') {
      results.push(await scenarioMultiWriter(workDir));
    }
    if (SCENARIO === 'torn-line' || SCENARIO === 'all') {
      results.push(await scenarioTornLine(workDir));
    }
  } finally {
    await fsp.rm(workDir, { recursive: true, force: true });
  }

  process.stderr.write('\n=== T004 SUMMARY ===\n');
  process.stderr.write(
    `${JSON.stringify(
      {
        test: 'T004-multi-process-watch',
        platform: `${process.platform} ${os.release()}`,
        nodeVersion: process.version,
        scenario: SCENARIO,
        results,
        overallPass: results.every((r) => r.pass),
      },
      null,
      2,
    )}\n`,
  );

  process.exit(results.every((r) => r.pass) ? 0 : 1);
}

main().catch((err) => {
  console.error('FATAL:', err?.stack || err);
  process.exit(1);
});
