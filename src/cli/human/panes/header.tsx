/**
 * Header pane — slug / runId / sessionId / status / capability label / counts.
 *
 * Plan 009 Phase 2 AC-1.
 */

import { Box, Text } from 'ink';
import type * as React from 'react';
import type { HumanHeaderView } from '../../../runner/types.js';
import type { InputCapability } from '../input-bridge.js';

export interface HeaderPaneProps {
  header: HumanHeaderView;
  /** Live capability from input-bridge (preferred over model.input.mode). */
  capability: InputCapability;
}

export function HeaderPane({
  header,
  capability,
}: HeaderPaneProps): React.JSX.Element {
  const statusColor = colorForStatus(header.status);
  const capColor = colorForCapability(capability);
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="gray"
      paddingX={1}
    >
      <Box>
        <Text bold>{header.slug}</Text>
        <Text dimColor> · run </Text>
        <Text>{header.runId}</Text>
        {header.sessionId ? (
          <>
            <Text dimColor> · session </Text>
            <Text>{header.sessionId.slice(0, 8)}</Text>
          </>
        ) : null}
      </Box>
      <Box>
        <Text dimColor>status </Text>
        <Text color={statusColor}>{header.status}</Text>
        <Text dimColor> · capability </Text>
        <Text color={capColor}>{capability}</Text>
        <Text dimColor> · events </Text>
        <Text>{header.eventCount}</Text>
        <Text dimColor> · tools </Text>
        <Text>{header.toolCallCount}</Text>
        {header.unreadCount > 0 ? (
          <>
            <Text dimColor> · unread </Text>
            <Text color="yellow">{header.unreadCount}</Text>
          </>
        ) : null}
      </Box>
    </Box>
  );
}

function colorForStatus(status: HumanHeaderView['status']): string {
  switch (status) {
    case 'active':
      return 'green';
    case 'starting':
      return 'cyan';
    case 'stale':
      return 'yellow';
    case 'failed':
      return 'red';
    case 'completed':
      return 'gray';
    default:
      return 'white';
  }
}

function colorForCapability(cap: InputCapability): string {
  switch (cap) {
    case 'input available':
      return 'green';
    case 'input read-only':
      return 'yellow';
    case 'completed':
      return 'gray';
  }
}
