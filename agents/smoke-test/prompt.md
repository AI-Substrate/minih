---
description: "End-to-end smoke test of all minih CLI commands and the full agent lifecycle"
tags: [smoke, ci, integration, e2e]
---

# Minih Smoke Test

## Objective

Exercise every minih CLI command to verify the full agent lifecycle works.
Create a temporary agent, validate it, preview it, check history, and report.

**Important**: Do NOT run `minih run` inside this agent — that would create
a nested SDK session. Use `--dry-run` to preview prompt assembly instead.

## Setup

```bash
cd {{REPO_ROOT}}
```

## Tasks

### 1. List Agents

```bash
npx minih list 2>/dev/null
```

Capture the JSON output from stdout (all minih commands output JSON on stdout
and human-readable tables on stderr). Record the count and slugs.
Verify this agent (smoke-test) appears in the list.

### 2. Doctor Check

```bash
npx minih doctor 2>/dev/null
```

Verify the harness is healthy. Record any warnings or errors.

### 3. Create Temporary Agent

```bash
npx minih init smoke-temp --with-input 2>/dev/null
```

Verify the folder was created with prompt.md, output-schema.json, input-schema.json.

### 4. Verify List Updated

```bash
npx minih list 2>/dev/null
```

Verify `smoke-temp` now appears in the list.

### 5. Inspect Scaffolded Files

Read the generated files and verify:
- prompt.md has frontmatter with description
- output-schema.json has retrospective required
- input-schema.json exists and is valid JSON Schema
- Templates are valid

### 6. Doctor the Temp Agent

```bash
npx minih doctor 2>/dev/null
```

Verify `smoke-temp` passes all doctor checks.

### 7. Dry-Run the Temp Agent

```bash
npx minih run smoke-temp --dry-run 2>/dev/null
```

### 8. Check Self-Validation

Validate your own output using the `minih check` command:

```bash
npx minih check 2>/dev/null
```

This uses MINIH_* env vars set by the runner to auto-detect agent and output path.

### 9. Check History

```bash
npx minih history smoke-test 2>/dev/null
```

Record whether any prior runs of smoke-test appear.

### 10. Last Run Info

```bash
npx minih last-run smoke-test 2>/dev/null
```

Record whether last-run info is available.

### 11. Cleanup

Remove the temporary agent folder:
```bash
rm -rf agents/smoke-temp
```

Verify it's gone by listing agents again.

### 12. Report

Compile all results into the structured output. Include pass/fail for each step
and the overall lifecycle verdict.
