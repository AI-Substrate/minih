#!/usr/bin/env node
/**
 * Pre-Work Test #3 (workshop 007 § Pre-Work Required) — Plan 007-backgrounding
 *
 * THE LOAD-BEARING TEST. If this fails, the daemon-light design fails.
 *
 * HYPOTHESIS:
 *   End-to-end: a child process appends an inbox NDJSON line → parent's
 *   `node:fs.watch` fires → forwarder reads the new line(s) and calls
 *   `session.send` → in-flight Copilot SDK session receives the message
 *   in a turn → agent's final message acknowledges it. Round-trip ≤ 5s
 *   for each message; ordering preserved across rapid writes.
 *
 * WHY IT MATTERS:
 *   This is what `runAgent` will look like in P2-P3. The whole 007 plan
 *   stands or falls on this pattern working.
 *
 * COMPONENTS UNDER TEST:
 *   - Native fs.watch (validated in T002)
 *   - Single-call atomic NDJSON append (workshop 001 §Atomic Write Strategy)
 *   - Forwarder skip-on-parse-failure protocol (workshop 001 §Forwarder-side
 *     robustness — added per Critical Insights 2026-04-26 #1)
 *   - Watermark advancement only on successful parse + send
 *   - SDK session.send + idle subscription (validated separately by T001)
 *
 * USAGE:
 *   GH_TOKEN=<token> node /Users/jordanknight/substrate/minih/scratch/daemon-light-prototype/test.mjs 2>&1 | tee /tmp/t003.log
 *
 *   Optional message count: GH_TOKEN=<…> node …/test.mjs 5
 */

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { CopilotClient } from '/Users/jordanknight/substrate/minih/node_modules/@github/copilot-sdk/dist/index.js';

if (!process.env.GH_TOKEN) {
  console.error('GH_TOKEN required (Copilot SDK auth)');
  process.exit(2);
}

const MSG_COUNT = Number(process.argv[2] || 5);
const ROUND_TRIP_TARGET_MS = 5000;
const OVERALL_TIMEOUT_MS = 120000; // 2 min ceiling for the whole test
const DEBOUNCE_MS = 50; // matches workshop 007 recommendation

function ts() {
  return new Date().toISOString();
}

function log(label, data) {
  process.stderr.write(`[${ts()}] [${label}] ${JSON.stringify(data).slice(0, 220)}\n`);
}

/**
 * Read NDJSON from `inboxPath`, starting at `watermarkBytes`. Returns
 * { newMessages, newWatermark, parseFailed }. If a line at the tail
 * fails to parse (torn write per Critical Insights #1), DO NOT advance
 * the watermark past it; return parseFailed=true and let the next
 * fs.watch event retry from the same offset.
 */
async function readNewMessages(inboxPath, watermarkBytes) {
  const buf = await fsp.readFile(inboxPath);
  if (buf.length <= watermarkBytes) {
    return { newMessages: [], newWatermark: watermarkBytes, parseFailed: false };
  }
  const slice = buf.subarray(watermarkBytes).toString('utf-8');
  // Split on \n; the last element is the partial-line tail (possibly empty)
  const parts = slice.split('\n');
  const completeLines = parts.slice(0, -1);
  const incompleteTail = parts[parts.length - 1];

  const messages = [];
  let bytesConsumed = 0;
  for (const line of completeLines) {
    if (!line.length) {
      bytesConsumed += 1; // the \n
      continue;
    }
    try {
      messages.push(JSON.parse(line));
      bytesConsumed += Buffer.byteLength(line, 'utf-8') + 1; // +1 for \n
    } catch {
      // Torn write — STOP. Do NOT advance past this line.
      return {
        newMessages: messages,
        newWatermark: watermarkBytes + bytesConsumed,
        parseFailed: true,
        failureLine: line.slice(0, 80),
      };
    }
  }

  return {
    newMessages: messages,
    newWatermark: watermarkBytes + bytesConsumed,
    parseFailed: false,
    incompleteTailBytes: Buffer.byteLength(incompleteTail, 'utf-8'),
  };
}

