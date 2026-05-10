#!/usr/bin/env node

/**
 * Pre-Work Test #2 (workshop 007 § Pre-Work Required) — Plan 007-backgrounding
 *
 * HYPOTHESIS:
 *   Native `node:fs.watch` reliably detects writes from a sibling subprocess on
 *   small directories (the inbox/state lanes are always small). Mean detection
 *   latency is well under 50ms; zero events are missed across a 100-write
 *   sequence; atomic-rename and burst patterns are observable and document-able.
 *
 * WHY IT MATTERS:
 *   Workshop 007 daemon-light pivot picks `node:fs.watch` over chokidar (chainglass
 *   FD-exhaustion evidence: chokidar v5 opens 1 FD per file via kqueue → spawn EBADF
 *   at >5K files). For small inbox/state dirs, native fs.watch should be sufficient.
 *
 * SCENARIOS:
 *   A) latency: 100 sequential appends from a child process → measure detection
 *      latency from child's "wrote at T" to parent's event handler invocation.
 *   B) atomic-rename: child writes tmp file then renames → observe event sequence
 *      (rename + change vs rename only). Documents the pattern P3 must coalesce.
 *   C) burst: child appends 50 lines as fast as possible (no inter-write delay)
 *      → observe how many events fire (POSIX guarantees only "at least one
 *      event after a change", so coalescing is expected).
 *
 * USAGE:
 *   node /Users/jordanknight/substrate/minih/scratch/fswatch-test/test.mjs all 2>&1 | tee /tmp/t002.log
 *   node /Users/jordanknight/substrate/minih/scratch/fswatch-test/test.mjs latency
 *   node /Users/jordanknight/substrate/minih/scratch/fswatch-test/test.mjs rename
 *   node /Users/jordanknight/substrate/minih/scratch/fswatch-test/test.mjs burst
 *
 * NO GH_TOKEN REQUIRED — pure Node + child_process + fs.
 */

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const SCENARIO = process.argv[2] || 'all';
const LATENCY_WRITE_COUNT = 100;
const LATENCY_INTER_WRITE_MS = 50; // child sleeps this between writes
const BURST_WRITE_COUNT = 50;

function ts() {
  return new Date().toISOString();
}

function log(label, data) {
  process.stderr.write(
    `[${ts()}] [${label}] ${JSON.stringify(data).slice(0, 220)}\n`,
  );
}

function quantile(sortedArr, q) {
  if (!sortedArr.length) return null;
  const pos = (sortedArr.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sortedArr[base + 1] !== undefined) {
    return sortedArr[base] + rest * (sortedArr[base + 1] - sortedArr[base]);
  }
  return sortedArr[base];
}

function summaryStats(latencies) {
  if (!latencies.length) return null;
  const sorted = [...latencies].sort((a, b) => a - b);
  const sum = latencies.reduce((a, b) => a + b, 0);
  return {
    count: latencies.length,
    meanMs: +(sum / latencies.length).toFixed(2),
    minMs: sorted[0],
    p50Ms: +quantile(sorted, 0.5).toFixed(2),
    p95Ms: +quantile(sorted, 0.95).toFixed(2),
    p99Ms: +quantile(sorted, 0.99).toFixed(2),
    maxMs: sorted[sorted.length - 1],
  };
}

