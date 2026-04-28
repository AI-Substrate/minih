#!/usr/bin/env node
import readline from 'node:readline';

const ui = process.stderr;

const ANSI = {
  clear: '\x1b[2J\x1b[H',
  hideCursor: '\x1b[?25l',
  showCursor: '\x1b[?25h',
};

const SPLITS = {
  default: { ratio: 0.65, label: '65/35' },
  transcript: { ratio: 0.8, label: '80/20' },
  workbench: { ratio: 0.45, label: '45/55' },
};

const STREAM_CHUNKS = [
  'I am reading the failed report now.',
  ' The schema error is clear: summary is required.',
  ' I am rewriting the report so the validation agent can consume it.',
  ' The next check should pass if the output envelope stays stable.',
  ' PASS. Report rewritten, checked, and ready for review.',
];

const fixtures = {
  'coordination-rich': {
    header: {
      slug: 'coordination-loop-validator',
      runId: '2026-04-28T07-10-06-449Z-e403',
      sessionId: '73e9ae6a-17b9-4af8-9dea-b5633bbd2831',
      status: 'active',
      mode: 'input-available',
      elapsedMs: 336700,
      eventCount: 4842,
      toolCallCount: 40,
      unreadCount: 0,
    },
    transcript: [
      {
        role: 'outside',
        content: 'milestone: area-1 ready for validation',
        status: 'final',
      },
      {
        role: 'inside',
        content:
          'I see area-1. I will validate the handoff and reply once I know whether the report is consumable.',
        status: 'final',
      },
      {
        role: 'inside',
        content:
          'The report schema failed first. I am reading the schema, rewriting the report, then checking again.',
        status: 'final',
      },
      {
        role: 'inside',
        content:
          'I found the issue: the summary field was nested under the wrong object. I am preserving the rest of the validation record and only moving that field.',
        status: 'final',
      },
      {
        role: 'inside',
        content:
          'PASS. Report rewritten and validated. I am sending an inside ack and leaving the magic-wand notes in the post.',
        status: 'final',
      },
      {
        role: 'system',
        content:
          'Mock-up note: this transcript is coalesced from message blocks. Token deltas would be grouped here instead of printed one per line.',
        status: 'final',
      },
    ],
    tools: [
      {
        name: 'bash npm test',
        status: 'running',
        input: 'vitest coordination-loop-validator',
        output: 'waiting on 3 files',
        duration: '00:41',
      },
      {
        name: 'mcp inbox_list',
        status: 'ok',
        input: 'lane inside',
        output: '2 messages, 0 unread',
        duration: '00:02',
      },
      {
        name: 'check report',
        status: 'error',
        input: 'report.json',
        output: 'schema: /summary required',
        duration: '00:01',
      },
      {
        name: 'apply_patch',
        status: 'ok',
        input: 'move summary field',
        output: '1 file changed',
        duration: '00:04',
      },
      {
        name: 'validate-v2',
        status: 'queued',
        input: 'communication report',
        output: 'waiting for runner idle',
        duration: '--:--',
      },
    ],
    coordination: [
      {
        lane: 'outside',
        kind: 'milestone',
        subject: 'area-1 ready for validation',
        detail: 'from parent runner',
      },
      {
        lane: 'inside',
        kind: 'ack',
        subject: 'ack area-1',
        detail: 'linked to outside milestone',
      },
      {
        lane: 'inside',
        kind: 'state',
        subject: 'reviewing',
        detail: 'schema repair in progress',
      },
      {
        lane: 'outside',
        kind: 'feedback',
        subject: 'PASS with wand notes',
        detail: 'post requested',
      },
      {
        lane: 'inside',
        kind: 'handoff',
        subject: 'ready for next agent',
        detail: 'no blockers',
      },
    ],
    state: [
      ['inside', 'reviewing'],
      ['outside', 'in-progress'],
      ['output', 'degraded -> repaired'],
      ['follow', 'on'],
      ['control', 'SessionSender ready'],
      ['post', '004 pending'],
    ],
  },
  'token-deltas': {
    header: {
      slug: 'smoke-test',
      runId: '2026-04-28T08-12-22-120Z-a91c',
      sessionId: 'b4030e32-628c-473f-87ac-01792cc4bcaa',
      status: 'active',
      mode: 'input-available',
      elapsedMs: 104000,
      eventCount: 910,
      toolCallCount: 7,
      unreadCount: 0,
    },
    transcript: [
      {
        role: 'outside',
        content: 'please validate this run and keep the transcript readable',
        status: 'final',
      },
      {
        role: 'inside',
        content: 'I am preparing to stream a response.',
        status: 'streaming',
      },
    ],
    tools: [
      {
        name: 'bash just fft',
        status: 'running',
        input: 'full quality gate',
        output: 'lint complete, build running',
        duration: '01:19',
      },
      {
        name: 'rg failures',
        status: 'ok',
        input: 'search test output',
        output: 'no fatal errors',
        duration: '00:01',
      },
    ],
    coordination: [
      {
        lane: 'outside',
        kind: 'request',
        subject: 'validate communication',
        detail: 'parent waiting',
      },
      {
        lane: 'inside',
        kind: 'state',
        subject: 'testing',
        detail: 'tool stream active',
      },
    ],
    state: [
      ['inside', 'testing'],
      ['outside', 'waiting'],
      ['output', 'streaming'],
      ['follow', 'on'],
    ],
  },
  'attached-read-only': {
    header: {
      slug: 'coordination-loop-validator',
      runId: '2026-04-28T07-10-06-449Z-e403',
      sessionId: '73e9ae6a-17b9-4af8-9dea-b5633bbd2831',
      status: 'active',
      mode: 'input-read-only',
      elapsedMs: 418000,
      eventCount: 6120,
      toolCallCount: 48,
      unreadCount: 3,
    },
    transcript: [
      {
        role: 'system',
        content:
          'Attached to an already-running run. This process can read artifacts, but cannot send to the original SDK session yet.',
        status: 'final',
      },
      {
        role: 'inside',
        content:
          'I am currently validating the post and will write the result into the run folder. Input is disabled in this mock attach mode.',
        status: 'final',
      },
      {
        role: 'inside',
        content:
          'You can still inspect tool calls, coordination messages, state, and output without running tail/status separately.',
        status: 'final',
      },
    ],
    tools: [
      {
        name: 'tail events.ndjson',
        status: 'ok',
        input: 'read latest 200 events',
        output: '6120 events loaded',
        duration: '00:01',
      },
      {
        name: 'read state',
        status: 'ok',
        input: 'agents/<slug>/state',
        output: 'inside reviewing',
        duration: '00:01',
      },
    ],
    coordination: [
      {
        lane: 'outside',
        kind: 'milestone',
        subject: 'manual operator attached',
        detail: 'read-only view',
      },
      {
        lane: 'inside',
        kind: 'state',
        subject: 'reviewing',
        detail: 'active run, no control lane',
      },
    ],
    state: [
      ['inside', 'reviewing'],
      ['outside', 'active'],
      ['control', 'read-only'],
      ['input', 'disabled'],
      ['source', 'run artifacts'],
    ],
  },
  completed: {
    header: {
      slug: 'smoke-test',
      runId: '2026-04-28T06-48-17-912Z-c7db',
      sessionId: '7dbb0772-5cb3-497e-8e8e-cbd878dd9604',
      status: 'completed',
      mode: 'completed',
      elapsedMs: 192000,
      eventCount: 1330,
      toolCallCount: 12,
      unreadCount: 0,
    },
    transcript: [
      {
        role: 'outside',
        content:
          'run smoke-test and tell me if the output contract still holds',
        status: 'final',
      },
      {
        role: 'inside',
        content:
          'Smoke test completed. The stdout envelope stayed machine-readable and the stderr progress output was human-readable.',
        status: 'final',
      },
      {
        role: 'inside',
        content:
          'Magic wand: the harness should have surfaced the run ID and latest post link without asking me to query status separately.',
        status: 'final',
      },
    ],
    tools: [
      {
        name: 'minih run smoke-test',
        status: 'ok',
        input: '--input fixture.json',
        output: 'status passed',
        duration: '03:12',
      },
      {
        name: 'check envelope',
        status: 'ok',
        input: 'stdout JSON',
        output: 'valid',
        duration: '00:01',
      },
    ],
    coordination: [
      {
        lane: 'outside',
        kind: 'complete',
        subject: 'smoke-test passed',
        detail: 'manual resume available',
      },
    ],
    state: [
      ['inside', 'complete'],
      ['outside', 'complete'],
      ['output', 'passed'],
      ['control', 'closed'],
    ],
  },
};

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  ui.write(helpText());
  process.exit(0);
}

