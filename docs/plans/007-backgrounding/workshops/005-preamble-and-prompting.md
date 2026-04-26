# Workshop: Preamble & SYSTEM_OUTPUT_INSTRUCTIONS Additions

**Type**: Other (Prompting)
**Plan**: 007-backgrounding
**Spec**: [coordination-spec.md](../coordination-spec.md)
**Created**: 2026-04-26
**Status**: Draft

**Related Documents**:
- [external-research/agent-harness-survey.md](../external-research/agent-harness-survey.md) — AutoGen/LangGraph evidence that prompt instruction is the only reliable nudge for agent behavior absent push semantics
- [003-mcp-tool-surface.md](003-mcp-tool-surface.md) — defines the tools agents must learn about
- [002-state-machine.md](002-state-machine.md) — defines the rules agents must learn to navigate
- [research-dossier.md](../research-dossier.md) — PS-02, PS-09, PL-12 (preamble as knowledge vector; difficulty pipeline; env-var documentation precedent)

**Domain Context**:
- **Primary Domain**: `runner` (owns preamble template, SYSTEM_OUTPUT_INSTRUCTIONS constant, frontmatter parser)
- **Related Domains**: `cli` (frontmatter additions surface in `init` scaffolding); `mcp` (the server is opt-in via the same frontmatter toggle)

---

## Purpose

Decide what minih *says* to agents about coordination. Inbox/state are useless if agents don't know to use them. Preamble + SYSTEM_OUTPUT_INSTRUCTIONS are the only places minih addresses every agent — but every byte added is paid by every run forever. **Minimum viable additions; opt-in by default; observable feedback loop via the difficulty ledger.**

## Key Questions Addressed

- What's the minimum viable preamble addition?
- Is the inbox-check a pre-completion checklist item, or a per-step nudge?
- Opt-in or opt-out per agent?
- How do we A/B test prompt changes without A/B infrastructure?
- How do we teach agents the typed error model for `state.transition` rejections?

## Resolved Open Questions From Spec

- **Frontmatter additions** → **RESOLVED**: opt-in via `coordination: enabled` (or richer `coordination: { enabled: true, ... }` for per-agent transition rules per workshop 002). When disabled or absent, no MCP server spawned, no preamble additions, no SYSTEM_OUTPUT_INSTRUCTIONS additions. Backward compatible with every existing agent.

---

## Design Principles

1. **Opt-in via frontmatter, not opt-out**: every existing agent stays bit-for-bit identical until its author flips the toggle. Conservative roll-out.
2. **Conditional template substitution**: when `coordination: enabled`, inject coordination sections into preamble + system instructions. When disabled, those sections are absent.
3. **Section-shaped, not paragraph-padded**: discoverable headers (`## Coordination`, `### Inbox`, `### State`) so agents can grep their own preamble.
4. **Concrete > abstract**: show example tool calls; don't describe semantics in prose.
5. **Pre-completion checklist > per-step nudge**: per research, agents reliably ignore "every N steps" instructions. A pre-completion checklist (run once, before declaring done) is reliable.
6. **Surface the typed error model**: the `GATED` vs `INVALID` distinction must be in the prompt; otherwise agents respond unhelpfully when transitions are rejected.
7. **Feedback loop**: any pain → `retrospective.difficulties` → preamble curation. Same compounding-value pipeline as everything else.

---

## Frontmatter Schema

Standard frontmatter today (see `runner/folder.ts:43-100`):

```yaml
---
description: required string
tags: optional array
model: optional string
reasoning: optional string
timeout: optional number
---
```

**New (this workshop):**

```yaml
---
description: ...
coordination:
  enabled: true                  # opt-in; default false
  outside:                       # optional; if omitted, defaults from workshop 002
    statuses: [...]
    transitions: [...]
  inside:                        # optional; if omitted, defaults from workshop 002
    statuses: [...]
    transitions: [...]
---
```

