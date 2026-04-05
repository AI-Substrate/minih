# Code Review: Phase 5: Doctor, Check, Init

**Plan**: /Users/jordanknight/substrate/minih/docs/plans/001-setup/miniharness-extraction-plan.md
**Spec**: /Users/jordanknight/substrate/minih/docs/plans/001-setup/miniharness-extraction-spec.md
**Phase**: Phase 5: Doctor, Check, Init
**Date**: 2026-04-05
**Reviewer**: Automated (plan-7-v2)
**Testing Approach**: Hybrid

## A) Verdict

**REQUEST_CHANGES**

Phase 5 adds the right command surface, but the review found blocking command-semantics and contract regressions: `minih check --input` degrades valid input payloads, `minih run --dry-run` still hard-requires `GH_TOKEN`, `minih doctor` rejects the documented `$ref` schema pattern, and the package replaced the documented `retrospective.json` schema export instead of shipping `system-output.json` alongside it.

**Key failure areas**:
- **Implementation**: `check` and `dry-run` both diverge from their intended behavior in reproducible ways.
- **Domain compliance**: runner contracts and domain artifacts were only partially updated for the schema-surface change.
- **Testing**: runner/system-output tests were added, but the new CLI command surface lacks lightweight command-level coverage and the phase execution log contains almost no evidence.

## B) Summary

The phase stays mostly in scope, `just fft` passes, and the happy-path manual runs show that `minih init` and `minih doctor` are wired into the CLI correctly. The blocking problems are all at the command-contract layer: `minih check --input` still applies the output contract, zero-arg `minih check` ignores `MINIH_AGENTS_DIR` and falls back to system-only validation, `minih check` also reports success for nonexistent agent slugs, and `minih run --dry-run` errors before it reaches the preview path unless `GH_TOKEN` is set. The schema story also regressed: the package no longer ships `retrospective.json`, even though the workshops and runner domain doc still describe it as a published contract, and `doctor` cannot compile the documented `$ref` shape because it does not preload the shipped schemas into AJV. Domain docs, the phase manifest, and the execution log are stale enough that this Full Mode review cannot approve the phase as-is.

## C) Checklist

**Testing Approach: Hybrid**

- [ ] Lightweight CLI validation present for the new Phase 5 commands
- [ ] Critical command paths covered
- [ ] Key verification points documented with concrete outputs
- [x] Only in-scope files changed
- [x] Linters/type checks clean (if applicable)
- [ ] Domain compliance checks pass

## D) Findings Table

