# Initial Evidence — parallel-param-smoke Parallel Operations

Status: intake evidence only; not a plan yet.
Date: 2026-06-07
Agent under test: `parallel-param-smoke`

## Why this exists

We need evidence for a future plan around running one minih agent many times concurrently with different params, while keeping run tracking clear for humans and agents.

Working plan slug requested by operator: `parallel-param-smoke-parallel-operations`.

## Test agent created

Created `agents/parallel-param-smoke/` with:

- `prompt.md`
- `input-schema.json`
- `output-schema.json`

Input contract:

- required: `id`
- optional: `message`

Behavior:

- writes `scratch/agent-runs/<id>/marker.json`
- marker includes `id`, `runId`, `agentSlug`, `message`, `createdAt`
- leaves marker in place as the smoke-test artifact
- final report includes `requestedId`, `targetDir`, `markerPath`, `markerExists`, `markerRunId`, `message`

Pre-run checks:

- `minih list` discovered `parallel-param-smoke`
- `minih run parallel-param-smoke --dry-run -p id=1 -p message=alpha` succeeded
- `minih doctor` passed prompt/frontmatter/permissions/input-schema/output-schema checks for this agent

## Parallel run command shape

Three independent `minih run` CLI processes were launched concurrently:

```bash
MINIH_NO_AUTO_HARVEST=1 minih run parallel-param-smoke --model claude-sonnet-4.6 --reasoning low --timeout 240 -p id=1 -p message=alpha --verbose
MINIH_NO_AUTO_HARVEST=1 minih run parallel-param-smoke --model claude-sonnet-4.6 --reasoning low --timeout 240 -p id=2 -p message=bravo --verbose
MINIH_NO_AUTO_HARVEST=1 minih run parallel-param-smoke --model claude-sonnet-4.6 --reasoning low --timeout 240 -p id=3 -p message=charlie --verbose
```

Wrapper artifacts were captured under `/tmp/minih-parallel-smoke/`:

- `1.json`, `2.json`, `3.json` — stdout JSON envelopes
- `1.stderr`, `2.stderr`, `3.stderr` — verbose event streams
- `1.exit`, `2.exit`, `3.exit` — wrapper exit codes
- `run-ids.txt` — run IDs from `minih history parallel-param-smoke`

`MINIH_NO_AUTO_HARVEST=1` was set to avoid adding smoke noise to `docs/retros/`.

## Result summary

All three parallel runs completed successfully.

| input id | message | runId | exit | result | validated | duration | events | tool calls | sessionId |
|---|---:|---|---:|---|---|---:|---:|---:|---|
| `1` | `alpha` | `2026-06-08T09-05-10-750Z-c892` | 0 | completed | true | 31.011s | 639 | 5 | `67c5baa5-c236-4e8e-b8d4-95aab29bf754` |
| `2` | `bravo` | `2026-06-08T09-05-10-810Z-f6fc` | 0 | completed | true | 32.952s | 509 | 5 | `5840f6a1-a4b6-4b5d-86e2-0a2725cf7003` |
| `3` | `charlie` | `2026-06-08T09-05-10-819Z-c100` | 0 | completed | true | 24.146s | 436 | 4 | `820de359-028d-43cb-8ff3-0b3d48b9904e` |

Launch timing from run IDs:

- all three run folders were created within ~69 ms
- each got a distinct run ID
- each got a distinct SDK session ID

Completion order:

1. id `3` / `...c100` completed first at 24.146s
2. id `1` / `...c892` completed second at 31.011s
3. id `2` / `...f6fc` completed third at 32.952s

## Scratch marker verification

Marker files were present after completion:

- `scratch/agent-runs/1/marker.json`
- `scratch/agent-runs/2/marker.json`
- `scratch/agent-runs/3/marker.json`

Observed contents:

```json
{
  "id": "1",
  "runId": "2026-06-08T09-05-10-750Z-c892",
  "agentSlug": "parallel-param-smoke",
  "message": "alpha",
  "createdAt": "2026-06-08T09:05:10.901Z"
}
```

