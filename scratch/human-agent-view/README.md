# Human Agent View Scratch Mock-up

Runnable zero-dependency mock-up for the planned `minih run --human` / `minih view` operator console.

```bash
# From the repo root
node scratch/human-agent-view/src/app.mjs

# Fixture variants
node scratch/human-agent-view/src/app.mjs --fixture coordination-rich
node scratch/human-agent-view/src/app.mjs --fixture token-deltas --play
node scratch/human-agent-view/src/app.mjs --fixture attached-read-only
node scratch/human-agent-view/src/app.mjs --fixture completed

# One-frame preview for a non-interactive terminal
node scratch/human-agent-view/src/app.mjs --snapshot --width 120 --height 34
node scratch/human-agent-view/src/app.mjs --snapshot --split workbench --width 120 --height 34
```

You can also run from the scratch folder:

```bash
cd scratch/human-agent-view
npm run coordination
npm run stream
npm run readonly
```

## Controls

| Key | Action |
| --- | --- |
| `[` | Expand transcript to 80/20. |
| `]` | Expand workbench to 45/55. |
| `=` | Reset to 65/35. |
| `Ctrl+F` | Pause/resume follow-scroll. |
| `Up` / `Down` | Scroll transcript history. |
| `PageUp` / `PageDown` | Scroll transcript faster. |
| `Enter` | Fake-send the current draft as an outside message in live-control fixtures. |
| `Backspace` | Edit draft. |
| `Ctrl+C` | Exit. |

For one-frame previews, `--split default`, `--split transcript`, and `--split workbench` show the same states as the interactive `[`, `]`, and `=` controls.

## What this proves

- Readable transcript pane instead of one-token-per-line output.
- Right-side workbench for tools, coordination, state, and output.
- Input/read-only/completed labels without exposing separate agent modes.
- Split controls for transcript-heavy and workbench-heavy reading.
- UI-only pause/follow behavior with unread line counts.
- Stderr-only rendering; stdout stays empty for machine output conventions.

## What this does not prove

- Real SDK session attach or send.
- A run-scoped control lane.
- Actual agent/session pause semantics.
- Ink/React dependency fit. This is intentionally a fast ASCII simulator before product dependencies are added.
