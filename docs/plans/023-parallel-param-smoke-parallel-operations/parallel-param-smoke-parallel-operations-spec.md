# Core Parallel Operations Convenience

**Mode**: Simple

## Research Context

📚 Specification incorporates findings from `initial-evidence.md`.

A manual smoke test launched three independent `minih run parallel-param-smoke` processes at the same time with different `id`/`message` params. All three completed successfully, validated output, and wrote disjoint scratch markers. The evidence showed that minih's current architecture can support same-slug parallel runs when each run is its own CLI process and target writes are parameter-isolated.

The same smoke exposed UX gaps that make this workflow hard to operate safely:

- no first-class cross-agent or cross-slug run inventory
- `minih status <slug>` defaulted to only the newest run, hiding the other active same-slug runs
- follow-up commands were safe only when the operator preserved and supplied explicit `--run <runId>` values
- velocity metadata appeared misleading under overlapping runs
- agents reported that shell tool calls could not see some promised `MINIH_*` environment variables, though prompt fallback context was enough to complete the smoke

## Summary

Add core convenience for operating multiple minih runs without introducing batch orchestration. The feature gives humans and agents a first-class way to discover active/completed runs across all agent types, inspect many known runs at once, and avoid accidentally targeting the wrong run when multiple runs share a slug. It also records run labels and parameter summaries in run manifests so tables can be human-readable instead of opaque lists of timestamp IDs.

This is intentionally not a scheduler, batch runner, or fanout system. It is the safer operational substrate that makes both manual parallel shell usage and future batch work easier.

## Goals

- Provide a cross-agent run inventory command that answers: "what is running or recently ran anywhere?"
- Provide a bulk status command for explicit `(slug, runId)` targets captured from parallel launches.
- Make ambiguous latest-run defaults visible and safe when multiple active runs exist for a slug.
- Add optional run labels and persisted params summaries so parallel same-slug rows are distinguishable.
- Preserve existing run isolation and current explicit `--run` workflows.
- Keep implementation CLI/runner-boundary compliant: CLI owns command UX and envelopes; runner owns durable run metadata.
- Update help/docs so agents know the safe workflow: list runs, copy run IDs, use explicit `--run`.

## Non-Goals

- No `minih batch run`, scheduler, job queue, or concurrency controller.
- No multi-run tail streaming UI in this scope.
- No automatic stopping or group control of many runs.
- No change to Copilot SDK session behavior.
- No in-process `Promise.all(runAgent(...))` fanout support.
- No direct run-dir file inspection guidance; all user-facing tracking remains through minih CLI surfaces.
- No attempt to solve SDK tool subprocess environment propagation except documenting/recording it as a follow-up unless a cheap, local manifest-sidecar falls naturally out of the params-summary work.

## Target Domains

| Domain | Status | Relationship | Role in This Feature |
|--------|--------|--------------|----------------------|
| cli | existing | **modify** | Add `runs` command group, JSON envelopes, help/docs, ambiguity errors, and safe resolver behavior for latest-run consumers. |
| runner | existing | **modify** | Persist run label and params summary in `run.json`/metadata-compatible types; expose reusable run inventory/status helpers if needed while preserving no CLI imports. |
| measurement | existing | consume | Reuse existing proof/traceability expectations: deterministic run metadata is authoritative evidence; agents/humans interpret it through CLI surfaces. |

### New Domain Sketches

None. This work fits existing `cli` and `runner` domain boundaries.

## Testing Strategy

**Approach**: Full TDD

**Rationale**: The feature is a CLI contract and run-manifest behavior change. Regressions would confuse humans/agents and could target the wrong run, so behavior should be locked with focused tests before/alongside implementation.

**Focus Areas**:

- `minih runs list` envelope shape and filters (`--active`, `--all`, `--slug`).
- `minih runs status` for explicit `slug/runId` targets and/or `--from` files.
- `minih run --label` and params summary persisted in `run.json` and surfaced by inventory/status commands.
- Ambiguous active-run guard for selected latest-default commands.
- Backward compatibility when exactly one or zero active runs exist.
- Help text and docs discoverability.

**Excluded**:

- Real SDK/network agent execution in automated tests.
- Batch scheduling behavior.
- Multi-run TUI/tail streaming.

**Mock Usage**: Targeted mocks. Prefer temporary fixture `agents/` directories and synthetic `run.json`/`completed.json` manifests. Use CLI execution against built `dist/` for command-boundary tests; avoid SDK calls.

## Documentation Strategy

**Location**: Hybrid (README + docs/how/ and CLI help)

**Rationale**: This workflow is for both humans and agents. The safe path needs to be visible in `--help`, quick-start docs, and deeper operational guidance. The documentation should explicitly teach:

1. launch many runs manually if desired,
2. capture run IDs,
3. use `minih runs list` / `minih runs status`,
4. use explicit `--run` when interacting with a specific run,
5. treat latest-run defaults as convenience only when unambiguous.

## Complexity

