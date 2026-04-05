---
description: "Review another agent's prompt.md for clarity, completeness, and minih conventions"
tags: [review, quality, prompts]
---

# Prompt Review

## Objective

Review the agent specified by the `agent_slug` input parameter. Assess its
prompt.md, instructions.md, and schemas for quality and convention compliance.

## Setup

```bash
cd {{REPO_ROOT}}
```

## Tasks

### 1. Locate the Agent

Read the agent's files from the agents directory:
- `agents/{agent_slug}/prompt.md` — the main prompt
- `agents/{agent_slug}/instructions.md` — if present
- `agents/{agent_slug}/output-schema.json` — if present
- `agents/{agent_slug}/input-schema.json` — if present

If the agent doesn't exist, set `agentFound` to false and report the error
in your summary. Skip remaining tasks.

### 2. Review Prompt Quality

Assess the prompt.md for:
- **Clarity**: Is the objective clear? Would an LLM know what to do?
- **Completeness**: Are tasks specific enough? Are edge cases addressed?
- **Frontmatter**: Is description accurate and useful for `minih list`?
- **Output instructions**: Does it reference the output hint and schema?
- **Setup**: Does it include `cd {{REPO_ROOT}}` if needed?
- **Retrospective reminder**: Does the prompt reinforce the magic wand feedback?

### 3. Review Schema Quality

If output-schema.json exists:
- Does it include `summary` (string, minLength 20) as required by system contract?
- Does it include retrospective with `magicWand` required?
- Are descriptions present on properties?
- Does it use appropriate constraints (minLength, enum, etc.)?
- Is `additionalProperties: true` set (so system fields pass)?

If input-schema.json exists:
- Are required params clearly described?
- Would `minih list` show useful param info?

### 4. Review Instructions Quality

If instructions.md exists:
- Does it define a clear persona/identity?
- Are rules specific and actionable?
- Does it complement (not repeat) the prompt?

### 5. Report

Write a structured report as JSON to the output hint path with:
- Whether the agent was found
- Per-aspect scores (1-5) with explanations
- Specific suggestions for improvement
- Overall verdict
