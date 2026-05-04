---
description: "Review a source file for code quality, patterns, and minih conventions"
tags: [review, quality, code]
permissions: read-only
---

# Self-Review

## Objective

Review the source file specified by the `file_path` input parameter for
code quality, consistency, and adherence to minih's coding conventions.

## Setup

```bash
cd {{REPO_ROOT}}
```

## Tasks

### 1. Read the File

Read the file at the specified `file_path`. If the file doesn't exist,
set `fileFound` to false and report the error. Skip remaining tasks.

### 2. Understand Context

Determine which domain the file belongs to:
- `src/adapter/` → adapter domain (SDK wrapper, event translation)
- `src/runner/` → runner domain (orchestration, validation, discovery)
- `src/cli/` → cli domain (commands, output envelope)
- `test/` → test code (should mirror src/ structure)

Read the domain's documentation if it exists:
```bash
cat docs/domains/adapter/domain.md 2>/dev/null
cat docs/domains/runner/domain.md 2>/dev/null
cat docs/domains/cli/domain.md 2>/dev/null
```

### 3. Review Code Quality

Assess the file for:

**Structure & Organization**
- Is the file well-organized with clear sections?
- Are functions/classes appropriately sized?
- Is there unnecessary complexity?

**Type Safety**
- Are TypeScript types used effectively?
- Any `any` types that should be specific?
- Are return types explicit where helpful?

**Error Handling**
- Are errors caught and handled appropriately?
- Are error messages actionable?
- Any unhandled edge cases?

**Import Hygiene**
- Does the file only import from allowed domains?
  (cli → runner → adapter, never upward)
- Are imports from barrel files (index.ts) when crossing domains?

**Conventions**
- ESM imports with `.js` extension?
- Single quotes (Biome convention)?
- Meaningful variable names?

### 4. Identify Issues

Categorize findings as:
- **critical** — bugs, security issues, missing error handling
- **warning** — code smells, potential issues, tech debt
- **suggestion** — style improvements, better patterns
- **praise** — well-done aspects worth highlighting

### 5. Report

Write a structured report as JSON to the output hint path.