- **Score**: CS-3 (medium)
- **Breakdown**: S=1, I=1, D=1, N=1, F=1, T=1 → P=6
- **Confidence**: 0.82

### Assumptions

- Run manifests already contain enough status data to build a useful inventory without reading private run files outside minih internals.
- CLI internals may scan `agents/*/runs/*` because minih owns that implementation surface; the dogfood rule applies to human/agent usage, not minih's own product code.
- Existing run resolver behavior can be extended safely without breaking explicit `--run` flows.
- `paramsSummary` can be bounded/redacted enough to avoid leaking huge/sensitive values.

### Dependencies

- Existing `run.json` manifest lifecycle.
- Existing `history`, `status`, `tail`, `view`, and coordination run resolver helpers.
- Existing CLI JSON envelope conventions and error-code registry.

### Risks

- Ambiguity guards could break scripts that rely on latest-run defaults while intentionally running multiple active runs.
- Params summaries may expose sensitive values if stored naively.
- Cross-agent inventory can be slow/noisy if it scans all historical runs without bounds.
- Velocity metadata is already misleading under parallel overlap; this scope should avoid amplifying it and may need a clear follow-up.

### Phases

Simple single implementation phase:

1. Manifest/run metadata additions (`label`, bounded/redacted `paramsSummary`).
2. `runs` command group with list/status filters.
3. Ambiguous active-run guard for selected latest-default commands.
4. Docs/help/tests.

## Acceptance Criteria

1. **Cross-agent inventory**: `minih runs list --active` returns a JSON envelope containing active runs across all agent slugs, including `slug`, `runId`, `verdict/status`, `startedAt`, `updatedAt`, `pid`, `model`, `sessionId`, `eventCount`, `toolCallCount`, `label`, and `paramsSummary` where available.
2. **History-capable inventory**: `minih runs list --all --slug parallel-param-smoke` includes completed runs for that slug with bounded/default ordering and does not require knowing individual run IDs first.
3. **Bulk explicit status**: `minih runs status` can inspect multiple explicit run targets in one invocation and returns a machine-readable row per target, including not-found/error rows without aborting the entire batch unless input parsing itself is invalid.
4. **Run labels**: `minih run <slug> --label <label>` persists the label to the live manifest and final metadata path used by inventory/status surfaces.
5. **Params summary**: runs started with `--param` persist a bounded, human-readable params summary suitable for inventory tables; oversized/object values are summarized rather than dumped unboundedly.
6. **Ambiguity safety**: when more than one active run exists for a slug, selected commands that would otherwise target latest active without `--run` return a clear ambiguity error listing candidate run IDs and the exact `--run` remedy.
7. **Backward compatibility**: when zero or one active run exists, existing latest-default command behavior remains compatible.
8. **Dogfood path**: docs and help show `minih runs list`, `minih runs status`, and explicit `--run` usage rather than instructing users to inspect run-dir files directly.
9. **No batch scope creep**: no batch scheduler/fanout command is introduced by this feature.
10. **Validation**: focused CLI/runner tests pass, and the full project gate remains `just fft` before commit/push.

## Risks & Assumptions

- The most user-visible risk is changing latest-run behavior. To reduce compatibility risk, the ambiguity guard should trigger only when multiple active candidates make the default genuinely unsafe.
- Params summaries must be bounded and should avoid pretending to be a secret-safe vault. Documentation should state that operators should not pass secrets as params.
- Inventory defaults should be bounded to avoid slow scans on large run histories. `--all` can be explicit; default can prefer active/recent.
- The environment propagation issue from the smoke test is important but orthogonal; this spec records it as follow-up unless the architecture plan decides a small run-context sidecar is required for params summary correctness.

## Open Questions

None blocking after clarification. Design details for `runs status` input syntax and the exact ambiguous-command set should be settled in architecture.

## Workshop Opportunities

| Topic | Type | Why Workshop | Key Questions |
|-------|------|--------------|---------------|
| Ambiguous latest-run guard command set | CLI Flow | The wrong command set could either leave hazards or break too much existing convenience. | Which commands should refuse vs warn? Is there a `--latest` escape hatch? What error code? |
| Params summary storage/redaction | Data Model | Params help operators identify parallel runs, but unbounded/sensitive values are risky. | What max size/depth? How to summarize arrays/objects? Should keys be allow/deny listed? |

## Clarifications

### Session 2026-06-07

- **Workflow Mode**: Simple — one scoped plan/implementation pass; batch remains out of scope.
- **Testing Strategy**: Full TDD — focused tests first for command envelopes, resolver/listing behavior, ambiguity errors, and manifest fields.
- **Mock Usage**: Targeted mocks — use temporary fixture agents/run folders and fake data; avoid SDK/network.
- **Documentation Strategy**: Hybrid — update CLI help plus README/AGENTS_README or docs/how so agents discover the safe multi-run workflow.
- **Agent Harness Readiness**: Existing MiniH engineering harness is L2 and sufficient for this feature; implementation should use `just build`, focused CLI/runner tests, and `just fft` before commit/push.