| ID | Severity | File:Lines | Category | Summary | Recommendation |
|----|----------|------------|----------|---------|----------------|
| F001 | HIGH | `/Users/jordanknight/substrate/minih/src/cli/commands/check.ts:71-91` | correctness | `check --input` always runs system-output validation first, so valid input JSON degrades instead of validating only against `input-schema.json`. | Skip system-output validation in `--input` mode and make input-mode success depend only on the input schema. |
| F002 | HIGH | `/Users/jordanknight/substrate/minih/src/cli/commands/run.ts:78-88`; `/Users/jordanknight/substrate/minih/src/cli/commands/run.ts:147-225` | correctness | `run --dry-run` exits with `E122` when `GH_TOKEN` is absent even though the preview path never imports or calls the SDK. | Move auth preflight below the dry-run return path and share prompt assembly between preview and execution. |
| F003 | HIGH | `/Users/jordanknight/substrate/minih/src/cli/commands/doctor.ts:84-110` | correctness | `doctor` compiles schemas with an empty AJV instance, so the documented `$ref` contract at `https://minih.dev/schemas/retrospective.json` fails. | Register the shipped schemas in AJV before compile and cover `$ref`-based schemas in CLI tests. |
| F004 | HIGH | `/Users/jordanknight/substrate/minih/package.json:20-30`; `/Users/jordanknight/substrate/minih/src/schemas/retrospective.json` (deleted) | scope | Phase 5 replaced the exported retrospective schema with `system-output.json` instead of shipping both, breaking the documented package contract. | Restore `retrospective.json` export/build copy and keep `system-output.json` alongside it. |
| F005 | HIGH | `/Users/jordanknight/substrate/minih/docs/plans/001-setup/tasks/phase-5-doctor-check-init/execution.log.md:1-16` | testing | Full Mode evidence is incomplete: the execution log contains only the header/pre-phase note and no recorded commands, outcomes, or acceptance checks. | Backfill the execution log with actual commands, results, and per-acceptance-item evidence; add CLI-focused verification to match the phase plan. |
| F006 | HIGH | `/Users/jordanknight/substrate/minih/src/cli/commands/check.ts:34-92` | correctness | `check` ignores `MINIH_AGENTS_DIR` in the zero-arg/self-check path and also accepts unresolved agent slugs, so it can silently skip user-schema validation and return a success-shaped result. | Resolve agents dir as explicit flag → `MINIH_AGENTS_DIR` → default, then return `AGENT_NOT_FOUND` before any validation if the slug cannot be resolved. |
| F007 | MEDIUM | `/Users/jordanknight/substrate/minih/docs/plans/001-setup/miniharness-extraction-plan.md:21-55`; `/Users/jordanknight/substrate/minih/docs/domains/cli/domain.md:42-47`; `/Users/jordanknight/substrate/minih/docs/domains/runner/domain.md:15-41`; `/Users/jordanknight/substrate/minih/docs/domains/domain-map.md:1-11` | domain-compliance | The Phase 5 manifest and domain artifacts are stale: the runner doc still centers `retrospective.json`, cli history stops at Phase 4, the manifest omits new files, and the map edges remain unlabeled. | Refresh the manifest plus cli/runner domain docs and replace the shorthand map with labeled contract edges and current node metadata. |
| F008 | LOW | `/Users/jordanknight/substrate/minih/src/cli/commands/run.ts:167-186`; `/Users/jordanknight/substrate/minih/src/cli/commands/init.ts:97-125`; `/Users/jordanknight/substrate/minih/agents/_shared/preamble.md:1-28` | pattern | The dry-run preview and scaffolded artifacts duplicate prompt/schema text instead of reusing a shared source of truth, which already allowed the system-output contract to fork between files. | Extract shared prompt/schema/template constants so preview, runtime validation, and scaffolding all render from the same contract source. |

## E) Detailed Findings

### E.1) Implementation Quality

- **F001 (HIGH)** — `/Users/jordanknight/substrate/minih/src/cli/commands/check.ts:71-91`  
  `check.ts` computes `const systemResult = validateSystemOutput(file);` before it branches on `opts.input`. Review reproduction created a temp agent with `--with-input`, wrote a valid JSON input file, and ran `node dist/cli/index.js check demo --agents-dir "$tmpdir" --file "$tmpdir/input.json" --input`. The command returned `status:"degraded"` with `[system] /: must have required property 'summary'` and `retrospective`, even though the input schema itself passed. That makes the advertised `--input` mode unusable for valid input payloads.

- **F002 (HIGH)** — `/Users/jordanknight/substrate/minih/src/cli/commands/run.ts:78-88`; `/Users/jordanknight/substrate/minih/src/cli/commands/run.ts:147-225`  
  The dry-run branch lives after the unconditional `GH_TOKEN` preflight. Review reproduction with `env -u GH_TOKEN node dist/cli/index.js run hello-world --dry-run` returned `{"code":"E122","message":"GH_TOKEN environment variable is not set..."}` and exited before the preview path executed. Since `--dry-run` never imports the SDK or opens a session, auth should not gate the command.

- **F003 (HIGH)** — `/Users/jordanknight/substrate/minih/src/cli/commands/doctor.ts:84-110`  
  `doctor.ts` validates schemas with `new Ajv2020({ allErrors: true }); ajv.compile(schema);` and never loads the shipped schema fragments first. Review reproduction created a temp agent whose `output-schema.json` used the documented workshop pattern `"retrospective": { "$ref": "https://minih.dev/schemas/retrospective.json" }`; `node dist/cli/index.js doctor --agents-dir "$tmpdir"` then failed with `Schema error: can't resolve reference https://minih.dev/schemas/retrospective.json from id #`. That means the new doctor command currently rejects a documented schema shape.

