/**
 * minih human-view Ink root — composes header / transcript / tools / workbench /
 * footer with capability-aware footer input and three split layouts:
 *   - 'transcript' — transcript expanded, workbench compact (Tab)
 *   - 'workbench'  — workbench expanded, transcript compact (Shift-Tab)
 *   - 'reset'      — even split (Esc)
 *
 * Renders to `process.stderr` (CLI stdout discipline — AC-13).
 *
 * Phase 3 forward-compat seam:
 *   - `mountHumanApp(props)` returns `{ unmount, waitUntilExit }` so callers
 *     own lifecycle.
 *   - Ink configured with `exitOnCtrlC: false` — caller registers signal handlers.
 *   - `feed.stop()` is invoked from `unmount()` so cleanup is single-source.
 */

import { Box, render, useInput } from 'ink';
import * as React from 'react';
import type { HumanViewModel } from '../../runner/types.js';
import type { InputBridge } from './input-bridge.js';
import { FooterPane } from './panes/footer.js';
import { HeaderPane } from './panes/header.js';
import { TranscriptPane } from './panes/transcript.js';
import { WorkbenchPane } from './panes/workbench.js';
import type { RunFeed } from './run-feed.js';

export interface MountHumanAppOptions {
  feed: RunFeed;
  bridge: InputBridge;
  /** Initial view model — must be provided so first paint is non-blank. */
  initial: HumanViewModel;
  /**
   * Called when the user requests exit via Ctrl-C / Ctrl-D inside the TUI.
   * The caller is expected to call `handle.unmount()` and then exit the
   * process. Without this, raw-mode + `exitOnCtrlC: false` swallows the
   * keypress and SIGINT never fires.
   */
  onExitRequest?: () => void;
}

export interface HumanAppHandle {
  unmount(): void;
  waitUntilExit(): Promise<void>;
  /** Programmatic update of the bridge (e.g. when run flips to completed). */
  updateBridge(bridge: InputBridge): void;
}

type SplitLayout = 'transcript' | 'workbench' | 'reset';

interface AppProps {
  initialBridge: InputBridge;
  initial: HumanViewModel;
  bridgeUpdateRef: React.MutableRefObject<((b: InputBridge) => void) | null>;
  onExitRequest?: () => void;
}

function App({
  initialBridge,
  initial,
  bridgeUpdateRef,
  onExitRequest,
}: AppProps): React.JSX.Element {
  const [model, setModel] = React.useState<HumanViewModel>(initial);
  const [bridge, setBridge] = React.useState<InputBridge>(initialBridge);
  const [followPaused, setFollowPaused] = React.useState<boolean>(false);
  const [layout, setLayout] = React.useState<SplitLayout>('reset');

  React.useEffect(() => {
    bridgeUpdateRef.current = (next) => setBridge(next);
    return () => {
      bridgeUpdateRef.current = null;
    };
  }, [bridgeUpdateRef]);

  // Note: feed updates flow via the module-level appSetModelRef setter; the
  // run-feed's onUpdate callback calls pushHumanModel which writes through it.
  // The dynamic flexGrow that used to drive split-layout was removed in FX002-3
  // — transcript:workbench is now a fixed 60/40 split with minWidth=30 on the
  // workbench. The split-layout state still drives WHICH pane is visually
  // expanded via height ratios inside the left column (transcript vs tools).

  useInput((input, key) => {
    // FX002 follow-up — Ink with `exitOnCtrlC: false` + raw mode swallows
    // Ctrl-C; SIGINT never fires. Detect ctrl+c / ctrl+d explicitly and
    // hand control to the caller (which knows how to tear down the SDK
    // session, not just the renderer).
    if (key.ctrl && (input === 'c' || input === 'd')) {
      onExitRequest?.();
      return;
    }
    if (key.tab && key.shift) {
      setLayout('workbench');
      return;
    }
    if (key.tab) {
      setLayout('transcript');
      return;
    }
    if (key.escape) {
      setLayout('reset');
      return;
    }
  });

  // Expose setModel as a side-effect for the parent — see mountHumanApp below.
  React.useEffect(() => {
    appSetModelRef.current = setModel;
    return () => {
      if (appSetModelRef.current === setModel) appSetModelRef.current = null;
    };
  }, []);

  // FX002-3 — fixed-height layout. `process.stderr.rows` may be undefined when
  // stderr is not a TTY (CI, piped output); fallback to 30 keeps Ink's
  // log-mode rendering coherent. Terminal resize is not handled in v1.
  const terminalRows = process.stderr.rows ?? 30;

  // Plan 009 user pref (2026-04-30 18:25): default 3:1 transcript:workbench
  // (~75/25). Split-layout swaps:
  //   reset             → 3:1 (transcript wider — chat is the focus)
  //   transcript-expand → 9:1 (workbench shrinks to a thin sidebar)
  //   workbench-expand  → 1:1 (workbench takes equal share for inspecting)
  const transcriptColRatio =
    layout === 'transcript' ? 9 : layout === 'workbench' ? 1 : 3;
  const workbenchColRatio =
    layout === 'workbench' ? 1 : layout === 'transcript' ? 1 : 1;

  return (
    <Box flexDirection="column" height={terminalRows}>
      <Box flexShrink={0} width="100%">
        <HeaderPane header={model.header} capability={bridge.capability} />
      </Box>
      <Box flexDirection="row" flexGrow={1} width="100%">
        <Box flexDirection="column" flexGrow={transcriptColRatio} flexBasis={0}>
          <TranscriptPane transcript={model.transcript} tools={model.tools} />
        </Box>
        <Box
          flexDirection="column"
          flexGrow={workbenchColRatio}
          flexBasis={0}
          minWidth={24}
        >
          <WorkbenchPane
            coordination={model.coordination}
            state={model.state}
            output={model.output}
          />
        </Box>
      </Box>
      <Box flexShrink={0} width="100%">
        <FooterPane
          bridge={bridge}
          followPaused={followPaused}
          onTogglePause={() => setFollowPaused((p) => !p)}
        />
      </Box>
    </Box>
  );
}

