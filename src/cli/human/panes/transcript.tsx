/**
 * Transcript pane — outside actor / inside agent / inside agent (thinking) /
 * system / error rows. Coalesces text deltas via the reducer's
 * `status === 'streaming'` marker.
 *
 * Plan 009 Phase 2 AC-2 / AC-4 + FX002-1 (thinking events) + FX002-4 (noise cap +
 * empty-content fallback).
 *
 * **Layout discipline (FX002-3)**:
 *   - The current "visible window" is the last `maxRows` entries.
 *   - Streaming rows ALWAYS render in the dynamic block — never `<Static>` —
 *     so they update on every model snapshot.
 *   - Final rows that fall outside the visible window can be `<Static>`-mounted
 *     in a future enhancement; for now we use the simpler approach (cap + slice)
 *     to avoid the "Static can't evict" trap. If the transcript stays bounded
 *     by `maxRows` AND finalised rows scroll off via natural terminal scrollback,
 *     no Static is needed.
 *
 * **Thinking-row noise cap (FX002-4)**:
 *   - Within the visible window, the LAST 5 thinking rows are rendered live;
 *     any earlier consecutive thinking rows are collapsed into a single dim
 *     summary line `… N earlier thinking entries collapsed`.
 *   - Final non-thinking rows (user prompts, finalised messages, errors) are
 *     never collapsed.
 */

import { Box, Text } from 'ink';
import type * as React from 'react';
import type { ToolCallView, TranscriptEntry } from '../../../runner/types.js';

export interface TranscriptPaneProps {
  transcript: TranscriptEntry[];
  /**
   * Tool calls — interleaved chronologically with transcript entries via the
   * `startedAt` timestamp. Pass to render tools inline; omit for a
   * transcript-only view (legacy).
   */
  tools?: ToolCallView[];
  /** Maximum rows to render (most recent N). */
  maxRows?: number;
  /** Maximum thinking rows to keep rendered before collapsing earlier ones. */
  maxThinkingRows?: number;
  /**
   * How many rows to scroll back from the live tail. 0 = follow live tail (default).
   * Higher = older content. The pane clamps to the available range.
   */
  scrollOffset?: number;
}

const DEFAULT_MAX_ROWS = 30;
const DEFAULT_MAX_THINKING_ROWS = 5;

interface CollapsedSummary {
  kind: 'collapsed-summary';
  count: number;
  id: string;
}

interface CollapsedTools {
  kind: 'collapsed-tools';
  toolName: string;
  count: number;
  id: string;
  status: ToolCallView['status'];
}

interface ToolItem {
  kind: 'tool';
  tool: ToolCallView;
  ts: string; // For sort key — equals startedAt; mirrored for type narrowing.
}

interface TranscriptItem {
  kind: 'transcript';
  entry: TranscriptEntry;
  ts: string;
}

type StreamItem = TranscriptItem | ToolItem;
type RenderItem = StreamItem | CollapsedSummary | CollapsedTools;

function isThinkingSummary(item: RenderItem): item is CollapsedSummary {
  return (item as CollapsedSummary).kind === 'collapsed-summary';
}

function isToolsSummary(item: RenderItem): item is CollapsedTools {
  return (item as CollapsedTools).kind === 'collapsed-tools';
}

/**
 * Walk the visible window and collapse trailing-but-not-most-recent thinking
 * rows into a single summary entry. Any thinking row that is NOT among the last
 * `maxThinkingRows` thinking rows in the window is collapsed; final non-thinking
 * rows are preserved.
 */
/**
 * Collapse runs of consecutive identical tool calls (same `toolName`) into a
 * single `collapsed-tools` summary row. Spammy long-poll patterns (e.g.,
 * `inbox_list` returning empty 30+ times during idle waits) shouldn't fill
 * the transcript. Only adjacent-equal runs collapse — interleaved tools/
 * transcript entries break the run.
 *
 * Threshold: runs of ≥3 identical tools collapse. Shorter runs render normally.
 */
function collapseToolNoise(rows: StreamItem[]): RenderItem[] {
  const out: RenderItem[] = [];
  let i = 0;
  while (i < rows.length) {
    const item = rows[i];
    if (item.kind !== 'tool') {
      out.push(item);
      i++;
      continue;
    }
    // Look-ahead: how many consecutive tool items share the same toolName?
    let runEnd = i + 1;
    while (
      runEnd < rows.length &&
      rows[runEnd].kind === 'tool' &&
      (rows[runEnd] as ToolItem).tool.toolName === item.tool.toolName
    ) {
      runEnd++;
    }
    const runLength = runEnd - i;
    if (runLength >= 3) {
      const last = rows[runEnd - 1] as ToolItem;
      out.push({
        kind: 'collapsed-tools',
        toolName: item.tool.toolName,
        count: runLength,
        id: `tool-collapse-${item.tool.id}`,
        status: last.tool.status,
      });
    } else {
      for (let j = i; j < runEnd; j++) out.push(rows[j]);
    }
    i = runEnd;
  }
  return out;
}