async function main() {
  const t0 = Date.now();
  const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 't003-daemon-light-'));
  const inboxPath = path.join(workDir, 'inbox.ndjson');
  const markerPath = path.join(workDir, 'writes.markers.ndjson');
  await fsp.writeFile(inboxPath, '');
  await fsp.writeFile(markerPath, '');

  log('boot', { workDir, msgCount: MSG_COUNT });

  // ========== SDK SESSION ==========
  const client = new CopilotClient();
  await client.start();
  log('boot', { call: 'client.start() ok' });

  const session = await client.createSession({
    workingDirectory: workDir,
    onPermissionRequest: () => ({ kind: 'approved' }),
    streaming: true,
  });
  log('boot', { call: 'createSession ok', sessionId: session.sessionId });

  const events = [];
  const messages = [];
  let idleResolver, idleRejector;
  const idlePromise = new Promise((res, rej) => {
    idleResolver = res;
    idleRejector = rej;
  });

  const unsubscribe = session.on((evt) => {
    events.push({ ts: ts(), type: evt.type, data: evt.data });
    if (evt.type === 'message' || evt.type === 'assistant.message') {
      const content = evt.data?.content || evt.data?.text || '';
      messages.push({ at: Date.now(), content });
      log('agent', { preview: content.slice(0, 100).replace(/\n/g, ' ') });
    }
    if (evt.type === 'session_idle' || evt.type === 'session.idle') {
      log('agent', { marker: 'IDLE' });
      idleResolver();
    }
    if (evt.type === 'session_error' || evt.type === 'session.error') {
      idleRejector(new Error(String(evt.data?.message ?? evt.data)));
    }
  });

  // ========== FORWARDER (the daemon-light pattern) ==========
  let watermark = 0;
  const forwarderState = { sendCount: 0, parseFailures: 0, retries: 0 };
  let forwarderBusy = false;
  let pendingFire = false;

  async function drainForward() {
    if (forwarderBusy) {
      pendingFire = true;
      return;
    }
    forwarderBusy = true;
    try {
      while (true) {
        const result = await readNewMessages(inboxPath, watermark);
        if (result.newMessages.length === 0 && !result.parseFailed) {
          break;
        }
        for (const msg of result.newMessages) {
          log('forwarder', { send: msg.id, preview: (msg.body || '').slice(0, 60) });
          await session.send({
            prompt: `📬 Inbox message id=${msg.id} body="${msg.body}". Acknowledge by replying ACK-${msg.id} on its own line.`,
          });
          forwarderState.sendCount++;
        }
        if (result.parseFailed) {
          forwarderState.parseFailures++;
          log('forwarder', { parseFail: result.failureLine, watermark: watermark, action: 'NOT advancing watermark; awaiting next event' });
          watermark = result.newWatermark; // up to but not past the bad line
          break; // exit drain loop; next fs.watch event will retry
        }
        watermark = result.newWatermark;
      }
    } finally {
      forwarderBusy = false;
      if (pendingFire) {
        pendingFire = false;
        forwarderState.retries++;
        // Tail-call style retry — coalesce burst events
        setTimeout(drainForward, DEBOUNCE_MS);
      }
    }
  }

  // Debounce: wrap fs.watch callback so multiple events within DEBOUNCE_MS
  // coalesce into one drain call (per workshop 007 §Debounce + atomic-rename)
  let debounceTimer = null;
  const watcher = fs.watch(workDir, (eventType, filename) => {
    if (filename !== 'inbox.ndjson') return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      drainForward().catch((err) => log('forwarder-error', { err: String(err) }));
    }, DEBOUNCE_MS);
  });

  // ========== INITIAL SDK PRIMER ==========
  // Tell the agent what its job is — to ack each inbox message it receives
  log('action', { call: 'session.send (primer)' });
  await session.send({
    prompt:
      'You are the inside half of a coordination test. You will receive several "📬 Inbox message" prompts. ' +
      'For EACH one, immediately reply with the ACK token specified in the prompt (e.g., ACK-msg-1). ' +
      `After you have acked all ${MSG_COUNT} messages, you may stop. Reply briefly to this primer with: READY.`,
  });

  // Wait for the agent to acknowledge being ready (small grace period)
  await sleep(2000);

  // ========== OUTSIDE WRITER (child process) ==========
  // Spawn a child that appends MSG_COUNT inbox messages over time
  const childCode = `
    import * as fs from 'node:fs/promises';
    import { setTimeout as sleep } from 'node:timers/promises';
    const inboxPath = '${inboxPath}';
    const markerPath = '${markerPath}';
    const N = ${MSG_COUNT};
    for (let i = 1; i <= N; i++) {
      const id = 'msg-' + i;
      const wroteAt = Date.now();
      const line = JSON.stringify({ id, body: 'hello ' + i, ts: wroteAt }) + '\\n';
      // Single appendFile call — POSIX atomic per workshop 001 §Atomic Write Strategy
      await fs.appendFile(inboxPath, line);
      await fs.appendFile(markerPath, JSON.stringify({ id, wroteAt }) + '\\n');
      await sleep(800); // give the agent a beat between messages
    }
    process.stderr.write('writer-done\\n');
  `;

  log('action', { call: 'spawn outside writer', expectedMessages: MSG_COUNT });
  const child = spawn(process.execPath, ['--input-type=module', '-e', childCode], {
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  await new Promise((res, rej) => {
    child.on('exit', (code) => (code === 0 ? res() : rej(new Error('child exit ' + code))));
    child.on('error', rej);
  });

  // ========== WAIT FOR SDK IDLE ==========
  const timeoutPromise = new Promise((_, rej) =>
    setTimeout(() => rej(new Error(`OVERALL TIMEOUT ${OVERALL_TIMEOUT_MS}ms`)), OVERALL_TIMEOUT_MS),
  );

  let pass = false;
  let failureReason = null;
  try {
    await Promise.race([idlePromise, timeoutPromise]);

    // Compute round-trip latencies: pair each writer marker with the agent
    // message that contains its ACK token
    const markers = (await fsp.readFile(markerPath, 'utf-8'))
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    const roundTrips = [];
    for (const m of markers) {
      const ackPattern = new RegExp(`ACK-${m.id}\\b`);
      const ackMsg = messages.find((mm) => ackPattern.test(mm.content));
      if (ackMsg) roundTrips.push({ id: m.id, latencyMs: ackMsg.at - m.wroteAt });
    }

    pass =
      roundTrips.length === MSG_COUNT &&
      roundTrips.every((rt) => rt.latencyMs <= ROUND_TRIP_TARGET_MS);

    if (!pass) {
      const missing = markers.filter((m) => !roundTrips.find((rt) => rt.id === m.id));
      failureReason = missing.length
        ? `missing acks for: ${missing.map((m) => m.id).join(', ')}`
        : `slow round-trip: ${JSON.stringify(roundTrips)}`;
    }

    process.stderr.write('\n=== T003 SUMMARY ===\n');
    process.stderr.write(JSON.stringify(
      {
        test: 'T003-daemon-light-prototype',
        msgCount: MSG_COUNT,
        pass,
        failureReason,
        roundTripsMs: roundTrips,
        forwarderState,
        eventsTotal: events.length,
        agentMessageCount: messages.length,
        targetMaxRoundTripMs: ROUND_TRIP_TARGET_MS,
        elapsedMs: Date.now() - t0,
      },
      null,
      2,
    ) + '\n');
  } catch (err) {
    failureReason = String(err?.message || err);
    pass = false;
    process.stderr.write('\n=== T003 SUMMARY (FAILED) ===\n');
    process.stderr.write(JSON.stringify(
      {
        test: 'T003-daemon-light-prototype',
        pass: false,
        failureReason,
        forwarderState,
        elapsedMs: Date.now() - t0,
      },
      null,
      2,
    ) + '\n');
  } finally {
    if (debounceTimer) clearTimeout(debounceTimer);
    watcher.close();
    unsubscribe();
    await session.disconnect().catch(() => {});
    await client.stop().catch(() => {});
    await fsp.rm(workDir, { recursive: true, force: true });
  }

  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error('FATAL:', err?.stack || err);
  process.exit(1);
});
