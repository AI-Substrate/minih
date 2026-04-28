# Coordination Loop Validator Worked Example

`coordination-loop-validator` is the canonical rich example for minih's outside/inside coordination loop. It is a dogfooding harness and concept demonstrator: a real coordinated agent runs inside minih while an outside peer manually sends milestone events, observes replies, and proves the loop works end to end.

Use `coordination-smoke-test` when you want the minimal primitive check. Use `coordination-loop-validator` when you want the full back-and-forth worked example with readiness, three milestones, state checks, acknowledgements, feedback, status/tail observation, final validation, and retrospectives.

## What this validates

- The outside peer can read a per-agent contract.
- The outside peer can start or attach to an inside validator running in parallel.
- The inside validator can announce readiness through state and inbox.
- The outside peer can send exactly three manual milestone events.
- The inside validator can read, acknowledge, and respond to each milestone.
- Both sides can keep status vocabulary schema-compatible while storing workflow details in `data` and messages.
- The final report can prove the loop from outside-facing commands and final artifacts, without private run internals.

This does not validate real source-code quality, real background code review, automatic source eventing, daemon supervision, public MCP serving, or many-inside-agent orchestration.

## Clean-slate setup

Agent-level files are definitions and defaults. Mutable coordination files are scoped to a specific run:

```text
agents/coordination-loop-validator/
├── prompt.md
├── outside.md
├── instructions.md
├── inside-state.schema.json
├── outside-state.schema.json
└── runs/
    └── <runId>/
        ├── inbox/
        └── state/
```

Before an evidence run, inspect the latest/current run if one exists:

```bash
minih status coordination-loop-validator
RUN_ID=$(minih status coordination-loop-validator 2>/dev/null | jq -r '.data.runId')
minih state get coordination-loop-validator --run "$RUN_ID" --side both
minih inside inbox list coordination-loop-validator --run "$RUN_ID"
```

If you need a fresh evidence run, preserve anything important, then remove only generated run folders for this agent:

```bash
rm -rf agents/coordination-loop-validator/runs
```

Do not remove `prompt.md`, `outside.md`, `instructions.md`, or schema files.

## Main path: outside starts inside

First read the contract:

```bash
minih outside context coordination-loop-validator
```

Start the inside validator in a second terminal or background shell:

```bash
minih run coordination-loop-validator --timeout 900
```

Capture the active run id before sending mutable outside messages or state:

```bash
RUN_ID=$(minih status coordination-loop-validator 2>/dev/null | jq -r '.data.runId')
```

The outside commands below include `--run "$RUN_ID"` so they target the intended conversation. You may omit `--run` only when exactly one run is available or one active run is unambiguous.

Keep the outside peer in the loop with status and tail:

```bash
minih status coordination-loop-validator
minih tail coordination-loop-validator
minih tail coordination-loop-validator --run "$RUN_ID" --lines 20 --snapshot
```

`status` is a one-shot liveness/readiness check for the latest run. `tail` follows the run's `events.ndjson` and exits when `completed.json` appears. Use `tail --lines <n> --snapshot` when you need a bounded no-follow progress sample.

Wait for readiness before milestone 1:

```bash
minih inside inbox list coordination-loop-validator --run "$RUN_ID" --type ready
minih state get coordination-loop-validator --run "$RUN_ID" --side both
```

Expected readiness evidence:

- an inside message with type `ready`;
- inside state status `in-progress`;
- inside state `data.phase` such as `ready-waiting-for-milestone`.

## Inside wait behavior

The inside validator should wait for outside signals with the private MCP `inbox_list` long-poll option, not with agent-authored sleep loops. For milestones, the intended inside call is:

```json
{ "unread": true, "waitForAny": ["milestone", "complete", "cancel"], "waitMs": 30000 }
```

The multi-type wait lets the inside validator notice milestone, completion, or cancellation signals in one bounded call. The outside peer still uses normal CLI observation commands (`status`, `tail --lines <n> --snapshot`, `inside inbox list`, and `state get`); `waitMs` and `waitForAny` are inside MCP tool options, not new outside CLI flags.

## Supported variation: already-running inside

If another terminal, human, or host agent already started the inside validator, do not start a second run. Use:

```bash
minih status coordination-loop-validator
minih tail coordination-loop-validator
minih tail coordination-loop-validator --run "$RUN_ID" --lines 20 --snapshot
minih inside inbox list coordination-loop-validator --run "$RUN_ID" --type ready
```

Then continue with milestone 1 after readiness is visible.

## Milestone protocol

For each milestone:

1. Set outside state with a schema-compatible status.
2. Put workflow vocabulary in `data.phase`, `data.milestone`, and the message body.
3. Send a `type: milestone` outside message.
4. Save the returned `messageId`.
5. Read inside feedback and state.
6. Confirm the inside agent acknowledged the message in its final report.

