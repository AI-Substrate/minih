
## 2026-06-11T04:14:03.801Z — parallel-param-smoke / 2026-06-11T14-13-36-678Z-e87c

- runId: 2026-06-11T14-13-36-678Z-e87c
- runDir: /Users/jordanknight/substrate/minih/agents/parallel-param-smoke/runs/2026-06-11T14-13-36-678Z-e87c
- summary: Successfully created scratch/agent-runs/t1/marker.json with the required fields. The marker file was verified by reading it back after creation. Run ID, agent slug, message ('alpha'), and timestamp were all recorded correctly.
- **magicWand** (target: minih): A minih shorthand like `minih env` that prints all MINIH_* env vars in the current run context would save agents from having to reference the preamble each time.

## 2026-06-11T04:14:12.725Z — parallel-param-smoke / 2026-06-11T14-13-36-923Z-cf1e

- runId: 2026-06-11T14-13-36-923Z-cf1e
- runDir: /Users/jordanknight/substrate/minih/agents/parallel-param-smoke/runs/2026-06-11T14-13-36-923Z-cf1e
- summary: Parsed id='t2' and message='bravo' from input parameters. Created scratch/agent-runs/t2/marker.json at the project root with the required fields. Verified the file exists and read it back successfully.
- **magicWand** (target: minih): A minih CLI command like `minih params` that prints the current run's parsed input parameters as JSON would reduce the need to rely on env var inspection.

## 2026-06-11T04:14:16.605Z — parallel-param-smoke / 2026-06-11T14-13-36-287Z-44c1

- runId: 2026-06-11T14-13-36-287Z-44c1
- runDir: /Users/jordanknight/substrate/minih/agents/parallel-param-smoke/runs/2026-06-11T14-13-36-287Z-44c1
- summary: Created scratch/agent-runs/t3/marker.json with id=t3, message=charlie, runId=2026-06-11T14-13-36-287Z-44c1. Read back the marker file and confirmed it exists with expected contents.
- **magicWand** (target: minih): Env vars like MINIH_PROJECT_ROOT and MINIH_RUN_ID should be injected into the agent shell so the agent does not need to parse them from the prompt text.
- difficulties:
  - [degrading] config: MINIH_PROJECT_ROOT, MINIH_PARAMS, MINIH_RUN_ID, MINIH_AGENT_SLUG, and MINIH_OUTPUT_PATH were all empty in the shell environment despite the preamble listing them as available. (workaround: Used literal values from the prompt text and the output path from the prompt header.)
