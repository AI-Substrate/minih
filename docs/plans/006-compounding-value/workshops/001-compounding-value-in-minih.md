# Workshop: Compounding Value in minih

**Type**: Integration Pattern / Data Model / Philosophy
**Plan**: 006-compounding-value
**Source**: Velocity Experiment Write-up (April 2026)
**Created**: 2026-04-14
**Status**: Draft

**Related Documents**:
- [Velocity Experiment Write-up](../../../scratch/paste/20260414T035726.md) — the source material
- [AGENTS_README.md](../../../AGENTS_README.md) — current philosophy section
- [agents/_shared/preamble.md](../../../agents/_shared/preamble.md) — agent-facing instructions
- [src/schemas/retrospective.json](../../../src/schemas/retrospective.json) — current retro schema

---

## Purpose

The velocity experiment proved that harness investment compounds — 16 hours → 15 minutes (64×) across 5 iterations. minih already has the core feedback loop (magic wand → fix → verify), but it doesn't yet **measure or surface** the compounding effect. This workshop designs how to incorporate the experiment's key concepts into minih so that users can see, feel, and leverage the compound curve in their own projects.

## Key Questions Addressed

1. Where does the "difficulty ledger" concept land — new schema field, standalone artifact, or enriched retrospective?
2. How should minih surface velocity trends (run-over-run improvement)?
3. Should the retrospective schema grow to capture the four measurement axes?
4. How should the "agents don't adapt" and "encode don't document" philosophy be woven into docs?
5. What changes to the preamble would make agents better reporters of compounding value?
6. What's the right granularity — per-agent, per-project, or both?

---

## Concept 1: The Difficulty Ledger

### What the experiment did

Every difficulty encountered got a structured entry:

| ID | Category | Description | Mitigation | Status |
|----|----------|-------------|------------|--------|
| MH-01 | build | C# destructor crash in DEBUG builds | Harness patches on build | ✅ Mitigated |
| MH-02 | data | Fresh DB missing audit columns | Seed command auto-applies | ✅ Mitigated |
| MH-03 | test | 32-bit test runner can't load 64-bit DLLs | Harness wraps correct runner | ✅ Mitigated |

Categories (suggested, not enforced — agents can use their own): `build`, `config`, `data`, `test`, `debug`, `knowledge`

The ledger itself became one of the most valuable artifacts — a structured record of everything that's hard about a codebase.

### How this could land in minih

**Option A: Difficulty as a retrospective field** (lowest friction)

Add an optional `difficulties` array to the retrospective schema:

```json
{
  "retrospective": {
    "workedWell": "...",
    "confusing": "...",
    "magicWand": "...",
    "difficulties": [
      {
        "category": "build",
        "description": "npm install fails silently when copilot-sdk peer dep is missing",
        "workaround": "Manually ran npm install @github/copilot-sdk first",
        "severity": "blocking"
      }
    ]
  }
}
```

Pro: Zero new infrastructure. Agents already produce retrospectives.
Con: Difficulties are scattered across run outputs. No single ledger view.

**Option B: Auto-aggregated difficulty ledger** (medium effort)

minih reads `difficulties` from every run output and maintains a project-level ledger file:

```
agents/_shared/difficulty-ledger.md    # Or .json
```

A new command — `minih difficulties` — aggregates across all agent runs:

```bash
$ minih difficulties
Difficulty Ledger (12 entries, 8 mitigated)

  ID    Category  Description                              Status
  MH-01  build     copilot-sdk peer dep not auto-resolved   ✅ mitigated (v0.1.3)
  MH-02  config    .env file not loaded automatically       ⚠️ partial
  MH-03  knowledge No docs on how resume works              ❌ open
```

Pro: Single view of all friction. Trackable over time.
Con: New command, new file, aggregation logic.

**Option C: Difficulties in the preamble** (highest leverage)

Like the evidence table already in the preamble, add a "Known Difficulties" section that agents read on startup. Agents see what's already known, don't re-report it, and can confirm mitigations work:

