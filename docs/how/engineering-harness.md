# The engineering harness — how it works and how to use it

minih's **engineering harness** is the session-level feedback loop for *developing minih*, running on **harness-core** (the global `harness` CLI). It answers three questions deterministically: *does the environment work right now?* (boot), *what friction did this session hit?* (observe → retro), and *what should the harness prove next?* (improve). The lean contract lives in [`.harness/engineering-harness.md`](../../.harness/engineering-harness.md); this guide is the deep narrative.

Don't confuse it with the **minih product harness** — the retrospective machinery minih ships to its own users (runner auto-append + `minih harvest`, writing `docs/retros/`). That one is part of the product. This one is for the people and agents building the product. The engineering harness *reads* `docs/retros/` at harvest time and never writes it.

## The loop

**Boot → Backpressure → Observe → Retro → Improve**, then back to Boot. It cycles — it never "completes".

| Beat | What happens | Command |
|------|--------------|---------|
| Boot | Prove the environment runs before touching it | `harness boot --json` |
| Backpressure | Pre-architect: which acceptance criteria can deterministic sensors *prove*, vs. eyeball? | fired by the SDD flow at the post-spec seam |
| Observe | Capture friction the moment it bites — one silent line | `harness observe "<what>" --kind <kind>` |
| Retro | Drain the buffer into a committed record at phase/session end | `harness record retro --slug <plan-slug>` |
| Improve | Encode the fix — a new sensor, verb, or recipe — so the next session starts smarter | `harness new <verb>`, justfile recipes, … |

The SDD pipeline self-fires the loop's seams (`/eng-harness-flow --event …` from the flow skills) — see the governance doc's `## Injection map`. Outside the pipeline, the AGENTS.md block is the cold-start cue.

## Boot: the session-start proof

```bash
harness boot --json
```

A hand-written composite verb (`.harness/extensions/boot/`) that runs five **read-only** sensors in order — lint (`npx biome check .`), typecheck (`npx tsc --noEmit`), build+test (`just check`), `minih doctor` (twice — see below), `npm audit --audit-level=high --json` — and folds them into one envelope: `ok` (all pass) / `degraded` (warnings present — workable with awareness) / `error` (a sensor hard-failed; fix it before feature work). `data.sensors` carries per-sensor outcomes; `data.orientation` re-orients a fresh agent (branch, governance path, the friction command, the commit gate).

Before running or interpreting it, read its briefing:

```bash
harness instructions boot
```

### Degraded is honest