/**
 * Walk the visible window and collapse trailing-but-not-most-recent thinking
 * rows into a single summary entry. Operates AFTER tool-noise collapse.
 */
function collapseThinkingNoise(
  rows: RenderItem[],
  maxThinkingRows: number,
): RenderItem[] {
  const thinkingPositions: number[] = [];
  rows.forEach((r, i) => {
    if (
      !isToolsSummary(r) &&
      !isThinkingSummary(r) &&
      r.kind === 'transcript' &&
      r.entry.actorLabel === 'Inside agent (thinking)'
    ) {
      thinkingPositions.push(i);
    }
  });
  if (thinkingPositions.length <= maxThinkingRows) return rows;

  const keepFromIdx =
    thinkingPositions[thinkingPositions.length - maxThinkingRows];
  const collapsedCount = thinkingPositions.length - maxThinkingRows;

  const out: RenderItem[] = [];
  let inserted = false;
  rows.forEach((r, i) => {
    const isThinking =
      !isToolsSummary(r) &&
      !isThinkingSummary(r) &&
      r.kind === 'transcript' &&
      r.entry.actorLabel === 'Inside agent (thinking)';
    if (isThinking && i < keepFromIdx) {
      if (!inserted) {
        out.push({
          kind: 'collapsed-summary',
          count: collapsedCount,
          id: `collapsed-${i}`,
        });
        inserted = true;
      }
      return;
    }
    out.push(r);
  });
  return out;
}

/**
 * Merge transcript entries + tool calls into a single chronological stream
 * (sorted by ts; transcript ts vs tool startedAt). Stable sort: when two items
 * share a timestamp, transcript entries render before tool calls (mirrors how
 * the SDK emits — assistant text typically lands the millisecond before the
 * tool_call is recorded).
 */
function buildStream(
  transcript: TranscriptEntry[],
  tools: ToolCallView[],
): StreamItem[] {
  const items: StreamItem[] = [];
  for (const entry of transcript) {
    items.push({ kind: 'transcript', entry, ts: entry.ts });
  }
  for (const tool of tools) {
    items.push({ kind: 'tool', tool, ts: tool.startedAt });
  }
  items.sort((a, b) => {
    if (a.ts < b.ts) return -1;
    if (a.ts > b.ts) return 1;
    // Tie-break: transcript before tool.
    if (a.kind === b.kind) return 0;
    return a.kind === 'transcript' ? -1 : 1;
  });
  return items;
}

export function TranscriptPane({
  transcript,
  tools,
  maxRows = DEFAULT_MAX_ROWS,
  maxThinkingRows = DEFAULT_MAX_THINKING_ROWS,
  scrollOffset = 0,
}: TranscriptPaneProps): React.JSX.Element {
  const stream = buildStream(transcript, tools ?? []);
  // Clamp scroll offset to the valid range. 0 = follow live tail.
  const maxOffset = Math.max(0, stream.length - maxRows);
  const offset = Math.min(Math.max(0, scrollOffset), maxOffset);
  const end = stream.length - offset;
  const start = Math.max(0, end - maxRows);
  const window = stream.slice(start, end);
  const noToolNoise = collapseToolNoise(window);
  const items = collapseThinkingNoise(noToolNoise, maxThinkingRows);
  const showingOlder = offset > 0;
  return (
    <Box flexDirection="column" paddingX={1} flexGrow={1} overflow="hidden">
      <Box>
        <Text bold dimColor>
          Transcript
        </Text>
        {showingOlder ? (
          <Text dimColor italic>
            {' · scrolled back '}
            {offset}
            {' (End to follow)'}
          </Text>
        ) : null}
      </Box>
      {items.length === 0 ? (
        <Text dimColor> (no messages yet)</Text>
      ) : (
        items.map((item) => {
          if (isThinkingSummary(item)) {
            return <CollapsedRow key={item.id} count={item.count} />;
          }
          if (isToolsSummary(item)) {
            return <CollapsedToolsRow key={item.id} item={item} />;
          }
          if (item.kind === 'tool') {
            return <ToolRow key={item.tool.id} tool={item.tool} />;
          }
          return <TranscriptRow key={item.entry.id} entry={item.entry} />;
        })
      )}
    </Box>
  );
}