if (!fixtures[args.fixture]) {
  ui.write(
    `Unknown fixture "${args.fixture}". Available: ${Object.keys(fixtures).join(', ')}\n`,
  );
  process.exit(1);
}

const state = {
  model: clone(fixtures[args.fixture]),
  split: args.split,
  draft: '',
  followPaused: false,
  pauseAnchorLineCount: null,
  scrollOffset: 0,
  streamChunkIndex: 0,
  notification: '',
  unreadLineCount: 0,
};

let lastLayout = { transcriptWidth: 70, transcriptLineCount: 0 };
let closed = false;
const timers = [];

if (args.snapshot || !process.stdin.isTTY || !process.stderr.isTTY) {
  ui.write(`${renderFrame(state, terminalSize())}\n`);
  process.exit(0);
}

startInteractive();

function startInteractive() {
  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();

  ui.write(ANSI.hideCursor);
  render();

  process.stdin.on('keypress', onKeypress);
  process.stderr.on('resize', render);
  process.on('SIGINT', () => close(0));
  process.on('exit', () => {
    ui.write(ANSI.showCursor);
  });

  timers.push(
    setInterval(() => {
      state.model.header.elapsedMs += 1000;
      if (args.play) {
        advancePlayback();
      }
      render();
    }, 1000),
  );
}