```json
{
  "id": "2",
  "runId": "2026-06-08T09-05-10-810Z-f6fc",
  "agentSlug": "parallel-param-smoke",
  "message": "bravo",
  "createdAt": "2026-06-08T09:05:10.953Z"
}
```

```json
{
  "id": "3",
  "runId": "2026-06-08T09-05-10-819Z-c100",
  "agentSlug": "parallel-param-smoke",
  "message": "charlie",
  "createdAt": "2026-06-08T09:05:10.995+10:00"
}
```

Notable: createdAt formatting varied (`Z` vs `+10:00`) because agents generated timestamps independently. If downstream tooling cares, specs should require normalized ISO UTC.

## Minih tracking evidence

### What worked

`minih history parallel-param-smoke` showed all three runs with completed metadata.

Explicit run IDs worked well:

```bash
minih status parallel-param-smoke --run 2026-06-08T09-05-10-819Z-c100
minih status parallel-param-smoke --run 2026-06-08T09-05-10-810Z-f6fc
minih status parallel-param-smoke --run 2026-06-08T09-05-10-750Z-c892
```

Each explicit status returned the correct completed run:

- `verdict: completed`
- `result: completed`
- distinct `sessionId`
- matching event/tool counts

Explicit tail snapshots worked:

```bash
minih tail parallel-param-smoke --run <runId> --snapshot --lines 5
```

Each tail snapshot rendered `Run Complete`, duration, event count, and validation success for the requested run.

### What was confusing

#### 1. No cross-agent active-run inventory

There is no first-class command equivalent to:

```bash
minih runs list --active
minih runs list --all
minih runs list --slug parallel-param-smoke
```

Current surfaces are mostly slug-scoped:

- `minih history <slug>`
- `minih status <slug>`
- `minih status <slug> --run <runId>`
- `minih tail <slug> --run <runId>`
- `minih view <slug> --run <runId>`
- `minih attach <slug> --run <runId>`

`minih doctor` has a cross-agent `peer` diagnostic array, but it is not a clean in-flight inventory and is noisy with stale/dead historical coordinated runs.

#### 2. Latest-run default is ambiguous under parallel same-slug runs

During the run, `minih status parallel-param-smoke` without `--run` selected only the newest run by run ID:

- selected `2026-06-08T09-05-10-819Z-c100`
- that corresponded to input id `3`

That was useful only by accident. With multiple same-slug runs, default latest behavior can hide the other in-flight runs and confuse operators/agents.

Recommendation for plan: any parallel operation surface should always return and preserve a run table, and should teach operators to use explicit `--run` for follow-up commands.

#### 3. `history <slug>` is complete but only after knowing the slug

`history` worked well once the slug was known, but it does not answer “what is running now across all agent types?”

#### 4. Tail output exposes file paths but not a machine-oriented summary mode

`minih tail --snapshot --lines 5` worked, but output is human-readable. A parallel orchestrator would benefit from a JSON status/snapshot mode rather than parsing terminal text.

#### 5. Velocity metadata is misleading under parallel runs

Observed velocity blocks:

- id `3`: `runNumber: 1`, no previous duration
- id `1`: `runNumber: 2`, previous = id `3`
- id `2`: `runNumber: 2`, previous = id `3`

Both id `1` and id `2` reported `runNumber: 2`. This appears to be a concurrency/ordering artifact: parallel completions compute velocity from already-completed runs, and sorting by run ID / available completed metadata is not a strict serial sequence.

Recommendation for plan: either make velocity explicitly best-effort under concurrency, use an atomic sequence, or suppress/adjust velocity for overlapping parallel runs.

#### 6. Agent-observed `MINIH_*` env vars were empty in shell tool calls

Run id `1` reported a degrading difficulty:

> All `MINIH_*` environment variables were empty at runtime (`MINIH_PROJECT_ROOT`, `MINIH_RUN_ID`, `MINIH_AGENT_SLUG`, `MINIH_PARAMS`, `MINIH_OUTPUT_PATH`). Had to extract runId, agentSlug, and params from the prompt text instead.