- **F006 (HIGH)** — `/Users/jordanknight/substrate/minih/src/cli/commands/check.ts:34-92`  
  `check.ts` resolves `agentsDir` as `program.opts().agentsDir ?? process.env.MINIH_AGENTS_DIR ?? 'agents'`, but `program.opts().agentsDir` is always populated with the command default, so `MINIH_AGENTS_DIR` is ignored in the zero-arg/self-check flow. Review reproduction created a temp agent, wrote a system-valid report that did **not** satisfy the agent schema, then ran `MINIH_AGENT_SLUG=demo MINIH_OUTPUT_PATH=... MINIH_AGENTS_DIR="$tmpdir" node .../dist/cli/index.js check` from an unrelated working directory. The command returned `status:"ok"` with `userValid:null`, proving it silently skipped the agent schema instead of resolving the env-provided agents directory. A second reproduction with `check missing-agent --agents-dir "$tmpdir" --file "$tmpdir/report.json"` also returned `ok` for a nonexistent agent slug. Both cases need to fail fast instead of falling back to system-only validation.

- **F008 (LOW)** — `/Users/jordanknight/substrate/minih/src/cli/commands/run.ts:167-186`; `/Users/jordanknight/substrate/minih/src/cli/commands/init.ts:97-125`; `/Users/jordanknight/substrate/minih/agents/_shared/preamble.md:1-28`  
  Even when `GH_TOKEN` is faked so `--dry-run` can execute, the preview prints `Write your final JSON report to: <run-dir>/output/report.json` and `(system output format instructions)` instead of the actual assembled text. The same contract text is also duplicated across `PREAMBLE_TEMPLATE`, the committed `_shared/preamble.md`, `OUTPUT_SCHEMA_TEMPLATE`, and the inline `systemSchema` in `validator.ts`, which is exactly the kind of drift the review reproduced in the schema surface.

No material security or performance issues were found beyond the command-semantics and schema-contract problems above.

### E.2) Domain Compliance

| Check | Status | Details |
|-------|--------|---------|
| File placement | ✅ | New source files live under `/Users/jordanknight/substrate/minih/src/cli/`, `/Users/jordanknight/substrate/minih/src/runner/`, and `/Users/jordanknight/substrate/minih/src/schemas/`; phase artifacts live under the phase folder. |
| Contract-only imports | ✅ | Phase 5 imports stay on the public barrel boundaries (`runner/index`, `adapter/index`) rather than reaching through other domains' internals. |
| Dependency direction | ✅ | The dependency flow remains `cli → runner → adapter` with no upward imports. |
| Domain.md updated | ❌ | `/Users/jordanknight/substrate/minih/docs/domains/cli/domain.md:42-47` stops at Phase 4, and `/Users/jordanknight/substrate/minih/docs/domains/runner/domain.md:15-41` still documents `retrospective.json` as the runner schema contract while omitting `system-output.json`, `validateSystemOutput()`, and the new validation metadata. |
| Registry current | ✅ | `/Users/jordanknight/substrate/minih/docs/domains/registry.md:1-7` remains accurate because Phase 5 adds no new domains. |
| No orphan files | ❌ | `/Users/jordanknight/substrate/minih/docs/plans/001-setup/miniharness-extraction-plan.md:21-55` still maps `src/schemas/retrospective.json` and omits `src/schemas/system-output.json`, `agents/_shared/preamble.md`, and `test/helpers/fixtures.ts`. |
| Map nodes current | ❌ | `/Users/jordanknight/substrate/minih/docs/domains/domain-map.md:1-11` lacks current node metadata and does not reflect the runner's Phase 5 contract surface. |
| Map edges current | ❌ | The existing map edges are unlabeled shorthand arrows; the review rules require each dependency to name the governing contract/public surface. |
| No circular business deps | ✅ | The dependency graph remains linear and acyclic. |
| Concepts documented | ⚠️ | The touched domains do have `## Concepts`, but they are still two-column tables and do not document the new Phase 5 concepts in the required `Concept | Entry Point | What It Does` format. |

