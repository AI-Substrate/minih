import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readRecentEventLines } from '../../src/cli/commands/tail.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-tail-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('readRecentEventLines', () => {
  it('reads a bounded suffix when recent events fit in the tail window', () => {
    const eventsPath = path.join(tmpDir, 'events.ndjson');
    const oldEvent = JSON.stringify({
      type: 'text_delta',
      text: 'x'.repeat(128 * 1024),
    });
    const recentEvents = [
      JSON.stringify({ type: 'text_delta', text: 'recent-1' }),
      JSON.stringify({ type: 'text_delta', text: 'recent-2' }),
    ];
    fs.writeFileSync(eventsPath, `${oldEvent}\n${recentEvents.join('\n')}\n`);

    const result = readRecentEventLines(eventsPath, 2);

    expect(result.lines).toEqual(recentEvents);
    expect(result.hasEarlier).toBe(true);
    expect(result.bytesScanned).toBeLessThan(result.bytesRead);
  });

  it('reports exact skipped lines when the whole file fits in the tail window', () => {
    const eventsPath = path.join(tmpDir, 'events.ndjson');
    fs.writeFileSync(eventsPath, 'old\nrecent-1\nrecent-2\n');

    const result = readRecentEventLines(eventsPath, 2);

    expect(result.lines).toEqual(['recent-1', 'recent-2']);
    expect(result.skippedLineCount).toBe(1);
  });
});
