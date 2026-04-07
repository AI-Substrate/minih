# The Self-Improving Harness: Treating Developer Tools as a Product

> **The harness is not infrastructure. It is the product.**

---

## The Insight

Most teams treat their developer tooling as a cost center — something you build once, maintain grudgingly, and replace when it rots. CI pipelines get duct-taped. Test runners get cargo-culted. Dev environments get documented in a wiki nobody reads.

The harness pattern inverts this. **Your developer tools are your most important product**, because every other product you build passes through them. A bad harness makes everything slower. A good harness makes everything faster. A self-improving harness makes everything *accelerate*.

The key insight is simple: **every agent that uses your tools is a user study you didn't have to schedule.**

---

## The Magic Wand

Every agent that runs through the harness must answer one question:

> *If you could change ONE thing about the tools you just used to make your job easier, what would it be?*

This is the `magicWand` field. It's not optional. It's not a nice-to-have. It's the most valuable output of any agent run — more valuable than the test results, the screenshots, or the code review findings.

### Why the Magic Wand Works

**1. It captures friction at the moment of friction.**

Humans adapt. When a command is awkward, a human learns the workaround and stops noticing. Agents don't adapt. Every time `just harness screenshot` fails because CDP is down, the agent reports it. Every time. The same friction, surfaced fresh every run, until you fix it.

**2. It's concrete, not abstract.**

The prompt demands specificity. Not "improve the CLI" but "add a `--viewport mobile` flag to the screenshot command so I don't have to write a Playwright script." Not "better error messages" but "when `wf-status` shows `blocked-error`, include the error message inline instead of making me click through to the properties panel."

**3. It creates a direct feedback→fix→verify loop.**

The agent says "I wish X existed." You build X. The same agent runs again. If it stops wishing for X, the fix worked. If it wishes for something else, you've moved forward. The agent is both the user who requested the feature and the QA that validates it.

### Real Magic Wands That Shipped

These aren't hypothetical. These are actual agent outputs that became actual fixes:

| Agent | Magic Wand | What We Built | Time to Ship |
|-------|-----------|---------------|-------------|
| smoke-test (run 1) | "No `console-logs` command — had to write Playwright from scratch" | `just harness console-logs` with `--filter`, `--url`, `--wait` flags | Same day |
| smoke-test (run 2) | "Screenshot command timed out on SSE pages — `networkidle` never fires" | `--wait-until` flag defaulting to `domcontentloaded` | Same day |
| smoke-test (run 3) | "No single place to see workflow execution history" | `just wf-logs` — unified timeline with auto-diagnostics | Next day |
| code-review | "Had to manually find domain files — a `just harness domains` would help" | Queued as wishlist item | — |
| mobile-ux-audit | "A `just harness mobile-audit <url>` that auto-screenshots at all mobile viewports" | Queued as wishlist item | — |

Notice the pattern: early magic wands are about *missing capabilities* ("I can't do X"). Later ones are about *convenience* ("I can do X but it takes too many steps"). This is exactly how product maturity works — you move from "possible" to "easy" to "delightful."

---

## Treating the Harness as a Product

### It Has Users

Your harness has two user types:

1. **Human developers** who use it to build, test, and verify features
2. **AI agents** who use it to execute tasks autonomously

Both are real users. Both have needs. Both generate feedback. The difference is that agents generate feedback *structurally* (via `magicWand`) while humans generate it *informally* (via Slack complaints or silent workarounds).

The harness pattern makes agent feedback first-class, which — counterintuitively — improves the experience for humans too. When you add `just harness console-logs` because an agent asked for it, humans benefit just as much.

### It Has a Backlog

The **wishlist** is the harness's backlog. It's not a dusty GitHub project board. It's a live document in the repo, updated during the same session where friction is discovered.

```markdown
### W003 — Fire-and-forget --server mode
**Severity**: 🟠 Painful
**Problem**: `cg wf run --server` blocks with a poll loop
**Impact**: Agent hangs waiting for completion instead of moving on
**Fix**: Return immediately after POST, let watcher handle status
```

Each item has severity, problem description, impact, and proposed fix. Items get resolved in the same development arc — not "someday" but "today, while I still remember the context."

### It Has Acceptance Criteria

When you fix a harness issue, the acceptance test is simple: **run the agent that complained, and check if it stops complaining.**

This is the most honest acceptance test possible. You're not asking "does this work?" You're asking "does the actual user — the entity that reported the problem — consider it solved?"

### It Has Versioning

Agent definitions are versioned in the repo. Every run creates a frozen snapshot of the exact prompt, schema, and instructions that were used. You can always answer:
- What did the agent see when it ran?
- Has the prompt changed since then?
- Did a schema change cause a regression?

### It Has Releases

