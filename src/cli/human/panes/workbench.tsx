/**
 * Workbench pane — coordination timeline (inbox + state transitions + validation
 * + diagnostics) plus current state snapshot and output pane.
 *
 * Plan 009 Phase 2 AC-6 — links acks / replies (`ackOf`) to messages.
 */

import { Box, Text } from 'ink';
import type * as React from 'react';
import type {
  CoordinationTimelineEntry,
  HumanViewModel,
  InboxTimelineEntry,
  StatePaneView,
  StateTransitionTimelineEntry,
} from '../../../runner/types.js';

export interface WorkbenchPaneProps {
  coordination: CoordinationTimelineEntry[];
  state: StatePaneView;
  output: HumanViewModel['output'];
  maxRows?: number;
}

const DEFAULT_MAX_ROWS = 20;

export function WorkbenchPane({
  coordination,
  state,
  output,
  maxRows = DEFAULT_MAX_ROWS,
}: WorkbenchPaneProps): React.JSX.Element {
  const visible = coordination.slice(-maxRows);
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="gray"
      paddingX={1}
    >
      <Text bold dimColor>
        Workbench
      </Text>

      <Box flexDirection="column" marginTop={1}>
        <Text dimColor>State</Text>
        <Box>
          <Text>outside: </Text>
          <Text color="cyan">{state.outside?.status ?? '—'}</Text>
          <Text dimColor> · </Text>
          <Text>inside: </Text>
          <Text color="magenta">{state.inside?.status ?? '—'}</Text>
        </Box>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Text dimColor>Coordination</Text>
        {visible.length === 0 ? (
          <Text dimColor> (no activity)</Text>
        ) : (
          visible.map((entry) => <TimelineRow key={entry.id} entry={entry} />)
        )}
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Text dimColor>Output</Text>
        {output.exists ? (
          <Box>
            <Text color="green">✓ </Text>
            <Text wrap="truncate-start">{output.outputPath}</Text>
            {output.bytes !== null ? (
              <Text dimColor> ({output.bytes}b)</Text>
            ) : null}
          </Box>
        ) : (
          <Box>
            <Text dimColor>(not written)</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}

function TimelineRow({
  entry,
}: {
  entry: CoordinationTimelineEntry;
}): React.JSX.Element {
  switch (entry.kind) {
    case 'inbox':
      return <InboxRow entry={entry} />;
    case 'state-transition':
      return <StateRow entry={entry} />;
    case 'validation':
      return (
        <Box>
          <Text color={entry.valid ? 'green' : 'red'}>
            {entry.valid ? '✓ valid' : '✗ invalid'}
          </Text>
          {entry.errors.length > 0 ? (
            <Text dimColor wrap="truncate-end">
              {' · '}
              {entry.errors[0]}
            </Text>
          ) : null}
        </Box>
      );
    case 'control':
      return (
        <Box>
          <Text color="yellow">⚙ {entry.controlType}</Text>
          <Text dimColor wrap="truncate-end">
            {' · '}
            {entry.description}
          </Text>
        </Box>
      );
    case 'diagnostic':
      return (
        <Box>
          <Text color="red">⚠ </Text>
          <Text dimColor>[{entry.source}] </Text>
          <Text wrap="truncate-end">{entry.message}</Text>
        </Box>
      );
  }
}

function InboxRow({ entry }: { entry: InboxTimelineEntry }): React.JSX.Element {
  const laneColor = entry.lane === 'outside' ? 'cyan' : 'magenta';
  const ackBadge = badgeForAckState(entry.ackState);
  return (
    <Box flexDirection="column">
      <Box>
        <Text color={laneColor}>{entry.lane[0]}</Text>
        <Text dimColor> </Text>
        <Text bold>{entry.type}</Text>
        {ackBadge ? (
          <>
            <Text dimColor> </Text>
            <Text color={ackBadge.color}>{ackBadge.label}</Text>
          </>
        ) : null}
      </Box>
      <Text wrap="truncate-end">{entry.subject}</Text>
      {entry.ackOf ? (
        <Text dimColor wrap="truncate-end">
          ↳ {entry.ackOf.slice(0, 12)}
        </Text>
      ) : null}
    </Box>
  );
}

function StateRow({
  entry,
}: {
  entry: StateTransitionTimelineEntry;
}): React.JSX.Element {
  return (
    <Box>
      <Text color={entry.side === 'outside' ? 'cyan' : 'magenta'}>
        {entry.side[0]}
      </Text>
      <Text dimColor>: </Text>
      <Text dimColor>{entry.from}</Text>
      <Text> → </Text>
      <Text wrap="truncate-end">{entry.to}</Text>
    </Box>
  );
}

function badgeForAckState(
  ackState: InboxTimelineEntry['ackState'],
): { label: string; color: string } | null {
  switch (ackState) {
    case 'acked':
      return { label: 'acked', color: 'green' };
    case 'unacked':
      return { label: 'unacked', color: 'yellow' };
    case 'acks-other':
      return { label: 'acks', color: 'gray' };
    case 'not-ack':
      return null;
  }
}