function onKeypress(input, key = {}) {
  state.notification = '';

  if (key.ctrl && key.name === 'c') {
    close(0);
    return;
  }

  if (key.ctrl && key.name === 'f') {
    toggleFollowPaused();
    render();
    return;
  }

  if (key.name === 'up') {
    scrollTranscript(1);
    render();
    return;
  }

  if (key.name === 'down') {
    scrollTranscript(-1);
    render();
    return;
  }

  if (key.name === 'pageup') {
    scrollTranscript(8);
    render();
    return;
  }

  if (key.name === 'pagedown') {
    scrollTranscript(-8);
    render();
    return;
  }

  if (input === '[') {
    state.split = 'transcript';
    render();
    return;
  }

  if (input === ']') {
    state.split = 'workbench';
    render();
    return;
  }

  if (input === '=') {
    state.split = 'default';
    render();
    return;
  }

  if (key.name === 'return') {
    sendDraft();
    render();
    return;
  }

  if (key.name === 'backspace' || key.sequence === '\x7f') {
    state.draft = state.draft.slice(0, -1);
    render();
    return;
  }

  if (isPrintable(input) && inputControlsEnabled(state.model)) {
    state.draft += input;
    render();
  }
}

function render() {
  ui.write(ANSI.clear + renderFrame(state, terminalSize()));
}

function close(code) {
  if (closed) {
    return;
  }
  closed = true;
  for (const timer of timers) {
    clearInterval(timer);
  }
  process.stdin.off('keypress', onKeypress);
  process.stderr.off('resize', render);
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false);
  }
  ui.write(`${ANSI.showCursor}\n`);
  process.exit(code);
}

