---
description: Simulate a brand-new user's first time using minih — create, run, and review an agent via npx.
tags: [dogfood, fte, onboarding]
---

# First-Time Experience Test

You are simulating a brand-new developer who just discovered minih. You have NEVER used it before. Your job is to go through the complete first-time experience and report what worked and what didn't.

## Setup

1. Create a fresh temp directory to work in:
   ```bash
   TESTDIR=$(mktemp -d)
   cd "$TESTDIR"
   mkdir agents
   ```

2. Verify minih is available (it's already installed via npx or npm link — just run `minih --help` to confirm).

## The Journey

### Step 1: Discover what minih can do
- Run `minih --help`
- Try `minih list` (should show no agents yet)
- Try `minih doctor` (should show nothing to check)
- Note: is the help clear? Would a new user understand what to do next?

### Step 2: Create your first agent
- Run `minih init greeting-bot --with-input`
- Look at what was created: `ls -la agents/greeting-bot/`
- Read each file and note if the templates make sense to a newcomer

### Step 3: Customize the agent
- Edit `agents/greeting-bot/prompt.md` to create a simple greeting agent:
  The agent should take a `name` input and produce a personalized greeting with a fun fact.
- Edit `agents/greeting-bot/input-schema.json` to require a `name` string field
- Edit `agents/greeting-bot/output-schema.json` to require `greeting` (string) and `funFact` (string) fields (keep summary + retrospective)
- Run `minih doctor` to validate your setup

### Step 4: Dry-run the agent
- Run `minih run greeting-bot --param name=Jordan --dry-run`
- Check: does the assembled prompt look right?
- Note: is the dry-run output helpful for debugging?

### Step 5: Run the agent for real
- Run `minih run greeting-bot --param name=Jordan --timeout 120`
- Watch the output stream
- Check: `minih last-run greeting-bot` — does it show the run?
- Check: `minih history greeting-bot` — does it show in history?
- Check: `minih validate greeting-bot` — does the output validate?

### Step 6: Try resume and connect
- Run `minih resume greeting-bot "Can you give me a different fun fact about a different topic?"`
- Run `minih connect greeting-bot` — does the command look right?
- Run `minih history greeting-bot` — do you see the resumed run with ↩?

### Step 7: Review the experience
- What was the overall flow like?
- Where did you get stuck or confused?
- What error messages were unhelpful?
- What would you change if you had a magic wand?

## Output

Write your report to $MINIH_OUTPUT_PATH as JSON.
