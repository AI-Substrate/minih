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
