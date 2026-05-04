# permission-prober — outside contract

The permission-prober is a security-validation agent fired by `minih probe`. It exercises one scenario per run and reports what happened.

## How `minih probe` drives this agent

The orchestrator invokes:
```
minih run permission-prober \
  --param scenario=<key> \
  --param nonce=<random hex> \
  --permissions <preset>
```

The prober:
1. Calls `permission_status` MCP tool to record claimed policy.
2. Attempts each probe operation in `scenarios.json[scenario].probes`.
3. Reports outcomes via `output/report.json` per `output-schema.json`.
4. Optionally writes summary back via `inbox_send` (coordinated path).

## Trust model

The prober's self-report is **untrusted**. The aggregator at `src/runner/probe/aggregator.ts` cross-references it against:
- `events.ndjson` — count of `permission_denied` events (truth).
- `run.json.terminalReason` and `run.json.permissionError` (truth).
- The expected probes from `scenarios.json` (intent).

Mismatches surface as `UNTRUSTWORTHY` in the matrix verdict.

## Coordination

`coordination: enabled` so the inside MCP server spawns and `permission_status` is callable. The prober does not need a polling outside peer for normal operation — `minih probe` is fire-and-forget post-mortem.
