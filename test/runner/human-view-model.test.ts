import { describe, expect, it } from 'vitest';
import {
  makeCompleted,
  makeHistoryEntry,
  makeInboxLane,
  makeInboxMessage,
  makeManifest,
  makeMessage,
  makeOutput,
  makeStateFile,
  makeTextDelta,
  makeThinking,
  makeToolCall,
  makeToolResult,
  makeUserPrompt,
  makeValidation,
  resetFixtureCounter,
} from '../../src/runner/human-view-fixtures.js';
import { buildHumanViewModel } from '../../src/runner/human-view-model.js';

describe('buildHumanViewModel — transcript coalescing', () => {
  it('AC2: collapses text_delta stream + final message into one TranscriptEntry by messageId', () => {
    resetFixtureCounter();
    const events = [
      makeUserPrompt('hi'),
      makeTextDelta('hel', 'msg-A'),
      makeTextDelta('lo', 'msg-A'),
      makeMessage('hello', 'msg-A'),
    ];
    const model = buildHumanViewModel({
      events,
      manifest: makeManifest({ status: 'active' }),
      completed: null,
      inbox: [],
      state: { inside: null, outside: null },
      history: [],
      output: null,
      validation: null,
    });
    const assistant = model.transcript.filter((t) => t.role === 'assistant');
    expect(assistant).toHaveLength(1);
    expect(assistant[0]?.content).toBe('hello');
    expect(assistant[0]?.status).toBe('final');
    expect(assistant[0]?.messageId).toBe('msg-A');
  });

  it('AC4: inside agent message is labelled "Inside agent"', () => {
    resetFixtureCounter();
    const model = buildHumanViewModel({
      events: [makeMessage('done', 'msg-B')],
      manifest: makeManifest(),
      completed: null,
      inbox: [],
      state: { inside: null, outside: null },
      history: [],
      output: null,
      validation: null,
    });
    expect(model.transcript[0]?.actorLabel).toBe('Inside agent');
  });

  it('AC3: outside inbox message renders as Outside actor on the coordination timeline', () => {
    resetFixtureCounter();
    const outsideMsg = makeInboxMessage({
      lane: 'outside',
      subject: 'ping',
      body: 'hi',
    });
    const model = buildHumanViewModel({
      events: [],
      manifest: makeManifest(),
      completed: null,
      inbox: [makeInboxLane('outside', [outsideMsg])],
      state: { inside: null, outside: null },
      history: [],
      output: null,
      validation: null,
    });
    const inboxRows = model.coordination.filter((c) => c.kind === 'inbox');
    expect(inboxRows).toHaveLength(1);
    expect(inboxRows[0]).toMatchObject({
      kind: 'inbox',
      lane: 'outside',
      subject: 'ping',
    });
  });
});

describe('buildHumanViewModel — tool lifecycle', () => {
  it('AC5: tool_call + tool_result pair into one ToolCallView keyed by toolCallId', () => {
    resetFixtureCounter();
    const events = [
      makeToolCall('shell', 'tc-1', { cmd: 'ls' }),
      makeToolResult('tc-1', 'README.md\n', false),
    ];
    const model = buildHumanViewModel({
      events,
      manifest: makeManifest(),
      completed: null,
      inbox: [],
      state: { inside: null, outside: null },
      history: [],
      output: null,
      validation: null,
    });
    expect(model.tools).toHaveLength(1);
    expect(model.tools[0]).toMatchObject({
      toolName: 'shell',
      status: 'ok',
      id: 'tc-1',
    });
    expect(model.tools[0]?.completedAt).not.toBeNull();
  });

  it('errored tool result yields status "error"', () => {
    resetFixtureCounter();
    const events = [
      makeToolCall('shell', 'tc-2'),
      makeToolResult('tc-2', 'oops', true),
    ];
    const model = buildHumanViewModel({
      events,
      manifest: makeManifest(),
      completed: null,
      inbox: [],
      state: { inside: null, outside: null },
      history: [],
      output: null,
      validation: null,
    });
    expect(model.tools[0]?.status).toBe('error');
  });

  it('orphan tool_call (no result) shows status "running"', () => {
    resetFixtureCounter();
    const model = buildHumanViewModel({
      events: [makeToolCall('shell', 'tc-3')],
      manifest: makeManifest(),
      completed: null,
      inbox: [],
      state: { inside: null, outside: null },
      history: [],
      output: null,
      validation: null,
    });
    expect(model.tools[0]?.status).toBe('running');
    expect(model.tools[0]?.completedAt).toBeNull();
  });
});

