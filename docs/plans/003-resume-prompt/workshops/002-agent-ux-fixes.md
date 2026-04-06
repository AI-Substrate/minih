# Workshop: Agent UX Fixes

**Type**: Integration Pattern
**Plan**: 003-resume-prompt
**Created**: 2026-04-06T08:48:00Z
**Status**: Draft

**Related Documents**:
- FTE agent reports (9/10 and 8.5/10 runs)
- Code-review agent magic wand feedback
- External agent feedback (4 items)
- Workshop 005 (session isolation)

**Domain Context**:
- **Primary Domains**: cli, runner, adapter
- **Related**: all agents consume these improvements

---

## Purpose

Address four concrete UX friction points reported by dogfood agents and external agent feedback. Each fix is independent — they can be implemented in any order.

## Fixes Overview

| # | Fix | Priority | Effort | Domain |
|---|-----|----------|--------|--------|
| F1 | Suppress SQLite ExperimentalWarning | P0 | Trivial | cli |
| F2 | CWD defaults to project root | P1 | Small | runner, adapter, preamble |
| F3 | Tool call elapsed timer | P2 | Small | runner/pretty |
| F4 | Fuzzy property name suggestions in validation | P3 | Medium | runner/validator |

---

## F1: Suppress SQLite ExperimentalWarning

### Problem

Every agent run shows:
```
[CLI subprocess] (node:PID) ExperimentalWarning: SQLite is an experimental feature and might change at any time
```

Both FTE runs flagged this. It's the first thing after the clean banner — undermines the polished feeling.

### Root Cause

The Copilot SDK spawns a Node.js subprocess (`copilot-cli`). That subprocess uses SQLite internally. The subprocess's stderr is piped through the SDK and printed with `[CLI subprocess]` prefix. The subprocess inherits `process.env` from the SDK client.

```
minih CLI → CopilotClient → spawn(node, [copilot-cli, ...], { env: envWithoutNodeDebug })
                                                                    ↑
                                                                    spreads this.options.env
                                                                    which inherits process.env
```

### Fix

Set `NODE_NO_WARNINGS=1` in process.env before creating the CopilotClient. The SDK's subprocess will inherit it, suppressing the ExperimentalWarning.

**Where**: `src/cli/commands/sdk-runtime.ts` — before `new CopilotClient()`

```typescript
// Suppress Node.js ExperimentalWarning in SDK subprocess (SQLite warning)
process.env.NODE_NO_WARNINGS = '1';

const client = new CopilotClient();
```

**Cleanup**: Remove it in the `cleanup()` function:
```typescript
const cleanup = () => {
  process.removeListener('SIGINT', sigintHandler);
  delete process.env.NODE_NO_WARNINGS;
  client.stop().catch(() => {});
};
```

### Edge Cases

- Other warnings we DO want to see? → `NODE_NO_WARNINGS` suppresses ALL warnings. Acceptable — minih's subprocess is a well-known binary. If we want finer control later, use `--redirect-warnings` to a file.
- Affects our own process? → No, minih itself doesn't emit ExperimentalWarnings. The env var only matters for the subprocess.

### Evidence

No unit test needed — this is a subprocess env var. Verify manually: run `minih run hello-world` and confirm no `[CLI subprocess] ExperimentalWarning` in output.

---

## F2: CWD Defaults to Project Root

### Problem

Every agent must `cd $MINIH_PROJECT_ROOT` as its first action because the SDK `workingDirectory` is set to the run folder (for session isolation per Workshop 005). This wastes a tool call on every single run.

### Current Architecture

```
SDK workingDirectory = runDir  →  Agent CWD = agents/slug/runs/timestamp/
Preamble says: "cd {{REPO_ROOT}} before executing commands"
```

**Why it was designed this way**: `copilot --resume` filters by CWD stored in `workspace.yaml`. If CWD = project root, minih sessions pollute the user's resume list.

### Proposed Fix

Keep SDK `workingDirectory` = runDir (session isolation preserved), BUT auto-inject `cd $MINIH_PROJECT_ROOT` as the agent's initial instruction. The preamble already says this — but the agent has to parse it and execute it as a tool call.

**Option A — Preamble auto-cd** (Recommended):
Add to the prompt assembly, just before the agent prompt:

```typescript
// Auto-orient the agent to project root
const autoOrient = `Before starting your task, run: cd ${repoRoot}`;
```

This means the preamble instruction is reinforced, but the agent still needs to execute it. The improvement is making it a clear, standalone instruction rather than buried in the preamble.

**Option B — Frontmatter `cwd: project`**:
Add a `cwd` field to frontmatter. Default: `project`. Alternative: `run`.

```yaml
---
description: My agent
cwd: project    # default — agent starts in project root
---
```

When `cwd: project`, set SDK `workingDirectory` to project root. This breaks session isolation — minih sessions would appear in `copilot --resume`.

**Option C — Dual CWD** (Best of both):
Set SDK `workingDirectory` = runDir (isolation preserved), BUT tell the SDK to `cd` to project root as an initial system instruction. The SDK's `sendAndWait` doesn't support this natively.

### Decision

**Option A** for now. It's the lowest-risk change. The agent still executes the `cd`, but the instruction is more prominent. Revisit if the SDK adds a way to set CWD independently of workingDirectory.

**Update preamble.md** — make the cd instruction the VERY FIRST line, not buried after env var docs:

```markdown
# Agent Preamble

**FIRST**: Run `cd {{REPO_ROOT}}` — your working directory is a run folder, not the project root.

## Environment Variables
...
```

### Edge Cases

