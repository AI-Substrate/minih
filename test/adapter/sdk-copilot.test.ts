import { describe, expect, it } from 'vitest';
import type {
  CopilotResumeSessionConfig,
  CopilotSessionConfig,
  CopilotSessionEventLike,
  ICopilotClient,
  ICopilotSession,
} from '../../src/adapter/copilot-types.js';
import type { AgentEvent } from '../../src/adapter/events.js';
import { SdkCopilotAdapter } from '../../src/adapter/sdk-copilot.js';

function neverSettles<T>(): Promise<T> {
  return new Promise<T>(() => {});
}

class MockSession implements ICopilotSession {
  readonly sessionId = 'mock-session';
  readonly sendCalls: Array<{ prompt: string }> = [];
  readonly sendAndWaitCalls: Array<{ prompt: string }> = [];
  readonly handlers: Array<(event: CopilotSessionEventLike) => void> = [];
  disconnectCalls = 0;
  unsubscribeCalls = 0;
  abortCalls = 0;
  // Plan 026 T003 — opt-in hang modes simulating a wedged CLI subprocess
  // that never answers JSON-RPC.
  hangAbort = false;
  hangDisconnect = false;

  async send(options: { prompt: string }): Promise<string> {
    this.sendCalls.push(options);
    return options.prompt;
  }

  async sendAndWait(options: { prompt: string }): Promise<unknown> {
    this.sendAndWaitCalls.push(options);
    return undefined;
  }

  on(handler: (event: CopilotSessionEventLike) => void): () => void {
    this.handlers.push(handler);
    return () => {
      this.unsubscribeCalls++;
    };
  }

  async abort(): Promise<void> {
    this.abortCalls++;
    if (this.hangAbort) return neverSettles();
  }

  async disconnect(): Promise<void> {
    this.disconnectCalls++;
    if (this.hangDisconnect) return neverSettles();
  }

  emit(event: CopilotSessionEventLike): void {
    for (const handler of [...this.handlers]) {
      handler(event);
    }
  }
}

class MockClient implements ICopilotClient {
  createSessionCalls: CopilotSessionConfig[] = [];
  resumeSessionCalls: CopilotResumeSessionConfig[] = [];
  forceStopCalls = 0;
  hangResume = false;

  constructor(private readonly session: MockSession) {}

  async createSession(config?: CopilotSessionConfig): Promise<ICopilotSession> {
    this.createSessionCalls.push(config ?? {});
    return this.session;
  }

  async resumeSession(
    _sessionId: string,
    config?: CopilotResumeSessionConfig,
  ): Promise<ICopilotSession> {
    this.resumeSessionCalls.push(config ?? {});
    if (this.hangResume) return neverSettles();
    return this.session;
  }

  async stop(): Promise<unknown> {
    return undefined;
  }

  async forceStop(): Promise<void> {
    this.forceStopCalls++;
  }
}

/** A 1.0.1-shaped client that does NOT expose forceStop (risk row: absent). */
class MockClientWithoutForceStop implements ICopilotClient {
  resumeSessionCalls: CopilotResumeSessionConfig[] = [];

  constructor(private readonly session: MockSession) {}

  async createSession(
    _config?: CopilotSessionConfig,
  ): Promise<ICopilotSession> {
    return this.session;
  }

  async resumeSession(
    _sessionId: string,
    config?: CopilotResumeSessionConfig,
  ): Promise<ICopilotSession> {
    this.resumeSessionCalls.push(config ?? {});
    return this.session;
  }

  async stop(): Promise<unknown> {
    return undefined;
  }
}

