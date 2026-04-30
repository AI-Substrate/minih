/**
 * Transcript pane — outside actor / inside agent / system rows. Coalesces text
 * deltas via the reducer's status === 'streaming' marker.
 *
 * Plan 009 Phase 2 AC-2 / AC-4.
 */

import { Box, Text } from 'ink';
import type * as React from 'react';
import type { TranscriptEntry } from '../../../runner/types.js';

export interface TranscriptPaneProps {
  transcript: TranscriptEntry[];
  /** Maximum rows to render (most recent N). */
  maxRows?: number;
}

const DEFAULT_MAX_ROWS = 80;

export function TranscriptPane({
  transcript,
  maxRows = DEFAULT_MAX_ROWS,
}: TranscriptPaneProps): React.JSX.Element {
  const visible = transcript.slice(-maxRows);
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
      {visible.length === 0 ? (
        <Text dimColor> (no messages yet)</Text>
      ) : (
        visible.map((entry) => <TranscriptRow key={entry.id} entry={entry} />)
      )}
    </Box>
  );
}

function TranscriptRow({
  entry,
}: {
  entry: TranscriptEntry;
}): React.JSX.Element {
  const labelColor = colorForActor(entry.actorLabel);
  const statusBadge = badgeForStatus(entry.status);
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
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
      <Text>{entry.content}</Text>
    </Box>
  );
}

function colorForActor(label: TranscriptEntry['actorLabel']): string {
  switch (label) {
    case 'Outside actor':
      return 'cyan';
    case 'Inside agent':
      return 'magenta';
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
