# Fix Tasks: Phase 5: Doctor, Check, Init

Apply in order. Re-run review after fixes.

## Critical / High Fixes

### FT-001: Correct `check` command mode handling and self-check resolution
- **Severity**: HIGH
- **File(s)**: /Users/jordanknight/substrate/minih/src/cli/commands/check.ts
- **Issue**: `check --input` still applies the system output contract, so valid input JSON degrades instead of validating only against `input-schema.json`. The zero-arg/self-check path also ignores `MINIH_AGENTS_DIR` because the command default always wins, and unresolved agent slugs can still return success-shaped output without any user-schema validation.
- **Fix**: Resolve agents dir as explicit CLI flag → `MINIH_AGENTS_DIR` → `agents`. Fail fast when `resolveAgent()` returns null. In `--input` mode, validate only against `input-schema.json`. In output mode, keep system validation plus any agent output schema validation, but ensure the result shape clearly reflects which checks ran.
- **Patch hint**:
  ```diff
  - const agentsDir =
  -   program.opts().agentsDir ?? process.env.MINIH_AGENTS_DIR ?? 'agents';
  + const agentsDir =
  +   process.argv.includes('--agents-dir')
  +     ? program.opts().agentsDir
  +     : process.env.MINIH_AGENTS_DIR ?? program.opts().agentsDir ?? 'agents';
  +
  + const definition = resolveAgent(slug, agentsDir);
  + if (!definition) {
  +   exitWithEnvelope(
  +     formatError('check', ErrorCodes.AGENT_NOT_FOUND, `Agent "${slug}" not found.`),
  +   );
  +   return;
  + }
  
  - const systemResult = validateSystemOutput(file);
  - let userResult = null;
  + let systemResult = null;
  + let userResult = null;
    if (opts.input) {
  -   userResult = validateOutput(definition.inputSchemaPath, file);
  +   userResult = validateOutput(definition.inputSchemaPath, file);
    } else {
  +   systemResult = validateSystemOutput(file);
      if (definition.schemaPath) {
        userResult = validateOutput(definition.schemaPath, file);
      }
    }
  ```

### FT-002: Make `run --dry-run` truly offline and preview the real prompt
- **Severity**: HIGH
- **File(s)**: /Users/jordanknight/substrate/minih/src/cli/commands/run.ts, /Users/jordanknight/substrate/minih/src/runner/runner.ts
- **Issue**: `run --dry-run` currently errors out unless `GH_TOKEN` is set, even though it never calls the SDK. When forced through with a fake token, the preview still prints placeholder output/system sections instead of the actual assembled prompt content.
- **Fix**: Move the dry-run path above the `GH_TOKEN` preflight and dynamic import. Extract shared prompt-assembly logic from `runner.ts` so preview mode renders the same output hint and system requirements that execution uses.
- **Patch hint**:
  ```diff
  - // Pre-flight: check GH_TOKEN
  - if (!process.env.GH_TOKEN) {
  -   exitWithEnvelope(...);
  - }
  -
    // Dry-run: preview assembled prompt without executing
    if (opts.dryRun) {
  -   const parts = [ ... placeholders ... ];
  +   const preview = assemblePromptPreview(definition, config, agentsDir);
  +   for (const part of preview.parts) {
  +     ...
  +   }
      exitWithEnvelope(formatSuccess('run', { ... }));
      return;
    }
  
  + if (!process.env.GH_TOKEN) {
  +   exitWithEnvelope(...);
  + }
  ```

### FT-003: Restore the shipped schema contract and make AJV ref-aware
- **Severity**: HIGH
- **File(s)**: /Users/jordanknight/substrate/minih/package.json, /Users/jordanknight/substrate/minih/src/schemas/retrospective.json, /Users/jordanknight/substrate/minih/src/cli/commands/doctor.ts, /Users/jordanknight/substrate/minih/src/runner/validator.ts, /Users/jordanknight/substrate/minih/src/schemas/system-output.json
- **Issue**: Phase 5 replaced the published `retrospective.json` schema with `system-output.json` even though the documented contract says `system-output.json` should be added alongside it. `doctor` then compiles schemas without preloading those shipped fragments, so the documented `$ref` usage fails.
- **Fix**: Re-add `src/schemas/retrospective.json`, restore the package export/build copy, and register both shipped schemas in AJV before compiling agent schemas. Prefer loading `system-output.json` from a shared source rather than redefining it inline in `validator.ts`.
- **Patch hint**:
  ```diff
    "exports": {
  +   "./schemas/retrospective.json": "./dist/schemas/retrospective.json",
      "./schemas/system-output.json": "./dist/schemas/system-output.json"
    },
    "scripts": {
  -   "build": "tsc && mkdir -p dist/schemas && cp src/schemas/system-output.json dist/schemas/system-output.json",
  +   "build": "tsc && mkdir -p dist/schemas && cp src/schemas/retrospective.json dist/schemas/retrospective.json && cp src/schemas/system-output.json dist/schemas/system-output.json",
    }
  ```
  ```diff
    const ajv = new Ajv2020({ allErrors: true });
  + ajv.addSchema(retrospectiveSchema, 'https://minih.dev/schemas/retrospective.json');
  + ajv.addSchema(systemOutputSchema, 'https://minih.dev/schemas/system-output.json');
    ajv.compile(schema);
  ```