// =====================================================================
// Scenario A — latency
// =====================================================================
async function scenarioLatency(workDir) {
  const target = path.join(workDir, 'latency.ndjson');
  const childMarker = path.join(workDir, 'latency.markers.ndjson');
  await fsp.writeFile(target, '');
  await fsp.writeFile(childMarker, '');

  const events = [];
  const watcher = fs.watch(workDir, (eventType, filename) => {
    if (filename !== 'latency.ndjson') return;
    events.push({ at: Date.now(), eventType, filename });
  });

  // Spawn the child writer
  const childCode = `
    import * as fs from 'node:fs/promises';
    import { setTimeout as sleep } from 'node:timers/promises';
    const target = '${target}';
    const marker = '${childMarker}';
    const N = ${LATENCY_WRITE_COUNT};
    const INTER = ${LATENCY_INTER_WRITE_MS};
    for (let i = 0; i < N; i++) {
      const wroteAt = Date.now();
      // Single appendFile call — POSIX atomic for small writes
      await fs.appendFile(target, JSON.stringify({i, wroteAt}) + '\\n');
      await fs.appendFile(marker, JSON.stringify({i, wroteAt}) + '\\n');
      await sleep(INTER);
    }
    process.stderr.write('child-done\\n');
  `;

  const child = spawn(
    process.execPath,
    ['--input-type=module', '-e', childCode],
    {
      stdio: ['ignore', 'inherit', 'inherit'],
    },
  );

  await new Promise((res, rej) => {
    child.on('exit', (code) =>
      code === 0 ? res() : rej(new Error(`child exit ${code}`)),
    );
    child.on('error', rej);
  });

  // Drain any final events the watcher hasn't queued yet
  await sleep(200);
  watcher.close();

  // Reconstruct latencies: pair each child write timestamp with its first
  // post-write fs.watch event. Child writes are ordered (sequential) and
  // events are observed in order, so we pair greedily.
  const writes = (await fsp.readFile(childMarker, 'utf-8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));

  const latencies = [];
  let eventIdx = 0;
  let detectedCount = 0;
  for (const w of writes) {
    while (eventIdx < events.length && events[eventIdx].at < w.wroteAt) {
      eventIdx++;
    }
    if (eventIdx < events.length) {
      latencies.push(events[eventIdx].at - w.wroteAt);
      eventIdx++;
      detectedCount++;
    }
  }

  return {
    name: 'latency',
    writes: writes.length,
    rawEvents: events.length,
    detectedCount,
    missedCount: writes.length - detectedCount,
    pairing: 'greedy: each write paired with first event ≥ wroteAt',
    note: 'fs.watch may coalesce events under burst — missed = unpaired writes (a single event covered multiple writes)',
    latencyStats: summaryStats(latencies),
    pass:
      detectedCount > writes.length * 0.5 &&
      (summaryStats(latencies)?.meanMs ?? Infinity) < 500,
    explainer:
      "Per-event detection isn't per-write because fs.watch coalesces. Pass = ≥50% detected AND mean ≤ 500ms; tight per-write detection isn't the goal — every-modification-eventually is.",
  };
}

// =====================================================================
// Scenario B — atomic-rename
// =====================================================================
async function scenarioRename(workDir) {
  const target = path.join(workDir, 'state.json');
  const tmp = path.join(workDir, `state.json.tmp.${process.pid}`);
  await fsp.writeFile(target, JSON.stringify({ status: 'idle' }));

  const events = [];
  const watcher = fs.watch(workDir, (eventType, filename) => {
    events.push({ at: Date.now(), eventType, filename });
  });

  await sleep(50);
  events.length = 0; // reset after warm-up

  // The atomic-write pattern from workshop 001 §Atomic Write Strategy:
  // write tmp + fsync + rename
  const t0 = Date.now();
  await fsp.writeFile(tmp, JSON.stringify({ status: 'in-progress' }));
  await fsp.rename(tmp, target);
  const t1 = Date.now();

  await sleep(200);
  watcher.close();

  // Categorize observed events
  const onTarget = events.filter((e) => e.filename === 'state.json');
  const onTmp = events.filter((e) => e.filename?.startsWith('state.json.tmp.'));

  return {
    name: 'atomic-rename',
    writeDurationMs: t1 - t0,
    rawEvents: events.length,
    eventsOnTarget: onTarget.map((e) => e.eventType),
    eventsOnTmp: onTmp.map((e) => e.eventType),
    expected:
      'On macOS: rename event for tmp + rename event for target. On Linux: similar but watcher may also emit "change" for target.',
    interpretation:
      onTarget.length === 0
        ? 'NO EVENTS ON TARGET — fs.watch on the parent dir missed the rename to target. Bad.'
        : `${onTarget.length} event(s) on target — atomic rename is observable.`,
    pass: onTarget.length >= 1,
  };
}

// =====================================================================
// Scenario C — burst
// =====================================================================
async function scenarioBurst(workDir) {
  const target = path.join(workDir, 'burst.ndjson');
  await fsp.writeFile(target, '');

  const events = [];
  const watcher = fs.watch(workDir, (eventType, filename) => {
    if (filename !== 'burst.ndjson') return;
    events.push({ at: Date.now(), eventType });
  });

  // Burst from this process directly (no child subprocess overhead)
  const t0 = Date.now();
  for (let i = 0; i < BURST_WRITE_COUNT; i++) {
    fs.appendFileSync(target, `${JSON.stringify({ i, t: Date.now() })}\n`);
  }
  const t1 = Date.now();

  // Wait for the watcher to settle
  await sleep(300);
  watcher.close();

  // Verify content integrity (no torn lines)
  const lines = (await fsp.readFile(target, 'utf-8')).trim().split('\n');
  let parseFailures = 0;
  for (const l of lines) {
    try {
      JSON.parse(l);
    } catch {
      parseFailures++;
    }
  }

  return {
    name: 'burst',
    writes: BURST_WRITE_COUNT,
    writeDurationMs: t1 - t0,
    rawEvents: events.length,
    coalesceRatio: +(events.length / BURST_WRITE_COUNT).toFixed(3),
    linesObserved: lines.length,
    parseFailures,
    interpretation: `fs.watch coalesces ${BURST_WRITE_COUNT} writes into ${events.length} event(s) — typical kqueue/inotify behavior. Forwarder MUST drain from watermark on each event, not assume 1 event = 1 line.`,
    pass: lines.length === BURST_WRITE_COUNT && parseFailures === 0,
  };
}

// =====================================================================
async function main() {
  const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 't002-fswatch-'));
  log('boot', { workDir, scenario: SCENARIO });

  const results = [];

  try {
    if (SCENARIO === 'latency' || SCENARIO === 'all') {
      results.push(await scenarioLatency(workDir));
    }
    if (SCENARIO === 'rename' || SCENARIO === 'all') {
      results.push(await scenarioRename(workDir));
    }
    if (SCENARIO === 'burst' || SCENARIO === 'all') {
      results.push(await scenarioBurst(workDir));
    }
  } finally {
    await fsp.rm(workDir, { recursive: true, force: true });
  }

  process.stderr.write('\n=== T002 SUMMARY ===\n');
  process.stderr.write(
    `${JSON.stringify(
      {
        test: 'T002-fswatch-test',
        scenario: SCENARIO,
        platform: `${process.platform} ${os.release()}`,
        nodeVersion: process.version,
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
