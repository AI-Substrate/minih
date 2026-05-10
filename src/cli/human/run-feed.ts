/**
 * minih run-feed — file-watcher loop that re-derives `HumanViewModel` from a
 * run directory's artifacts.
 *
 * Owns I/O; the reducer (`buildHumanViewModel`) stays pure. Watches `events.ndjson`,
 * `run.json`, the `inbox/<lane>/messages.ndjson` files, `state/<side>.json` files,
 * `state/history.ndjson`, `completed.json`, and `output/report.json` for changes. On
 * any change, debounces ~75ms, re-snapshots all artifacts, re-builds the view model,
 * emits via `onUpdate`.
 *
 * Public surface:
 *   - `createRunFeed({ runDir, onUpdate })` — starts the feed; calls `onUpdate` once
 *     synchronously after initial snapshot, then on every debounced change.
 *   - `feed.stop()` — releases watchers.
 *   - `feed.readSnapshot()` — one-shot read of `HumanViewSources` without subscribing.
 *     Phase 3 snapshot mode reuses this without starting watchers.
 *
 * Platform note: `fs.watch` is non-recursive on Linux; we watch a small fixed set of
 * known files individually (and the inbox/ + state/ directories for new files).
 */

import { type FSWatcher, watch as fsWatch } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { AgentEvent } from '../../adapter/events.js';
import type { InboxLane } from '../../runner/human-view-fixtures.js';
import {
  buildHumanViewModel,
  type HumanViewModel,
  type HumanViewSources,
  readManifest,
} from '../../runner/index.js';
import type {
  CompletedMetadata,
  InboxMessage,
  InsideState,
  OutsideState,
  StateHistoryEntry,
  ValidationResult,
} from '../../runner/types.js';
import { readRecentEventLines } from '../commands/tail.js';

export interface RunFeedOptions {
  runDir: string;
  onUpdate: (model: HumanViewModel) => void;
  /** Override the events tail size (default 1000 lines). */
  eventsTailLines?: number;
  /** Override the debounce window (default 75ms). */
  debounceMs?: number;
}

export interface RunFeed {
  stop(): void;
  readSnapshot(): Promise<HumanViewSources>;
}

const DEFAULT_DEBOUNCE_MS = 75;
const DEFAULT_TAIL_LINES = 1000;

export async function createRunFeed(options: RunFeedOptions): Promise<RunFeed> {
  const debounce = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const tailLines = options.eventsTailLines ?? DEFAULT_TAIL_LINES;
  const runDir = options.runDir;

  const watchers: FSWatcher[] = [];
  let stopped = false;
  let debounceTimer: NodeJS.Timeout | null = null;

  const snapshot = (): Promise<HumanViewSources> =>
    readAllSources(runDir, tailLines);

  const emit = async (): Promise<void> => {
    if (stopped) return;
    try {
      const sources = await snapshot();
      const model = buildHumanViewModel(sources);
      options.onUpdate(model);
    } catch {
      // Surface diagnostics through the next snapshot cycle; never throw out
      // of the watcher callback (it would crash the process).
    }
  };

  const scheduleEmit = (): void => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void emit();
    }, debounce);
  };

  // Initial emit BEFORE returning the handle (per Phase 2 contract — first
  // paint must show accumulated events).
  await emit();

  const watchPath = (target: string): void => {
    try {
      const w = fsWatch(target, { persistent: false }, () => {
        scheduleEmit();
      });
      w.on('error', () => {
        // ENOENT means the file/dir doesn't exist yet — safe to ignore;
        // a later emit will pick it up via the runDir watcher.
      });
      watchers.push(w);
    } catch {
      // file/dir doesn't exist yet — safe to ignore
    }
  };

  watchPath(runDir);
  watchPath(path.join(runDir, 'events.ndjson'));
  watchPath(path.join(runDir, 'run.json'));
  watchPath(path.join(runDir, 'completed.json'));
  watchPath(path.join(runDir, 'inbox'));
  watchPath(path.join(runDir, 'inbox', 'outside'));
  watchPath(path.join(runDir, 'inbox', 'inside'));
  watchPath(path.join(runDir, 'state'));
  watchPath(path.join(runDir, 'state', 'history.ndjson'));
  watchPath(path.join(runDir, 'state', 'inside.json'));
  watchPath(path.join(runDir, 'state', 'outside.json'));
  watchPath(path.join(runDir, 'output'));
  watchPath(path.join(runDir, 'output', 'report.json'));

  return {
    stop(): void {
      stopped = true;
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      for (const w of watchers) {
        try {
          w.close();
        } catch {
          // ignore
        }
      }
      watchers.length = 0;
    },
    readSnapshot(): Promise<HumanViewSources> {
      return snapshot();
    },
  };
}

