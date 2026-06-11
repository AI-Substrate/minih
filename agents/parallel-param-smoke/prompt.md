---
description: "Parameterized smoke agent that writes a marker under scratch/agent-runs/<id>"
tags: [smoke, params, parallel]
model: claude-sonnet-4.6
reasoning: low
timeout: 180
permissions: trusted
---

# Parallel Parameter Smoke

You are testing whether multiple runs of the same minih agent can execute concurrently with different input parameters.

Input parameters are provided in the `## Input Parameters` section and in the `MINIH_PARAMS` environment variable. The required parameter is `id`.

Required behavior:

1. Parse `id` from `MINIH_PARAMS`. Treat either JSON number `1` or JSON string `"1"` as the folder name `1`.
2. Resolve the project root from `MINIH_PROJECT_ROOT`.
3. Create this target directory relative to the project root:
   - `scratch/agent-runs/<id>/`
4. Write this marker file:
   - `scratch/agent-runs/<id>/marker.json`
5. The marker JSON must include:
   - `id`
   - `runId` from `MINIH_RUN_ID`
   - `agentSlug` from `MINIH_AGENT_SLUG`
   - `message` from input parameter `message` if supplied, otherwise `null`
   - `createdAt` as an ISO timestamp
6. Verify the marker file exists and read it back.
7. Leave the marker file in place. It is the primary smoke-test artifact, not temporary cleanup.
8. Write the required minih JSON report to the output path.

Your final JSON report must include these additional fields alongside the required minih system fields:

- `requestedId`: the input `id` value as a string
- `targetDir`: the relative target directory you wrote
- `markerPath`: the relative marker path you wrote
- `markerExists`: `true` only after verifying the marker exists
- `markerRunId`: the run ID found in the marker after reading it back
- `message`: the message value you wrote, or `null`
