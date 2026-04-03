import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '../../src/adapter/events.js';
import { FakeAgentAdapter } from '../../src/adapter/fake.js';

describe('FakeAgentAdapter', () => {
  it('implements IAgentAdapter — run returns configured output', async () => {
    const fake = new FakeAgentAdapter({
      sessionId: 'test-session',
      output: 'hello world',
      status: 'completed',
      exitCode: 0,
    });

    const result = await fake.run({ prompt: 'say hello' });

    expect(result.output).toBe('hello world');
    expect(result.sessionId).toBe('test-session');
    expect(result.status).toBe('completed');
    expect(result.exitCode).toBe(0);
  });

  it('returns default values when no options provided', async () => {
    const fake = new FakeAgentAdapter();

    const result = await fake.run({ prompt: 'test' });

    expect(result.output).toBe('');
    expect(result.status).toBe('completed');
    expect(result.exitCode).toBe(0);
    expect(result.sessionId).toMatch(/^fake-session-/);
    expect(result.tokens).toEqual({ used: 0, total: 0, limit: 200000 });
  });

  it('emits events via onEvent callback', async () => {
    const events: AgentEvent[] = [];
    const fake = new FakeAgentAdapter({
      events: [
        {
          type: 'thinking',
          timestamp: '2026-01-01T00:00:00.000Z',
          data: { content: 'pondering...' },
        },
        {
          type: 'tool_call',
          timestamp: '2026-01-01T00:00:01.000Z',
          data: { toolName: 'bash', input: 'echo hi', toolCallId: 'tc1' },
        },
      ],
    });

    await fake.run({ prompt: 'test', onEvent: (e) => events.push(e) });

    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('thinking');
    expect(events[1].type).toBe('tool_call');
  });

  it('does not emit events when onEvent is not provided', async () => {
    const fake = new FakeAgentAdapter({
      events: [
        {
          type: 'message',
          timestamp: '2026-01-01T00:00:00.000Z',
          data: { content: 'hi' },
        },
      ],
    });

    // Should not throw
    const result = await fake.run({ prompt: 'test' });
    expect(result.status).toBe('completed');
  });

  it('tracks run call history', async () => {
    const fake = new FakeAgentAdapter();

    await fake.run({ prompt: 'first' });
    await fake.run({ prompt: 'second', model: 'gpt-5.4' });

    const history = fake.getRunHistory();
    expect(history).toHaveLength(2);
    expect(history[0].prompt).toBe('first');
    expect(history[1].prompt).toBe('second');
    expect(history[1].model).toBe('gpt-5.4');
  });

  it('assertRunCalled succeeds for matching call', async () => {
    const fake = new FakeAgentAdapter();
    await fake.run({ prompt: 'hello world' });

    expect(() => fake.assertRunCalled({ prompt: 'hello world' })).not.toThrow();
  });

  it('assertRunCalled throws for non-matching call', async () => {
    const fake = new FakeAgentAdapter();
    await fake.run({ prompt: 'hello' });

    expect(() => fake.assertRunCalled({ prompt: 'goodbye' })).toThrow(
      /Expected run/,
    );
  });

  it('reset clears all history', async () => {
    const fake = new FakeAgentAdapter();
    await fake.run({ prompt: 'test' });
    await fake.terminate('sess-1');
    await fake.compact('sess-2');

    fake.reset();

    expect(fake.getRunHistory()).toHaveLength(0);
    expect(fake.getTerminateHistory()).toHaveLength(0);
    expect(fake.getCompactHistory()).toHaveLength(0);
  });

  it('terminate returns killed status', async () => {
    const fake = new FakeAgentAdapter();

    const result = await fake.terminate('sess-1');

    expect(result.status).toBe('killed');
    expect(result.exitCode).toBe(143);
    expect(result.sessionId).toBe('sess-1');
    expect(fake.getTerminateHistory()).toEqual(['sess-1']);
  });

  it('compact returns completed status', async () => {
    const fake = new FakeAgentAdapter();

    const result = await fake.compact('sess-1');

    expect(result.status).toBe('completed');
    expect(result.sessionId).toBe('sess-1');
    expect(fake.getCompactHistory()).toEqual(['sess-1']);
  });

  it('uses provided sessionId when resuming', async () => {
    const fake = new FakeAgentAdapter({ sessionId: 'original' });

    const result = await fake.run({ prompt: 'test', sessionId: 'resumed' });

    expect(result.sessionId).toBe('resumed');
  });

  it('emitToolCall/emitToolResult/emitThinking add to event queue', async () => {
    const fake = new FakeAgentAdapter();
    fake.emitToolCall('bash', { command: 'ls' }, 'tc1');
    fake.emitToolResult('tc1', 'file1.ts\nfile2.ts');
    fake.emitThinking('analyzing results...');

    const events = fake.getEvents();
    expect(events).toHaveLength(3);
    expect(events[0].type).toBe('tool_call');
    expect(events[1].type).toBe('tool_result');
    expect(events[2].type).toBe('thinking');
  });

  it('setEvents replaces event queue', () => {
    const fake = new FakeAgentAdapter();
    fake.emitThinking('old');

    fake.setEvents([
      {
        type: 'message',
        timestamp: '2026-01-01T00:00:00.000Z',
        data: { content: 'new' },
      },
    ]);

    expect(fake.getEvents()).toHaveLength(1);
    expect(fake.getEvents()[0].type).toBe('message');
  });

  it('clearEvents empties event queue', () => {
    const fake = new FakeAgentAdapter();
    fake.emitThinking('something');
    fake.clearEvents();

    expect(fake.getEvents()).toHaveLength(0);
  });

  it('supports null tokens', async () => {
    const fake = new FakeAgentAdapter({ tokens: null });
    const result = await fake.run({ prompt: 'test' });
    expect(result.tokens).toBeNull();
  });

  it('supports stderr output', async () => {
    const fake = new FakeAgentAdapter({ stderr: 'error details' });
    const result = await fake.run({ prompt: 'test' });
    expect(result.stderr).toBe('error details');
  });
});