- **F004 (HIGH)** — `/Users/jordanknight/substrate/minih/package.json:20-30`; `/Users/jordanknight/substrate/minih/src/schemas/retrospective.json` (deleted)  
  Workshop 006 says to add `system-output.json` **alongside** the existing `retrospective.json` schema, and Workshop 001 resolves that `retrospective.json` ships as a standalone package contract for `$ref` usage. The current package export/build script now exposes only `./schemas/system-output.json`, while the runner domain doc still lists `retrospective.json` as a contract consumed by agent schemas. That is a real contract break, not just stale documentation.

- **F007 (MEDIUM)** — `/Users/jordanknight/substrate/minih/docs/plans/001-setup/miniharness-extraction-plan.md:21-55`; `/Users/jordanknight/substrate/minih/docs/domains/cli/domain.md:42-47`; `/Users/jordanknight/substrate/minih/docs/domains/runner/domain.md:15-41`; `/Users/jordanknight/substrate/minih/docs/domains/domain-map.md:1-11`  
  The domain artifacts were only partially refreshed. The cli composition table includes the new commands, but the history section was not advanced to Phase 5. The runner doc still centers `retrospective.json` and omits `system-output.json` plus the new validation contract. The domain map still uses unlabeled arrows, and the plan manifest no longer matches the changed file set for this phase.

### E.3) Anti-Reinvention

| New Component | Existing Match? | Domain | Status |
|--------------|----------------|--------|--------|
| shared preamble template | `/Users/jordanknight/substrate/minih/src/cli/commands/init.ts:97-125` (`PREAMBLE_TEMPLATE`) | cli | reuse |
| `minih check` | None | None | proceed |
| `minih doctor` | None | None | proceed |
| init output-schema template | `/Users/jordanknight/substrate/minih/src/runner/validator.ts:156-173` inline system schema | runner | extend |
| `system-output.json` | `/Users/jordanknight/substrate/minih/src/runner/validator.ts:156-173` inline system schema | runner | extend |
| `validSystemOutput` test helper | None | None | proceed |

The only material reinvention issue is schema/template drift: the system-output contract now exists in multiple places instead of being composed from one shared source. That duplication is already visible in the mismatch between the shipped schema surface and the runtime validation/preview behavior.

### E.4) Testing & Evidence

**Coverage confidence**: 60%

`just fft` reran successfully during review, and the manual command runs produced concrete evidence for `init`, `doctor`, `check`, and `dry-run`. The evidence quality still falls short of the spec's Hybrid expectation for Phase 5 because the new CLI behaviors do not have lightweight command-level tests and `/Users/jordanknight/substrate/minih/docs/plans/001-setup/tasks/phase-5-doctor-check-init/execution.log.md:1-16` contains no substantive task evidence.

| AC | Confidence | Evidence |
|----|------------|----------|
| `minih doctor` validates all agents and reports per-agent check results | 82 | `node dist/cli/index.js doctor --agents-dir /Users/jordanknight/substrate/minih/agents` returned per-agent results plus JSON `{command:"doctor",status:"ok"...}`; a temp agent using the documented `$ref` contract exposed the unresolved-ref failure. |
| `minih check <slug> --file <path>` validates file against schema | 15 | `check --input` degraded a valid input file due to unconditional system validation, `check missing-agent ...` returned `ok` without resolving an agent schema, and the zero-arg self-check path ignored `MINIH_AGENTS_DIR` and skipped user-schema validation. |
| `minih init <slug>` creates agent folder with correct templates | 84 | `node dist/cli/index.js init demo --agents-dir "$tmpdir" --with-input` created `prompt.md`, `output-schema.json`, `instructions.md`, `input-schema.json`, and `_shared/preamble.md`. |
| Scaffolded `output-schema.json` includes retrospective as required | 58 | `/Users/jordanknight/substrate/minih/src/cli/commands/init.ts:50-82` requires `summary` and `retrospective`, but this remains mostly static evidence because the phase log does not record a content-level verification. |
| `--dry-run` shows assembled prompt without executing | 18 | `env -u GH_TOKEN node dist/cli/index.js run hello-world --dry-run` failed with `E122`; `GH_TOKEN=fake node dist/cli/index.js run hello-world --dry-run` produced a preview but still printed placeholder system/output sections rather than the true assembled prompt. |
| Preamble template created on first init | 85 | The isolated `init` run reported `_shared/preamble.md (created)`, matching `/Users/jordanknight/substrate/minih/src/cli/commands/init.ts:201-209`. |

