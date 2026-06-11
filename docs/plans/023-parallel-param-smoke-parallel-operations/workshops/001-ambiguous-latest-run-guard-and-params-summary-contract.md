# Workshop: Ambiguous Latest-Run Guard and Params Summary Contract

**Type**: CLI Flow + Data Model
**Plan**: 023-parallel-param-smoke-parallel-operations
**Spec**: [parallel-param-smoke-parallel-operations-spec.md](../parallel-param-smoke-parallel-operations-spec.md)
**Created**: 2026-06-07T23:40:00Z
**Status**: Approved

**Value Thesis**: This workshop makes parallel minih operation cheaper and safer by turning opaque timestamp run IDs into recognizable rows, and by preventing latest-run defaults from silently targeting the wrong active run.
**Target Proof Level**: Implementation Ready
**Current Proof Level**: Implementation Ready

**Selected Value Axes**:
- **Operator Usability**: humans need a clear answer to "which run am I looking at?" when many runs share a slug.
- **Agent Readiness**: coding agents need machine-readable command contracts and deterministic ambiguity errors instead of parsing human stderr.
- **Safety to Change**: ambiguity guards must reduce mis-targeting risk without breaking unambiguous single-run workflows.
- **Review Compression**: reviewers should be able to verify behavior from fixture manifests and JSON envelopes.

**Related Documents**:
- [Initial Evidence](../initial-evidence.md)
- [Spec](../parallel-param-smoke-parallel-operations-spec.md)
- `docs/domains/cli/domain.md`
- `docs/domains/runner/domain.md`

**Domain Context**:
- **Primary Domain**: `cli`
- **Related Domains**: `runner`, `measurement`

---

## Purpose

Clarify the CLI behavior and run metadata contract for core parallel operations convenience. The workshop settles two high-risk design seams before architecture: which latest-run defaults become guarded, and how labels/params summaries are persisted without leaking unbounded or sensitive values.

## Fresh Entrant Outcome

A fresh human or agent should be able to use this workshop to reach **Implementation Ready** with no additional context.

They should be able to:

- implement the selected ambiguity guard semantics without re-litigating command behavior;
- add the `label` and `paramsSummary` manifest fields with bounded/redacted display semantics;
- write focused CLI/runner tests from the examples and acceptance tables below.

## Key Questions Addressed

- Which commands should refuse vs warn when multiple active same-slug runs exist?
- Is there a `--latest` escape hatch?
- Which error code and envelope should represent ambiguity?
- How should `--label` and `paramsSummary` be stored, bounded, and redacted?
- What examples/docs should agents see?

---

## Value Frame

| Field | Selection | Why It Matters |
|-------|-----------|----------------|
| Target Proof Level | Implementation Ready | The architecture plan should be able to convert this directly into tasks/tests. |
| Primary Value Axis | Operator Usability | The feature exists because latest-run defaults confused a real parallel smoke. |
| Supporting Value Axes | Agent Readiness, Safety to Change, Review Compression | CLI JSON envelopes and explicit run IDs are the contract agents can safely automate. |
| Downstream Loop Improved | Implementation / Review / Agent execution | The implementer gets concrete command rules, reviewers get table-driven cases, agents get deterministic errors. |

## Evidence Ledger

| Evidence | Location | Supports | Status |
|----------|----------|----------|--------|
| Three same-slug runs completed in parallel | `initial-evidence.md` Result summary | Architecture supports CLI-process parallelism | Ready |
| `status <slug>` selected only newest run | `initial-evidence.md` § What was confusing | Ambiguity guard need | Ready |
| Current resolver has `MultipleActiveRunsError` | `src/runner/run-resolver.ts` | Reuse existing ambiguity model | Ready |
| Current `view` maps ambiguity to E170 | `src/cli/commands/view.ts`, `src/cli/output.ts` | Reuse/widen E170 instead of inventing E151 | Ready |
| Spec acceptance criteria | Spec § Acceptance Criteria | Test/task source | Ready |

