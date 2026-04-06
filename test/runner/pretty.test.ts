import { beforeEach, describe, expect, it } from 'vitest';
import type { AgentEvent } from '../../src/adapter/events.js';
import { PrettyDisplay } from '../../src/runner/pretty.js';

// Capture stderr writes
function captureStderr(fn: () => void): string {
  const writes: string[] = [];
  const orig = process.stderr.write;
  process.stderr.write = ((chunk: string) => {
    writes.push(chunk);
    return true;
  }) as typeof process.stderr.write;
  try {
    fn();
  } finally {
    process.stderr.write = orig;
  }
  return writes.join('');
}

function makeThinking(
  content: string,
  isDelta = true,
): Extract<AgentEvent, { type: 'thinking' }> {
  return {
    type: 'thinking',
    timestamp: new Date().toISOString(),
    data: { content, isDelta },
  };
}

function makeTextDelta(
  content: string,
  messageId?: string,
): Extract<AgentEvent, { type: 'text_delta' }> {
  return {
    type: 'text_delta',
    timestamp: new Date().toISOString(),
    data: { content, messageId },
  };
}

function makeMessage(
  content: string,
  messageId?: string,
): Extract<AgentEvent, { type: 'message' }> {
  return {
    type: 'message',
    timestamp: new Date().toISOString(),
    data: { content, messageId },
  };
}

function makeToolCall(
  toolName: string,
  input: unknown,
  toolCallId: string,
): Extract<AgentEvent, { type: 'tool_call' }> {
  return {
    type: 'tool_call',
    timestamp: new Date().toISOString(),
    data: { toolName, input, toolCallId },
  };
}

function makeToolResult(
  toolCallId: string,
  output: string,
  isError = false,
): Extract<AgentEvent, { type: 'tool_result' }> {
  return {
    type: 'tool_result',
    timestamp: new Date().toISOString(),
    data: { toolCallId, output, isError },
  };
}

describe('PrettyDisplay', () => {
  let display: PrettyDisplay;

  beforeEach(() => {
    display = new PrettyDisplay();
  });

  describe('thinking events', () => {
    it('accumulates isDelta=true thinking events', () => {
      const output = captureStderr(() => {
        display.handleEvent(makeThinking('Hello '));
        display.handleEvent(makeThinking('world'));
      });
      expect(output).toContain('Hello ');
      expect(output).toContain('world');
    });

    it('suppresses isDelta=false thinking events', () => {
      const output = captureStderr(() => {
        display.handleEvent(makeThinking('chunk1 ', true));
        display.handleEvent(makeThinking('chunk2', true));
        display.handleEvent(
          makeThinking('chunk1 chunk2 — full consolidated', false),
        );
      });
      expect(output).toContain('chunk1 ');
      expect(output).toContain('chunk2');
      expect(output).not.toContain('full consolidated');
    });

    it('shows final-only thinking when no deltas preceded it', () => {
      const output = captureStderr(() => {
        display.handleEvent(
          makeThinking('Final-only reasoning content', false),
        );
      });
      expect(output).toContain('Final-only reasoning content');
    });
  });

  describe('message suppression', () => {
    it('suppresses message when text_delta stream was active', () => {
      const output = captureStderr(() => {
        display.handleEvent(makeTextDelta('Hello ', 'msg-1'));
        display.handleEvent(makeTextDelta('world', 'msg-1'));
        display.handleEvent(makeMessage('Hello world', 'msg-1'));
      });
      // Should contain the deltas but not duplicate the message
      expect(output).toContain('Hello ');
      expect(output).toContain('world');
      // The full "Hello world" message should NOT appear as a separate block
      const lines = output.split('\n').filter((l) => l.trim());
      expect(lines.length).toBeLessThanOrEqual(1);
    });

    it('suppresses message when inDeltaStream even without messageId', () => {
      const output = captureStderr(() => {
        display.handleEvent(makeTextDelta('Hello '));
        display.handleEvent(makeTextDelta('world'));
        display.handleEvent(makeMessage('Hello world'));
      });
      expect(output).toContain('Hello ');
      expect(output).toContain('world');
      const occurrences = (output.match(/Hello/g) || []).length;
      expect(occurrences).toBe(1);
    });

    it('shows message when no prior deltas', () => {
      const output = captureStderr(() => {
        display.handleEvent(makeMessage('Direct message'));
      });
      expect(output).toContain('Direct message');
    });
  });

  describe('intent capture', () => {
    it('captures report_intent tool call as inline intent', () => {
      const output = captureStderr(() => {
        display.handleEvent(
          makeToolCall(
            'report_intent',
            { intent: 'Exploring codebase' },
            'tc-1',
          ),
        );
      });
      expect(output).toContain('Exploring codebase');
    });

    it('does not show report_intent as a regular tool call', () => {
      const output = captureStderr(() => {
        display.handleEvent(
          makeToolCall('report_intent', { intent: 'Testing' }, 'tc-1'),
        );
      });
      expect(output).not.toContain('🔧');
    });
  });

  describe('tool call lifecycle', () => {
    it('shows tool call with name and preview', () => {
      const output = captureStderr(() => {
        display.handleEvent(
          makeToolCall('bash', { command: 'ls -la' }, 'tc-2'),
        );
      });
      expect(output).toContain('bash');
      expect(output).toContain('ls -la');
    });

    it('shows result with success icon', () => {
      const output = captureStderr(() => {
        display.handleEvent(makeToolCall('bash', { command: 'pwd' }, 'tc-3'));
        display.handleEvent(makeToolResult('tc-3', '/Users/test'));
      });
      expect(output).toContain('✓');
      expect(output).toContain('/Users/test');
    });

    it('shows result with error icon', () => {
      const output = captureStderr(() => {
        display.handleEvent(makeToolCall('bash', { command: 'fail' }, 'tc-4'));
        display.handleEvent(makeToolResult('tc-4', 'Command failed', true));
      });
      expect(output).toContain('✗');
    });
  });

  describe('cleanup', () => {
    it('flushes thinking stream with newline', () => {
      const output = captureStderr(() => {
        display.handleEvent(makeThinking('partial'));
        display.cleanup();
      });
      expect(output).toContain('partial');
      expect(output.endsWith('\n')).toBe(true);
    });

    it('flushes text delta stream with newline', () => {
      const output = captureStderr(() => {
        display.handleEvent(makeTextDelta('partial'));
        display.cleanup();
      });
      expect(output).toContain('partial');
      expect(output.endsWith('\n')).toBe(true);
    });

    it('resets sawThinkingDelta so next segment handles final-only correctly', () => {
      const output = captureStderr(() => {
        // First segment: deltas then final (suppressed)
        display.handleEvent(makeThinking('delta chunk', true));
        display.handleEvent(makeThinking('full text', false));
        display.cleanup();
        // Second segment: final-only (should show)
        display.handleEvent(makeThinking('new final-only', false));
      });
      expect(output).toContain('delta chunk');
      expect(output).not.toContain('full text');
      expect(output).toContain('new final-only');
    });
  });
});