### FT-004: Add Phase 5 CLI evidence and lightweight coverage
- **Severity**: HIGH
- **File(s)**: /Users/jordanknight/substrate/minih/src/cli/commands/check.ts, /Users/jordanknight/substrate/minih/src/cli/commands/doctor.ts, /Users/jordanknight/substrate/minih/src/cli/commands/init.ts, /Users/jordanknight/substrate/minih/src/cli/commands/run.ts, /Users/jordanknight/substrate/minih/docs/plans/001-setup/tasks/phase-5-doctor-check-init/execution.log.md
- **Issue**: The phase plan called for lightweight CLI validation, but the changed tests only cover runner/system-output behavior. The execution log contains almost no evidence, so the Full Mode review cannot trace command-level verification.
- **Fix**: Add focused CLI tests (or equally concrete manual verification) for `doctor`, `check`, `init`, and `run --dry-run`, then record the commands, exit codes, and observed outcomes in `execution.log.md`.
- **Patch hint**:
  ```diff
  + describe('Phase 5 CLI commands', () => {
  +   it('doctor reports per-agent checks', async () => { ... });
  +   it('check validates input mode without system-output errors', async () => { ... });
  +   it('init scaffolds files and first-run preamble', async () => { ... });
  +   it('dry-run previews prompt without GH_TOKEN', async () => { ... });
  + });
  ```
  ```diff
    ## Task Log
  
  + - `just fft` → pass
  + - `node dist/cli/index.js init demo --agents-dir ... --with-input` → created prompt/schema/instructions/input/preamble
  + - `node dist/cli/index.js doctor --agents-dir agents` → healthy=1, errors=0
  + - `node dist/cli/index.js run hello-world --dry-run` → preview rendered without execution
  ```

## Medium / Low Fixes

### FT-005: Refresh Phase 5 domain artifacts
- **Severity**: MEDIUM
- **File(s)**: /Users/jordanknight/substrate/minih/docs/domains/cli/domain.md, /Users/jordanknight/substrate/minih/docs/domains/runner/domain.md, /Users/jordanknight/substrate/minih/docs/domains/domain-map.md, /Users/jordanknight/substrate/minih/docs/plans/001-setup/miniharness-extraction-plan.md
- **Issue**: The Phase 5 manifest and domain docs are stale. The cli history stops at Phase 4, the runner doc still treats `retrospective.json` as the only schema contract, the map edges are unlabeled, and the manifest no longer matches the actual changed-file set.
- **Fix**: Add Phase 5 history rows, update runner Composition/Contracts/Concepts for the schema changes, label every domain-map edge with its contract surface, and refresh the Domain Manifest for the new/deleted Phase 5 artifacts.
- **Patch hint**:
  ```diff
    | Phase | Changes |
    |-------|---------|
    | Phase 4 | Full CLI implementation ... |
  + | Phase 5 | Added `doctor`, `check`, `init`, and `run --dry-run`; scaffolded `_shared/preamble.md`; introduced `system-output.json`; retained `retrospective.json` as the reusable published fragment. |
  ```
  ```diff
  - cli → runner → adapter
  + cli --runner/index (listAgents, resolveAgent, runAgent, validate*)--> runner
  + cli --adapter/index (SdkCopilotAdapter)--> adapter
  + runner --adapter/index (IAgentAdapter, AgentEvent, AgentResult)--> adapter
  ```

## Re-Review Checklist

- [ ] `check --input` validates valid input JSON without system-output errors
- [ ] `check` rejects nonexistent agent slugs
- [ ] zero-arg `minih check` honors `MINIH_AGENTS_DIR` and validates the agent schema
- [ ] `run --dry-run` works without `GH_TOKEN`
- [ ] dry-run preview renders the real assembled prompt parts
- [ ] `retrospective.json` is shipped again alongside `system-output.json`
- [ ] `doctor` accepts the documented `$ref` schema pattern
- [ ] Phase 5 CLI verification is captured in tests and/or `execution.log.md`
- [ ] Domain manifest and domain docs/map reflect the Phase 5 contract surface
- [ ] Re-run `/plan-7-v2-code-review` and achieve zero HIGH/CRITICAL
