# Fix Tasks: Phase 2: Runner Core

Apply in order. Re-run review after fixes.

## Critical / High Fixes

### FT-001: Clear the runner timeout timer and prove the timeout path
- **Severity**: HIGH
- **File(s)**: /Users/jordanknight/substrate/minih/src/runner/runner.ts, /Users/jordanknight/substrate/minih/test/runner/runner.test.ts
- **Issue**: `runAgent()` races `adapter.run()` against a `setTimeout()` promise but never clears the timer when `adapter.run()` resolves first. Successful runs therefore keep the Node process alive until the timeout expires, and the timeout path currently has no direct automated evidence.
- **Fix**: Store the timeout handle, clear it after the race settles, and add a timeout-specific test that forces a slow adapter run, asserts `terminate(sessionId)`, and verifies `completed.json` / metadata report `timeout`.
- **Patch hint**:
  ```diff
  - agentResult = await Promise.race([
  -   adapter.run({ ... }),
  -   new Promise<never>((_, reject) => {
  -     setTimeout(() => {
  -       timedOut = true;
  -       reject(new Error(`Agent timed out after ${config.timeout ?? 300}s`));
  -     }, timeoutMs);
  -   }),
  - ]);
  + let timeoutHandle: NodeJS.Timeout | undefined;
  + const runPromise = adapter.run({ ... });
  + const timeoutPromise = new Promise<never>((_, reject) => {
  +   timeoutHandle = setTimeout(() => {
  +     timedOut = true;
  +     reject(new Error(`Agent timed out after ${config.timeout ?? 300}s`));
  +   }, timeoutMs);
  + });
  + try {
  +   agentResult = await Promise.race([runPromise, timeoutPromise]);
  + } finally {
  +   if (timeoutHandle) clearTimeout(timeoutHandle);
  + }
  ```

### FT-002: Ship the retrospective schema in the npm package
- **Severity**: HIGH
- **File(s)**: /Users/jordanknight/substrate/minih/package.json, /Users/jordanknight/substrate/minih/src/schemas/retrospective.json
- **Issue**: The phase claims `/Users/jordanknight/substrate/minih/src/schemas/retrospective.json` is shipped, but `npm pack --dry-run --json` shows no schema asset in the package. `package.json` currently whitelists a top-level `schemas/` directory that does not exist.
- **Fix**: Copy the schema into published output during build (for example `dist/schemas/retrospective.json`), keep it inside the packaged `dist/` tree or another real published directory, and expose a stable export path or documented location. Re-run `npm pack --dry-run --json` to verify the asset is present.
- **Patch hint**:
  ```diff
   "scripts": {
  -  "build": "tsc",
  +  "build": "tsc && mkdir -p dist/schemas && cp src/schemas/retrospective.json dist/schemas/retrospective.json",
      "test": "vitest run"
   },
   "exports": {
     ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" },
     "./adapter": { "import": "./dist/adapter/index.js", "types": "./dist/adapter/index.d.ts" },
  -  "./runner": { "import": "./dist/runner/index.js", "types": "./dist/runner/index.d.ts" }
  +  "./runner": { "import": "./dist/runner/index.js", "types": "./dist/runner/index.d.ts" },
  +  "./schemas/retrospective.json": "./dist/schemas/retrospective.json"
   },
   "files": [
  -  "dist",
  -  "schemas",
  +  "dist",
      "LICENSE"
   ]
  ```

## Medium / Low Fixes

### FT-003: Enforce required frontmatter/description during discovery
- **Severity**: MEDIUM
- **File(s)**: /Users/jordanknight/substrate/minih/src/runner/folder.ts, /Users/jordanknight/substrate/minih/test/runner/folder.test.ts
- **Issue**: `listAgents()` currently accepts `prompt.md` files without required frontmatter/description and returns `AgentDefinition` objects with empty descriptions, which conflicts with the spec clarification that frontmatter is required with at least a `description`.
- **Fix**: Reject invalid agent folders during discovery or surface a structured validation failure, and update tests so missing frontmatter/description is not treated as a valid agent definition.
- **Patch hint**:
  ```diff
    const promptContent = fs.readFileSync(promptPath, 'utf-8');
    const { description, tags } = parseFrontmatter(promptContent);
  + if (!description.trim()) {
  +   continue;
  + }
  
    agents.push({
      slug: entry.name,
     description,
     tags,
  ```

### FT-004: Route runner tests through adapter contracts
- **Severity**: MEDIUM
- **File(s)**: /Users/jordanknight/substrate/minih/test/runner/runner.test.ts, /Users/jordanknight/substrate/minih/test/runner/integration.test.ts
- **Issue**: Runner-domain tests currently import `FakeAgentAdapter` from `../../src/adapter/fake.js`, which reaches into an adapter internal module path instead of using the adapter contract barrel.
- **Fix**: Change those imports to `../../src/adapter/index.js` so runner tests depend only on adapter contracts/public surface.
- **Patch hint**:
  ```diff
  - import { FakeAgentAdapter } from '../../src/adapter/fake.js';
  + import { FakeAgentAdapter } from '../../src/adapter/index.js';
  ```

### FT-005: Refresh runner domain contracts documentation
- **Severity**: MEDIUM
- **File(s)**: /Users/jordanknight/substrate/minih/docs/domains/runner/domain.md
- **Issue**: The Phase 2 history was added, but the Contracts section still documents only type contracts. It omits the public runtime API now exported from `src/runner/index.ts` and under-documents the retrospective schema as a runner contract.
- **Fix**: Update `## Contracts` to include the runtime runner barrel surface (discovery, validation, display, `runAgent`) and clarify the retrospective schema's contract role/consumers.

### FT-006: Add the integration test to the plan manifest
- **Severity**: LOW
- **File(s)**: /Users/jordanknight/substrate/minih/docs/plans/001-setup/miniharness-extraction-plan.md
- **Issue**: `test/runner/integration.test.ts` exists and is in-scope for Phase 2, but the Domain Manifest does not list it.
- **Fix**: Add `test/runner/integration.test.ts` to the Domain Manifest as a runner/internal integration test.

## Re-Review Checklist

- [ ] All critical/high fixes applied
- [ ] `npm test` passes with the new timeout/frontmatter coverage
- [ ] `npm pack --dry-run --json` includes the retrospective schema asset
- [ ] Runner tests import `FakeAgentAdapter` via the adapter barrel
- [ ] Runner domain docs and plan manifest reflect the Phase 2 public/test surface
- [ ] Re-run `/plan-7-v2-code-review` and achieve zero HIGH/CRITICAL