// Module-level setter handle for the live model (set by the App effect on mount).
// `mountHumanApp` reads it to drive `feed`-emitted updates into React state.
const appSetModelRef: { current: ((m: HumanViewModel) => void) | null } = {
  current: null,
};

/**
 * Mount the human-view Ink app. Caller owns lifecycle — Ink is configured with
 * `exitOnCtrlC: false` so the parent registers signal handlers.
 *
 * IMPORTANT: caller must wire `feed.onUpdate` in `createRunFeed()` to invoke
 * the returned `handle.pushModel` (or pass a closure that will). For v1 we
 * use a module-level setter ref, so callers MUST construct the feed AFTER
 * mounting the app — see `view.ts` and `run --human` for canonical patterns.
 */
export function mountHumanApp(options: MountHumanAppOptions): HumanAppHandle {
  const bridgeUpdateRef: React.MutableRefObject<
    ((b: InputBridge) => void) | null
  > = { current: null };

  const instance = render(
    <App
      initialBridge={options.bridge}
      initial={options.initial}
      bridgeUpdateRef={bridgeUpdateRef}
      onExitRequest={options.onExitRequest}
    />,
    {
      stdout: process.stderr,
      exitOnCtrlC: false,
    },
  );

  let unmounted = false;
  const unmount = (): void => {
    if (unmounted) return;
    unmounted = true;
    try {
      instance.unmount();
    } catch {
      // ignore
    }
    try {
      options.feed.stop();
    } catch {
      // ignore
    }
  };

  return {
    unmount,
    waitUntilExit: () => instance.waitUntilExit().then(() => undefined),
    updateBridge(next: InputBridge): void {
      if (bridgeUpdateRef.current) bridgeUpdateRef.current(next);
    },
  };
}

/**
 * Push a new view model into the mounted app. Called by the run-feed's
 * `onUpdate` callback. No-op if no app is mounted.
 */
/**
 * Push a new view model into the mounted app. Called by the run-feed's
 * `onUpdate` callback. No-op if no app is mounted.
 *
 * **Throttle**: limit React re-renders to ~10 fps (100ms min interval). Without
 * this, a burst of fs.watch events can trigger Ink + yoga layout thrash that
 * leaves ghost border characters from the previous frame (known Ink rendering
 * artifact with frequent re-renders).
 */
let lastPushAt = 0;
let pendingModel: HumanViewModel | null = null;
let pendingTimer: NodeJS.Timeout | null = null;
const PUSH_THROTTLE_MS = 100;

export function pushHumanModel(model: HumanViewModel): void {
  if (!appSetModelRef.current) return;
  const now = Date.now();
  const elapsed = now - lastPushAt;
  if (elapsed >= PUSH_THROTTLE_MS) {
    lastPushAt = now;
    appSetModelRef.current(model);
    pendingModel = null;
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
    return;
  }
  // Queue the latest model for the trailing edge of the throttle window.
  pendingModel = model;
  if (!pendingTimer) {
    const wait = PUSH_THROTTLE_MS - elapsed;
    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      if (pendingModel && appSetModelRef.current) {
        lastPushAt = Date.now();
        appSetModelRef.current(pendingModel);
        pendingModel = null;
      }
    }, wait);
  }
}