- Agent ignores the instruction? → Same as today. No regression.
- Resume runs? → Resume skips preamble (just sends follow-up message). Agent is already oriented from the original run.

---

## F3: Tool Call Elapsed Timer

### Problem

During long tool calls (e.g., `bash` running `doctor --wait` for 60s), pretty mode shows:
```
🔧 bash  minih doctor
```
Then nothing for 60 seconds. No indication of progress.

### Proposed Fix

Add an elapsed timer that updates in place while a tool call is running:

```
🔧 bash  minih doctor  12s...
```

**Implementation** in `src/runner/pretty.ts`:

```typescript
private toolTimers = new Map<string, NodeJS.Timeout>();

private handleToolCall(event) {
  const toolCallId = event.data.toolCallId;
  const startTime = Date.now();
  
  // Start elapsed timer
  const timer = setInterval(() => {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    // Write elapsed in dim text (no newline — stays on same line)
    process.stderr.write(`\r  🔧 ${name}  ${preview}  ${chalk.dim(`${elapsed}s...`)}`);
  }, 5000); // Update every 5 seconds
  
  this.toolTimers.set(toolCallId, timer);
}

private handleToolResult(event) {
  const timer = this.toolTimers.get(event.data.toolCallId);
  if (timer) {
    clearInterval(timer);
    this.toolTimers.delete(event.data.toolCallId);
  }
  // Clear the timer line and show result
  process.stderr.write('\r');
  // ... existing result handling
}
```

### Design Decisions

**Q: How often to update?**
Every 5 seconds. More frequent = visual noise. Less frequent = feels unresponsive.

**Q: Use `\r` (carriage return) for in-place update?**
Yes — but only if the terminal supports it (isTTY). Falls back to no timer on non-TTY. Note: `\r` works fine in tmux.

**Q: What if multiple tools run in parallel?**
Current pretty mode shows tools sequentially (no parallel display). Timer applies to the most recent tool. If parallel tools become a thing, revisit.

**Q: Cleanup on SIGINT?**
Clear all timers in `cleanup()`.

### Edge Cases

- Very short tool calls (< 1s): No timer shown — it resolves before the first 5s tick.
- Pipe/redirect (non-TTY): No timer — carriage return doesn't work.
- Multiple tool calls stacking: Clear previous timer when new tool starts.

---

## F4: Fuzzy Property Name Suggestions in Validation

### Problem

Validation error: `must have required property 'health'` when the agent wrote `healthStatus`. The error is correct but unhelpful — the agent was close but doesn't know how close.

### Proposed Fix

When a required property is missing, scan the actual output keys for near-matches using Levenshtein distance. If a match is found (distance ≤ 3), suggest it:

```
/: must have required property 'health' — did you mean 'healthStatus'?
```

**Implementation** in `src/runner/validator.ts`:

```typescript
function findNearMatch(missing: string, actualKeys: string[]): string | null {
  let bestMatch: string | null = null;
  let bestDistance = 4; // threshold
  
  for (const key of actualKeys) {
    const dist = levenshtein(missing.toLowerCase(), key.toLowerCase());
    if (dist < bestDistance) {
      bestDistance = dist;
      bestMatch = key;
    }
  }
  return bestMatch;
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[m][n];
}
```

**Where to hook it**: In the error formatting after AJV validation:

```typescript
const errors = (validate.errors ?? []).map((e) => {
  const path = e.instancePath || '/';
  let msg = `${path}: ${e.message ?? 'unknown error'}`;
  
  // Add fuzzy suggestion for missing required properties
  if (e.keyword === 'required' && e.params?.missingProperty) {
    const actualKeys = Object.keys(outputData);
    const suggestion = findNearMatch(e.params.missingProperty, actualKeys);
    if (suggestion) {
      msg += ` — did you mean '${suggestion}'?`;
    }
  }
  
  return msg;
});
```

### Design Decisions

**Q: Levenshtein distance threshold?**
≤ 3. Catches: `health` → `healthStatus` (distance 6? too far). Actually substring matching might be better:

```typescript
function findNearMatch(missing: string, actualKeys: string[]): string | null {
  const lower = missing.toLowerCase();
  // Check substring containment first (healthStatus contains health)
  for (const key of actualKeys) {
    if (key.toLowerCase().includes(lower) || lower.includes(key.toLowerCase())) {
      return key;
    }
  }
  // Then Levenshtein for typos (healht → health)
  let bestMatch: string | null = null;
  let bestDistance = 4;
  for (const key of actualKeys) {
    const dist = levenshtein(lower, key.toLowerCase());
    if (dist < bestDistance) {
      bestDistance = dist;
      bestMatch = key;
    }
  }
  return bestMatch;
}
```

This catches both `health` → `healthStatus` (substring) AND `healht` → `health` (typo).

**Q: Add as a dependency (fastest-levenshtein)?**
No — hand-roll the 10-line implementation. Matches the project convention (hand-roll frontmatter parser).

**Q: Apply to system validation too?**
Yes — `summary` → `summray`, `retrospective` → `retroperspective` are plausible agent typos.

### Edge Cases

- No near match: Don't add suggestion — just show the original error.
- Multiple near matches: Show the closest one only.
- Empty output: No keys to match against.

---

## Implementation Order

```
F1 (SQLite warning)      — 1 line change in sdk-runtime.ts
       ↓
F2 (CWD orientation)     — preamble.md rewrite
       ↓
F3 (Tool elapsed timer)  — ~30 LOC in pretty.ts
       ↓
F4 (Fuzzy suggestions)   — ~40 LOC in validator.ts
```

F1-F2 are independent. F3-F4 are independent. All four are independent of each other.

---

## Open Questions

All resolved — decisions inline above.
