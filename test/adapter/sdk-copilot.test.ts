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

class MockSession implements ICopilotSession {
  readonly sessionId = 'mock-session';
  readonly sendCalls: Array<{ prompt: string }> = [];
  readonly sendAndWaitCalls: Array<{ prompt: string }> = [];
  readonly handlers: Array<(event: CopilotSessionEventLike) => void> = [];
  disconnectCalls = 0;
  unsubscribeCalls = 0;
  abortCalls = 0;
  destroyCalls = 0;

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
  }

  async disconnect(): Promise<void> {
    this.disconnectCalls++;
  }

  async destroy(): Promise<void> {
    this.destroyCalls++;
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

  it('resets duplicate suppression at idle boundaries for queued turns', async () => {
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
});