Shorthand for "yes with defaults":

```yaml
coordination: enabled
```

(Resolves to `{ enabled: true }`.)

### Frontmatter parser changes

`parseFrontmatter` already does shallow YAML. The `coordination` field is either:
- a string `"enabled"` → resolves to `{ enabled: true }`
- a string `"disabled"` → resolves to `{ enabled: false }`
- absent → resolves to `{ enabled: false }`
- an object → parsed as-is, `enabled` defaults to `true` when an object is provided

Validation:
- if `enabled === true` but `outside.transitions` references phases not in `outside.phases` → `minih doctor` error
- if `requiresPeer.phase` references phases not in *peer's* `phases` enum → `minih doctor` error
- (workshop 002 covers the rule-validation logic; doctor surfaces it)

---

## Preamble Additions

### When `coordination.enabled` is false (default)

No additions. Existing preamble unchanged.

### When `coordination.enabled` is true

Append a new top-level section AFTER the existing preamble body. Template substitution at run start writes:

```markdown
---

## Coordination (this agent uses inbox + state)

You can communicate with the *outside* (the human or system that started this run) and read/write *state* via tool calls. The tools live in the `minih-coordination` MCP server and are available in your tools list.

### Tools available

- `inbox.list({ unread?, type?, limit?, after? })` — read messages from outside
- `inbox.send({ type, subject, body, ackOf? })` — send a message to outside
- `inbox.ack({ msgId })` — acknowledge an outside message
- `state.get({ side?, key? })` — read your state, the peer's, or both
- `state.set({ key, value })` — set a non-status field of your `data` object
- `state.transition({ to, reason? })` — change your `status` per the rules

### Your status states

Default inside statuses: `idle` → `in-progress` → (`paused`) → `reviewing` → `complete`.
Plus terminal `error` from any non-terminal state.

**The gate**: `reviewing` → `complete` is gated on the outside being at status `done`. If you call `state.transition({ to: 'complete' })` and outside isn't done, the call returns a typed error (`_meta.code === 'GATED'`). Don't try to force it; either continue work, send an inbox message asking outside to signal done, or exit cleanly.

### How to handle a `GATED` error

```
try {
  await state.transition({ to: 'complete', reason: 'review done' });
} catch (err) {
  if (err._meta?.code === 'GATED') {
    await inbox.send({
      type: 'status',
      subject: 'review done; awaiting your "done" signal',
      body: `My review is finished. When you've completed your work, set state.outside.phase = "done" and re-run me.`
    });
    // Exit cleanly. Do NOT keep trying.
    return;
  }
  throw err;
}
```

### How to handle an `INVALID` error

`INVALID` means there's no transition rule from your current phase to the requested target. Check your current phase via `state.get({ side: 'self', key: 'status' })`. The error's `_meta.details.allowedFromCurrent` lists what you CAN transition to.

---
```

### Word budget

Section above is ~280 words / ~1900 chars. Adds ~5% to a typical preamble. Acceptable given it's opt-in.

---

## SYSTEM_OUTPUT_INSTRUCTIONS Additions

### When `coordination.enabled` is false (default)

No additions.

### When `coordination.enabled` is true

Append a single section to the existing instructions:

```markdown
## Pre-completion checklist (coordination)

Before producing your final `report.json`, do these checks:

1. **Check your inbox**: call `inbox.list({ unread: true })`.
   - If there are unread messages, address each one (typically by writing back via `inbox.send` and then `inbox.ack`-ing each).
   - The act of ignoring an unread message is a coordination failure — note it in `retrospective.difficulties` as a `coordination` category if you cannot address it.

2. **If your status states has a terminal "complete" state, try to reach it**:
   ```
   await state.transition({ to: 'complete', reason: '<one line why you're done>' });
   ```
   - On success: write your report and exit normally.
   - On `GATED` error: send a final inbox message explaining what you finished and that you're waiting for outside's `done` signal. Exit cleanly. Do NOT loop, do NOT retry — your run is over and the next run will resume coordination.
   - On `INVALID` error: this is a bug in your transition logic. Note in `retrospective.difficulties`.

3. **Surface coordination work in your `summary`**: mention messages received/sent and any state transitions. The host caller reads the summary to know what to do next.
```

### Word budget

~190 words / ~1300 chars added when enabled.

---

## Frontmatter Examples

### Default opt-in (uses default status states)

```yaml
---
description: Code reviewer that processes diffs
coordination: enabled
---
```

### Opt-in with custom phases (per workshop 002)

```yaml
---
description: Multi-phase analyzer
coordination:
  enabled: true
  outside:
    statuses: [idle, drafting, requesting-review, done, error]
    transitions:
      - { from: idle, to: drafting }
      - { from: drafting, to: requesting-review }
      - { from: requesting-review, to: done }
  inside:
    statuses: [idle, listening, analyzing, awaiting-finalization, complete, error]
    transitions:
      - { from: idle, to: listening }
      - { from: listening, to: analyzing }
      - { from: analyzing, to: awaiting-finalization }
      - { from: awaiting-finalization, to: complete, requiresPeer: { phase: done } }
---
```

### Opt-out (default)

```yaml
---
description: Single-shot summary generator
---
```

(Or explicit: `coordination: disabled`.)

---

## Why a checklist (and not "every N steps")

Per `external-research/agent-harness-survey.md`, AutoGen learned the hard way: pure-prompt instruction "check the inbox every N steps" is unreliable. Agents forget. The reliable pattern is:

1. **A single pre-completion check**: agents reliably do "before declaring done" steps because they're framed as "things to do once before exit."
2. **Surface the structured surface in tools** so the agent's tool-selection reasoning naturally considers `inbox.list` whenever the prompt mentions coordination.
3. **Future eventing plan adds push** — when MCP server-push notifications land in the SDK, the agent can be interrupted by an inbox arrival without polling at all.

The pre-completion checklist is the v1 pattern. The future eventing plan replaces it.

---

## Surface in `completed.json` and `minih history` (out of scope, deferred)

A future enhancement: after each run, `completed.json` carries:

```jsonc
{
  ...,
  "coordination": {
    "inboxSent": 2,
    "inboxReceived": 1,
    "stateTransitions": [
      { "ts": "...", "from": "in-progress", "to": "reviewing" },
      { "ts": "...", "from": "reviewing", "to": "complete" }
    ],
    "lastInsidePhase": "complete",
    "lastOutsidePhase": "done"
  }
}
```

`minih history` then shows a `Phase` column. Out of scope for v1; design now to make it additive later.

---

## Difficulty Pipeline Integration

When agents struggle with coordination, they report it via `retrospective.difficulties` with `category: 'coordination'`. The existing `minih difficulties` aggregator picks them up. Humans curate fixes back into the preamble:

```markdown
## Known Coordination Difficulties

| ID | Category | Status | Mitigation |
|----|----------|--------|------------|
| MH-COORD-001 | coordination | mitigated | Added clearer error message format |
| MH-COORD-002 | coordination | open | Investigating |
```

Same compounding-value loop as Plan 006. The preamble grows as we learn what trips agents up.

---

## Backwards Compatibility Audit

Every existing agent in `agents/`:

| Agent | `coordination` field present? | Effect |
|-------|------------------------------|--------|
| `code-review` | no | Unchanged behavior; no MCP server spawned; no prompt additions |
| `convention-check` | no | Same |
| `feedback-digest` | no | Same |
| `first-time-experience` | no | Same |
| `hello-world` | no | Same |
| `mcp-smoke-test` | no | Same (smoke-test for Plan 005 MCP consumption, not coordination) |
| `prompt-review` | no | Same |
| `self-review` | no | Same |
| `smoke-test` | no | Same |

No regressions possible by opt-in design.

A new agent for coordination smoke-testing — `agents/coordination-smoke/` (covered in workshop 006) — is the first to opt in. Real users opt in their own agents as they need coordination.

---

## init Command Scaffolding

`minih init <slug>` should default to `coordination: disabled` (or omitted) for backward compatibility. Optionally add a `--coordinated` flag:

```bash
minih init code-reviewer --coordinated
```

Generates `agents/code-reviewer/prompt.md` with `coordination: enabled` in frontmatter and a default coordination-aware prompt body that mentions inbox/state.

---

## Worked Example: A Coordinated Code-Review Agent's Prompt

```markdown
---
description: Reviews source files when outside signals "phase done"
coordination: enabled
---

# Code Reviewer

You review source files for issues. The outside agent (a human or another system) edits files and signals when each phase is ready for review.

## Workflow

1. Check your inbox for unread messages from outside (`inbox.list({ unread: true })`).
2. If outside has sent `{type: 'note', subject: 'phase X done', body: '...'}`, read the body to learn which files to review.
3. Run your review (your normal logic).
4. Send a status message back: `inbox.send({type: 'status', subject: 'review of phase X done', body: '<summary>'})`.
5. If your status states allows, transition: `state.transition({to: 'complete', reason: 'reviewed N files'})`.
6. The pre-completion checklist (in your system instructions) covers the cleanup. Trust it.

## Domain knowledge

[Project-specific review criteria here...]
```

The agent is short because the *coordination machinery* is encoded in the preamble + system instructions, not in this prompt. Each agent's `prompt.md` only owns the domain knowledge.

---

## Open Questions

### Q1: What if the agent prompt itself contradicts the system-output coordination checklist?

**OPEN**: an agent might say in its prompt "skip the inbox check, this is a one-shot." The checklist would conflict.
- **Leaning**: SYSTEM_OUTPUT_INSTRUCTIONS comes AFTER the agent prompt in assembly order. Per minih's existing convention, system instructions override. Document in preamble: "system instructions are minih's contract; honor them even if they conflict with agent prompt."

### Q2: Should we add a `coordination.preCompletionCheck: false` toggle to disable the checklist for agents that opt-in to coordination but don't want pre-completion checks?

**OPEN**: enables agents that use inbox/state but not in a "coordinate-then-complete" pattern.
- **Leaning**: ship with the checklist always on when `coordination.enabled === true`; add a toggle if a real use case surfaces.

### Q3: Should the preamble note appear at the top or the bottom?

**OPEN**: prompt-engineering wisdom says important context goes near the start AND the end (recency bias). Today the preamble is at the very start; SYSTEM_OUTPUT_INSTRUCTIONS at the very end (per `runner.ts:247-265`).
- **Leaning**: preamble Coordination section after existing preamble body but before the divider; SYSTEM_OUTPUT_INSTRUCTIONS pre-completion checklist at the end as designed. Both ends covered.

### Q4: Should we offer a `coordination.silentMode: true` toggle that suppresses preamble additions but keeps the MCP server available?

**OPEN**: for agents whose authors believe their own prompt is sufficient documentation.
- **Leaning**: defer. If preamble bloat becomes a measured pain (via difficulties), add the toggle.

### Q5: Should `inbox.list` results be rendered in a structured way the model finds easier to parse?

**OPEN**: e.g., instead of returning JSON, return a human-readable Markdown bullet list.
- **Leaning**: return JSON (per workshop 003) since modern models parse JSON tool results well. If a measured pain emerges (model misreading messages), add a `format: 'markdown'` parameter then.

### Q6: A/B testing prompt changes?

**OPEN**: no infrastructure today. We could ship the addition behind a `MINIH_COORDINATION_PROMPT_V2` env var to test new wordings without breaking old runs.
- **Leaning**: ship one version; observe via difficulty ledger and `magicWand` reports; iterate based on signal. A/B framework not justified yet.
