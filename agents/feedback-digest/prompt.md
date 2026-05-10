---
description: "Aggregate magic wand feedback from all agents' recent runs into a prioritized improvement digest"
tags: [feedback, meta, roadmap]
permissions: read-only
---

# Feedback Digest

## Objective

Read the magic wand feedback from all minih agents' recent runs and produce
a prioritized improvement digest. This is how minih improves itself.

## Setup

```bash
cd {{REPO_ROOT}}
```

## Tasks

### 1. Discover All Agents

```bash
npx minih list 2>/dev/null
```

Get the list of all agent slugs.

### 2. Read Recent Feedback

For each agent slug, find the most recent runs:

```bash
npx minih history <slug> 2>/dev/null
```

For each recent run, read the output file:
```bash
cat agents/<slug>/runs/<runId>/output/report.json 2>/dev/null
```

Extract from each output:
- `.retrospective.magicWand`
- `.retrospective.confusing`
- `.retrospective.workedWell`
- `.retrospective.improvementSuggestions` (if present)

If an agent has no runs or no output, note that and move on.

### 3. Analyze Themes

Group feedback into themes:
- **CLI usability** — command ergonomics, flag confusion, output format
- **Convention clarity** — what rules are unclear or hard to follow
- **Error messages** — unhelpful errors, missing context
- **Missing features** — things agents wish existed
- **Documentation gaps** — information that was hard to find
- **Prompt/schema issues** — problems with the agent authoring experience

### 4. Prioritize

Rank themes by:
- **Frequency**: how many agents/runs mention it
- **Impact**: how much it affects the workflow
- **Feasibility**: how easy it would be to fix

### 5. Produce Digest

Write a prioritized list of improvements with:
- Theme name and description
- Supporting quotes from agent feedback
- Frequency count
- Suggested fix or investigation

### 6. Report

Write the full digest as JSON to the output hint path.