Day one, boot reports **`degraded`** — known `minih doctor` warnings plus a known high/critical advisory chain in the dependency tree. That is the *truthful* state of the tree, with `next_action` naming each caveat. Resist two temptations: treating `degraded` as failure (it exits 0; you can work), and "fixing" boot so it reads `ok` (that's hiding the signal, not improving the system). The verdict improves when the underlying warnings are actually fixed.

### Why `minih doctor` runs twice

`minih doctor` has no `--json` flag (only `--strict`) — observed as friction entry DL-001 during setup. So boot detects warnings deterministically via exit codes: a plain run catches hard errors, a `--strict` run turns warnings into a non-zero exit. No prose scraping, no src change. The follow-up candidate (adding `--json` envelope output to `minih doctor`) is recorded in the governance doc.

### Boot never mutates

Boot's read-only property is part of its contract (proven by byte-identical `git status --porcelain` across a run). The mutating gate — `just fft`, which runs `biome format --write` — belongs at commit time:

```bash
just build   # quick rebuild during iteration (~2s)
just check   # build + test (what boot's sensor 3 runs)
just fft     # full mutating gate — required before every commit/push
```

## Observe → Retro: the friction loop

The harness only compounds if friction gets captured when it's cheap (the moment it happens) and drained somewhere durable (a committed record). Lifecycle:

1. **Capture** (zero ceremony, gitignored):

   ```bash
   harness observe "minih doctor has no --json flag; had to pair plain + --strict exit codes" \
     --kind difficulty --target plan --severity annoying \
     --workaround "exit-code pair" --suggested-encoding "add --json to minih doctor"
   ```

   Kinds: `difficulty | magic-wand | gift | insight | coordination | improvement-suggestion | confusion`. Entries land in `.harness/temp/<agent>/` — self-gitignored by the CLI, plus a repo-level `.gitignore` entry as defense-in-depth. Nothing reaches git history at this stage.

2. **Inspect** the buffer any time:

   ```bash
   harness observe --list --json
   ```

3. **Drain** at retro time (phase/session end) into a committed, dated record:

   ```bash
   harness record retro --slug <plan-slug>
   # → .harness/records/retro/<YYYY-MM-DD>/<NNN>-<plan-slug>.md
   ```

   The record's frontmatter shape is owned by the CLI's template — fill the entries from the buffer, commit the record, then empty the buffer:

   ```bash
   harness observe --clear
   ```

4. **Harvest** (cross-plan curation) reads committed records — and, for back-compat, the product harness's `docs/retros/*.md` ledgers as a READ-only legacy source via the minihToUniversal mapping. Writers under `.harness/` never target `docs/retros/`.

## Narrow gates: prove the phase, not the world

Use the narrowest gate that proves the phase's contract (full table: governance § Phase Gates), then `just fft` before commit/push:

```bash
npx vitest run test/runner/<file>.test.ts    # runner work
npx vitest run test/cli/<file>.test.ts       # cli work
npx vitest run test/mcp/<file>.test.ts       # mcp work
harness boot --json                          # eng-harness work — the narrow gate IS the boot
git --no-pager diff --check                  # docs / planning work
just fft                                     # release / pre-commit, always
```

## Copy-paste harness validation

The modernized session-start validation block (successor to the old `docs/project-rules/harness.md` block — now `harness boot`-based):

```bash
set -e
mkdir -p scratch/evidence
harness doctor --json > scratch/evidence/harness-doctor.json
harness boot --json > scratch/evidence/harness-boot.json    # exit 0 covers ok AND degraded
minih doctor > scratch/evidence/minih-doctor.json 2> scratch/evidence/minih-doctor.stderr
test -s scratch/evidence/harness-doctor.json
test -s scratch/evidence/harness-boot.json
test -s scratch/evidence/minih-doctor.json
```

(`scratch/` is gitignored; committed phase evidence belongs in the active plan's `execution.log.md`.)

## Commit types: harness work never cuts a release

Commits touching only `.harness/` and docs use **non-releasing** conventional-commit types:

```bash
git commit -m "chore(harness): <what changed in the substrate>"
git commit -m "docs(harness): <what changed in harness docs>"
```

release-please's default ruleset treats `chore`/`docs` as non-releasing, and this repo's config sets no type overrides — so harness housekeeping never bumps minih's version. Anything touching `src/` is normal product work (`feat:`/`fix:`) and out of this guide's scope.

## Dialect and locality

- **Bare `harness`, always.** The CLI is installed globally (npm-linked dev checkout; `engh` is an alias). Never `npx harness`, never `npm install` it into this repo. The recorded contract surface (version, verbs, envelope, record paths) lives in governance § Harness-core contract — that section is the drift detector when the global CLI moves.
- **Skills are global, not repo-local.** The eng-harness skill family (the `/eng-harness-flow` router and friends) installs into your agent CLI, not into minih:

  ```bash
  npx skills@latest add AI-Substrate/harness-engineering -a claude-code -g -y
  ```

## Pointers

- Lean contract: [`.harness/engineering-harness.md`](../../.harness/engineering-harness.md) — boot sensors as built, phase gates, dogfood rules, injection map, history.
- Boot briefing: `harness instructions boot` (served from `.harness/extensions/boot/instructions.md`).
- Agent routing: [`AGENTS.md`](../../AGENTS.md) § Engineering harness — session start.
- Domain boundary: [`docs/domains/eng-harness/domain.md`](../domains/eng-harness/domain.md) — the four hard rules.
