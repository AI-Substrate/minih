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
import type { TranscriptEntry } from '../../../runner/types.js';

export interface TranscriptPaneProps {
  transcript: TranscriptEntry[];
  /** Maximum rows to render (most recent N). */
  maxRows?: number;
  /** Maximum thinking rows to keep rendered before collapsing earlier ones. */
  maxThinkingRows?: number;
}

const DEFAULT_MAX_ROWS = 80;
const DEFAULT_MAX_THINKING_ROWS = 5;

interface CollapsedSummary {
  kind: 'collapsed-summary';
  count: number;
  id: string;
}

type RenderItem = TranscriptEntry | CollapsedSummary;

function isSummary(item: RenderItem): item is CollapsedSummary {
  return (item as CollapsedSummary).kind === 'collapsed-summary';
}

/**
 * Walk the visible window and collapse trailing-but-not-most-recent thinking
 * rows into a single summary entry. Any thinking row that is NOT among the last
 * `maxThinkingRows` thinking rows in the window is collapsed; final non-thinking
 * rows are preserved.
 */
function collapseThinkingNoise(
  rows: TranscriptEntry[],
  maxThinkingRows: number,
): RenderItem[] {
  // Index the positions of all thinking rows in the window.
  const thinkingPositions: number[] = [];
  rows.forEach((r, i) => {
    if (r.actorLabel === 'Inside agent (thinking)') thinkingPositions.push(i);
  });
  if (thinkingPositions.length <= maxThinkingRows) return rows;

  // Keep the last N thinking rows visible; collapse the rest.
  const keepFromIdx =
    thinkingPositions[thinkingPositions.length - maxThinkingRows];
  const collapsedCount = thinkingPositions.length - maxThinkingRows;

  const out: RenderItem[] = [];
  let inserted = false;
  rows.forEach((r, i) => {
    const isThinking = r.actorLabel === 'Inside agent (thinking)';
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

export function TranscriptPane({
  transcript,
  maxRows = DEFAULT_MAX_ROWS,
  maxThinkingRows = DEFAULT_MAX_THINKING_ROWS,
}: TranscriptPaneProps): React.JSX.Element {
  const window = transcript.slice(-maxRows);
  const items = collapseThinkingNoise(window, maxThinkingRows);
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="gray"
      paddingX={1}
    >
      <Text bold dimColor>
        Transcript
      </Text>
      {items.length === 0 ? (
        <Text dimColor> (no messages yet)</Text>
      ) : (
        items.map((item) =>
          isSummary(item) ? (
            <CollapsedRow key={item.id} count={item.count} />
          ) : (
            <TranscriptRow key={item.id} entry={item} />
          ),
        )
      )}
    </Box>
  );
}

function CollapsedRow({ count }: { count: number }): React.JSX.Element {
  return (
    <Box marginTop={1}>
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
}): React.JSX.Element {
  const labelColor = colorForActor(entry.actorLabel);
  const isThinking = entry.actorLabel === 'Inside agent (thinking)';
  const statusBadge = badgeForStatus(entry.status);
  const hasContent = entry.content.trim().length > 0;
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text color={labelColor} bold={!isThinking} italic={isThinking}>
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
        <Text dimColor={isThinking} italic={isThinking}>
          {entry.content}
        </Text>
      ) : (
        <Text dimColor italic>
          (no content yet)
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