## Selected Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | Reuse `E170 AMBIGUOUS_RUN_ID` for ambiguous run target errors. | Existing code and tests already use E170 for multiple active runs in `view`; widening the message/details is lower churn than allocating a new code. |
| D2 | Hard-refuse ambiguous active-run defaults for commands that target one live run. | Silent latest selection is the hazard. A clear error with candidates is safer and still non-blocking because users can pass `--run`. |
| D3 | Allow an explicit `--latest` escape hatch only for read-only commands. | Operators sometimes want the newest active run for inspection. Mutating/write commands should require `--run` when ambiguous. |
| D4 | Persist `label` as an optional user string, validated at CLI entry. | Labels are the simplest way to make parallel rows recognizable: `id=1`, `review:foo`, etc. |
| D5 | Persist `paramsSummary` as bounded display metadata, not raw params. | Params identify runs but may be large/sensitive. Inventory needs a readable hint, not a full payload. |
| D6 | Keep batch orchestration out of command examples. | This scope provides safer primitives for manual shell parallelism and future batch, without introducing a scheduler. |

## Command Surface Contract

### New run inventory group

| Command | Purpose | Output |
|---------|---------|--------|
| `minih runs list` | Show active and recent runs across all agents. | JSON envelope + TTY table. |
| `minih runs list --active` | Show only active/stale live-run candidates. | JSON envelope + TTY table. |
| `minih runs list --all` | Include completed/failed historical runs, bounded by default limit. | JSON envelope + TTY table. |
| `minih runs list --slug <slug>` | Filter inventory to one agent slug. | JSON envelope + TTY table. |
| `minih runs status --run <slug>/<runId>` | Inspect one explicit target. Repeatable. | JSON envelope rows. |
| `minih runs status --from <file>` | Inspect explicit targets from a text file. | JSON envelope rows. |

### `runs status` target file format

`--from` file is deliberately simple and agent-friendly:

```text
# comments and blank lines ignored
parallel-param-smoke/2026-06-08T09-05-10-750Z-c892
parallel-param-smoke/2026-06-08T09-05-10-810Z-f6fc
other-agent/2026-06-08T10-00-00-000Z-abcd
```

Rules:

- each non-comment line is `<slug>/<runId>`;
- invalid line format becomes a row-level error if read from file;
- invalid CLI `--run` argument shape is an argument error (`E108`) because the invocation itself is malformed;
- missing run targets become row-level `result: "not-found"` with an error object, not a whole-command failure.

### Example: inventory JSON shape

```json
{
  "command": "runs list",
  "status": "ok",
  "data": {
    "filters": { "active": true, "all": false, "slug": null, "limit": 50 },
    "runs": [
      {
        "slug": "parallel-param-smoke",
        "runId": "2026-06-08T09-05-10-750Z-c892",
        "liveness": "active",
        "manifestStatus": "active",
        "result": null,
        "label": "id=1",
        "paramsSummary": {
          "schemaVersion": 1,
          "display": { "id": "1", "message": "alpha" },
          "truncated": false,
          "redactedKeys": []
        },
        "startedAt": "2026-06-07T23:05:10.750Z",
        "updatedAt": "2026-06-07T23:05:20.000Z",
        "pid": 32710,
        "model": "claude-sonnet-4.6",
        "sessionId": "67c5baa5-c236-4e8e-b8d4-95aab29bf754",
        "eventCount": 123,
        "toolCallCount": 2,
        "runDir": "/abs/path/agents/parallel-param-smoke/runs/2026-..."
      }
    ],
    "count": 1
  }
}
```

### Example: bulk status JSON shape

```json
{
  "command": "runs status",
  "status": "degraded",
  "data": {
    "runs": [
      {
        "target": "parallel-param-smoke/2026-06-08T09-05-10-750Z-c892",
        "slug": "parallel-param-smoke",
        "runId": "2026-06-08T09-05-10-750Z-c892",
        "found": true,
        "liveness": "completed",
        "result": "completed",
        "validated": true,
        "label": "id=1",
        "paramsSummary": { "schemaVersion": 1, "display": { "id": "1" }, "truncated": false, "redactedKeys": [] }
      },
      {
        "target": "parallel-param-smoke/missing",
        "slug": "parallel-param-smoke",
        "runId": "missing",
        "found": false,
        "error": { "code": "E171", "message": "Run not found." }
      }
    ],
    "summary": { "total": 2, "found": 1, "missing": 1, "active": 0, "completed": 1, "failed": 0 }
  }
}
```