Verbose log evidence showed shell checks like:

```text
MINIH_PROJECT_ROOT=
MINIH_RUN_ID=
MINIH_PARAMS=
```

Despite that, the agents completed because the prompt includes enough fallback context. This is likely not caused by parallelism, but parallel runs surfaced it clearly.

Recommendation for plan: investigate whether SDK tool subprocesses receive the CLI process env. If not, consider a stable run-local sidecar such as `params.json` / `context.json`, or update docs/preamble to avoid promising shell env availability when the SDK cannot guarantee it.

#### 7. Agent-created marker timestamps are not normalized

Two markers used UTC `Z`; one used local offset `+10:00`. This is a smoke-agent prompt/spec issue rather than a minih runner issue.

## Architecture observations

### What the run proves

The current architecture can run the same non-coordinated agent slug multiple times concurrently as separate CLI processes.

Each run got independent:

- run directory
- copied prompt/schema artifacts
- SDK session
- output report
- event stream
- final metadata

The target writes did not collide because params selected disjoint target folders.

### What this does not prove

This test does not prove:

- in-process `Promise.all([runAgent(...), runAgent(...)])` safety
- coordinated-agent multi-run ergonomics
- cross-process safety of retro auto-harvest writes under concurrent successful runs
- heavy fanout run ID collision resistance
- global active-run inventory UX

`runAgent()` mutates `process.env.MINIH_*` in the parent Node process, so in-process parallelism is still suspect. CLI-process parallelism is the safe path today.

## Candidate requirements for future plan

1. Add first-class cross-agent run inventory.
   - Possible command: `minih runs list --active --all --json`
   - Include `slug`, `runId`, `status`, `result`, `startedAt`, `updatedAt`, `pid`, `sessionId`, `model`, `elapsedMs`, `eventCount`, `toolCallCount`, `runDir`.

2. Add a fanout/batch runner.
   - Possible command: `minih batch run <slug> --params-file cases.jsonl --concurrency N`
   - It should preserve a parent run table and emit child run IDs immediately.

3. Make latest-run ambiguity explicit.
   - When more than one active run exists for a slug, commands without `--run` should warn or refuse.
   - Especially important for `status`, `tail`, `view`, `attach`, `outside inbox send`, `state`, and `resume`.

4. Provide machine-readable tracking output.
   - `status` already emits JSON on stdout.
   - `tail --snapshot` is human-readable; consider `--format json` or a separate events snapshot command.

5. Investigate environment propagation.
   - Confirm whether SDK tool calls can see `MINIH_*` env vars.
   - If not, add a durable run context file and update preamble wording.

6. Make velocity concurrency-aware.
   - Avoid duplicate `runNumber` or misleading previous-duration comparisons for overlapping runs.

7. Consider run ID collision hardening for fanout.
   - Current timestamp + 16-bit random suffix was fine for 3 runs.
   - Heavy fanout may merit ULID or mkdir retry.

8. Decide coordinated multi-run semantics.
   - This smoke used a non-coordinated agent.
   - Coordinated agents have outside/inside state/inbox per run ID, but operator defaults are likely more confusing under multi-run.

## Commands worth reusing in planning

```bash
minih history parallel-param-smoke
minih status parallel-param-smoke --run <runId>
minih tail parallel-param-smoke --run <runId> --snapshot --lines 5
```

## Local artifacts to preserve for now

- `agents/parallel-param-smoke/`
- `scratch/agent-runs/1/marker.json`
- `scratch/agent-runs/2/marker.json`
- `scratch/agent-runs/3/marker.json`
- `/tmp/minih-parallel-smoke/` wrapper logs/envelopes

## Dogfood note

Run-dir internals were not inspected directly for this evidence. Run state/history/tail validation used minih CLI surfaces. The only direct file reads were wrapper captures under `/tmp/minih-parallel-smoke/` and the intended scratch marker artifacts under `scratch/agent-runs/`.
