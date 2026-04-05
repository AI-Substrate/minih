---
description: "Validate all minih agents follow folder conventions, frontmatter, and schema rules"
tags: [ci, validation, conventions]
---

# Convention Check

## Objective

Audit the minih agents directory for convention compliance. Run the doctor
command and produce a detailed report with findings and recommendations.

## Setup

```bash
cd {{REPO_ROOT}}
```

## Tasks

### 1. Run Doctor

```bash
npx minih doctor 2>/dev/null
```

Capture the full JSON output (stdout is always JSON, stderr is human-readable).
Parse the `data.agents` array.

### 2. Analyze Each Agent

For each agent reported by doctor:
- Is frontmatter present and valid (has description)?
- Does the output schema compile without errors?
- Is retrospective included in the output schema?
- Does the agent have instructions.md?
- Does the agent have an input schema?

### 3. Check Preamble

Verify `agents/_shared/preamble.md` exists and contains the feedback loop
section (look for "magicWand" or "retrospective" keywords).

### 4. Cross-Check File Conventions

For each agent directory, verify:
- prompt.md is the first file read (required)
- Frontmatter uses YAML format with `---` delimiters
- Tags array is present in frontmatter
- output-schema.json uses JSON Schema 2020-12 (`$schema` field)

### 5. Report

Write your findings as JSON to the output hint path. Include:
- Overall health status
- Per-agent detailed results
- Whether the preamble exists and covers feedback
- Actionable recommendations for agents that need attention
- Your retrospective on the doctor command UX