async function waitFor(condition: () => boolean): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > 1000) {
      throw new Error('condition not met before timeout');
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe('SdkCopilotAdapter.run', () => {
  it('uses session.send and resolves on session idle', async () => {
    const session = new MockSession();
    const adapter = new SdkCopilotAdapter(new MockClient(session));
    const events: AgentEvent[] = [];

    const runPromise = adapter.run({
      prompt: '  hello  ',
      timeout: 123,
      onEvent: (event) => events.push(event),
    });

    await waitFor(() => session.sendCalls.length === 1);
    session.emit({
      type: 'assistant.message',
      data: { content: 'done', messageId: 'm1' },
    });
    session.emit({ type: 'session.idle', data: {} });

    const result = await runPromise;

    expect(result).toMatchObject({
      output: 'done',
      sessionId: 'mock-session',
      status: 'completed',
      exitCode: 0,
    });
    expect(session.sendCalls).toEqual([{ prompt: 'hello' }]);
    expect(session.sendAndWaitCalls).toHaveLength(0);
    expect(session.unsubscribeCalls).toBe(1);
    expect(session.disconnectCalls).toBe(1);
    expect(events.map((event) => event.type)).toEqual([
      'session_start',
      'message',
      'session_idle',
    ]);
  });

  it('emits every idle event but settles only once for queued flow', async () => {
    const session = new MockSession();
    const adapter = new SdkCopilotAdapter(new MockClient(session));
    const events: AgentEvent[] = [];

    const runPromise = adapter.run({
      prompt: 'start',
      onEvent: (event) => events.push(event),
    });

    await waitFor(() => session.sendCalls.length === 1);
    session.emit({ type: 'session.idle', data: {} });
    session.emit({ type: 'session.idle', data: {} });

    const result = await runPromise;

    expect(result.status).toBe('completed');
    expect(
      events.filter((event) => event.type === 'session_idle'),
    ).toHaveLength(2);
    expect(session.unsubscribeCalls).toBe(1);
    expect(session.disconnectCalls).toBe(1);
  });

  // Updated for FT-001 (plan 026 review F001): the streamed turn's
  // consolidated message now flows through instead of being suppressed.
  it('emits consolidated messages for streamed and unstreamed queued turns', async () => {
    const session = new MockSession();
    const adapter = new SdkCopilotAdapter(new MockClient(session));
    const events: AgentEvent[] = [];

    const runPromise = adapter.run({
      prompt: 'start',
      onEvent: (event) => events.push(event),
    });

    await waitFor(() => session.sendCalls.length === 1);
    session.emit({
      type: 'assistant.message_delta',
      data: { deltaContent: 'first', messageId: 'm1' },
    });
    session.emit({
      type: 'assistant.message',
      data: { content: 'first', messageId: 'm1' },
    });
    session.emit({ type: 'session.idle', data: {} });
    session.emit({
      type: 'assistant.message',
      data: { content: 'second', messageId: 'm2' },
    });
    session.emit({ type: 'session.idle', data: {} });

    const result = await runPromise;

    expect(result.output).toBe('second');
    expect(events.map((event) => event.type)).toEqual([
      'session_start',
      'text_delta',
      'message',
      'session_idle',
      'message',
      'session_idle',
    ]);
    expect(
      events.find(
        (event) => event.type === 'message' && event.data.messageId === 'm2',
      ),
    ).toBeDefined();
  });

  // FT-001 (plan 026 review F001) — the consolidated assistant.message must
  // still reach onEvent when deltas streamed: it is the single turn-accounting
  // signal the runner counts for --max-turns. Display dedup is downstream
  // (pretty.ts / human-view-model.ts coalesce by messageId) — never the
  // adapter's job.
  it('emits exactly one consolidated message event per streamed turn', async () => {
    const session = new MockSession();
    const adapter = new SdkCopilotAdapter(new MockClient(session));
    const events: AgentEvent[] = [];

    const runPromise = adapter.run({
      prompt: 'start',
      onEvent: (event) => events.push(event),
    });

    await waitFor(() => session.sendCalls.length === 1);
    session.emit({
      type: 'assistant.message_delta',
      data: { deltaContent: 'hel', messageId: 'm1' },
    });
    session.emit({
      type: 'assistant.message_delta',
      data: { deltaContent: 'lo', messageId: 'm1' },
    });
    session.emit({
      type: 'assistant.message',
      data: { content: 'hello', messageId: 'm1' },
    });
    session.emit({ type: 'session.idle', data: {} });

    const result = await runPromise;

    expect(result.output).toBe('hello');
    const messages = events.filter((event) => event.type === 'message');
    expect(messages).toHaveLength(1);
    expect(messages[0]?.data).toMatchObject({
      content: 'hello',
      messageId: 'm1',
    });
  });

  it('returns failed status when session error fires before idle', async () => {
    const session = new MockSession();
    const adapter = new SdkCopilotAdapter(new MockClient(session));

    const runPromise = adapter.run({ prompt: 'start' });

    await waitFor(() => session.sendCalls.length === 1);
    session.emit({
      type: 'session.error',
      data: { message: 'boom', errorType: 'SESSION_ERROR' },
    });

    const result = await runPromise;

    expect(result.status).toBe('failed');
    expect(result.output).toContain('boom');
    expect(session.unsubscribeCalls).toBe(1);
    expect(session.disconnectCalls).toBe(1);
  });

  // T008 (plan 025, FX012/PL-06) — a stream that dies while a message is
  // still in flight must emit provider_stream_aborted exactly once, carrying
  // the LATEST in-flight messageId.
  it('emits provider_stream_aborted once when the stream errors mid-message', async () => {
    const session = new MockSession();
    const adapter = new SdkCopilotAdapter(new MockClient(session));
    const events: AgentEvent[] = [];

    const runPromise = adapter.run({
      prompt: 'start',
      onEvent: (event) => events.push(event),
    });

    await waitFor(() => session.sendCalls.length === 1);
    session.emit({
      type: 'assistant.message_delta',
      data: { deltaContent: 'par', messageId: 'm1' },
    });
    session.emit({
      type: 'assistant.message',
      data: { content: 'partial-one', messageId: 'm1' },
    });
    session.emit({
      type: 'assistant.message_delta',
      data: { deltaContent: 'sec', messageId: 'm2' },
    });
    session.emit({
      type: 'session.error',
      data: { message: 'boom', errorType: 'SESSION_ERROR' },
    });

    const result = await runPromise;

    expect(result.status).toBe('failed');
    const aborts = events.filter(
      (event) => event.type === 'provider_stream_aborted',
    );
    expect(aborts).toHaveLength(1);
    expect(aborts[0]?.data).toMatchObject({
      messageId: 'm2',
      reason: expect.stringContaining('boom'),
    });
    // The abort diagnosis precedes the generic session_error.
    const types = events.map((event) => event.type);
    expect(types.indexOf('provider_stream_aborted')).toBeLessThan(
      types.indexOf('session_error'),
    );
  });

  it('does NOT emit provider_stream_aborted when the message settled before the error', async () => {
    const session = new MockSession();
    const adapter = new SdkCopilotAdapter(new MockClient(session));
    const events: AgentEvent[] = [];

    const runPromise = adapter.run({
      prompt: 'start',
      onEvent: (event) => events.push(event),
    });

    await waitFor(() => session.sendCalls.length === 1);
    session.emit({
      type: 'assistant.message_delta',
      data: { deltaContent: 'don', messageId: 'm1' },
    });
    session.emit({
      type: 'assistant.message',
      data: { content: 'done', messageId: 'm1' },
    });
    session.emit({
      type: 'session.error',
      data: { message: 'late boom', errorType: 'SESSION_ERROR' },
    });

    const result = await runPromise;

    expect(result.status).toBe('failed');
    expect(
      events.filter((event) => event.type === 'provider_stream_aborted'),
    ).toHaveLength(0);
  });

  it('does NOT emit provider_stream_aborted on a normal settle', async () => {
    const session = new MockSession();
    const adapter = new SdkCopilotAdapter(new MockClient(session));
    const events: AgentEvent[] = [];

    const runPromise = adapter.run({
      prompt: 'start',
      onEvent: (event) => events.push(event),
    });

    await waitFor(() => session.sendCalls.length === 1);
    session.emit({
      type: 'assistant.message_delta',
      data: { deltaContent: 'don', messageId: 'm1' },
    });
    session.emit({
      type: 'assistant.message',
      data: { content: 'done', messageId: 'm1' },
    });
    session.emit({ type: 'session.idle', data: {} });

    const result = await runPromise;

    expect(result.status).toBe('completed');
    expect(
      events.filter((event) => event.type === 'provider_stream_aborted'),
    ).toHaveLength(0);
  });

  it('invokes onSessionReady once with a working sender', async () => {
    const session = new MockSession();
    const adapter = new SdkCopilotAdapter(new MockClient(session));
    let callbackCount = 0;

    const runPromise = adapter.run({
      prompt: 'start',
      onSessionReady: (sender) => {
        callbackCount++;
        void sender.send('follow-up');
      },
    });

    await waitFor(() => session.sendCalls.length === 2);
    session.emit({ type: 'session.idle', data: {} });

    const result = await runPromise;

    expect(result.status).toBe('completed');
    expect(callbackCount).toBe(1);
    expect(session.sendCalls).toEqual([
      { prompt: 'start' },
      { prompt: 'follow-up' },
    ]);
  });

  it('passes skill config into createSession and resumeSession', async () => {
    const session = new MockSession();
    const client = new MockClient(session);
    const adapter = new SdkCopilotAdapter(client);

    const fresh = adapter.run({
      prompt: 'start',
      skillDirectories: ['/skills/grill-me'],
      disabledSkills: ['disabled-one'],
    });
    await waitFor(() => session.sendCalls.length === 1);
    session.emit({ type: 'session.idle', data: {} });
    await fresh;

    expect(client.createSessionCalls[0]).toMatchObject({
      skillDirectories: ['/skills/grill-me'],
      disabledSkills: ['disabled-one'],
    });

    const resumed = adapter.run({
      prompt: 'resume',
      sessionId: 'existing-session',
      skillDirectories: ['/skills/grill-me'],
      disabledSkills: ['disabled-one'],
    });
    await waitFor(() => session.sendCalls.length === 2);
    session.emit({ type: 'session.idle', data: {} });
    await resumed;

    expect(client.resumeSessionCalls[0]).toMatchObject({
      skillDirectories: ['/skills/grill-me'],
      disabledSkills: ['disabled-one'],
    });
  });

  // Plan 026 T003 — the run-`finally` disconnect is deadline-bounded: a
  // wedged subprocess must not block run() from returning its result.
  it('returns its result within the cleanup budget when disconnect hangs', async () => {
    const session = new MockSession();
    session.hangDisconnect = true;
    const adapter = new SdkCopilotAdapter(new MockClient(session), {
      cleanupRungTimeoutMs: 20,
    });

    const runPromise = adapter.run({ prompt: 'start' });
    await waitFor(() => session.sendCalls.length === 1);
    session.emit({
      type: 'assistant.message',
      data: { content: 'done', messageId: 'm1' },
    });
    session.emit({ type: 'session.idle', data: {} });

    const started = Date.now();
    const result = await runPromise;
    expect(Date.now() - started).toBeLessThan(2000);
    expect(result.status).toBe('completed');
    expect(result.output).toBe('done');
    expect(session.disconnectCalls).toBe(1);
  });

  it('normalizes skill load and invocation SDK events', async () => {
    const session = new MockSession();
    const adapter = new SdkCopilotAdapter(new MockClient(session));
    const events: AgentEvent[] = [];

    const runPromise = adapter.run({
      prompt: 'start',
      onEvent: (event) => events.push(event),
    });

    await waitFor(() => session.sendCalls.length === 1);
    session.emit({
      type: 'session.skills_loaded',
      data: {
        skills: [{ name: 'grill-me', path: '/skills/grill-me/SKILL.md' }],
      },
    });
    session.emit({
      type: 'skill.invoked',
      data: { name: 'grill-me', path: '/skills/grill-me/SKILL.md' },
    });
    session.emit({ type: 'session.idle', data: {} });

    await runPromise;

    expect(
      events.find((event) => event.type === 'skills_loaded'),
    ).toMatchObject({
      data: {
        skills: [{ name: 'grill-me', path: '/skills/grill-me/SKILL.md' }],
      },
    });
    expect(
      events.find((event) => event.type === 'skill_invoked'),
    ).toMatchObject({
      data: { name: 'grill-me', path: '/skills/grill-me/SKILL.md' },
    });
  });
});

// Plan 026 T003 — bounded cleanup ladder. No code path between a kill
// trigger and the terminal artifact writes may await an unbounded SDK
// promise; any hung/failed rung escalates to client.forceStop().
describe('SdkCopilotAdapter.terminate (bounded cleanup)', () => {
  it('aborts and disconnects gracefully without forceStop', async () => {
    const session = new MockSession();
    const client = new MockClient(session);
    const adapter = new SdkCopilotAdapter(client, { cleanupRungTimeoutMs: 20 });

    const result = await adapter.terminate('mock-session');

    expect(result).toMatchObject({
      sessionId: 'mock-session',
      status: 'killed',
      exitCode: 137,
    });
    expect(session.abortCalls).toBe(1);
    expect(session.disconnectCalls).toBe(1);
    expect(client.forceStopCalls).toBe(0);
  });

  it('returns within budget and escalates to forceStop when abort hangs', async () => {
    const session = new MockSession();
    session.hangAbort = true;
    const client = new MockClient(session);
    const adapter = new SdkCopilotAdapter(client, { cleanupRungTimeoutMs: 20 });

    const started = Date.now();
    const result = await adapter.terminate('mock-session');

    expect(Date.now() - started).toBeLessThan(2000);
    expect(result.status).toBe('killed');
    expect(client.forceStopCalls).toBe(1);
  });

  it('returns within budget and escalates when resumeSession itself hangs', async () => {
    const session = new MockSession();
    const client = new MockClient(session);
    client.hangResume = true;
    const adapter = new SdkCopilotAdapter(client, { cleanupRungTimeoutMs: 20 });

    const started = Date.now();
    const result = await adapter.terminate('mock-session');

    expect(Date.now() - started).toBeLessThan(2000);
    expect(result.status).toBe('killed');
    expect(client.forceStopCalls).toBe(1);
  });

  it('escalates when a rung rejects (wedged RPC) rather than hangs', async () => {
    const session = new MockSession();
    session.abort = async () => {
      session.abortCalls++;
      throw new Error('rpc dead');
    };
    const client = new MockClient(session);
    const adapter = new SdkCopilotAdapter(client, { cleanupRungTimeoutMs: 20 });

    const result = await adapter.terminate('mock-session');

    expect(result.status).toBe('killed');
    expect(client.forceStopCalls).toBe(1);
  });

  it('skips escalation gracefully when the client has no forceStop', async () => {
    const session = new MockSession();
    session.hangAbort = true;
    const client = new MockClientWithoutForceStop(session);
    const adapter = new SdkCopilotAdapter(client, { cleanupRungTimeoutMs: 20 });

    const started = Date.now();
    const result = await adapter.terminate('mock-session');

    expect(Date.now() - started).toBeLessThan(2000);
    expect(result.status).toBe('killed');
  });
});
