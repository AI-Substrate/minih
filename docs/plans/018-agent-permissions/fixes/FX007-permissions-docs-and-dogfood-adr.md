# FX007 — Permissions docs cross-link + dogfood-rule ADR

**Status**: DEFERRED (post-R6)
**Plan**: 018-agent-permissions
**Origin**: Top-10 follow-ups #9 and #10 — docs polish + capturing a hard-won lesson about CLI surface gaps from this session.

## Motivation

Two small, related improvements that share the same domain (`docs/`) and don't justify separate dossiers:

**1. Cross-link permissions from the coordination flow.** Coordination-aware agents are the most likely to need explicit `permissions:` because companion mode (Power-On-Mode) requires `read-only + overrides {network: allow}`. AGENTS_README and README both have a coordination section AND a permissions section, but no inline pointer between them. A new author following the coordination tutorial will only discover permissions when they hit a denial in production.

**2. ADR for "the dogfood rule applied to permissions."** This session learned the hard way that the dogfood rule (`minih CLI for everything; never `cat` run-dir files directly`) breaks down when a CLI surface gap exists — e.g. `minih retros` failing because of an inbox-lane corruption bug. The "right" response was to file the gap as a magicWand BEFORE bypassing with `cat`. We did this for the prober coordination wand; we should codify the rule so the next agent doesn't silently bypass it.

Both items are pure-docs and live in this single dossier.

## Scope

### FX007-1: Cross-link permissions from coordination sections (~5 min)

Add one sentence to:
- `AGENTS_README.md` § Coordination section: "Coordination-aware agents typically need explicit `permissions: read-only` with `network: allow` and `shell: allow` overrides — see [`docs/how/permissions.md`](docs/how/permissions.md)."
- `README.md` companion section: same sentence.
- `docs/how/coordination.md` (if exists): same.
- `docs/how/permissions.md` § Companion mode subsection: reverse cross-link to coordination doc.

### FX007-2: Dogfood-rule ADR (~1 hour)

New file: `docs/adr/0001-dogfood-rule-applies-to-permissions.md` (or next available ADR ordinal).

Content outline:
- **Status**: Accepted
- **Context**: Plan 018 session experience — `minih retros` failed because of inbox-lane bug; correct path was to file the magicWand BEFORE `cat`-ing the file. Easier to slip past silently when debugging under time pressure.
- **Decision**: If a debugging path requires `cat`/`grep`/`tail`/`jq` on `agents/<slug>/runs/<run>/` files, the gap IS the magicWand. File it (in deferred-follow-ups or as a fix dossier) before bypassing. Then decide explicitly with the operator whether to `cat` once or fix the CLI first.
- **Consequences**: Slower debug under acute pressure; more robust CLI surface over time. Captured on every session; auto-harvested retros surface bypass attempts.
- **Self-check**: Before reaching for `cat`, ask "could `minih X` answer this?" — if yes, use that. If no, that's the answer.

Cross-link from:
- `AGENTS_README.md` (existing dogfood-rule section gains link to the ADR).
- `docs/how/permissions.md` § Debugging.
- `docs/how/companion-mode.md`.

### FX007-3: ADR registry index (if not already present)

If `docs/adr/` doesn't yet have a `README.md` or `index.md`:
- Create `docs/adr/README.md` listing all ADRs by number with title, status, link.
- Document the ADR template (markdown, four sections: Status, Context, Decision, Consequences).
- Cross-link from main README under "Architecture decisions".

## Acceptance criteria

- AC-FX7.1: AGENTS_README and README both cross-link to `docs/how/permissions.md` from coordination sections.
- AC-FX7.2: `docs/how/permissions.md` cross-links back to coordination docs.
- AC-FX7.3: Dogfood-rule ADR exists in `docs/adr/` with Status / Context / Decision / Consequences.
- AC-FX7.4: ADR is cross-linked from AGENTS_README dogfood-rule section and from companion-mode doc.
- AC-FX7.5: ADR registry exists at `docs/adr/README.md` (or equivalent) listing all ADRs.
- AC-FX7.6: All cross-links resolve (no broken markdown links — `npx markdown-link-check` or equivalent on touched files).

## Out of scope
- Backfilling ADRs for prior plan decisions (separate workstream).
- Restructuring `docs/how/` or `docs/adr/` directory layouts.
- Adding ADR templates as scaffolding tooling.

## Risks
- ADR drifts out of sync with code reality — accept; ADRs are a point-in-time decision record by design.
- Cross-links rot when files move — mitigated by markdown-link-check in CI (already configured if `just fft` includes it; verify).

## Testing
- Manual: read all touched docs in sequence; verify the path from coordination → permissions is one click.
- Lightweight: link-checker on the four/five touched markdown files.