### E.5) Doctrine Compliance

N/A — no `/Users/jordanknight/substrate/minih/docs/project-rules/rules.md`, `idioms.md`, `architecture.md`, or `constitution.md` files were present for this repository.

### E.6) Harness Live Validation

N/A — no harness configured. `/Users/jordanknight/substrate/minih/docs/plans/001-setup/tasks/phase-5-doctor-check-init/execution.log.md:9-12` explicitly records: "UNAVAILABLE — No harness.md exists. Using `just fft` + real agent runs."

## F) Coverage Map

| AC | Description | Evidence | Confidence |
|----|-------------|----------|------------|
| Phase 5 AC1 | `minih doctor` validates all agents and reports per-agent check results | Happy-path review run against `/Users/jordanknight/substrate/minih/agents` succeeded; ref-based schema reproduction showed a documented contract still fails. | 82 |
| Phase 5 AC2 | `minih check <slug> --file <path>` validates file against schema | Review reproductions showed `--input` is currently broken for valid input payloads, missing slugs still return success-shaped output, and the zero-arg self-check flow ignores `MINIH_AGENTS_DIR` and skips agent-schema validation. | 15 |
| Phase 5 AC3 | `minih init <slug>` creates agent folder with correct templates | Isolated `init demo --with-input` run created the expected files and returned the created-file list in the JSON envelope. | 84 |
| Phase 5 AC4 | Scaffolded `output-schema.json` includes retrospective as required | Static inspection of `OUTPUT_SCHEMA_TEMPLATE` confirms the fields are required, but the phase evidence log does not record a content-level verification. | 58 |
| Phase 5 AC5 | `--dry-run` shows assembled prompt without executing | Review run without `GH_TOKEN` failed before preview; review run with a fake token previewed placeholders instead of the full assembled text. | 18 |
| Phase 5 AC6 | Preamble template created on first init | The isolated init run created `_shared/preamble.md`, matching the code path in `init.ts`. | 85 |

**Overall coverage confidence**: 60%

## G) Commands Executed

```bash
git --no-pager diff --stat && printf '\n---STAGED---\n' && git --no-pager diff --staged --stat && printf '\n---STATUS---\n' && git --no-pager status --short
git --no-pager log --oneline --decorate -20 && printf '\n---NAMES---\n' && git --no-pager log --name-status --format='COMMIT %H %s' -10
mkdir -p /Users/jordanknight/substrate/minih/docs/plans/001-setup/tasks/phase-5-doctor-check-init/reviews && git --no-pager diff 950d444301bc23c24916c6d65bd69f8ddf627fa3..90a20606496654abcdc57d40c419277db2c15cae > /Users/jordanknight/substrate/minih/docs/plans/001-setup/tasks/phase-5-doctor-check-init/reviews/_computed.diff && git --no-pager diff --name-status 950d444301bc23c24916c6d65bd69f8ddf627fa3..90a20606496654abcdc57d40c419277db2c15cae
just fft
tmpdir=$(mktemp -d) && printf 'TMPDIR=%s\n' "$tmpdir" && node dist/cli/index.js init demo --agents-dir "$tmpdir" --with-input && printf '{"foo":"bar"}\n' > "$tmpdir/input.json" && node dist/cli/index.js check demo --agents-dir "$tmpdir" --file "$tmpdir/input.json" --input && env -u GH_TOKEN node dist/cli/index.js run hello-world --dry-run && node dist/cli/index.js doctor --agents-dir /Users/jordanknight/substrate/minih/agents && rm -rf "$tmpdir"
tmpdir=$(mktemp -d) && printf '{"summary":"This is a valid summary paragraph that is definitely long enough.","retrospective":{"workedWell":"Things were smooth today.","confusing":"Nothing too confusing happened.","magicWand":"Please add a clearer command example for this exact workflow."}}\n' > "$tmpdir/report.json" && node dist/cli/index.js check missing-agent --agents-dir "$tmpdir" --file "$tmpdir/report.json" && rm -rf "$tmpdir"
tmpdir=$(mktemp -d) && node dist/cli/index.js init demo --agents-dir "$tmpdir" >/dev/null && mkdir -p "$tmpdir/runspace" && printf '{"summary":"This is a valid summary paragraph that is definitely long enough.","retrospective":{"workedWell":"Things were smooth today.","confusing":"Nothing too confusing happened.","magicWand":"Please add a clearer command example for this exact workflow."}}\n' > "$tmpdir/runspace/report.json" && (cd "$tmpdir/runspace" && MINIH_AGENT_SLUG=demo MINIH_OUTPUT_PATH="$tmpdir/runspace/report.json" MINIH_AGENTS_DIR="$tmpdir" node /Users/jordanknight/substrate/minih/dist/cli/index.js check) && rm -rf "$tmpdir"
tmpdir=$(mktemp -d) && mkdir -p "$tmpdir/ref-agent" && printf '%s\n' '---' 'description: ref agent' '---' '' '# Ref Agent' > "$tmpdir/ref-agent/prompt.md" && printf '%s\n' '{' '  "$schema": "https://json-schema.org/draft/2020-12/schema",' '  "type": "object",' '  "required": ["summary", "retrospective"],' '  "properties": {' '    "summary": { "type": "string" },' '    "retrospective": { "$ref": "https://minih.dev/schemas/retrospective.json" }' '  }' '}' > "$tmpdir/ref-agent/output-schema.json" && node dist/cli/index.js doctor --agents-dir "$tmpdir" && rm -rf "$tmpdir"
GH_TOKEN=fake node dist/cli/index.js run hello-world --dry-run
```

