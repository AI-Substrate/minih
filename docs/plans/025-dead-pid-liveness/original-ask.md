# Original ask — dead-pid-liveness
**Captured**: 2026-06-11T08:10:27Z  ·  **By**: /the-flow

> go after group 1, not sure how we prove hte fix though. work on branch

**Context**: "Group 1" refers to the issue triage done immediately before this flow — the
*"host can't tell the agent is dead"* cluster (rated CRITICAL): GitHub issue **#24**
(`minih status` reports `verdict: active` for a dead pid — config-only/mtime liveness check),
with three pre-specced open FX dossiers in `docs/plans/018-agent-permissions/fixes/`:
**FX009** (status pid-liveness probe, "implements today"), **FX011** (`minih reconcile`
run.json healer), **FX012** (`provider_stream_aborted` synthetic adapter event).
The open question the user flagged: how to deterministically **prove** the fix
(simulating a dead pid / aborted provider stream in tests).