describe('buildHumanViewModel — coordination timeline', () => {
  it('AC6: ackOf links inside ack to the outside message it acknowledges', () => {
    resetFixtureCounter();
    const outside = makeInboxMessage({
      id: '01HOUTSIDE0000000000000000',
      lane: 'outside',
      subject: 'q',
    });
    const insideAck = makeInboxMessage({
      id: '01HINSIDE00000000000000000',
      lane: 'inside',
      subject: 'ack',
      ackOf: outside.id,
    });
    const model = buildHumanViewModel({
      events: [],
      manifest: makeManifest(),
      completed: null,
      inbox: [
        makeInboxLane('outside', [outside]),
        makeInboxLane('inside', [insideAck]),
      ],
      state: { inside: null, outside: null },
      history: [],
      output: null,
      validation: null,
    });
    const inboxEntries = model.coordination.filter((c) => c.kind === 'inbox');
    const ackingRow = inboxEntries.find(
      (e) => 'ackOf' in e && e.ackOf === outside.id,
    );
    const ackedRow = inboxEntries.find((e) => 'id' in e && e.id === outside.id);
    expect(ackingRow).toBeDefined();
    expect(ackingRow?.kind === 'inbox' && ackingRow.ackState).toBe(
      'acks-other',
    );
    expect(ackedRow?.kind === 'inbox' && ackedRow.ackState).toBe('acked');
  });

  it('state transitions appear on the coordination timeline', () => {
    resetFixtureCounter();
    const model = buildHumanViewModel({
      events: [],
      manifest: makeManifest(),
      completed: null,
      inbox: [],
      state: { inside: makeStateFile('inside', 'in-progress'), outside: null },
      history: [
        makeHistoryEntry({ side: 'inside', from: 'idle', to: 'in-progress' }),
      ],
      output: null,
      validation: null,
    });
    expect(model.coordination.some((c) => c.kind === 'state-transition')).toBe(
      true,
    );
    expect(model.state.inside?.status).toBe('in-progress');
  });
});

describe('buildHumanViewModel — output projection', () => {
  it('output + validation flow into OutputPaneView', () => {
    resetFixtureCounter();
    const model = buildHumanViewModel({
      events: [],
      manifest: makeManifest(),
      completed: makeCompleted(),
      inbox: [],
      state: { inside: null, outside: null },
      history: [],
      output: makeOutput({
        outputPath: '/tmp/x/output/report.json',
        exists: true,
        bytes: 1024,
      }),
      validation: makeValidation({ valid: true }),
    });
    expect(model.output.outputPath).toBe('/tmp/x/output/report.json');
    expect(model.output.exists).toBe(true);
    expect(model.output.bytes).toBe(1024);
    expect(model.output.lastValidation?.valid).toBe(true);
  });
});

describe('buildHumanViewModel — diagnostics & determinism', () => {
  it('AC14: malformed event line emits a ViewDiagnostic and does NOT crash', () => {
    resetFixtureCounter();
    // Cast to AgentEvent[] but include a deliberately malformed entry.
    const events = [
      makeMessage('hello', 'msg-1'),
      // biome-ignore lint/suspicious/noExplicitAny: deliberately malformed input
      { type: 'unknown_event_kind', timestamp: 'bad', data: {} } as any,
    ];
    const model = buildHumanViewModel({
      events,
      manifest: makeManifest(),
      completed: null,
      inbox: [],
      state: { inside: null, outside: null },
      history: [],
      output: null,
      validation: null,
    });
    expect(model.transcript.length).toBeGreaterThan(0); // valid event still rendered
    expect(model.diagnostics.some((d) => d.source === 'events')).toBe(true);
  });

  it('reducer is deterministic — same inputs produce deeply-equal outputs', () => {
    resetFixtureCounter();
    const inputs = {
      events: [makeUserPrompt('hi'), makeMessage('hello', 'msg-D')],
      manifest: makeManifest({ status: 'active' }),
      completed: null,
      inbox: [],
      state: { inside: null, outside: null },
      history: [],
      output: null,
      validation: null,
    };
    const a = buildHumanViewModel(inputs);
    const b = buildHumanViewModel(inputs);
    expect(a).toEqual(b);
  });
});

describe('FX002-1 — thinking events project to transcript', () => {
  const baseSources = {
    manifest: null,
    completed: null,
    inbox: [],
    state: { inside: null, outside: null },
    history: [],
    output: null,
    validation: null,
  };

  it('coalesces consecutive thinking deltas into one row, finalised on next non-thinking event', () => {
    resetFixtureCounter();
    const events = [
      makeThinking('Let me '),
      makeThinking('understand'),
      makeThinking(' the request.'),
      makeMessage('OK got it', 'msg-x'),
    ];
    const model = buildHumanViewModel({ ...baseSources, events });
    const thinkingRows = model.transcript.filter(
      (e) => e.actorLabel === 'Inside agent (thinking)',
    );
    expect(thinkingRows).toHaveLength(1);
    expect(thinkingRows[0].content).toBe('Let me understand the request.');
    expect(thinkingRows[0].status).toBe('final');
    expect(thinkingRows[0].messageId).toBeNull();
  });

  it('starts a fresh thinking burst after non-thinking interruption', () => {
    resetFixtureCounter();
    const events = [
      makeThinking('first burst'),
      makeMessage('reply 1', 'msg-a'),
      makeThinking('second burst'),
      makeMessage('reply 2', 'msg-b'),
    ];
    const model = buildHumanViewModel({ ...baseSources, events });
    const thinkingRows = model.transcript.filter(
      (e) => e.actorLabel === 'Inside agent (thinking)',
    );
    expect(thinkingRows).toHaveLength(2);
    expect(thinkingRows[0].content).toBe('first burst');
    expect(thinkingRows[1].content).toBe('second burst');
  });

  it('trailing thinking buffer (no follow-up event) flushes as final row', () => {
    resetFixtureCounter();
    const events = [makeThinking('still thinking…')];
    const model = buildHumanViewModel({ ...baseSources, events });
    const thinkingRows = model.transcript.filter(
      (e) => e.actorLabel === 'Inside agent (thinking)',
    );
    expect(thinkingRows).toHaveLength(1);
    expect(thinkingRows[0].content).toBe('still thinking…');
    expect(thinkingRows[0].status).toBe('final');
  });
});

