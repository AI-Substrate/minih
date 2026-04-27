# No-Context Two-Agent Coordination Eval Prompt

Copy everything below this line into a fresh agent session.

---

You are a fresh agent working in the `AI-Substrate/minih` repository. Treat this as a no-context eval of minih's outside/inside coordination system.

## Mission

Set up and run a real two-agent coordination eval:

1. An **inner minih agent** with no prior chat context that uses the private coordination tools from inside a run.
2. An **outer minih agent** with no prior chat context that starts or targets the inner agent, drives the outside side of the conversation, observes with `minih status` and `minih tail`, records feedback, and writes an experience report.

Both agents may know this is an eval run. The important constraint is that they must learn the workflow from the repository's current docs, agent files, CLI behavior, and live run artifacts, not from any previous chat transcript.

## Freshness rules

- Do not use prior conversation history.
- Before the eval run, do **not** read these historical evidence files:
  - `docs/plans/008-canonical-coordination-loop/manual-live-run-evidence.md`
  - `docs/plans/008-canonical-coordination-loop/posts/001-our-first-run-with-the-messaging-system.md`
  - `docs/plans/008-canonical-coordination-loop/posts/002-run-scoped-rerun-evidence.md`
- You may read normal user-facing docs and source/contracts, including:
  - `README.md`
  - `AGENTS_README.md`
  - `docs/how/coordination-loop-validator.md`
  - `agents/coordination-loop-validator/outside.md`
  - `agents/coordination-loop-validator/prompt.md`
  - `agents/coordination-loop-validator/output-schema.json`
  - relevant `src/cli`, `src/runner`, and `src/mcp` files if needed.
- After your own eval is complete, you may optionally compare against historical evidence and note differences.

## What to build

Create a small eval pair unless an equivalent pair already exists:

```text
agents/coordination-eval-inner/
  prompt.md
  instructions.md
  outside.md
  output-schema.json

agents/coordination-eval-outer/
  prompt.md
  instructions.md
  output-schema.json
```

The inner agent should be coordinated and should:

- announce readiness through the private inbox tool;
- publish inside state transitions;
- wait for three outside milestone messages and the final completion message with the private `inbox_list` blocking read, for example `inbox_list({ "unread": true, "type": "milestone", "waitMs": 30000 })`, rather than arbitrary sleep-polling;
- acknowledge each milestone;
- send useful feedback for each milestone;
- accept a final completion message;
- write a schema-valid final report;
- include `workedWell`, `confusing`, and `magicWand` feedback about the coordination experience.

The outer agent should:

- read the inner agent's `outside.md` contract;
- start the inner agent if it is not already running;
- capture the inner run id;
- keep the user informed using `minih status` and `minih tail`;
- send exactly three outside milestones to the inner agent with explicit `--run <runId>`;
- inspect inside replies with `minih outside-inbox-list`;
- inspect both sides of state with `minih state get --side both`;
- finish the inner run with a completion message;
- run `minih validate` and `minih retros`;
- record an outside retro with `minih outside-retro`;
- write an outer experience report with what was clear, what was confusing, what broke, and what the magic wand improvement would be.

Prefer `node dist/cli/index.js ...` in scripts/commands if the package is not globally linked as `minih`.

## Where to write eval data

Keep raw generated run artifacts in the ignored run folders:

```text
agents/coordination-eval-inner/runs/<innerRunId>/
agents/coordination-eval-outer/runs/<outerRunId>/
```

Write a committed summary document here:

```text
docs/plans/008-canonical-coordination-loop/evals/no-context-two-agent-eval.md
```

The summary should include:

- TL;DR
- run ids for both agents
- model(s) used
- exact commands used
- observed back-and-forth diagram, preferably Mermaid sequence diagram
- milestone table with message ids, ack ids, feedback ids, and state evidence
- validation result
- inner agent retrospective
- outer agent retrospective
- magic wand findings
- whether the no-context instructions were enough
- any recommended follow-up tasks

If you create a new `evals/` directory, that is expected.

## Suggested eval flow

First build the repo:

```bash
npm run build
```

Before the eval run, confirm the inner agent prompt explicitly prefers `inbox_list` with bounded `waitMs` over sleep loops while waiting for outside milestone and completion messages.

Then run the outer eval agent. Use `gpt-5.5` if available, because prior local experimentation wants this model tested:

```bash
node dist/cli/index.js run coordination-eval-outer --model gpt-5.5 --timeout 1200
```

The outer agent should start the inner agent roughly like:

```bash
node dist/cli/index.js run coordination-eval-inner --model gpt-5.5 --timeout 900
```

Once the inner run exists, all outside commands targeting the inner agent should use the explicit run id:

```bash
RUN_ID="<innerRunId>"

node dist/cli/index.js status coordination-eval-inner --run "$RUN_ID"
node dist/cli/index.js tail coordination-eval-inner --run "$RUN_ID"
node dist/cli/index.js outside-inbox-list coordination-eval-inner --run "$RUN_ID"
node dist/cli/index.js state get coordination-eval-inner --run "$RUN_ID" --side both
```

Milestone pattern:

```bash
node dist/cli/index.js state set coordination-eval-inner \
  --run "$RUN_ID" \
  --side outside \
  --status in-progress \
  --data-json '{"phase":"milestone-ready","milestone":"area-1","summary":"Outer eval milestone 1 is ready"}'

node dist/cli/index.js outside-send coordination-eval-inner \
  --run "$RUN_ID" \
  --type milestone \
  --subject "area-1 ready for no-context validation" \
  --body "Eval milestone 1 is ready. Validate whether the message and outside state are clear enough to act on, acknowledge this message, and send feedback."
```

Repeat for `area-2` and `area-3`, changing the state data and message body. After each milestone, observe:

```bash
node dist/cli/index.js outside-inbox-list coordination-eval-inner --run "$RUN_ID" --unread
node dist/cli/index.js state get coordination-eval-inner --run "$RUN_ID" --side both
node dist/cli/index.js status coordination-eval-inner --run "$RUN_ID"
```

Completion pattern:

```bash
node dist/cli/index.js state set coordination-eval-inner \
  --run "$RUN_ID" \
  --side outside \
  --status done \
  --data-json '{"phase":"complete","milestones":["area-1","area-2","area-3"],"summary":"All eval milestones were sent"}'

node dist/cli/index.js outside-send coordination-eval-inner \
  --run "$RUN_ID" \
  --type complete \
  --subject "no-context eval complete" \
  --body "All three eval milestones were sent. Produce the final coordination experience report and include workedWell, confusing, and magicWand feedback."
```

Then collect:

```bash
node dist/cli/index.js status coordination-eval-inner --run "$RUN_ID"
node dist/cli/index.js validate coordination-eval-inner --run "$RUN_ID"
node dist/cli/index.js retros --agent coordination-eval-inner --run "$RUN_ID" --target coordination
node dist/cli/index.js outside-retro coordination-eval-inner --run "$RUN_ID" --body "WORKED WELL: ...
CONFUSING: ...
MAGIC WAND: ..."
```

## Acceptance criteria

The eval is successful if:

- both agents run through minih, not just manual shell simulation;
- the inner agent completes with a schema-valid report;
- the outer agent writes an experience report;
- all mutable coordination artifacts for the inner conversation live under `agents/coordination-eval-inner/runs/<innerRunId>/`;
- outside commands use `--run <innerRunId>`;
- `minih validate coordination-eval-inner --run <innerRunId>` passes or the failure is clearly documented;
- `minih retros --agent coordination-eval-inner --run <innerRunId> --target coordination` returns useful inner feedback;
- `minih outside-retro coordination-eval-inner --run <innerRunId>` records the outer side's feedback;
- `docs/plans/008-canonical-coordination-loop/evals/no-context-two-agent-eval.md` captures the observed experience.

## Important things to watch for

Pay special attention to:

- whether an agent with no chat context understands `outside.md`;
- whether the outer agent can correctly discover and target the inner run id;
- whether `minih tail` is enough to understand progress;
- whether the inner agent uses `inbox_list({ "unread": true, "type": "milestone", "waitMs": 30000 })` or equivalent bounded long-polling instead of arbitrary sleep-polling;
- whether report/output path instructions are clear;
- whether schema errors are easy to recover from;
- whether the run-scoped folder model is obvious;
- whether `retros` and `outside-retro` produce enough experience data to improve the harness.

## Final response expected from you

When done, report:

- what files you created or changed;
- the inner and outer run ids;
- whether validation passed;
- the top three experience findings;
- the top magic wand improvement;
- the path to the committed eval summary doc.

Do not commit unless explicitly asked.