## H) Handover Brief

> Copy this section to the implementing agent. It has no context on the review —
> only context on the work that was done before the review.

**Review result**: REQUEST_CHANGES

**Plan**: /Users/jordanknight/substrate/minih/docs/plans/001-setup/miniharness-extraction-plan.md
**Spec**: /Users/jordanknight/substrate/minih/docs/plans/001-setup/miniharness-extraction-spec.md
**Phase**: Phase 5: Doctor, Check, Init
**Tasks dossier**: /Users/jordanknight/substrate/minih/docs/plans/001-setup/miniharness-extraction-plan.md (Phase 5 section); /Users/jordanknight/substrate/minih/docs/plans/001-setup/tasks/phase-5-doctor-check-init/001-subtask-system-output-enforcement.md
**Execution log**: /Users/jordanknight/substrate/minih/docs/plans/001-setup/tasks/phase-5-doctor-check-init/execution.log.md
**Review file**: /Users/jordanknight/substrate/minih/docs/plans/001-setup/tasks/phase-5-doctor-check-init/reviews/review.phase-5-doctor-check-init.md

### Files Reviewed

| File (absolute path) | Status | Domain | Action Needed |
|---------------------|--------|--------|---------------|
| /Users/jordanknight/substrate/minih/src/cli/commands/check.ts | Reviewed | cli internal | FT-001 |
| /Users/jordanknight/substrate/minih/src/cli/commands/run.ts | Reviewed | cli internal | FT-002 |
| /Users/jordanknight/substrate/minih/src/cli/commands/doctor.ts | Reviewed | cli internal | FT-003 |
| /Users/jordanknight/substrate/minih/package.json | Reviewed | root/package | FT-003 |
| /Users/jordanknight/substrate/minih/src/schemas/retrospective.json | Deleted in phase | runner contract | FT-003 |
| /Users/jordanknight/substrate/minih/src/schemas/system-output.json | Reviewed | runner contract | FT-003 |
| /Users/jordanknight/substrate/minih/src/runner/validator.ts | Reviewed | runner internal | FT-003 |
| /Users/jordanknight/substrate/minih/src/cli/commands/init.ts | Reviewed | cli internal | FT-004 |
| /Users/jordanknight/substrate/minih/test/runner/runner.test.ts | Reviewed | runner test | FT-004 |
| /Users/jordanknight/substrate/minih/test/runner/integration.test.ts | Reviewed | runner test | FT-004 |
| /Users/jordanknight/substrate/minih/docs/domains/cli/domain.md | Reviewed | cli docs | FT-005 |
| /Users/jordanknight/substrate/minih/docs/domains/runner/domain.md | Reviewed | runner docs | FT-005 |
| /Users/jordanknight/substrate/minih/docs/domains/domain-map.md | Reviewed | domain docs | FT-005 |
| /Users/jordanknight/substrate/minih/docs/plans/001-setup/miniharness-extraction-plan.md | Reviewed | plan artifact | FT-005 |
| /Users/jordanknight/substrate/minih/docs/plans/001-setup/tasks/phase-5-doctor-check-init/execution.log.md | Reviewed | phase artifact | FT-004 |