### Milestone 1: parser boundary

```bash
minih outside state set coordination-loop-validator --status in-progress \
  --run "$RUN_ID" \
  --data-json '{"phase":"milestone-ready","milestone":"area-1","summary":"Pretended to finish the parser boundary handoff"}'

minih outside inbox send coordination-loop-validator --type milestone \
  --run "$RUN_ID" \
  --subject "area-1 ready for validation" \
  --body "Pretend work area 1 is complete: parser boundary handoff. Validate message/state coherence and send coordination-focused feedback."
```

Then observe:

```bash
minih inside inbox list coordination-loop-validator --run "$RUN_ID" --unread
minih state get coordination-loop-validator --run "$RUN_ID" --side both
minih status coordination-loop-validator
```

### Milestone 2: runner handoff

```bash
minih outside state set coordination-loop-validator --status in-progress \
  --run "$RUN_ID" \
  --data-json '{"phase":"milestone-ready","milestone":"area-2","summary":"Pretended to finish the runner handoff"}'

minih outside inbox send coordination-loop-validator --type milestone \
  --run "$RUN_ID" \
  --subject "area-2 ready for validation" \
  --body "Pretend work area 2 is complete: runner handoff. Validate that the inside agent can read state, acknowledge the message, and reply."
```

Then observe:

```bash
minih inside inbox list coordination-loop-validator --run "$RUN_ID" --unread
minih state get coordination-loop-validator --run "$RUN_ID" --side both
minih status coordination-loop-validator
```

### Milestone 3: documentation handoff

```bash
minih outside state set coordination-loop-validator --status in-progress \
  --run "$RUN_ID" \
  --data-json '{"phase":"milestone-ready","milestone":"area-3","summary":"Pretended to finish the documentation handoff"}'

minih outside inbox send coordination-loop-validator --type milestone \
  --run "$RUN_ID" \
  --subject "area-3 ready for validation" \
  --body "Pretend work area 3 is complete: documentation handoff. Validate final milestone coordination and tell me whether the loop is ready to finish."
```

Then observe:

```bash
minih inside inbox list coordination-loop-validator --run "$RUN_ID" --unread
minih state get coordination-loop-validator --run "$RUN_ID" --side both
minih status coordination-loop-validator
```

## Finish the loop

After exactly three milestone feedback cycles:

```bash
minih outside state set coordination-loop-validator --status done \
  --run "$RUN_ID" \
  --data-json '{"phase":"complete","milestones":["area-1","area-2","area-3"],"summary":"All three simulated milestones were sent"}'

minih outside inbox send coordination-loop-validator --type complete \
  --run "$RUN_ID" \
  --subject "manual validation complete" \
  --body "All three fake work areas have been sent. Produce the final coordination validation report."
```

Watch for normal completion:

```bash
minih status coordination-loop-validator
minih tail coordination-loop-validator
minih tail coordination-loop-validator --run "$RUN_ID" --lines 20 --snapshot
```

If the inside agent times out or reports `partial`, capture which expected signal was missing. A bounded `waitMs` partial is better evidence than an indefinite hang.

## Final checks

Run:

```bash
minih validate coordination-loop-validator --run "$RUN_ID"
minih retros --agent coordination-loop-validator --run "$RUN_ID" --target coordination
```

`validate --run` re-validates a completed run output. `check --file <path>` validates an explicit report file; do not use `check` as a run validator.

Inside the validator, the literal output path in the prompt is the reliable target. If `$MINIH_OUTPUT_PATH` is not visible from the agent's shell, write to the literal path and run `minih check coordination-loop-validator --file <literal-output-path>`.

Record outside-side feedback:

```bash
minih outside retro add coordination-loop-validator --run "$RUN_ID" --body "WORKED WELL: ...
CONFUSING: ...
MAGIC WAND: ..."
```

Expected final evidence:

- readiness message/state before milestone 1;
- exactly three milestone message ids;
- acknowledgement evidence for each milestone id;
- inside feedback visible through `inside inbox list`;
- outside state and inside state observations;
- `status` and `tail` observation notes;
- `validate` result for the final report;
- coordination-focused retrospective output.

## Evidence hygiene

Prefer pasted, minimal text over screenshots. Do not include secrets, tokens, unrelated local data, or private user content in evidence files. If a transcript includes local paths, usernames, session ids, or long run ids that are not needed to prove the loop, redact or shorten them.

The evidence file should prove the coordination loop, not archive the whole terminal.

## Future boundary

This example demonstrates one outside peer and one inside validator. A future outside agent may coordinate many inside agents in parallel, including different agent types, but that orchestration is out of scope here.
