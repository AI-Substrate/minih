# FX005 — Probe matrix trustworthy validation

**Status**: DEFERRED (post-R6)
**Plan**: 018-agent-permissions
**Origin**: Top-10 follow-ups #1, #3, #4, #7 — collected after live R6 validation revealed `minih probe` returns mostly UNTRUSTWORTHY/FAIL because of scenario design, not implementation bugs.

## Motivation

The R2.12-R2.13 prober pack + `minih probe` orchestrator ship as the validation backbone for plan 018. Live experience with the matrix surfaced four gaps that, taken together, mean the matrix isn't yet a trustworthy CI gate:

1. **No regression test pins the F005 CLI override merge fix.** The `--permissions` CLI override merges with frontmatter (`{...frontmatter, preset: cliOverride}`); a regression here silently corrupts every probe-matrix run and any operator who tries `minih run X --permissions yolo`. Verified manually by running scenarios end-to-end, but no unit test pins it.
2. **Prober scenarios mostly produce FAIL or "truth-only PASS"** because the prober's frontmatter `read-only + overrides` survive the `--permissions` CLI override (correctly per F005), so the prober's claimed preset never matches the scenario's expected preset. The matrix runs but isn't validating preset equivalence.
3. **No HTML matrix output.** Workshop 004 § Q9 promised `matrix.html` for release-gate evidence (T-R6.5 gate). Today's `minih probe --matrix all` is stderr-text only — operators screenshot terminal output for release evidence.
4. **No meta-scenario asserting all 6 presets resolve cleanly.** Scenarios are scoped per-preset; we have no single scenario that loops through `permission_status` for each preset and verifies the matrix matches the registered preset table. Future preset-table corruption would slip past the matrix.

Together: the matrix is built but does not yet trustworthy-validate. This dossier closes the gap.

## Scope

### FX005-1: Pin F005 with a regression test (~30 min)

```ts
// test/runner/permissions/cli-override.test.ts
test('CLI --permissions preset merges with frontmatter overrides + allowedRoots', () => {
  const definition = { permissions: { preset: 'read-only', overrides: { network: 'allow' }, allowedRoots: ['./src'] } };
  const cliOverride = { preset: 'restricted' };
  const merged = mergePermissionsForRun(definition, cliOverride);
  expect(merged.preset).toBe('restricted');             // CLI wins on preset
  expect(merged.overrides.network).toBe('allow');       // frontmatter overrides survive
  expect(merged.allowedRoots).toEqual(['./src']);       // frontmatter allowedRoots survive
});
```

If `mergePermissionsForRun` isn't a callable export, extract the merge from `runner.ts` (current location ~lines 615-680) into a pure helper.

### FX005-2: Rewrite prober scenarios to actually validate (~½ day)

Choose one of two strategies (decide during implementation, document choice):

**(a) Drop prober's frontmatter `read-only + overrides`.** Prober becomes `permissions: yolo`. Accept that the prober can't write reports under restrictive presets — truth-only verdicts (events.ndjson + run.json) win in those scenarios. The aggregator's truth-only path (FX005 already exists post-F003/F004) handles missing reports cleanly.

**(b) Drive scenarios via `MINIH_PERMISSIONS_DEFAULT` env-var instead of `--permissions` flag.** Frontmatter wins via the resolution chain → prober's `read-only` frontmatter is what actually applies. Scenarios become "what does the agent see when run under this default policy?".

Strategy (a) is simpler and aligns with truth-first verdict philosophy. Strategy (b) is more realistic for actual user workflows. Recommend (a).

Verify after rewrite: `minih probe --matrix all` produces ≥ 8 PASS and 0 UNTRUSTWORTHY across the 10 scenarios.

### FX005-3: HTML matrix output (~2 hours)

```bash
minih probe --matrix all --output matrix.html
# Default: stderr-text + matrix.html in cwd if --matrix
# Opt-out: --no-html or --output -
```

Single-file static HTML (no JS framework, no external deps). Layout:

```html
<h1>Permission Probe Matrix</h1>
<p>Total: 10 | Pass: 8 | Fail: 1 | Untrustworthy: 1 | Generated: <ts></p>
<table>
  <tr><th>Scenario</th><th>Verdict</th><th>Truth Events</th><th>Claimed Outcome</th><th>Message</th></tr>
  <tr class="pass">...</tr>
</table>
```

Embed CSS for verdict-color rows. No JS. Workshop 004 § Q9 requires it as the R6 evidence gate; this closes that requirement.

### FX005-4: All-presets-coordination synthetic scenario (~½ day)

Pure aggregator-level test (no agent run needed if we generate the report in-process):

```ts
// test/runner/probe/all-presets-resolution.test.ts
test('all 6 presets resolve to expected decision matrices', () => {
  for (const preset of ['yolo', 'trusted', 'restricted', 'read-only', 'network', 'build-only']) {
    const policy = compile({ permissions: { preset } });
    expect(policy.decisions).toMatchSnapshot(`preset-${preset}`);
  }
});
```

Pin the snapshot. Future preset-table corruption breaks this test before it breaks production probes.

Optionally: add a wrapper scenario `--scenario all-presets-coordination` that runs the same assertion via the live `permission_status` MCP tool against a coordinated agent.

## Acceptance criteria

- AC-FX5.1: Unit test pins F005 CLI override merge (preset, overrides, allowedRoots).
- AC-FX5.2: `minih probe --matrix all` produces ≥ 8/10 PASS verdicts post-rewrite.
- AC-FX5.3: Strategy chosen for FX005-2 documented in `docs/how/permissions.md` § Probing.
- AC-FX5.4: `minih probe --matrix all --output matrix.html` produces a self-contained HTML file.
- AC-FX5.5: `matrix.html` includes per-scenario row with verdict color, truth event counts, message.
- AC-FX5.6: All-presets snapshot test pins resolved decision matrices for all 6 presets.
- AC-FX5.7: Workshop 004 § Q9 evidence gate (T-R6.5) is now satisfiable — release notes can link `matrix.html`.

## Out of scope
- Multi-format output (JSON Schema, XML, CSV) — HTML + existing stderr-text are enough.
- TUI screenshot regression for `minih view` of running probe — plan 016 owns that surface.
- Cross-platform smoke (covered by FX006).

## Risks
- Strategy (a) loses validation depth — accepted; truth-only verdicts are correct for restrictive presets.
- HTML output drifts from `ProbeMatrix` JSON shape — mitigated by generating both from one in-memory model.
- All-presets snapshot churns when presets evolve — accepted; updating snapshots is the audit trail.

## Testing
- TDD: FX005-1 (override merge test).
- Lightweight: FX005-3 (HTML rendering — DOM parse + assert table rows).
- Snapshot: FX005-4 (preset matrix).
- Manual: full-matrix run before/after FX005-2 with verdict counts captured in PR description.
