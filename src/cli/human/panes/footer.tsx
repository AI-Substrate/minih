/**
 * Footer pane — capability-aware text input + pause toggle. Pause copy is
 * `Pause scroll` / `Resume follow` (Workshop 003) — never implies the agent stops.
 *
 * Plan 009 Phase 2 AC-7 / AC-8 / AC-9.
 */

import { Box, Text, useInput } from 'ink';
import * as React from 'react';
import type { InputBridge } from '../input-bridge.js';

export interface FooterPaneProps {
  bridge: InputBridge;
  followPaused: boolean;
  onTogglePause: () => void;
  onSubmitted?: (text: string) => void;
  /** Disable input handling for tests / non-TTY contexts. */
  inputDisabled?: boolean;
}

export function FooterPane({
  bridge,
  followPaused,
  onTogglePause,
  onSubmitted,
  inputDisabled,
}: FooterPaneProps): React.JSX.Element {
  const [draft, setDraft] = React.useState<string>('');
  const [lastResult, setLastResult] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState<boolean>(false);

  const canType = bridge.capability === 'input available' && !inputDisabled;

  useInput(
    (input, key) => {
      if (key.return) {
        if (canType && draft.length > 0 && !submitting) {
          void doSubmit(draft);
        }
        return;
      }
      if (key.tab) {
        // Tab toggles transcript-vs-workbench focus (split layout); handled by parent.
        return;
      }
      if (input === 'p' && key.ctrl) {
        onTogglePause();
        return;
      }
      if (key.backspace || key.delete) {
        if (canType) setDraft((d) => d.slice(0, -1));
        return;
      }
      if (canType && input && !key.ctrl && !key.meta) {
        setDraft((d) => d + input);
      }
    },
    { isActive: !inputDisabled },
  );

  const doSubmit = async (text: string): Promise<void> => {
    setSubmitting(true);
    const result = await bridge.submit(text);
    setSubmitting(false);
    if (result.ok) {
      setDraft('');
      setLastResult(`sent · ${result.messageId.slice(0, 12)}`);
      onSubmitted?.(text);
    } else {
      setLastResult(`refused · ${result.reason}`);
    }
  };

  const capColor =
    bridge.capability === 'input available'
      ? 'green'
      : bridge.capability === 'input read-only'
        ? 'yellow'
        : 'gray';

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1} width="100%">
      <Box>
        <Text color={capColor}>{bridge.capability}</Text>
        {bridge.reason ? (
          <>
            <Text dimColor> · </Text>
            <Text dimColor>{bridge.reason}</Text>
          </>
        ) : null}
        <Text dimColor> · </Text>
        <Text>{followPaused ? 'Pause scroll' : 'Resume follow'}</Text>
        <Text dimColor> (Ctrl-P toggles)</Text>
      </Box>
      <Box>
        <Text dimColor>{canType ? '> ' : '  '}</Text>
        <Text>{canType ? draft : '(input disabled)'}</Text>
        {canType ? <Text inverse> </Text> : null}
      </Box>
      {lastResult ? (
        <Box>
          <Text dimColor>{lastResult}</Text>
        </Box>
      ) : null}
      {submitting ? (
        <Box>
          <Text color="yellow">… sending</Text>
        </Box>
      ) : null}
    </Box>
  );
}
