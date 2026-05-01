# Flight Plan: Fix FX003 — Document `--wait`/`--after` as canonical operator pattern

**Fix**: [FX003 dossier](./FX003-driving-from-outside-docs.md)
**Status**: Ready

## What → Why

**Problem**: `inside inbox list --wait` is the right operator round-trip primitive. Our docs teach `sleep+cat` instead. Third-party authors will write polling-with-sleep every time.

**Fix**: New canonical "Driving an agent from outside" how-to + drift sweep across companion-mode.md, AGENTS_README.md, existing outside.md scripts, and the init-coordinated scaffold.

## Domain Context

| Domain | Relationship | What Changes |
|--------|-------------|-------------|
| Docs | Primary | New how-to + drift sweep |
| `cli` | Tangential | init scaffolding text |

## Stages

- [ ] **Stage 1: Canonical page** — `docs/how/driving-an-agent-from-outside.md` (NEW)
- [ ] **Stage 2: Rewrite** — `docs/how/companion-mode.md` to use `--wait`
- [ ] **Stage 3: Cheat-sheet** — `AGENTS_README.md` operator round-trip section
- [ ] **Stage 4: Outside scripts** — update existing `outside.md` files
- [ ] **Stage 5: Scaffold fix** — `npx minih init --coordinated` generates the right pattern
- [ ] **Stage 6: Drift sweep** — grep + clean any remaining `sleep+cat` round-trips

## Acceptance

- [ ] No `sleep+cat` in operator round-trip docs
- [ ] New canonical page linked from README and how/
- [ ] Scaffolded agents inherit canonical pattern
