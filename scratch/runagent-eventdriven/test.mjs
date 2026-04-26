#!/usr/bin/env node
/**
 * Pre-Work Test #1 (workshop 007 § Pre-Work Required) — Plan 007-backgrounding
 *
 * HYPOTHESIS:
 *   A `runAgent`-shaped flow can run a Copilot SDK session to completion using ONLY
 *   `session.send` + subscribe-to-`session.idle`. No `sendAndWait` anywhere.
 *
 * WHY IT MATTERS:
 *   Workshop 007 daemon-light pivot requires `runAgent` to be event-driven so that
 *   cross-process forwarders can interleave additional `session.send` calls while
 *   the agent is processing. `sendAndWait` blocks until full queue drain (footgun
 *   already documented in external-research/sdk-mid-turn-injection.md). This test
 *   proves the alternative assembly works end-to-end.
 *
 * PASS CRITERIA:
 *   - Reaches an `idle` event ≤ 60s.
 *   - At least one assistant `message` event captured before idle.
 *   - `client.stop()` cleans up — no orphan `node` process matching SDK CLI marker
 *     remains after the script exits (verified by parent shell with `pgrep -f`).
 *
 * USAGE:
 *   GH_TOKEN=<token> node /Users/jordanknight/substrate/minih/scratch/runagent-eventdriven/test.mjs 2>&1
 *
 *   Optional second scenario for two queued messages:
 *   GH_TOKEN=<token> node /Users/jordanknight/substrate/minih/scratch/runagent-eventdriven/test.mjs queued
 */

import { CopilotClient } from '/Users/jordanknight/substrate/minih/node_modules/@github/copilot-sdk/dist/index.js';

if (!process.env.GH_TOKEN) {
  console.error('GH_TOKEN required (Copilot SDK auth)');
  process.exit(2);
}

const SCENARIO = process.argv[2] || 'single';
const TIMEOUT_MS = 60000;

function ts() {
  return new Date().toISOString();
}

function log(label, data) {
  process.stderr.write(`[${ts()}] [${label}] ${JSON.stringify(data).slice(0, 240)}\n`);
}

/**
 * Subscribe to a session and resolve when an idle event is observed.
 * This is the pattern runner.ts will adopt in P2.
 *
 * Returns: { idlePromise, events, unsubscribe }
 */
function subscribeUntilIdle(session, label = 'evt') {
  const events = [];
  const messages = [];
  let idleResolver, idleRejector;
  const idlePromise = new Promise((res, rej) => {
    idleResolver = res;
    idleRejector = rej;
  });

  const unsubscribe = session.on((evt) => {
    events.push({ ts: ts(), type: evt.type, data: evt.data });

    // Capture assistant messages
    if (
      evt.type === 'message' ||
      evt.type === 'assistant.message'
    ) {
      const content = evt.data?.content || evt.data?.text || '';
      messages.push(content);
      log(label, { t: evt.type, preview: content.slice(0, 80).replace(/\n/g, ' ') });
    }

    // Resolve on idle
    if (evt.type === 'session_idle' || evt.type === 'session.idle') {
      log(label, { t: evt.type, marker: 'IDLE-REACHED' });
      idleResolver({ events, messages });
    }

    // Surface session errors
    if (evt.type === 'session_error' || evt.type === 'session.error') {
      log(label, { t: evt.type, err: String(evt.data?.message ?? evt.data) });
      idleRejector(new Error(String(evt.data?.message ?? evt.data)));
    }
  });

  return { idlePromise, events, messages, unsubscribe };
}

async function main() {
  const t0 = Date.now();
  log('boot', { scenario: SCENARIO, timeoutMs: TIMEOUT_MS });

  const client = new CopilotClient();
  await client.start();
  log('boot', { call: 'client.start() ok' });

  const session = await client.createSession({
    workingDirectory: '/tmp',
    onPermissionRequest: () => ({ kind: 'approved' }),
    streaming: true,
  });
  log('boot', { call: 'createSession ok', sessionId: session.sessionId });

  const { idlePromise, events, messages, unsubscribe } = subscribeUntilIdle(session, 'evt');

  // Race against timeout so we report cleanly instead of hanging
  const timeoutPromise = new Promise((_, rej) =>
    setTimeout(() => rej(new Error(`TIMEOUT after ${TIMEOUT_MS}ms`)), TIMEOUT_MS),
  );

  let pass = false;
  let failureReason = null;
  let firstIdleAt = null;
  let queuedAt = null;

  try {
    if (SCENARIO === 'single') {
      log('action', { call: 'session.send (single message)' });
      await session.send({ prompt: 'Reply with the single word: ALPHA. Nothing else.' });
      log('action', { call: 'session.send returned (queued)' });

      await Promise.race([idlePromise, timeoutPromise]);
      firstIdleAt = Date.now();

      pass = messages.length > 0;
      if (!pass) failureReason = 'reached idle but no assistant message captured';
    } else if (SCENARIO === 'queued') {
      // Prove that two session.send calls in flight both land — workshop 007 cross-process push pattern
      log('action', { call: 'session.send #1' });
      await session.send({ prompt: 'Reply with: STAGE-ONE-DONE' });
      log('action', { call: 'session.send #2 (queued behind #1)' });
      await session.send({ prompt: 'Now reply with: STAGE-TWO-DONE' });
      queuedAt = Date.now();

      await Promise.race([idlePromise, timeoutPromise]);
      firstIdleAt = Date.now();

      const sawStageOne = messages.some((m) => /STAGE-ONE-DONE/.test(m));
      const sawStageTwo = messages.some((m) => /STAGE-TWO-DONE/.test(m));
      pass = sawStageOne && sawStageTwo;
      if (!pass) {
        failureReason = `queued messages incomplete: STAGE-ONE-DONE=${sawStageOne}, STAGE-TWO-DONE=${sawStageTwo}`;
      }
    } else {
      throw new Error(`Unknown scenario: ${SCENARIO}. Use 'single' or 'queued'.`);
    }
  } catch (err) {
    failureReason = String(err?.message || err);
    pass = false;
  } finally {
    unsubscribe();
    await session.disconnect().catch(() => {});
    await client.stop().catch(() => {});
  }

  const elapsedMs = Date.now() - t0;
  const idleAfterMs = firstIdleAt ? firstIdleAt - t0 : null;

  // Structured summary on stderr — easy to grep for the prework-results.md memo
  process.stderr.write('\n=== T001 SUMMARY ===\n');
  process.stderr.write(
    JSON.stringify(
      {
        test: 'T001-runagent-eventdriven',
        scenario: SCENARIO,
        pass,
        failureReason,
        elapsedMs,
        idleAfterMs,
        sentAndWaitUsed: false, // by construction
        eventCount: events.length,
        messageCount: messages.length,
        messagesPreview: messages.map((m) => m.slice(0, 80).replace(/\n/g, ' ')),
        targetMaxMs: TIMEOUT_MS,
      },
      null,
      2,
    ) + '\n',
  );

  // Exit cleanly so the parent shell can run pgrep / ps to verify cleanup
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error('FATAL:', err?.stack || err);
  process.exit(1);
});