function advancePlayback() {
  state.model.header.eventCount += 3;

  if (args.fixture === 'token-deltas') {
    const current = state.model.transcript.at(-1);
    if (
      current &&
      current.role === 'agent' &&
      state.streamChunkIndex < STREAM_CHUNKS.length
    ) {
      current.content =
        state.streamChunkIndex === 0
          ? STREAM_CHUNKS[state.streamChunkIndex]
          : current.content + STREAM_CHUNKS[state.streamChunkIndex];
      current.status =
        state.streamChunkIndex === STREAM_CHUNKS.length - 1
          ? 'final'
          : 'streaming';
      state.streamChunkIndex += 1;
    }

    const runningTool = state.model.tools.find(
      (tool) => tool.status === 'running',
    );
    if (runningTool && state.streamChunkIndex === STREAM_CHUNKS.length) {
      runningTool.status = 'ok';
      runningTool.output = 'quality gate passed';
      runningTool.duration = '02:06';
      state.model.coordination.push({
        lane: 'inside',
        kind: 'feedback',
        subject: 'stream completed',
        detail: 'coalesced transcript stayed readable',
      });
      state.model.state = state.model.state.map(([key, value]) =>
        key === 'output' ? [key, 'pass'] : [key, value],
      );
    }
    return;
  }

  const runningTool = state.model.tools.find(
    (tool) => tool.status === 'running',
  );
  if (runningTool) {
    const seconds = Math.floor(state.model.header.elapsedMs / 1000) % 60;
    runningTool.output = `still running, last heartbeat ${String(seconds).padStart(2, '0')}s`;
  }
}

function toggleFollowPaused() {
  state.followPaused = !state.followPaused;
  state.scrollOffset = 0;
  if (state.followPaused) {
    state.pauseAnchorLineCount = buildTranscriptLines(
      state.model,
      lastLayout.transcriptWidth,
    ).length;
    state.notification =
      'Follow paused. New transcript lines will count here until resumed.';
  } else {
    state.pauseAnchorLineCount = null;
    state.notification = 'Follow resumed.';
  }
}

function scrollTranscript(delta) {
  if (!state.followPaused) {
    state.followPaused = true;
    state.pauseAnchorLineCount = buildTranscriptLines(
      state.model,
      lastLayout.transcriptWidth,
    ).length;
  }
  const maxOffset = Math.max(0, (state.pauseAnchorLineCount ?? 0) - 5);
  state.scrollOffset = clamp(state.scrollOffset + delta, 0, maxOffset);
}

function sendDraft() {
  if (!inputControlsEnabled(state.model)) {
    state.notification = 'Input disabled in this mode.';
    return;
  }

  const draft = state.draft.trim();
  if (!draft) {
    state.notification = 'Type a message first.';
    return;
  }

  state.model.transcript.push({
    role: 'outside',
    content: draft,
    status: 'final',
  });
  state.model.transcript.push({
    role: 'inside',
    content:
      'Mock outside message received. Product code should write this through the outside lane so the same message is visible in chat and MCP inbox state.',
    status: 'final',
  });
  state.model.tools.unshift({
    name: 'mock send',
    status: 'ok',
    input: 'local draft',
    output: 'appended to mock model',
    duration: '00:00',
  });
  state.model.coordination.push({
    lane: 'inside',
    kind: 'note',
    subject: 'operator message appended',
    detail: 'mock local state only',
  });
  state.model.header.eventCount += 2;
  state.model.header.toolCallCount += 1;
  state.draft = '';
  state.followPaused = false;
  state.pauseAnchorLineCount = null;
  state.scrollOffset = 0;
  state.notification = 'Mock message appended locally.';
}

function renderFrame(viewState, size) {
  const width = clamp(size.width, 70, 220);
  const height = clamp(size.height, 18, 80);
  const header = renderHeader(viewState.model, width);
  const footer = renderFooter(viewState, width);
  const bodyHeight = Math.max(5, height - header.length - footer.length);

  if (width < 90) {
    return [
      ...header,
      ...renderNarrowWarning(width, bodyHeight),
      ...footer,
    ].join('\n');
  }

  const body =
    width >= 120
      ? renderWideBody(viewState, width, bodyHeight)
      : renderMediumBody(viewState, width, bodyHeight);

  return [...header, ...body, ...footer].slice(0, height).join('\n');
}