describe('FX002-2 — text_delta/message messageId mismatch fallback', () => {
  const baseSources = {
    manifest: null,
    completed: null,
    inbox: [],
    state: { inside: null, outside: null },
    history: [],
    output: null,
    validation: null,
  };

  it('falls back to most-recent unfinalised text_delta buffer when message has empty content + mismatched id', () => {
    resetFixtureCounter();
    // Deltas keyed by msg-A; final message uses different msg-B with empty content (real SDK behaviour observed in dogfood).
    const events = [
      makeTextDelta('Hello ', 'msg-A'),
      makeTextDelta('world.', 'msg-A'),
      makeMessage('', 'msg-B'),
    ];
    const model = buildHumanViewModel({ ...baseSources, events });
    const finalAssistant = model.transcript.find(
      (e) => e.actorLabel === 'Inside agent' && e.status === 'final',
    );
    expect(finalAssistant?.content).toBe('Hello world.');
    // No leftover streaming row from the mismatched buffer.
    const streaming = model.transcript.filter((e) => e.status === 'streaming');
    expect(streaming).toHaveLength(0);
  });

  it('still pairs by exact messageId match when both ids agree (no regression)', () => {
    resetFixtureCounter();
    const events = [
      makeTextDelta('hi ', 'msg-1'),
      makeTextDelta('there', 'msg-1'),
      makeMessage('', 'msg-1'),
    ];
    const model = buildHumanViewModel({ ...baseSources, events });
    const finalAssistant = model.transcript.find(
      (e) => e.actorLabel === 'Inside agent' && e.status === 'final',
    );
    expect(finalAssistant?.content).toBe('hi there');
  });

  it('does NOT raid an already-finalised buffer for a later mismatched message', () => {
    resetFixtureCounter();
    const events = [
      makeTextDelta('first ', 'msg-A'),
      makeMessage('first', 'msg-A'), // Properly paired; finalises buffer.
      makeTextDelta('second', 'msg-B'),
      makeMessage('', 'msg-C'), // Empty + mismatch — should pick msg-B (unfinalised), not msg-A.
    ];
    const model = buildHumanViewModel({ ...baseSources, events });
    const finals = model.transcript.filter(
      (e) => e.actorLabel === 'Inside agent' && e.status === 'final',
    );
    expect(finals).toHaveLength(2);
    expect(finals[0].content).toBe('first');
    expect(finals[1].content).toBe('second');
  });
});

describe('FX002-1 follow-up — thinking-flush ignores provider noise', () => {
  const baseSources = {
    manifest: null,
    completed: null,
    inbox: [],
    state: { inside: null, outside: null },
    history: [],
    output: null,
    validation: null,
  };

  it('raw + usage events between thinking deltas do NOT split the burst', () => {
    resetFixtureCounter();
    const rawEvent = {
      type: 'raw' as const,
      timestamp: '2026-04-28T00:00:02.600Z',
      eventId: 'evt-raw',
      data: { provider: 'copilot', originalType: 'noise', originalData: {} },
    };
    const usageEvent = {
      type: 'usage' as const,
      timestamp: '2026-04-28T00:00:02.700Z',
      eventId: 'evt-usage',
      data: { inputTokens: 100, outputTokens: 5 },
    };
    const events = [
      makeThinking('Let me '),
      rawEvent,
      makeThinking('understand '),
      usageEvent,
      makeThinking('the request.'),
      makeMessage('done', 'msg-x'),
    ];
    const model = buildHumanViewModel({ ...baseSources, events });
    const thinkingRows = model.transcript.filter(
      (e) => e.actorLabel === 'Inside agent (thinking)',
    );
    expect(thinkingRows).toHaveLength(1);
    expect(thinkingRows[0].content).toBe('Let me understand the request.');
  });

  it('tool_call DOES flush thinking burst (boundary event)', () => {
    resetFixtureCounter();
    const events = [
      makeThinking('I need to call a tool. '),
      makeToolCall('shell', 'tc1'),
      makeThinking('After tool, more thoughts.'),
      makeMessage('final', 'msg-y'),
    ];
    const model = buildHumanViewModel({ ...baseSources, events });
    const thinkingRows = model.transcript.filter(
      (e) => e.actorLabel === 'Inside agent (thinking)',
    );
    expect(thinkingRows).toHaveLength(2);
    expect(thinkingRows[0].content).toBe('I need to call a tool. ');
    expect(thinkingRows[1].content).toBe('After tool, more thoughts.');
  });
});
