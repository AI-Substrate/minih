#!/usr/bin/env node
/**
 * Empirical test: does session.send() succeed mid-stream while a prior
 * sendAndWait() is still in flight?
 *
 * Three scenarios:
 *   A) Sequential: sendAndWait → wait → sendAndWait. Baseline.
 *   B) Mid-turn: sendAndWait(slow) is fired; ~3s later session.send(extra)
 *      is called WHILE the first call is still resolving. Observe:
 *        - does session.send return / throw?
 *        - does the assistant.message event include awareness of "extra"?
 *        - is the second message processed in a separate turn or merged?
 *   C) Rapid-fire: two session.send calls back-to-back without awaiting.
 *
 * Output: NDJSON event stream + structured summary on stderr.
 */
import { CopilotClient } from '/Users/jordanknight/substrate/minih/node_modules/@github/copilot-sdk/dist/index.js';

if (!process.env.GH_TOKEN) {
  console.error('GH_TOKEN required');
  process.exit(2);
}

const SLOW_PROMPT =
  'Slow loop. Use the bash tool 5 times in sequence: each call runs `sleep 1 && echo "tick N"` (replacing N with the call number). Between calls, write a short reasoning sentence. Do NOT do them in parallel.';

const INJECT_PROMPT =
  'IMPORTANT: also include the word PINEAPPLE somewhere in your final summary.';

const SCENARIO = process.argv[2] || 'B';

function ts() {
  return new Date().toISOString();
}

function logEvent(label, data) {
  process.stderr.write(
    `[${ts()}] [${label}] ${JSON.stringify(data).slice(0, 240)}\n`,
  );
}

async function main() {
  const client = new CopilotClient();
  await client.start();

  const cwd = '/tmp';
  const session = await client.createSession({
    workingDirectory: cwd,
    onPermissionRequest: () => ({ kind: 'approved' }),
    streaming: true,
  });

  process.stderr.write(
    `\n=== SCENARIO ${SCENARIO} === sessionId=${session.sessionId}\n\n`,
  );

  const events = [];
  const unsub = session.on((evt) => {
    events.push({ ts: ts(), type: evt.type, data: evt.data });
    // Keep the stream readable
    const summary = (() => {
      switch (evt.type) {
        case 'session_start':
        case 'session.start':
          return 'session_start';
        case 'session_idle':
        case 'session.idle':
          return 'session_idle';
        case 'message':
        case 'assistant.message':
          return `message: ${(evt.data?.content || evt.data?.text || '').slice(0, 80).replace(/\n/g, ' ')}`;
        case 'tool.call':
        case 'tool_call':
          return `tool_call: ${evt.data?.name || evt.data?.tool || '?'}`;
        case 'tool.result':
        case 'tool_result':
          return 'tool_result';
        case 'usage':
          return `usage: in=${evt.data?.input_tokens || evt.data?.inputTokens || '?'} out=${evt.data?.output_tokens || evt.data?.outputTokens || '?'}`;
        case 'thinking':
        case 'reasoning':
        case 'reasoning_delta':
          return 'thinking';
        case 'text_delta':
        case 'message_delta':
          return null;
        default:
          return evt.type;
      }
    })();
    if (summary) logEvent('evt', { t: evt.type, s: summary });
  });

  try {
    if (SCENARIO === 'A') {
      logEvent('action', { call: 'sendAndWait#1' });
      const r1 = await session.sendAndWait(
        { prompt: 'Say hello briefly.' },
        30000,
      );
      logEvent('action', {
        call: 'sendAndWait#1 returned',
        preview: (r1?.data?.content || '').slice(0, 80),
      });

      logEvent('action', { call: 'sendAndWait#2' });
      const r2 = await session.sendAndWait(
        { prompt: 'Say goodbye briefly.' },
        30000,
      );
      logEvent('action', {
        call: 'sendAndWait#2 returned',
        preview: (r2?.data?.content || '').slice(0, 80),
      });
    }

    if (SCENARIO === 'B') {
      logEvent('action', { call: 'sendAndWait(slow) fire-and-await' });
      const slowPromise = session.sendAndWait({ prompt: SLOW_PROMPT }, 60000);

      // Wait 3 seconds then inject mid-turn
      await new Promise((r) => setTimeout(r, 3000));
      logEvent('action', { call: 'mid-turn session.send(inject)' });
      try {
        const injectId = await session.send({ prompt: INJECT_PROMPT });
        logEvent('action', {
          call: 'session.send returned',
          injectMessageId: injectId,
        });
      } catch (err) {
        logEvent('action', { call: 'session.send THREW', err: String(err) });
      }

      const slowResult = await slowPromise;
      logEvent('action', {
        call: 'sendAndWait(slow) returned',
        preview: (slowResult?.data?.content || '').slice(0, 200),
        mentionedPineapple: /PINEAPPLE/i.test(slowResult?.data?.content || ''),
      });
    }

    if (SCENARIO === 'C') {
      logEvent('action', { call: 'session.send #1 (no await)' });
      const id1Promise = session.send({
        prompt: 'Step A: respond with the word ALPHA',
      });
      logEvent('action', { call: 'session.send #2 immediately' });
      const id2Promise = session.send({
        prompt: 'Step B: respond with the word BETA',
      });

      try {
        const [id1, id2] = await Promise.all([id1Promise, id2Promise]);
        logEvent('action', {
          call: 'both sends resolved',
          id1,
          id2,
          sameId: id1 === id2,
        });
      } catch (err) {
        logEvent('action', { call: 'sends THREW', err: String(err) });
      }

      // Give the session time to chew on either/both messages
      await new Promise((r) => setTimeout(r, 30000));
      const messages = events.filter(
        (e) => e.type === 'message' || e.type === 'assistant.message',
      );
      logEvent('summary', {
        totalEvents: events.length,
        assistantMessages: messages.length,
        contents: messages.map((m) => (m.data?.content || '').slice(0, 80)),
      });
    }
  } finally {
    unsub();
    await session.disconnect().catch(() => {});
    await client.stop().catch(() => {});
    process.stderr.write(
      `\n=== SCENARIO ${SCENARIO} done; ${events.length} events ===\n`,
    );
  }
}

main().catch((err) => {
  console.error('FATAL:', err?.stack || err);
  process.exit(1);
});