function renderHeader(model, width) {
  const header = model.header;
  const session =
    header.sessionId.length > 8
      ? header.sessionId.slice(0, 8)
      : header.sessionId;
  return [
    border(width),
    framedLine(
      `minih view ${header.slug} | ${header.status} | input ${inputLabel(header.mode)} | elapsed ${formatElapsed(
        header.elapsedMs,
      )}`,
      width,
    ),
    framedLine(
      `run ${header.runId} | session ${session} | events ${header.eventCount} | tools ${header.toolCallCount} | unread ${header.unreadCount}`,
      width,
    ),
    border(width),
  ];
}

function renderWideBody(viewState, width, height) {
  const split = SPLITS[viewState.split] ?? SPLITS.default;
  const innerHeight = Math.max(3, height - 2);
  const availableWidth = width - 3;
  const leftWidth = clamp(
    Math.floor(availableWidth * split.ratio),
    36,
    availableWidth - 18,
  );
  const rightWidth = availableWidth - leftWidth;

  lastLayout = {
    transcriptWidth: leftWidth,
    transcriptLineCount: buildTranscriptLines(viewState.model, leftWidth)
      .length,
  };

  const transcript = visibleTranscriptLines(viewState, leftWidth, innerHeight);
  const workbench = buildWorkbenchLines(
    viewState.model,
    rightWidth,
    viewState.split,
  );
  const lines = [`+${'-'.repeat(leftWidth)}+${'-'.repeat(rightWidth)}+`];

  for (let index = 0; index < innerHeight; index += 1) {
    lines.push(
      `|${fit(transcript[index] ?? '', leftWidth)}|${fit(workbench[index] ?? '', rightWidth)}|`,
    );
  }

  lines.push(`+${'-'.repeat(leftWidth)}+${'-'.repeat(rightWidth)}+`);
  return lines;
}

function renderMediumBody(viewState, width, height) {
  const transcriptHeight = Math.max(6, Math.floor(height * 0.55));
  const workbenchHeight = Math.max(5, height - transcriptHeight);
  const innerWidth = width - 2;
  const transcriptLines = visibleTranscriptLines(
    viewState,
    innerWidth,
    transcriptHeight - 2,
  );
  const workbenchLines = buildWorkbenchLines(
    viewState.model,
    innerWidth,
    viewState.split,
  );

  lastLayout = {
    transcriptWidth: innerWidth,
    transcriptLineCount: buildTranscriptLines(viewState.model, innerWidth)
      .length,
  };

  return [
    ...renderSectionBox('TRANSCRIPT', transcriptLines, width, transcriptHeight),
    ...renderSectionBox('WORKBENCH', workbenchLines, width, workbenchHeight),
  ].slice(0, height);
}

function renderNarrowWarning(width, height) {
  return renderSectionBox(
    'HUMAN VIEW',
    [
      'Terminal is too narrow for the split mock-up.',
      'Resize to at least 90 columns for medium mode.',
      'Resize to at least 120 columns for the planned split-pane layout.',
      '',
      'Try:',
      '  node scratch/human-agent-view/src/app.mjs --snapshot --width 120 --height 34',
    ],
    width,
    height,
  );
}

function renderFooter(viewState, width) {
  const mode = viewState.model.header.mode;
  const paused = viewState.followPaused ? 'follow:paused' : 'follow:on';
  const unread =
    viewState.unreadLineCount > 0
      ? ` | +${viewState.unreadLineCount} new lines`
      : '';
  const split = SPLITS[viewState.split]?.label ?? SPLITS.default.label;
  const notice = viewState.notification ? ` | ${viewState.notification}` : '';

  if (mode === 'input-read-only' || mode === 'attached-read-only') {
    return [
      border(width),
      framedLine(
        `Input read-only. Original runner control is not available.${notice}`,
        width,
      ),
      framedLine(
        `Ctrl+F pause scroll | ${paused}${unread} | [ transcript | ] workbench | = reset | arrows scroll | Ctrl+C close`,
        width,
      ),
      border(width),
    ];
  }

  if (mode === 'completed') {
    return [
      border(width),
      framedLine(`Run complete. Transcript is inspect-only.${notice}`, width),
      framedLine(
        `Ctrl+F pause scroll | ${paused}${unread} | [ transcript | ] workbench | = reset | arrows scroll | Ctrl+C close`,
        width,
      ),
      border(width),
    ];
  }

  return [
    border(width),
    framedLine(
      `> ${viewState.draft || 'Send outside message...'}${notice}`,
      width,
    ),
    framedLine(
      `Enter send outside msg | Ctrl+F pause scroll | ${paused}${unread} | split ${split} | [ left | ] right | = reset | arrows scroll | Ctrl+C`,
      width,
    ),
    border(width),
  ];
}