### Required Fixes (if REQUEST_CHANGES)

| # | File (absolute path) | What To Fix | Why |
|---|---------------------|-------------|-----|
| 1 | /Users/jordanknight/substrate/minih/src/cli/commands/check.ts | Make `--input` validate only against the input schema, resolve agents dir as explicit flag → `MINIH_AGENTS_DIR` → default, and reject missing agent slugs before validation begins. | Valid input payloads currently degrade, zero-arg self-check skips user-schema validation in non-default agents dirs, and nonexistent agents can still return success-shaped output. |
| 2 | /Users/jordanknight/substrate/minih/src/cli/commands/run.ts | Make `--dry-run` bypass auth/SDK preflight and preview the actual assembled prompt text instead of placeholders. | The command currently fails without `GH_TOKEN` and misrepresents the prompt even when forced through. |
| 3 | /Users/jordanknight/substrate/minih/package.json; /Users/jordanknight/substrate/minih/src/schemas/retrospective.json; /Users/jordanknight/substrate/minih/src/cli/commands/doctor.ts; /Users/jordanknight/substrate/minih/src/runner/validator.ts | Restore the published retrospective schema surface and make AJV validation aware of the shipped schema refs. | Phase 5 broke the documented schema contract and `doctor` currently rejects documented `$ref` usage. |
| 4 | /Users/jordanknight/substrate/minih/src/cli/commands/init.ts; /Users/jordanknight/substrate/minih/test/runner/runner.test.ts; /Users/jordanknight/substrate/minih/test/runner/integration.test.ts; /Users/jordanknight/substrate/minih/docs/plans/001-setup/tasks/phase-5-doctor-check-init/execution.log.md | Add lightweight Phase 5 CLI verification and record concrete evidence in the execution log. | The plan calls for lightweight CLI coverage, but the phase only added runner tests and left the execution log nearly empty. |
| 5 | /Users/jordanknight/substrate/minih/docs/domains/cli/domain.md; /Users/jordanknight/substrate/minih/docs/domains/runner/domain.md; /Users/jordanknight/substrate/minih/docs/domains/domain-map.md; /Users/jordanknight/substrate/minih/docs/plans/001-setup/miniharness-extraction-plan.md | Refresh the manifest and domain artifacts to match the Phase 5 file set and contract surface. | Domain review cannot pass while the runner contract, manifest, and map are stale. |

### Domain Artifacts to Update (if any)

| File (absolute path) | What's Missing |
|---------------------|----------------|
| /Users/jordanknight/substrate/minih/docs/domains/cli/domain.md | Add a Phase 5 history row describing `doctor`, `check`, `init`, and `run --dry-run`. |
| /Users/jordanknight/substrate/minih/docs/domains/runner/domain.md | Update Composition, Contracts, Concepts, and History for `system-output.json`, `validateSystemOutput()`, validation metadata, and the continuing `retrospective.json` contract. |
| /Users/jordanknight/substrate/minih/docs/domains/domain-map.md | Replace unlabeled shorthand arrows with labeled contract edges and add current node metadata/health summary. |
| /Users/jordanknight/substrate/minih/docs/plans/001-setup/miniharness-extraction-plan.md | Refresh `## Domain Manifest` for `src/schemas/system-output.json`, `agents/_shared/preamble.md`, `test/helpers/fixtures.ts`, and the removal/retention decision for `retrospective.json`. |

### Next Step

/plan-6-v2-implement-phase --plan /Users/jordanknight/substrate/minih/docs/plans/001-setup/miniharness-extraction-plan.md --phase 'Phase 5: Doctor, Check, Init'
