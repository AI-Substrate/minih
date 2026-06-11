# Parallel minih runs

Minih supports multiple same-slug runs when each run is launched as its own CLI process. This guide covers the safe operator workflow for finding and targeting those runs.

## Launch with labels

Labels are optional, but they make same-slug rows readable:

```bash
minih run parallel-param-smoke --label id=1 --param id=1 --param message=alpha &
minih run parallel-param-smoke --label id=2 --param id=2 --param message=bravo &
minih run parallel-param-smoke --label id=3 --param id=3 --param message=charlie &
```

`--param` values also produce a bounded `paramsSummary` for inventory rows. The summary is for identification only: it is truncated, object/array values are summarized, and secret-ish key names such as `token`, `access_token`, `client_secret`, and `password` are redacted. Do not treat labels or params as a secret store.

## Find active runs

```bash
minih runs list --active
minih runs list --active --slug parallel-param-smoke
```

Rows include factual runner metadata such as slug, run ID, liveness, timestamps, model/session IDs, counters, optional label, and `paramsSummary`. Public inventory rows intentionally use `slug` + `runId` as the stable handle; they are not a prompt to inspect run folders directly.

## Inspect known targets in bulk

```bash
minih runs status \
  --run parallel-param-smoke/2026-06-08T09-05-10-750Z-c892 \
  --run parallel-param-smoke/2026-06-08T09-05-10-810Z-f6fc
```

Or read targets from a simple text file:

```text
# targets.txt
parallel-param-smoke/2026-06-08T09-05-10-750Z-c892
parallel-param-smoke/2026-06-08T09-05-10-810Z-f6fc
```

```bash
minih runs status --from targets.txt
```

Missing targets are returned as row-level errors and make the envelope `degraded`; malformed CLI targets fail the invocation with `E108`.

## Target follow-up commands explicitly

When multiple active runs share a slug, commands that need one run refuse ambiguous latest defaults with `E170 AMBIGUOUS_RUN_ID` and list candidate run IDs plus remedies.

Use explicit targets:

```bash
minih status parallel-param-smoke --run 2026-06-08T09-05-10-750Z-c892
minih tail parallel-param-smoke --run 2026-06-08T09-05-10-750Z-c892 --snapshot --lines 20
minih outside inbox send parallel-param-smoke --run 2026-06-08T09-05-10-750Z-c892 \
  --type note --subject "update" --body "checking in"
```

Some read-only commands also support `--latest`, which explicitly means "choose the newest active candidate". Mutating commands require `--run` when ambiguous.

## What this is not

This is not a batch scheduler, fanout runner, group stop command, or multi-run tail UI. It is the core visibility and targeting substrate that makes manual parallel shell workflows and future orchestration safer.