function visibleTranscriptLines(viewState, width, height) {
  const headerLines = [
    `TRANSCRIPT ${SPLITS[viewState.split]?.label ?? SPLITS.default.label}`,
    `mode ${viewState.model.header.mode} | status ${viewState.model.header.status}`,
    '',
  ];
  const lines = buildTranscriptLines(viewState.model, width);
  const anchor = viewState.followPaused
    ? Math.min(viewState.pauseAnchorLineCount ?? lines.length, lines.length)
    : lines.length;
  const unread = viewState.followPaused
    ? Math.max(0, lines.length - anchor)
    : 0;
  viewState.unreadLineCount = unread;
  const bodyHeight = Math.max(0, height - headerLines.length);
  const end = clamp(anchor - viewState.scrollOffset, 0, lines.length);
  const start = Math.max(0, end - bodyHeight);
  const visible = [...headerLines, ...lines.slice(start, end)];
  while (visible.length < height) {
    visible.push('');
  }
  return visible;
}

function buildTranscriptLines(model, width) {
  const lines = [];
  for (const item of model.transcript) {
    const label =
      item.status === 'streaming'
        ? `${roleLabel(item.role)} (streaming)`
        : roleLabel(item.role);
    lines.push(label);
    for (const line of wrapText(item.content, Math.max(8, width - 2))) {
      lines.push(`  ${line}`);
    }
    lines.push('');
  }
  return lines;
}

function buildWorkbenchLines(model, width, splitMode) {
  const compact = width < 28 || splitMode === 'transcript';
  const lines = [
    `WORKBENCH`,
    `tools ${model.tools.length} | coord ${model.coordination.length}`,
    '',
  ];

  if (compact) {
    lines.push('Tools');
    for (const tool of model.tools.slice(0, 4)) {
      lines.push(`${statusCode(tool.status)} ${tool.name}`);
    }
    lines.push('', 'Coordination');
    for (const item of model.coordination.slice(0, 5)) {
      lines.push(`${item.lane} ${item.kind}`);
    }
    lines.push('', 'State');
    for (const [key, value] of model.state.slice(0, 5)) {
      lines.push(`${key}: ${value}`);
    }
    return lines;
  }

  lines.push('Tools');
  for (const tool of model.tools.slice(0, splitMode === 'workbench' ? 6 : 4)) {
    lines.push(`${statusCode(tool.status)} ${tool.name} ${tool.duration}`);
    lines.push(`  in  ${tool.input}`);
    lines.push(`  out ${tool.output}`);
  }

  lines.push('', 'Coordination');
  for (const item of model.coordination.slice(
    0,
    splitMode === 'workbench' ? 7 : 5,
  )) {
    lines.push(`${item.lane} ${item.kind}: ${item.subject}`);
    lines.push(`  ${item.detail}`);
  }

  lines.push('', 'State / Output');
  for (const [key, value] of model.state) {
    lines.push(`${key.padEnd(8)} ${value}`);
  }

  return lines.flatMap((line) => wrapText(line, width));
}

function renderSectionBox(title, contentLines, width, height) {
  const innerWidth = width - 2;
  const lines = [border(width), framedLine(title, width)];
  const maxContent = Math.max(0, height - 3);
  for (let index = 0; index < maxContent; index += 1) {
    lines.push(framedLine(contentLines[index] ?? '', width));
  }
  lines.push(`+${'-'.repeat(innerWidth)}+`);
  return lines;
}

