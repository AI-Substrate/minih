# Fix FX001: Quickstart Command

**Created**: 2026-04-06T06:15:00Z
**Status**: Proposed
**Plan**: [resume-prompt-plan.md](../resume-prompt-plan.md)
**Source**: FTE agent magic wand — "zero-to-success in 60 seconds"
**Domain(s)**: cli (primary), runner (consumed)

---

## Problem

New users must scaffold with `minih init`, then manually edit 3-4 template files, then run — a 5-step, 5-minute process before seeing their first successful agent run. The FTE agent scored the experience 8.5/10 but identified this as the #1 friction point. The "first success moment" is delayed by boilerplate editing.

## Proposed Fix

Add `minih quickstart` — a zero-config command that scaffolds a hello-world agent (if not already present) and immediately runs it. No flags, no editing. One command, one success, under 60 seconds.

## Domain Impact

| Domain | Relationship | What Changes |
|--------|-------------|-------------|
| cli | **modify** | New `quickstart.ts` command, register in `index.ts` |
| runner | consumed (no changes) | Uses existing `resolveAgent()`, `runAgent()` |

## Tasks

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|--------|-----|------|--------|---------|-----------|-------|
| [x] | FX001-1 | Create `quickstart` command | cli | `/Users/jordanknight/substrate/minih/src/cli/commands/quickstart.ts` | `minih quickstart` scaffolds hello-world + runs it with pretty mode | Uses `sdk-runtime.ts`, reuses init's prompt/preamble templates. No flags. 120s timeout. |
| [x] | FX001-2 | Register command + help text | cli | `/Users/jordanknight/substrate/minih/src/cli/index.ts` | `minih --help` shows quickstart, `minih quickstart --help` shows examples | Register before other commands so it's near the top |
| [x] | FX001-3 | Handle edge cases | cli | `/Users/jordanknight/substrate/minih/src/cli/commands/quickstart.ts` | hello-world exists → skip scaffold, run. GH_TOKEN missing → scaffold, actionable error. Non-TTY → JSON only. | Per workshop decisions Q2, Q3 |
| [x] | FX001-4 | Add celebration + next steps | cli | `/Users/jordanknight/substrate/minih/src/cli/commands/quickstart.ts` | After successful run, print: what happened (4 steps), next commands (init, history, resume), docs link | Under 10 lines of guidance per workshop Q5 |
| [x] | FX001-5 | Update README + AGENTS_README | docs | `/Users/jordanknight/substrate/minih/README.md`, `/Users/jordanknight/substrate/minih/AGENTS_README.md` | Quick Start section leads with `minih quickstart` | Per workshop Q8 option A |
| [x] | FX001-6 | Update domain docs | docs | `/Users/jordanknight/substrate/minih/docs/domains/cli/domain.md`, `/Users/jordanknight/substrate/minih/docs/domains/registry.md` | quickstart in composition table and history | |

## DYK Insights Applied

| # | Insight | Decision | Impact |
|---|---------|----------|--------|
| 1 | `createSdkRuntime()` exits on missing GH_TOKEN before scaffold can happen | Scaffold FIRST, check GH_TOKEN manually, only call `createSdkRuntime()` when auth available | FX001-1, FX001-3 |
| 2 | init.ts has prompt/preamble templates — quickstart will duplicate and drift | Extract scaffold helpers from `init.ts`, quickstart calls them with hello-world prompt | FX001-1 |
| 3 | Hello-world `{{REPO_ROOT}}` in empty dir = underwhelming first run | Add hint in celebration: "Run from a project with source code for a richer experience" | FX001-4 |
| 4 | Commander sorts by registration order — quickstart should be FIRST | Register `quickstart` before all other commands in `index.ts` | FX001-2 |
| 5 | Envelope needs to express scaffold + run as two phases | Single `command: 'quickstart'` envelope with `scaffolded`, `files`, and run data. Scaffold-only (no auth) = `result: null` | FX001-1, FX001-3 |

## Workshops Consumed

- [001-quickstart-experience.md](../workshops/001-quickstart-experience.md) — design decisions Q1-Q9

## Acceptance

- [ ] `minih quickstart` from a fresh dir (no agents/) scaffolds hello-world + preamble, runs the agent, prints celebration
- [ ] Second `minih quickstart` skips scaffold, runs existing hello-world
- [ ] Missing GH_TOKEN → scaffolds agent, prints actionable auth error
- [ ] Non-TTY → JSON envelope only, no celebration
- [ ] `minih quickstart --help` shows description and example
- [ ] README Quick Start section leads with quickstart

## Discoveries & Learnings

_Populated during implementation._

| Date | Task | Type | Discovery | Resolution |
|------|------|------|-----------|------------|