// ============================================
// Source readers
// ============================================

async function readAllSources(
  runDir: string,
  tailLines: number,
): Promise<HumanViewSources> {
  const [
    events,
    manifest,
    completed,
    inbox,
    state,
    history,
    output,
    validation,
  ] = await Promise.all([
    readEvents(runDir, tailLines),
    readManifestSafe(runDir),
    readCompleted(runDir),
    readInboxLanes(runDir),
    readStates(runDir),
    readHistory(runDir),
    readOutput(runDir),
    readValidation(runDir),
  ]);

  return {
    events,
    manifest,
    completed,
    inbox,
    state,
    history,
    output,
    validation,
  };
}

async function readEvents(
  runDir: string,
  tailLines: number,
): Promise<AgentEvent[]> {
  const eventsPath = path.join(runDir, 'events.ndjson');
  if (!(await pathExists(eventsPath))) return [];
  try {
    const result = readRecentEventLines(eventsPath, tailLines);
    const events: AgentEvent[] = [];
    for (const line of result.lines) {
      try {
        events.push(JSON.parse(line) as AgentEvent);
      } catch {
        // Skip non-JSON line; reducer surfaces unknown shapes via diagnostics.
      }
    }
    return events;
  } catch {
    return [];
  }
}

async function readManifestSafe(
  runDir: string,
): Promise<HumanViewSources['manifest']> {
  try {
    return await readManifest(runDir);
  } catch {
    return null;
  }
}

async function readCompleted(
  runDir: string,
): Promise<CompletedMetadata | null> {
  const file = path.join(runDir, 'completed.json');
  if (!(await pathExists(file))) return null;
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw) as CompletedMetadata;
  } catch {
    return null;
  }
}

async function readInboxLanes(runDir: string): Promise<InboxLane[]> {
  const lanes: InboxLane[] = [];
  for (const lane of ['outside', 'inside'] as const) {
    const file = path.join(runDir, 'inbox', lane, 'messages.ndjson');
    const messages = await readJsonl<InboxMessage>(file);
    lanes.push({ lane, messages });
  }
  return lanes;
}

async function readStates(
  runDir: string,
): Promise<{ inside: InsideState | null; outside: OutsideState | null }> {
  const inside = await readJsonObject<InsideState>(
    path.join(runDir, 'state', 'inside.json'),
  );
  const outside = await readJsonObject<OutsideState>(
    path.join(runDir, 'state', 'outside.json'),
  );
  return { inside, outside };
}

async function readHistory(runDir: string): Promise<StateHistoryEntry[]> {
  return readJsonl<StateHistoryEntry>(
    path.join(runDir, 'state', 'history.ndjson'),
  );
}

async function readOutput(runDir: string): Promise<HumanViewSources['output']> {
  const outputPath = path.join(runDir, 'output', 'report.json');
  try {
    const stat = await fs.stat(outputPath);
    return { outputPath, exists: true, bytes: stat.size };
  } catch {
    return { outputPath, exists: false, bytes: null };
  }
}

async function readValidation(
  runDir: string,
): Promise<ValidationResult | null> {
  const file = path.join(runDir, 'validation', 'last.json');
  return readJsonObject<ValidationResult>(file);
}

// ============================================
// Helpers
// ============================================

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function readJsonObject<T>(file: string): Promise<T | null> {
  if (!(await pathExists(file))) return null;
  try {
    const raw = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed)
    ) {
      return null;
    }
    return parsed as T;
  } catch {
    return null;
  }
}

async function readJsonl<T>(file: string): Promise<T[]> {
  if (!(await pathExists(file))) return [];
  try {
    const raw = await fs.readFile(file, 'utf8');
    const lines = raw.split('\n').filter((l) => l.trim().length > 0);
    const out: T[] = [];
    for (const line of lines) {
      try {
        out.push(JSON.parse(line) as T);
      } catch {
        // skip malformed
      }
    }
    return out;
  } catch {
    return [];
  }
}
