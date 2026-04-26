import { afterEach, describe, expect, it } from 'vitest';
import {
  invalidContextEnvelope,
  isInsideMinihSession,
} from '../../src/cli/preaction-context.js';

const originalMinih = process.env.MINIH;

afterEach(() => {
  if (originalMinih === undefined) {
    delete process.env.MINIH;
  } else {
    process.env.MINIH = originalMinih;
  }
});

describe('preaction context block', () => {
  it('detects inside context only for strict MINIH=1', () => {
    process.env.MINIH = '1';
    expect(isInsideMinihSession()).toBe(true);

    for (const value of ['true', '0', ' 1 ', '', 'yes']) {
      process.env.MINIH = value;
      expect(isInsideMinihSession()).toBe(false);
    }

    delete process.env.MINIH;
    expect(isInsideMinihSession()).toBe(false);
  });

  it('builds an E128 INVALID_CONTEXT envelope with alternatives', () => {
    const envelope = invalidContextEnvelope({
      commandName: 'run',
      alternatives: ['Use the inbox MCP tools from inside the session.'],
    });

    expect(envelope).toMatchObject({
      command: 'run',
      status: 'error',
      error: {
        code: 'E128',
        message: 'Cannot run `minih run` from inside a minih session.',
        details: {
          context: 'inside',
          expectedContext: 'outside',
          alternatives: ['Use the inbox MCP tools from inside the session.'],
        },
      },
    });
  });
});
