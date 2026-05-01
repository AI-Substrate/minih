# Demo Companion — outside contract (operator's two-screen demo script)

A live, runnable demo of every coordination primitive in minih: briefing, threaded replies, question/answer round-trip, outside-state flip with peer-state listening, mid-stream directive, graceful stop, and farewell envelope.

Pair this with screen A running the companion. See `docs/plans/016-a2a-companion-protocol/workshops/001-companion-demo.md` for the design rationale and A2A correspondence.

---

## Screen A — boot the companion

```bash
npx minih run demo-companion --human
```

The TUI mounts. Leave it running for the rest of the demo.

## Screen B — capture the run id

```bash
RUN=$(npx minih status demo-companion 2>/dev/null | jq -r '.data.runId')
echo "Run: $RUN"
```

## Screen B — Step 1: brief

```bash
npx minih outside inbox send demo-companion --run "$RUN" \
  --type briefing \
  --subject "Topic: TUI rendering quirks" \
  --body "Hi! Let's chat about Ink/Yoga rendering quirks we hit recently. I'll send you tasks and you respond + ask follow-ups."
```

Expected (screen A): briefing row → state `reading → reporting → idle` → one `progress` reply with ⇄ to the briefing.

## Screen B — Step 2: first task (companion will reply + ask one question)

```bash
npx minih outside inbox send demo-companion --run "$RUN" \
  --type task \
  --subject "Round 1: rounded borders" \
  --body "We saw ghost border characters with borderStyle='round' under frequent re-renders. Tell me your read on that, and ask me one follow-up question."
```

Expected (screen A): state `reading → reporting → blocked`. One or two `finding` replies + one `question`, all threaded to the task.

## Screen B — Step 3: find the companion's question and answer it

```bash
QID=$(npx minih outside inbox list demo-companion --run "$RUN" 2>/dev/null \
  | jq -r '.data.messages | map(select(.from=="inside" and .type=="question")) | last | .id')
echo "Question id: $QID"

npx minih outside inbox send demo-companion --run "$RUN" \
  --type question \
  --subject "Re: ghost chars after single?" \
  --body "Yes — single borders had the same residue. Only fully dropping borders fixed it. We use whitespace gaps now." \
  --ack-of "$QID"
```

Expected (screen A): companion unblocks; state `reporting → idle`; one `summary` threaded to the answer.

## Screen B — Step 4: flip outside state (peer-state listening)

```bash
npx minih outside state set demo-companion --run "$RUN" \
  --status in-progress \
  --data-json '{"label":"thinking-out-loud-mode"}'
```

Expected (screen A): outside-state row updates in the workbench; companion sends one `progress` row noting the flip.

## Screen B — Step 5: directive (mid-stream scope change)

```bash
npx minih outside inbox send demo-companion --run "$RUN" \
  --type directive \
  --subject "Be terser" \
  --body "Keep replies to one short finding per task from now on. No follow-up questions."
```

Expected (screen A): one short `progress` row acknowledging the new scope.

## Screen B — Step 6: second task (terser this time, no question)

```bash
npx minih outside inbox send demo-companion --run "$RUN" \
  --type task \
  --subject "Round 2: emoji width" \
  --body "We hit issues with double-width emoji (💭) throwing off Ink wrap math. Your read?"
```

Expected (screen A): one short `finding` only, no follow-up question — directive took effect.

## Screen B — Step 7: stop

```bash
npx minih outside inbox send demo-companion --run "$RUN" \
  --type control \
  --subject "stop" \
  --body "stop — demo complete, please write your farewell"
```

Expected (screen A): state `stopping`; one `farewell` row; TUI exits.

## Screen B — Step 8: read the farewell envelope

```bash
sleep 3
RUN_DIR=agents/demo-companion/runs/$RUN
cat $RUN_DIR/output/report.json | jq
```

Expected: a JSON document with `session`, `conversation` (2 rounds), `summary`, and `retrospective.magicWand`.

## Screen B — Step 9: verify retro auto-harvested

```bash
ls docs/retros/ | grep demo-companion || echo "(no retro yet — auto-harvest may be off)"
tail -20 docs/retros/demo-companion.md 2>/dev/null
```

---

## What this demonstrates

| Step | Coordination primitive | A2A correspondence |
|------|------------------------|--------------------|
| Boot | Coordinated run + TUI | Agent server starts; AgentCard published |
| 1 | `briefing` send + threaded reply | `message/send`; reply shares `contextId` |
| 2 | `task` → state transitions → `finding` + `question` (all `ackOf`) | `Task` → `working` → `input-required` with artifact-update events |
| 3 | Outside `--ack-of` answer | Client supplies input-required input; task resumes |
| 4 | `state set` outside; `state.peer.changed` wake-up | (no native A2A; client-side state) |
| 5 | Directive (no restart) | (no native A2A; metadata on a message) |
| 6 | Second task respects directive | Same as Step 2 but terser |
| 7 | `control:stop` graceful drain | Soft variant of `tasks/cancel` |
| 8 | Farewell envelope | Terminal `Task.status = completed` + final `Artifact` |
| 9 | Retro auto-harvest | Out of band; minih ledger machinery |

---

## Troubleshooting

- **No question id found in Step 3** — the companion may not have asked one yet. Wait a few seconds and re-run the `QID=…` line. Watch screen A's transcript for a `question`-typed row.
- **Companion stuck in `blocked`** — your `--ack-of` value didn't match. Re-list the inbox and grab the question id again.
- **Outside state flip didn't wake the companion** — confirm the run is using `wait_for_any` (this companion does). If you see `inbox_list` in the transcript instead, that's a prompt drift bug.
- **Farewell envelope missing** — give it a few seconds after `stop`; the companion writes it during the `stopping` state. If still missing, check `agents/demo-companion/runs/$RUN/state/history.ndjson` for the last transition.