When you improve the harness, you're shipping a product release. The commit message says what changed. The agent re-run proves it works. The retrospective from the re-run shows what to improve next.

---

## The Compound Effect

Here's what happens when you treat the harness as a product over time:

**Week 1**: Agents can boot the app and take screenshots. Retrospectives are full of "I couldn't do X" complaints. You add basic capabilities.

**Week 2**: Agents can run workflows and inspect results. Retrospectives shift from "I can't" to "I can, but it's awkward." You add convenience commands.

**Week 4**: Agents run end-to-end pipelines with minimal friction. Retrospectives focus on edge cases and polish. Your CLI has 30+ recipes that all work.

**Week 8**: New agents spin up and are productive on their first run because the preamble is comprehensive, the CLI is mature, and the evidence capture is reliable. Magic wands are now about *strategic* improvements ("I wish the harness could auto-detect regressions by comparing screenshots across runs").

This is the compound effect. Each improvement makes every future agent run slightly faster, slightly more reliable, slightly more productive. And since agents run *often* — dozens of times per day — the compound effect is dramatic.

---

## The Preamble: Product Documentation for Agent Users

The shared preamble (`agents/_shared/preamble.md`) is the harness's user manual. It's injected into every agent's context before their specific prompt. Think of it as onboarding documentation that every new hire reads on day one.

A good preamble includes:

**1. Orientation** — where am I, what tools are available, how do I get to the repo root?

**2. Gotchas** — the things that will bite you if nobody warns you. `git --no-pager` or commands hang. `networkidle` never fires on SSE pages. Auth tokens need `XDG_CONFIG_HOME` override.

**3. Output discipline** — write JSON to the specified path, don't modify files outside your run folder, don't commit changes.

**4. CLI quick reference** — the 10 commands you'll use most, with examples.

**5. The feedback contract** — you're not just doing a job, you're dogfooding the tools. Your retrospective is required. Your magicWand matters. Previous agents' feedback has already shipped as fixes. Yours will too.

The preamble is itself a product artifact. When agents report confusion about something, you update the preamble. When a gotcha bites three agents in a row, you add it to the gotchas table. The preamble improves the same way the CLI does — through the retrospective loop.

---

## The Anti-Patterns

### "We'll improve the tooling later"

No. The whole point is that improvement is continuous, not deferred. If an agent says "this is confusing" and you file it in a backlog for next quarter, you've broken the loop. Fix it now, or at least this session.

### "Agents don't need good DX"

Agents are more sensitive to bad DX than humans. A human can guess what a cryptic error means. An agent takes it literally, retries the wrong thing three times, and wastes 5 minutes of API tokens. Good DX for agents is good DX for everyone.

### "The harness is just for testing"

The harness is for *closing the loop*. Testing is one thing it does. It also provides evidence, captures feedback, validates assumptions, and improves itself. If you reduce it to "testing," you'll underinvest in evidence capture and feedback loops.

### "One environment is enough"

You need both speed (host) and isolation (container). Forcing everything through Docker slows iteration. Forcing everything on the host loses reproducibility. Two environments with clear rules for when to use each.

### "Output schemas should be strict"

Agents are creative with field names. Your schema says `findings`, the agent writes `auditResults`. Your schema says `topFixes`, the agent writes `recommendations`. If you make schemas strict, every agent run degrades. Enforce the system contract (`summary` + `retrospective`) and let the domain content be flexible.

---

## The Philosophy in One Page

1. **The harness is a product.** It has users (agents + humans), a backlog (wishlist), acceptance tests (re-run the complaining agent), and releases (commits that improve it).

2. **Every agent run is a user study.** The retrospective captures what worked, what didn't, and what should change. This data is more honest than any survey because the agent actually used the tools, not just imagined using them.

3. **The magicWand is the most valuable output.** Not the test results. Not the screenshots. The single concrete improvement suggestion that comes from actual usage friction.

4. **Fixes ship fast.** Same session, not next sprint. The context is fresh. The friction is still felt. The agent is still available to verify the fix.

5. **The preamble is onboarding.** Every new agent starts with comprehensive context. When the context is wrong or incomplete, fix the preamble. It improves every future run.

6. **Two environments, clear rules.** Host for speed, container for proof. One CLI surface for both. No ambiguity about when to use which.

7. **The loop accelerates.** Each improvement makes every future run better. Since agents run often, improvements compound fast. The harness gets better at the rate agents run, not at the rate humans remember to improve it.

---

> *"The harness isn't a testing tool. It's a product improvement engine that happens to test things along the way. Every agent that runs is a user of your developer tools. Every retrospective is a usability study. Every magicWand is a feature request from someone who actually used the thing."*

---

*Companion to [The Harness Pattern Playbook](./harness-pattern-playbook.md), which covers the technical architecture and implementation guide.*
