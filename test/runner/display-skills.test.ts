import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '../../src/adapter/events.js';
import { formatEvent } from '../../src/runner/display.js';

describe('skill event display', () => {
  it('formats loaded and invoked skill events', () => {
    const loaded: AgentEvent = {
      type: 'skills_loaded',
      timestamp: new Date().toISOString(),
      data: { skills: [{ name: 'grill-me' }], raw: {} },
    };
    const invoked: AgentEvent = {
      type: 'skill_invoked',
      timestamp: new Date().toISOString(),
      data: { name: 'grill-me', raw: {} },
    };

    expect(formatEvent(loaded)).toContain('skills loaded:');
    expect(formatEvent(loaded)).toContain('grill-me');
    expect(formatEvent(invoked)).toContain('skill invoked:');
    expect(formatEvent(invoked)).toContain('grill-me');
  });
});
