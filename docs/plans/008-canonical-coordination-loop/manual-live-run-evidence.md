# Manual Live Run Evidence: coordination-loop-validator

## Summary

The real `coordination-loop-validator` run completed successfully with the live SDK-backed minih runner, real private MCP coordination tools, real inbox/state files, and outside observation through `minih status` and `minih tail`.

Post-run correction: this evidence was captured before FX001 moved mutable coordination files from agent scope to run scope. The run remains valid historical evidence; current runs use `agents/<slug>/runs/<runId>/{inbox,state}` and should target outside commands with `--run <runId>` when multiple runs exist.

| Field | Evidence |
|-------|----------|
| Run ID | `2026-04-27T15-25-51-655Z-a767` |
| Session ID | `b0475e42-8f2a-447b-90f5-9d3b653f2854` |
| Model requested | `gpt-5.5` |
| Result | `completed` |
| Duration | `363.8s` |
| Events | `5372` |
| Tool calls | `45` |
| Report validation | `minih check` passed inside the run; `minih validate coordination-loop-validator` returned `validated: true` |

Note: the CLI warned that `gpt-5.5` was not in `copilot-sdk` model metadata and continued with the requested value. The run still proceeded beyond MCP loading and completed successfully.

## Clean Slate

Generated state for this agent was reset before the evidence run using the pre-FX001 cleanup shape:

```bash
rm -rf agents/coordination-loop-validator/inbox \
       agents/coordination-loop-validator/state \
       agents/coordination-loop-validator/runs
```

Current cleanup should remove generated run folders instead:

```bash
rm -rf agents/coordination-loop-validator/runs
```

Clean-slate observation:

```json
{
  "outside": { "status": "idle", "data": {}, "updatedBy": "outside" },
  "inside": { "status": "idle", "data": {}, "updatedBy": "inside" },
  "insideReplies": 0
}
```

## Runtime Blocker and Fix

The first live coordinated runs failed before the first model turn with CAPI 400 after the private `minih-coordination` MCP server loaded. The same failure reproduced with the existing `coordination-smoke-test`, which isolated the problem to the shared coordinated MCP surface rather than the new validator prompt.

The fix was to expose backend-safe MCP tool names:

| Old manifest name | New manifest name |
|-------------------|-------------------|
| `inbox.list` | `inbox_list` |
| `inbox.send` | `inbox_send` |
| `inbox.ack` | `inbox_ack` |
| `state.get` | `state_get` |
| `state.set` | `state_set` |
| `state.transition` | `state_transition` |

The dispatcher still accepts legacy dotted names as local aliases, but only underscore names are exposed to the SDK/backend manifest and prompts.

Focused validation after the fix:

```bash
npm run build
npx vitest run \
  test/mcp/types.test.ts \
  test/mcp/server-dispatch.test.ts \
  test/mcp/server.test.ts \
  test/mcp/coexist.test.ts \
  test/runner/preamble-builder.test.ts \
  test/cli/init-coordinated.test.ts \
  test/cli/coordination-loop-validator.test.ts \
  test/e2e/two-agent-coordination.test.ts
```

Result: 7 files passed, 1 e2e file skipped by its existing guard, 40 tests passed, 1 skipped.

## Start and Observe

Started the inside validator:

```bash
node dist/cli/index.js run coordination-loop-validator --timeout 900 --model gpt-5.5
```

Initial outside observation:

```bash
node dist/cli/index.js status coordination-loop-validator -n 8
node dist/cli/index.js tail coordination-loop-validator
```

`status` showed the run active, and `tail` showed the inside agent calling real coordination tools (`state_get`, `inbox_list`) instead of failing at MCP load.

## Readiness

Ready message:

| Field | Value |
|-------|-------|
| Message ID | `01KQ6PDXF73HYHP61RV5CAGDFX` |
| Sender | `inside` |
| Type | `ready` |
| Subject | `Inside validator ready` |

Ready state:

```json
{
  "inside": {
    "status": "in-progress",
    "data": {
      "phase": "ready-waiting-for-milestone",
      "description": "Inside agent initialized and ready to receive milestone messages"
    }
  },
  "outside": {
    "status": "idle",
    "data": {}
  }
}
```

## Milestone Evidence

| Milestone | Outside message ID | Inside ack ID | Inside feedback ID | Outcome |
|-----------|--------------------|---------------|--------------------|---------|
| `area-1` parser boundary | `01KQ6PEGBP6T44RA3Q9J7V28FR` | `01KQ6PF82S684X59C6DNFQV7PC` | `01KQ6PF82TX1Y74GM6QNXXC7VZ` | Pass |
| `area-2` runner handoff | `01KQ6PFHMCVC3GAEDR3NSFESQ0` | `01KQ6PGEG8Q7MPETAM4WC4R6YX` | `01KQ6PGEG96ZS3JRPM9E056AH0` | Pass |
| `area-3` documentation handoff | `01KQ6PGQAD06DS9PSV5VR1H7ED` | `01KQ6PHM7BQRS70FC8G6DJWC96` | `01KQ6PHM7BQRS70FC8G6DJWC97` | Pass |

Each milestone used outside status `in-progress` with workflow vocabulary in `data.phase` and `data.milestone`, then the inside agent moved through `reviewing` and returned to `in-progress` while storing workflow details in `data`.

Outside readback command used after each milestone:

```bash
node dist/cli/index.js outside-inbox-list coordination-loop-validator --unread
node dist/cli/index.js state get coordination-loop-validator --side both
node dist/cli/index.js status coordination-loop-validator -n 10
```

## Completion

Completion signal:

| Field | Value |
|-------|-------|
| Outside state | `done` |
| Outside completion message ID | `01KQ6PHX7NYBFJRY04WN6AZHKN` |
| Inside completion ack ID | `01KQ6PJMBP8ZB2130FM3B9E080` |
| Inside complete message ID | `01KQ6PJZREJJJ5VMCYZTAZTMB2` |
| Final inside state | `complete` |

Final state evidence:

```json
{
  "outside": {
    "status": "done",
    "data": {
      "phase": "complete",
      "milestones": ["area-1", "area-2", "area-3"]
    }
  },
  "inside": {
    "status": "complete",
    "data": {
      "completedMilestones": ["area-1", "area-2", "area-3"],
      "phase": "report-written"
    }
  }
}
```

`tail` ended with:

```text
Result:     completed
Duration:   363.8s
Events:     5372 (45 tool calls)
Validated:  yes
```

## Final Validation and Retros

Validation:

```bash
node dist/cli/index.js validate coordination-loop-validator
```

Result:

```json
{
  "validated": true,
  "errors": [],
  "previousResult": "completed"
}
```

Inside coordination retro:

```text
Add a coordination polling helper or convention -- e.g. a coordination.pollInterval config in prompt frontmatter or a built-in inbox_wait MCP tool that blocks with a timeout instead of requiring manual sleep-and-poll loops.
```

Outside retro was recorded with message ID `01KQ6PS73A35K8622JVQFDRTV0`.

## Evidence Hygiene

Evidence is limited to command outcomes, run IDs, message IDs, state snippets, and report summaries needed to prove the loop. No credentials, tokens, unrelated local data, or private user content are included.

## Post-Run Cleanup

After evidence capture, generated live-run artifacts were removed from the working tree so the repository keeps the reusable harness assets but not per-run state:

```bash
rm -rf agents/coordination-loop-validator/runs
```

## Outcome

The run proves the canonical outside/inside conversation loop end to end:

1. Outside can start and observe a live inside validator.
2. Inside can announce readiness.
3. Outside can send exactly three manual milestone events.
4. Inside can read, acknowledge, validate, and respond to each milestone.
5. Both sides can keep statuses schema-compatible while storing workflow detail in `data`.
6. Completion, validation, and retros are visible from outside-facing commands and final artifacts.