`status: "degraded"` is appropriate when the command completed but at least one target row has a not-found/corrupt-row error. `status: "error"` is reserved for invalid invocation or unreadable `--from` file.

## Ambiguous Latest-Run Guard

### Definition

An invocation is **ambiguous** when all are true:

1. the command targets a single run by slug;
2. the operator did not provide `--run <runId>`;
3. the command would otherwise choose a latest active/live run or latest-any fallback;
4. the resolver finds more than one active live run for that slug after stale/dead PID filtering.

Completed historical multiplicity does not trigger this guard. Existing latest-completed behavior remains compatible unless the command explicitly works on active/live runs.

### Candidate details

Every ambiguity error should include enough data to let an agent pick the next command without scraping stderr:

```json
{
  "code": "E170",
  "message": "Multiple active runs found for \"parallel-param-smoke\". Pass --run <runId> or inspect with minih runs list --active --slug parallel-param-smoke.",
  "details": {
    "slug": "parallel-param-smoke",
    "candidates": [
      {
        "runId": "2026-06-08T09-05-10-750Z-c892",
        "startedAt": "2026-06-07T23:05:10.750Z",
        "sessionId": "67c5baa5-c236-4e8e-b8d4-95aab29bf754",
        "label": "id=1",
        "paramsSummary": { "display": { "id": "1" } }
      }
    ],
    "remedies": [
      "minih runs list --active --slug parallel-param-smoke",
      "minih status parallel-param-smoke --run <runId>"
    ]
  }
}
```

Candidate rows should include `label` and `paramsSummary` when present. This is the payoff for storing those fields.

### Command decision table

| Command | Ambiguous active same-slug default | Escape hatch | Rationale |
|---------|------------------------------------|--------------|-----------|
| `minih status <slug>` | **Hard refuse E170** | `--run <id>` or `--latest` | Read-only, but the smoke proved latest status hides other active runs. |
| `minih tail <slug>` | **Hard refuse E170** | `--run <id>` or `--latest` | Tail follows one stream; wrong stream wastes attention. |
| `minih view <slug>` | **Hard refuse E170** | `--run <id>` or `--latest` | Existing behavior already refuses via E170 for multiple active runs. |
| `minih attach <slug>` | **Hard refuse E170** | `--run <id>` only | Writable/read+write capability; no `--latest` escape when ambiguous. |
| `minih resume <slug>` | **Hard refuse E170/E144-family as appropriate** | `--run <id>` only | Mutates/reuses a session; explicit target required. |
| `minih connect <slug>` | **Hard refuse E170** | `--run <id>` or `--latest` | Prints a command for one session; wrong session is confusing. |
| `minih outside inbox send <slug>` | **Hard refuse E170** | `--run <id>` only | Writes to a run's outside lane; no latest escape. |
| `minih outside state set/transition <slug>` | **Hard refuse E170** | `--run <id>` only | Mutates run-scoped state; explicit target required. |
| `minih outside retro add <slug>` | **Hard refuse E170** | `--run <id>` only | Writes feedback to a specific run; explicit target required. |
| `minih inside inbox list <slug>` | **Hard refuse E170** | `--run <id>` or `--latest` | Read-only, but must identify one lane. |
| `minih state get <slug>` | **Hard refuse E170** | `--run <id>` or `--latest` | Read-only but returns one run's state pair. |
| `minih history <slug>` | No guard | N/A | Already returns many runs and is not latest-active. |
| `minih last-run <slug>` | No guard in this scope | N/A | Existing latest completed/report path; not an active-run interaction command. |
| `minih validate <slug>` | No guard unless it adds latest-active semantics later | `--run` if present | Validation targets completed outputs. |
| `minih runs list/status` | No guard | N/A | These commands are designed for many runs. |

### `--latest` semantics

`--latest` means: "I acknowledge multiple active candidates and intentionally choose the lexicographically newest run ID after active-candidate filtering."

Rules:

- only available on read-only commands in the table;
- never implied by default;
- always shown in TTY stderr as a warning when it selects among multiple active candidates;
- JSON envelope should include `selection: { mode: "latest", ambiguousCandidates: N }` where that command has a success envelope;
- not available on write/mutating commands because it recreates the original hazard.

This is intentionally smaller than a global `--force-latest` because safety differs between read-only inspection and writes.

## Params Summary Contract

### Manifest fields

Add optional fields to `LiveRunManifest` and `CompletedMetadata`:

```ts
interface RunParamsSummary {
  schemaVersion: 1;
  display: Record<string, string>;
  truncated: boolean;
  redactedKeys: string[];
  omittedKeys?: string[];
}

interface LiveRunManifest {
  label?: string;
  paramsSummary?: RunParamsSummary;
}

interface CompletedMetadata {
  label?: string;
  paramsSummary?: RunParamsSummary;
}
```

`CompletedMetadata` inclusion is useful for `runs list --all` because completed rows can be read without trusting live `run.json` state only. If implementation chooses to read both, completed metadata wins for terminal rows and manifest wins for active rows.

### Label rules

`minih run <slug> --label <label>`:

- optional;
- max 120 Unicode scalar characters after trimming;
- must not contain newline, carriage return, or NUL;
- stored exactly after trimming;
- rejected with `E108 INVALID_ARGS` if invalid;
- docs warn: do not put secrets in labels.

Why reject instead of truncate? Labels are operator-provided identifiers. Silent truncation can make two labels collide visually (`case-very-long...`).

### Params summary rules

`paramsSummary` is display metadata only. It is **not** a raw params store.

Rules:

| Rule | Value |
|------|-------|
| Max keys | 20 keys |
| Max key display length | 64 chars |
| Max value display length | 80 chars |
| Max total display chars | 2 KiB |
| Key order | Original object insertion order from parsed params |
| Secret-ish key redaction | case-insensitive match on `password`, `passwd`, `secret`, `token`, `api_key`, `apikey`, `credential`, `auth` |
| Oversized/omitted keys | listed in `omittedKeys`; `truncated: true` |

Value formatting:

| Input value | Display example |
|-------------|-----------------|
| string <= 80 chars | `alpha` |
| long string | `string(142): abcdef...` |
| number | `42` |
| boolean | `true` |
| null | `null` |
| array | `array(len=3)` |
| object | `object(keys=id,path,+2)` |
| redacted secret-ish key | `***redacted***` |

Objects and arrays are summarized, not serialized. This prevents giant fixture payloads from bloating `run.json` and avoids accidentally displaying nested secrets. The full raw params remain available to the agent in the prompt context; this feature is only for operator identification.

### Example params summary

Input:

```bash
minih run parallel-param-smoke \
  --label id=1 \
  -p id=1 \
  -p message=alpha \
  -p token='"ghp_abc"' \
  -p config='{"mode":"fast","retries":2}'
```

Manifest:

```json
{
  "label": "id=1",
  "paramsSummary": {
    "schemaVersion": 1,
    "display": {
      "id": "1",
      "message": "alpha",
      "token": "***redacted***",
      "config": "object(keys=mode,retries)"
    },
    "truncated": false,
    "redactedKeys": ["token"]
  }
}
```

## Decision Space

| Option | Description | Pros | Cons | Decision |
|--------|-------------|------|------|----------|
| A | Guard every latest-default command and require `--run` always. | Maximum safety. | Breaks read-only convenience too hard. | Rejected |
| B | Guard ambiguous active runs; read-only can opt into `--latest`; writes require `--run`. | Balances safety and convenience. | Slightly more command-specific behavior. | **Selected** |
| C | Warn only, keep latest behavior. | Backward compatible. | Preserves the exact hazard observed in smoke. | Rejected |
| D | Add only `runs list`, no ambiguity guard. | Minimal. | Inventory alone does not prevent wrong-run operations. | Rejected |

## Error Codes