function border(width) {
  return `+${'-'.repeat(Math.max(0, width - 2))}+`;
}

function framedLine(text, width) {
  return `|${fit(` ${text}`, width - 2)}|`;
}

function fit(text, width) {
  const value = String(text).replace(/\t/g, '  ');
  if (width <= 0) {
    return '';
  }
  if (value.length === width) {
    return value;
  }
  if (value.length < width) {
    return value + ' '.repeat(width - value.length);
  }
  if (width <= 3) {
    return value.slice(0, width);
  }
  return `${value.slice(0, width - 3)}...`;
}

function wrapText(text, width) {
  const lines = [];
  for (const rawLine of String(text).replace(/\r\n/g, '\n').split('\n')) {
    let remaining = rawLine.trimEnd();
    if (!remaining) {
      lines.push('');
      continue;
    }
    while (remaining.length > width) {
      let cut = remaining.lastIndexOf(' ', width);
      if (cut <= 0) {
        cut = width;
      }
      lines.push(remaining.slice(0, cut).trimEnd());
      remaining = remaining.slice(cut).trimStart();
    }
    lines.push(remaining);
  }
  return lines;
}

function roleLabel(role) {
  if (role === 'outside') {
    return 'Outside actor';
  }
  if (role === 'system') {
    return 'System';
  }
  return 'Inside agent';
}

function inputLabel(mode) {
  if (mode === 'input-available' || mode === 'live-control') {
    return 'available';
  }
  if (mode === 'input-read-only' || mode === 'attached-read-only') {
    return 'read-only';
  }
  if (mode === 'completed') {
    return 'closed';
  }
  return String(mode);
}

function statusCode(status) {
  if (status === 'ok') {
    return 'OK ';
  }
  if (status === 'error') {
    return 'ERR';
  }
  if (status === 'running') {
    return 'RUN';
  }
  if (status === 'queued') {
    return 'QUE';
  }
  return String(status).slice(0, 3).toUpperCase().padEnd(3);
}

function inputControlsEnabled(model) {
  return (
    model.header.mode === 'input-available' ||
    model.header.mode === 'live-control'
  );
}

function isPrintable(input) {
  return (
    Boolean(input) && input.length === 1 && input >= ' ' && input !== '\x7f'
  );
}

function terminalSize() {
  return {
    width: Number(args.width) || process.stderr.columns || 120,
    height: Number(args.height) || process.stderr.rows || 34,
  };
}

function formatElapsed(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function parseArgs(argv) {
  const parsed = {
    fixture: 'coordination-rich',
    play: false,
    snapshot: false,
    split: 'default',
    width: undefined,
    height: undefined,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--fixture') {
      parsed.fixture = argv[index + 1] ?? parsed.fixture;
      index += 1;
      continue;
    }
    if (arg === '--play') {
      parsed.play = true;
      continue;
    }
    if (arg === '--snapshot') {
      parsed.snapshot = true;
      continue;
    }
    if (arg === '--split') {
      const split = argv[index + 1] ?? parsed.split;
      parsed.split = SPLITS[split] ? split : parsed.split;
      index += 1;
      continue;
    }
    if (arg === '--width') {
      parsed.width = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === '--height') {
      parsed.height = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    }
  }

  return parsed;
}

function helpText() {
  return `Human Agent View scratch mock-up

Usage:
  node scratch/human-agent-view/src/app.mjs [options]

Options:
  --fixture <name>   ${Object.keys(fixtures).join(', ')}
  --play             Simulate activity for active fixtures
  --snapshot         Render one frame and exit
  --split <state>    default, transcript, workbench
  --width <cols>     Override terminal width for snapshot/testing
  --height <rows>    Override terminal height for snapshot/testing
  -h, --help         Show this help

Controls:
  [ / ] / =          Expand transcript / expand workbench / reset split
  Ctrl+F             Pause or resume follow-scroll
  Up/Down/Page       Scroll transcript history
  Enter              Fake-send draft when input is available
  Ctrl+C             Exit
`;
}