```markdown
## Known Difficulties

| ID | Category | Description | Status |
|----|----------|-------------|--------|
| MH-01 | build | copilot-sdk peer dep resolution via npx | ✅ mitigated (createRequire fallback) |
| MH-02 | config | MCP server cwd defaults to run folder | ✅ mitigated (runner injects project root) |

If you encounter a NEW difficulty not listed here, report it in your retrospective.difficulties array.
If a "mitigated" difficulty still affects you, report that too — the mitigation may be incomplete.
```

Pro: Agents become aware of known issues. Closes the loop — agents verify mitigations.
Con: Manual curation of preamble (but that's already the pattern with the evidence table).

### **Recommendation: A + B + C** — All three layers, each serving a different audience:

- **A (schema field)** — agents report difficulties as structured data in their retrospective. This is the input pipeline.
- **B (aggregation command)** — `minih difficulties` reads across all run outputs and produces a unified view. This is the human dashboard — you see every friction point across all agents, sorted by frequency and status. Without aggregation, difficulties are scattered across hundreds of `report.json` files and nobody ever reads them.
- **C (preamble curation)** — known/mitigated difficulties go into the preamble so agents are aware on startup. This is the output — the curated, resolved entries that close the loop.

The flow: Agents report (A) → humans review aggregated view (B) → resolved items get curated into preamble (C) → future agents read them and either confirm mitigations work or report regressions.

---

## Concept 2: Velocity Tracking

### What the experiment measured

```
Iteration 1:  ~16 hours
Iteration 2:  ~6 hours
Iteration 3:  ~3 hours
Iteration 4:  ~30 minutes
Iteration 5:  ~15 minutes
```

The declining curve IS the proof that harness investment compounds.

### What minih already captures

`completed.json` in each run folder already contains:
- `durationMs` — how long the run took
- `result` — completed/degraded/failed
- `validated` — true/false
- `toolCallCount` (in events.ndjson stats)

`minih history <slug>` already shows a table with Duration column.

### What's missing

The history command shows absolute durations, but doesn't surface the **trend**. You can't see "this agent is getting faster over time" or "something regressed."

### Design: Velocity annotations in history

**Minimum viable**: Add a trend indicator to `minih history` output:

```
Run History: code-review (8 runs)

  Run ID                          Result     Duration  Trend    Validated
  2026-04-14T10-41-12-887Z-9816   completed  2m 14s    ▼ 23%   ✓
  2026-04-13T15-22-05-123Z-4421   completed  2m 52s    ▼ 11%   ✓
  2026-04-12T09-15-33-456Z-7788   completed  3m 12s    ▲ 5%    ✓
  2026-04-11T14-08-41-789Z-2345   completed  3m 03s    ▼ 40%   ✓
  2026-04-10T11-30-22-012Z-6677   completed  5m 05s    —        ✓
```

The trend column compares to the previous run. Over time this tells a story.

**Nice-to-have**: A summary line at the bottom:

```
  Velocity: 5m 05s → 2m 14s over 8 runs (56% faster)
```

### Implementation notes

- Only compare completed↔completed runs (skip failed/degraded)
- Trend = `(prevDuration - currentDuration) / prevDuration * 100`
- First run shows `—` (no baseline)
- Green ▼ = faster, Red ▲ = slower, Grey `—` = first run or within 5% (noise)

### **Recommendation**: Add trend column to `minih history`. Low effort, high insight. The velocity summary line is a nice-to-have.

### Velocity data as stored per-agent data

Beyond the display in `minih history`, velocity data should be stored in `completed.json` so that calling agents can read it and report on trends. This turns velocity from a human-readable table into **machine-readable data** that agents can use to feed work items.

When writing `completed.json`, the runner should compute and store:

```json
{
  "runId": "2026-04-14T10-41-12-887Z-9816",
  "durationMs": 134200,
  "result": "completed",
  "validated": true,
  "velocity": {
    "previousDurationMs": 172300,
    "changePercent": -22.1,
    "runNumber": 8,
    "firstDurationMs": 305000,
    "overallChangePercent": -56.0
  }
}
```

New `velocity` block (per-agent, computed at run end):
- **`previousDurationMs`** — duration of the last completed run (null if first run)
- **`changePercent`** — % change vs previous run (negative = faster)
- **`runNumber`** — which completed run this is (1-indexed)
- **`firstDurationMs`** — duration of the first ever completed run
- **`overallChangePercent`** — % change from first to current (the big number)

This means any agent — a feedback-digest, a CI reporter, a dashboard agent — can read `completed.json` from any agent's last run and get velocity data without computing it themselves. Agents can flag regressions ("code-review got 40% slower — investigate"), surface wins ("smoke-test down from 5min to 2min over 8 runs"), or feed work items ("velocity plateaued — check difficulty ledger for unresolved MH- entries").

### Implementation notes

- Only compare completed↔completed runs (skip failed/degraded)
- Trend = `(prevDuration - currentDuration) / prevDuration * 100`
- First run shows `—` (no baseline), velocity block has nulls for previous
- Green ▼ = faster, Red ▲ = slower, Grey `—` = first run or within 5% (noise)
- `velocity` block is written by the runner at run completion, same time as the rest of `completed.json`

---

## Concept 3: The Three Measurement Axes

### What the experiment measured (adapted — value axis dropped)

| Axis | Question | Maps to minih |
|------|----------|---------------|
| **Difficulty** | How hard is the platform for agents? | `confusing` + `difficulties` |
| **Mitigation** | What tooling reduces difficulty? | `workedWell` + evidence table |
| **Velocity** | How much faster each iteration? | `velocity` block in `completed.json` |

The experiment also tracked a "value axis" (how good is the information). We're dropping that — it's inherently qualitative and the summary field already captures it. Three axes that can be measured beat four where one is hand-wavy.

### **Recommendation**: Reference the three axes in AGENTS_README as a framing device. They map cleanly to existing + proposed schema fields. No additional schema needed — difficulty, mitigation, and velocity are already captured.

---

## Concept 4: Philosophy Enrichment

### What the experiment articulated that minih's docs don't yet say

The experiment write-up has several powerful framings that should be woven into AGENTS_README and the preamble:

#### 4a. "Every task must send a gift to its future self"

This is the most concise statement of the compounding value principle. Currently, AGENTS_README says "The Feedback Loop" and "The Compound Effect" — but it doesn't use this language. It should.

**Where**: AGENTS_README § Philosophy, near the feedback loop diagram.

```markdown
### The Core Principle

> **Every task must send a gift to its future self.**

If you hit a problem, don't just solve it — encode the solution. The agent that runs 
tomorrow should never hit the same problem you hit today. This is the core mechanism 
behind the velocity curve.
```

#### 4b. "Agents don't adapt — that's the feature"

Already partially in AGENTS_README (line 40-41), but could be stronger. The experiment write-up nails it:

> "Humans learn workarounds and stop noticing friction. An agent reports the same problem fresh every single run, until you fix it."

This deserves more prominence — it's the single most compelling argument for agent-driven improvement.

**Where**: AGENTS_README § "Why the Magic Wand Works" — elevate this point.

#### 4c. "Encode, don't document"

The distinction between "build scripts" (everyone has those) and "executable knowledge" (the harness tests things, not tells you how to test them). minih's preamble already does this with the evidence table, but the AGENTS_README doesn't articulate the principle.

**Where**: AGENTS_README new tip or philosophy subsection.

```markdown
### Encode, Don't Document

The harness doesn't *tell you* how to test things. It *tests things*. There's a 
difference.

A wiki page that says "to validate audit provenance, create an invoice and check the 
database" is documentation. It rots. A command that creates an invoice, checks the 
database, and reports pass/fail is *encoded knowledge*. It runs forever.

When your agents discover how something works — encode it. Make it a command, a recipe, 
a pre-flight check. Make it so the next agent (or human) never has to rediscover it.
```

#### 4d. "The harness is the product"

Already the section title in AGENTS_README. But the experiment write-up adds a powerful frame: "the harness gives us the ability to stand up the platform locally in minutes... The broader approach — parallel research agents, structured experiments — that's the engineering system we built *around* the harness."

minih IS that harness layer. The AGENTS_README should make this explicit.

#### 4e. "Democratising the codebase"

> "It's not giving everyone commit access. It's giving everyone the *ability to understand* — to explore, to experiment, to ask 'what if?' and get a real answer, fast."

This is a motivation section that AGENTS_README doesn't have. It could be a brief "Why This Matters" opener or sidebar.

### **Recommendation**: Weave 4a, 4b, 4c into existing AGENTS_README sections. 4d is already there. 4e could be a brief addition to the intro or a sidebar. Don't bloat the doc — surgical insertions.

---

## Concept 5: Preamble Enhancements

### Current preamble structure

1. Environment Variables
2. Feedback — The Self-Improving Loop (two-layer feedback)
3. Evidence — Feedback That Was Acted On
4. Filing Issues — Close the Loop Faster

### Proposed additions

#### 5a. Known Difficulties section (from Concept 1)

After the Evidence table, add:

```markdown
## Known Difficulties — What's Hard About This Project

| ID | Category | What Hurts | Status |
|----|----------|-----------|--------|
| MH-01 | config | copilot-sdk peer dep not auto-resolved via npx | ✅ mitigated |
| MH-02 | config | MCP server cwd defaults to run folder | ✅ mitigated |

**If you hit a difficulty NOT listed here**, add it to your `retrospective.difficulties`.
**If a "mitigated" difficulty still affects you**, report that — the mitigation may be incomplete.
```

**Note**: This is project-specific. The preamble lives in `agents/_shared/preamble.md` which is per-project. minih's own preamble documents minih's own difficulties. A user's project preamble documents their project's difficulties. This is the right granularity.

#### 5b. "Gift to your future self" framing

Add one line to the feedback section:

```markdown
> **Every task must send a gift to its future self.** Your retrospective IS that gift.
```

#### 5c. Difficulty category guidance

Suggest categories but don't enforce them — agents know their domain better than we do:

```markdown
When reporting difficulties, here are some common categories — but use whatever fits:
- **build**: compilation, bundling, dependency resolution
- **config**: environment setup, credentials, env vars
- **data**: test data, seeding, database state
- **test**: test execution, assertion, validation
- **debug**: observability, logging, error messages
- **knowledge**: missing docs, tribal knowledge, unclear architecture

Use your own category if none of these fit (e.g., "permissions", "networking", "perf").
```

### **Recommendation**: Add 5a (known difficulties) and 5b (gift framing). ~~Skip 5c~~ → Include 5c but as guidance, not enforcement. The suggested categories give agents a starting vocabulary without constraining them. New categories that emerge from agent runs become signal about what kinds of friction the project actually has.

---

## Concept 6: Retrospective Schema Evolution

### Current schema

```json
{
  "workedWell": "string (min 10)",
  "confusing": "string (min 10)",
  "magicWand": "string (min 20)",
  "improvementSuggestions": ["string[]", "optional, 1-5 items"]
}
```

### Proposed evolution

```json
{
  "workedWell": "string (min 10)",
  "confusing": "string (min 10)",
  "magicWand": "string (min 20)",
  "magicWandTarget": "enum: project | minih",
  "improvementSuggestions": ["string[]", "optional, 1-5 items"],
  "difficulties": [
    {
      "category": "string (suggested: build, config, data, test, debug, knowledge — but agents can use their own)",
      "description": "string",
      "workaround": "string | null",
      "severity": "enum: blocking | degrading | annoying"
    }
  ]
}
```

New fields:
1. **`magicWandTarget`** — Makes the two-layer feedback explicit in schema (currently just in prose). `project` or `minih`.
2. **`difficulties`** — Structured friction reporting. Optional array.

Both are **optional** (not required) — existing agents don't break.

### Migration path

- Add fields to `retrospective.json` schema as optional
- Update `system-output.json` to match
- Update preamble and SYSTEM_OUTPUT_INSTRUCTIONS to explain new fields
- Update agents' inlined retrospective schemas (code-review, convention-check, first-time-experience)

### **Recommendation**: Add `magicWandTarget` and `difficulties` as optional fields. Both earn their keep — target disambiguates feedback routing, difficulties enables the ledger concept.

### Where difficulties get prompted

The schema captures the data, but agents need to be **told** about difficulties in three places:

#### 1. SYSTEM_OUTPUT_INSTRUCTIONS (runner.ts) — the runtime instruction

This is what the agent actually sees during execution. Add difficulties to the JSON example and explain what makes a good difficulty report:

```json
{
  "summary": "...",
  "retrospective": {
    "workedWell": "...",
    "confusing": "...",
    "magicWand": "...",
    "magicWandTarget": "project",
    "difficulties": [
      {
        "category": "config",
        "description": "GH_TOKEN not set, no actionable error — just a cryptic 401",
        "workaround": "Guessed from SDK source that GH_TOKEN was needed",
        "severity": "blocking"
      }
    ]
  }
}
```

Add instruction text:

```
If you hit friction during this run — something that slowed you down, confused you, or
required a workaround — report it in retrospective.difficulties. Each difficulty needs:
- category: what kind of friction (e.g., build, config, data, test, debug, knowledge — or your own)
- description: what happened, specifically
- workaround: what you did to get past it (or null if you couldn't)
- severity: blocking (couldn't proceed), degrading (worked around it), or annoying (minor friction)

These reports feed the difficulty ledger. The ones you report today get fixed for tomorrow.
```

#### 2. Preamble (agents/_shared/preamble.md) — the onboarding context

The preamble already has the evidence table showing shipped magic wands. Add the known difficulties table (Concept 5a) and a one-liner connecting difficulties to the compounding loop:

```markdown
## Reporting Difficulties

If something slows you down, report it in `retrospective.difficulties`. Common categories:
build, config, data, test, debug, knowledge — but use whatever fits.

> **Every difficulty you report is a gift to the next agent.** The difficulty ledger
> tracks friction across all runs. What you report today gets mitigated tomorrow.
```

#### 3. AGENTS_README — the human documentation

Add a new subsection under Philosophy explaining the difficulty ledger concept, the A→B→C pipeline, and how `minih difficulties` works. This is for the human building agents, not the agent itself. Include:

- What the difficulty ledger is and why it matters
- How agents report difficulties (schema field)
- How humans review them (`minih difficulties`)
- How resolved difficulties flow back to agents (preamble curation)
- The "friction compounds in the wrong direction" framing from the experiment

```markdown
### The Difficulty Ledger

Friction compounds — in the wrong direction. Every unresolved difficulty costs the next
agent hours. The difficulty ledger tracks what's hard and what's been fixed.

**The pipeline:**
1. Agents report difficulties in `retrospective.difficulties` (structured: category, description, workaround, severity)
2. You review them with `minih difficulties` — a single view across all agent runs
3. You fix the worst ones and add them to the preamble's Known Difficulties table
4. Future agents read the preamble, see what's known, and confirm mitigations work

The categories are suggested, not enforced — agents use `build`, `config`, `data`,
`test`, `debug`, `knowledge`, or whatever fits. New categories that emerge from runs
are signal about what kinds of friction your project actually has.
```

---

## Concept 7: The Maturity Curve as a Teaching Tool

### The insight

Magic wands follow a predictable maturity progression:

```
Week 1:  "I can't do X"              → Missing capabilities
Week 2:  "I can, but it's awkward"   → Convenience gaps  
Week 4:  "Edge case Y breaks"        → Polish & robustness
Week 8:  "Auto-detect regressions"   → Strategic improvements
```

### Where this belongs

**AGENTS_README** already has "The Compound Effect" section with this exact progression (lines 48-54). It's good but could reference this as "The Maturity Curve" — a named concept that harness owners can use to assess where they are.

**Preamble** could reference it briefly:

```markdown
As the harness matures, your magic wands should evolve from "missing capabilities" to 
"edge cases" to "strategic improvements." If you're still reporting missing basics after 
many runs, something is wrong — flag it.
```

### **Recommendation**: Name it explicitly in AGENTS_README as "The Maturity Curve." Add a one-liner to the preamble. This is a teaching moment, not a feature.

---

## Summary: What to Build

### Tier 1 — Philosophy & Docs (do now, zero code changes)

| Change | File | Effort |
|--------|------|--------|
| "Every task sends a gift to its future self" | AGENTS_README | 5 min |
| "Encode, don't document" subsection | AGENTS_README | 10 min |
| Name "The Maturity Curve" | AGENTS_README | 5 min |
| Known Difficulties section | preamble.md | 10 min |
| "Gift to future self" one-liner | preamble.md | 2 min |
| Maturity curve hint | preamble.md | 2 min |

### Tier 2 — Schema & Data Model (do next, small code changes)

| Change | File | Effort |
|--------|------|--------|
| Add `magicWandTarget` to retro schema | retrospective.json, system-output.json | 15 min |
| Add `difficulties` array to retro schema | retrospective.json, system-output.json | 20 min |
| Store `velocity` block in completed.json | runner.ts | 30 min |
| Update SYSTEM_OUTPUT_INSTRUCTIONS | runner.ts | 10 min |
| Update inlined schemas in agents | 3 agent output-schema.json files | 15 min |
| `minih difficulties` aggregation command | new command file | 1-2 hrs |

### Tier 3 — Velocity Display (do later, uses stored data)

| Change | File | Effort |
|--------|------|--------|
| Trend column in `minih history` (reads velocity block) | history.ts | 30 min |
| Velocity summary line | history.ts | 15 min |

### Tier 4 — Aspirational (park for later)

| Change | Why later |
|--------|-----------|
| Four-axis measurement dashboard | Over-engineering for current scale |
| Magic wand maturity auto-classification | ML territory — not worth it yet |

---

## Open Questions

### Q1: Should difficulties be per-agent or per-project?

**RESOLVED**: Per-project. Difficulties are about the codebase/harness, not individual agents. The preamble (per-project) is the right home for known difficulties. Agent retrospectives report new ones.

### Q2: Should velocity tracking compare same-agent runs only?

**RESOLVED**: Yes. Cross-agent comparison is meaningless (different tasks, different complexity). Velocity trends are per-slug.

### Q3: Should the measurement axes become schema fields?

**RESOLVED**: Three axes (difficulty, mitigation, velocity) — value axis dropped. Difficulty maps to `confusing` + `difficulties`. Mitigation maps to `workedWell`. Velocity is stored per-agent in `completed.json` as a `velocity` block computed by the runner. No value axis — it's qualitative and the summary field covers it.

### Q4: Should the article's "difficulty ledger" IDs be auto-generated?

**RESOLVED**: Auto-generated by `minih difficulties` command. IDs use `MH-` prefix (MH-001, MH-002...) assigned on first aggregation. When promoting to the preamble's Known Difficulties table, the auto-generated ID carries over.

### Q5: How does this relate to the harness-is-the-product skill?

**RESOLVED**: Update `harness-is-the-product-v2.md` (at `~/github/tools/agents/v2-commands/`) to reference minih-specific mechanisms — the A→B→C difficulty pipeline, MH- IDs, `minih difficulties` command, `retrospective.difficulties` schema field. The skill already covers the philosophy (difficulty ledgers, velocity compounding, encode-don't-document) but doesn't know about the minih implementation of those concepts. This is a separate repo change (`~/github/tools/`).