| Code | Name | Cause | Notes |
|------|------|-------|-------|
| E170 | AMBIGUOUS_RUN_ID | Multiple active candidates exist for a slug and command needs one run. | Reuse existing code; message should say "run target" even if constant remains `AMBIGUOUS_RUN_ID`. |
| E171 | RUN_NOT_FOUND | Explicit `slug/runId` target not found or no resolvable run. | Already exists for view; reuse for `runs status` row errors. |
| E108 | INVALID_ARGS | Bad label, bad `--from` path, malformed repeated `--run` target in direct CLI args. | Existing invalid-args code. |

## Test Scenarios

### Ambiguity guard tests

| Case | Fixture | Command | Expected |
|------|---------|---------|----------|
| AG-1 | two active run manifests same slug | `minih status slug` | E170 with two candidates and remedies |
| AG-2 | two active run manifests same slug | `minih status slug --latest` | ok, selected lexicographically newest, selection metadata |
| AG-3 | two active run manifests same slug | `minih tail slug --snapshot` | exits nonzero with E170-style stderr/envelope if command becomes enveloped, or clear stderr if tail remains non-envelope |
| AG-4 | two active run manifests same slug | `minih outside inbox send slug ...` | E170, no message appended |
| AG-5 | one active run manifest | `minih status slug` | existing success behavior |
| AG-6 | active manifest with dead pid plus one live active | `minih view slug` | resolves live run; stale diagnostic preserved |
| AG-7 | zero active, latest completed exists | `minih view slug` | existing latest-completed fallback |

### Params summary tests

| Case | Input | Expected |
|------|-------|----------|
| PS-1 | `-p id=1 -p message=alpha --label id=1` | `label: "id=1"`, display `{id:"1",message:"alpha"}` |
| PS-2 | long string value | display begins `string(<len>):`, `truncated: true` |
| PS-3 | object/array params | display `object(keys=...)`, `array(len=N)` |
| PS-4 | `-p token='"abc"'` | display token as `***redacted***`, `redactedKeys:["token"]` |
| PS-5 | label contains newline | E108 before run starts |
| PS-6 | more than 20 keys | first 20 summarized, rest in `omittedKeys`, `truncated:true` |

### Inventory/status tests

| Case | Fixture | Command | Expected |
|------|---------|---------|----------|
| RI-1 | active runs across two slugs | `minih runs list --active` | both slugs appear |
| RI-2 | completed runs plus active | `minih runs list --all --slug slug` | active + completed bounded by limit |
| RI-3 | target file with three rows, one missing | `minih runs status --from targets.txt` | status degraded, row-level missing error |
| RI-4 | repeated explicit run flags | `minih runs status --run slug/a --run slug/b` | two rows |

## Attention Reduction

| Future Loop | Before Workshop | After Workshop |
|-------------|-----------------|----------------|
| Implementation | Implementer had to infer command-specific guard behavior. | Decision table states refuse/warn/escape-hatch behavior per command family. |
| Review | Reviewer had to reconstruct why E170 vs new error code. | Reuse of E170 is explicit and justified. |
| Testing | Test author had to invent fixture cases. | Test scenario tables give focused cases. |
| Agent execution | Agent had to parse latest-run conventions from scattered commands. | JSON envelope examples and `runs status --from` grammar are explicit. |

## Validation / Acceptance

This workshop reaches Implementation Ready when:

- the architecture plan references D1-D6 and does not contradict them;
- task tables include tests for AG, PS, and RI scenario families;
- docs/help tasks teach `runs list`, `runs status`, explicit `--run`, and read-only `--latest` where supported;
- mutating commands do not receive a `--latest` ambiguity escape hatch.

## Quick Reference for Architecture

Use these decisions in `/plan-3`:

1. Add manifest fields: `label?: string`, `paramsSummary?: RunParamsSummary` to live and completed metadata.
2. Add CLI flag: `minih run --label <label>`.
3. Add runner helper for params summary formatting/redaction.
4. Add `minih runs list` and `minih runs status`.
5. Reuse/widen `E170 AMBIGUOUS_RUN_ID` for ambiguous run target errors.
6. Guard latest-active defaults for `status`, `tail`, `view`, `attach`, `resume`, `connect`, and run-scoped coordination commands.
7. Allow `--latest` only on read-only guarded commands; writes require `--run`.
8. Keep batch orchestration out of scope.