function CollapsedToolsRow({
  item,
}: {
  item: CollapsedTools;
}): React.JSX.Element {
  const { glyph, color } = badgeForToolStatus(item.status);
  return (
    <Box marginTop={1} width="100%" overflowX="hidden">
      <Text color={color}>{glyph} </Text>
      <Text bold dimColor>
        {item.toolName}
      </Text>
      <Text dimColor> · × {item.count}</Text>
    </Box>
  );
}

function ToolRow({ tool }: { tool: ToolCallView }): React.JSX.Element {
  const { glyph, color } = badgeForToolStatus(tool.status);
  const summary = tool.outputSummary ?? tool.inputSummary;
  const summaryClean = summary ? summary.replace(/\s+/g, ' ').trim() : null;
  return (
    <Box marginTop={1} width="100%" overflowX="hidden">
      <Text color={color}>{glyph} </Text>
      <Text bold wrap="truncate-end">
        {tool.toolName}
      </Text>
      {summaryClean ? (
        <>
          <Text dimColor> · </Text>
          <Text dimColor wrap="truncate-end">
            {summaryClean}
          </Text>
        </>
      ) : null}
      {tool.outputTruncated ? <Text dimColor> …</Text> : null}
    </Box>
  );
}

function badgeForToolStatus(status: ToolCallView['status']): {
  glyph: string;
  color: string;
} {
  switch (status) {
    case 'running':
      return { glyph: '◐', color: 'yellow' };
    case 'ok':
      return { glyph: '✓', color: 'green' };
    case 'error':
      return { glyph: '✗', color: 'red' };
  }
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n - 1)}…`;
}

function CollapsedRow({ count }: { count: number }): React.JSX.Element {
  return (
    <Box marginTop={1} width="100%" overflowX="hidden">
      <Text dimColor italic>
        … {count} earlier thinking {count === 1 ? 'entry' : 'entries'} collapsed
      </Text>
    </Box>
  );
}

function TranscriptRow({
  entry,
}: {
  entry: TranscriptEntry;
}): React.JSX.Element | null {
  const isThinking = entry.actorLabel === 'Inside agent (thinking)';
  const labelColor = colorForActor(entry.actorLabel);
  const statusBadge = badgeForStatus(entry.status);
  const hasContent = entry.content.trim().length > 0;

  // Skip empty non-streaming rows entirely — the previous "(no content yet)"
  // placeholder produced visual concat artifacts where the placeholder ran
  // into the next row's content. If the reducer ever produces an empty
  // finalised row, that's a reducer bug to fix at source, not paper over here.
  if (!hasContent && entry.status !== 'streaming') {
    return null;
  }

  if (isThinking) {
    // Single truncated line — thinking is transient state, not chat content.
    // No emoji prefix: 💭 is double-width which throws off Ink's wrap math
    // (it counts chars, not display cells), causing the second visual cell
    // to bleed past the column boundary on emoji-containing rows.
    const cleaned = entry.content.replace(/\s+/g, ' ').trim();
    return (
      <Box marginTop={1} width="100%" overflowX="hidden">
        <Text dimColor italic wrap="truncate-end">
          ~ {cleaned || '(thinking…)'}
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginTop={1} width="100%" overflowX="hidden">
      <Box width="100%">
        <Text color={labelColor} bold>
          {entry.actorLabel}
        </Text>
        {statusBadge ? (
          <>
            <Text dimColor> · </Text>
            <Text color={statusBadge.color}>{statusBadge.label}</Text>
          </>
        ) : null}
      </Box>
      {hasContent ? (
        <Box width="100%">
          <Text wrap="wrap">{entry.content}</Text>
        </Box>
      ) : (
        <Text dimColor italic>
          …
        </Text>
      )}
    </Box>
  );
}

function colorForActor(label: TranscriptEntry['actorLabel']): string {
  switch (label) {
    case 'Outside actor':
      return 'cyan';
    case 'Inside agent':
      return 'magenta';
    case 'Inside agent (thinking)':
      return 'gray';
    case 'System':
      return 'gray';
    case 'Error':
      return 'red';
  }
}

function badgeForStatus(
  status: TranscriptEntry['status'],
): { label: string; color: string } | null {
  switch (status) {
    case 'streaming':
      return { label: '… streaming', color: 'yellow' };
    case 'collapsed':
      return { label: 'collapsed', color: 'gray' };
    case 'error':
      return { label: 'error', color: 'red' };
    case 'final':
      return null;
  }
}
