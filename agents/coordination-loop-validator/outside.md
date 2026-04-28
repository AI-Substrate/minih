# Coordination Loop Validator - outside contract

This is minih's richer worked example for the outside/inside coordination loop. It validates messaging, shared state, acknowledgements, status/tail observability, and final evidence. It is not a real code-review agent; the inside agent knows this is a harness.

## Start and observe

Read this contract:

```bash
minih outside context coordination-loop-validator
```

Start the inside validator in another terminal or background shell:

```bash
minih run coordination-loop-validator --timeout 900
```

In the outside terminal, capture the active run id:

```bash
RUN_ID=$(minih status coordination-loop-validator 2>/dev/null | jq -r '.data.runId')
```

If an inside validator is already running, skip startup and continue. Keep the outside peer in the loop with:

```bash
minih status coordination-loop-validator
minih tail coordination-loop-validator
minih tail coordination-loop-validator --run "$RUN_ID" --lines 20 --snapshot
minih inside inbox list coordination-loop-validator --run "$RUN_ID" --type ready
minih state get coordination-loop-validator --run "$RUN_ID" --side both
```

`status` gives a one-shot run summary. `tail` follows `events.ndjson` and exits on completion; `tail --lines <n> --snapshot` prints a bounded no-follow sample.

## Clean-slate rule

This harness uses run-scoped mutable files under `agents/coordination-loop-validator/runs/<runId>/{inbox,state}`. Agent-level files (`prompt.md`, `outside.md`, `instructions.md`, schemas) are definitions/defaults. Before evidence runs, inspect existing runs. If you need a fresh run, preserve useful evidence, then remove only generated run folders for this agent.

You may omit `--run` only when exactly one run is available or one active run is unambiguous.

## Send exactly three milestones

Keep workflow words in `data` and message text, not in `status`. Use schema-compatible outside statuses: `idle`, `in-progress`, `paused`, `done`, `error`.

### Milestone 1

```bash
minih outside state set coordination-loop-validator --status in-progress \
  --run "$RUN_ID" \
  --data-json '{"phase":"milestone-ready","milestone":"area-1","summary":"Pretended to finish the parser boundary handoff"}'
minih outside inbox send coordination-loop-validator --type milestone \
  --run "$RUN_ID" \
  --subject "area-1 ready for validation" \
  --body "Pretend work area 1 is complete: parser boundary handoff. Validate message/state coherence and send coordination-focused feedback."
```

### Milestone 2

```bash
minih outside state set coordination-loop-validator --status in-progress \
  --run "$RUN_ID" \
  --data-json '{"phase":"milestone-ready","milestone":"area-2","summary":"Pretended to finish the runner handoff"}'
minih outside inbox send coordination-loop-validator --type milestone \
  --run "$RUN_ID" \
  --subject "area-2 ready for validation" \
  --body "Pretend work area 2 is complete: runner handoff. Validate that the inside agent can read state, acknowledge the message, and reply."
```

### Milestone 3

```bash
minih outside state set coordination-loop-validator --status in-progress \
  --run "$RUN_ID" \
  --data-json '{"phase":"milestone-ready","milestone":"area-3","summary":"Pretended to finish the documentation handoff"}'
minih outside inbox send coordination-loop-validator --type milestone \
  --run "$RUN_ID" \
  --subject "area-3 ready for validation" \
  --body "Pretend work area 3 is complete: documentation handoff. Validate final milestone coordination and tell me whether the loop is ready to finish."
```

After each milestone:

```bash
minih inside inbox list coordination-loop-validator --run "$RUN_ID" --unread
minih state get coordination-loop-validator --run "$RUN_ID" --side both
minih status coordination-loop-validator
```

Save each `outside inbox send` message id. The inside report should include acknowledgement evidence for each id.

## Finish

```bash
minih outside state set coordination-loop-validator --status done \
  --run "$RUN_ID" \
  --data-json '{"phase":"complete","milestones":["area-1","area-2","area-3"],"summary":"All three simulated milestones were sent"}'
minih outside inbox send coordination-loop-validator --type complete \
  --run "$RUN_ID" \
  --subject "manual validation complete" \
  --body "All three fake work areas have been sent. Produce the final coordination validation report."
```

Then inspect:

```bash
minih status coordination-loop-validator
minih tail coordination-loop-validator --run "$RUN_ID" --lines 20 --snapshot
minih validate coordination-loop-validator --run "$RUN_ID"
minih retros --agent coordination-loop-validator --run "$RUN_ID" --target coordination
```

Use `validate --run` for a completed run output. Use `check --file <path>` only when you have an explicit report file path to validate.

Record outside feedback:

```bash
minih outside retro add coordination-loop-validator --run "$RUN_ID" --body "WORKED WELL: ...
CONFUSING: ...
MAGIC WAND: ..."
```

Future boundary: this example is one outside peer plus one inside validator. Many inside agents of differing types are out of scope.
