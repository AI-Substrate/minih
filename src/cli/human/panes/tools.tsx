/**
 * Tools pane — compact tool-call lifecycle rows (running / ok / error).
 *
 * Plan 009 Phase 2 AC-5.
 */

import { Box, Text } from 'ink';
import type * as React from 'react';
import type { ToolCallView } from '../../../runner/types.js';

export interface ToolsPaneProps {
  tools: ToolCallView[];
  maxRows?: number;
}

const DEFAULT_MAX_ROWS = 12;

export function ToolsPane({
  tools,
  maxRows = DEFAULT_MAX_ROWS,
}: ToolsPaneProps): React.JSX.Element {
  const visible = tools.slice(-maxRows);
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="gray"
      paddingX={1}
    >
      <Text bold dimColor>
        Tools
      </Text>
      {visible.length === 0 ? (
        <Text dimColor> (no tool calls)</Text>
      ) : (
        visible.map((tool) => <ToolRow key={tool.id} tool={tool} />)
      )}
    </Box>
  );
}

function ToolRow({ tool }: { tool: ToolCallView }): React.JSX.Element {
  const { glyph, color } = badgeForStatus(tool.status);
  const summary = tool.outputSummary ?? tool.inputSummary;
  return (
    <Box>
      <Text color={color}>{glyph} </Text>
      <Text bold>{tool.toolName}</Text>
      {summary ? (
        <>
          <Text dimColor> · </Text>
          <Text>{truncate(summary, 60)}</Text>
        </>
      ) : null}
      {tool.outputTruncated ? <Text dimColor> …</Text> : null}
    </Box>
  );
}

function badgeForStatus(status: ToolCallView['status']): {
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
