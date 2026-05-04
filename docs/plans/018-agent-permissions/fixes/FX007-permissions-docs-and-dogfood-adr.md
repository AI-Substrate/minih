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

**Prerequisite**: `docs/adr/` does not exist as of this dossier's authoring (verified by glob). FX007-3 (below) creates the directory + registry; FX007-2 must run after FX007-3.

New file: `docs/adr/0001-dogfood-rule-applies-to-permissions.md`. Ordinal is **0001** (no prior ADRs exist; future ADRs increment from 0002).

Content outline:
- **Status**: Accepted
- **Context**: Plan 018 session experience — `minih retros` failed because of inbox-lane bug; correct path was to file the magicWand BEFORE `cat`-ing the file. Easier to slip past silently when debugging under time pressure.
- **Decision**: If a debugging path requires `cat`/`grep`/`tail`/`jq` on `agents/<slug>/runs/<run>/` files, the gap IS the magicWand. File it (in deferred-follow-ups or as a fix dossier) before bypassing. Then decide explicitly with the operator whether to `cat` once or fix the CLI first.
- **Consequences**: Slower debug under acute pressure; more robust CLI surface over time. Captured on every session. *Future retro tooling SHOULD surface bypass attempts via auto-harvested retros — this is an aspiration, not a current capability; implementing it is out of scope for this dossier (no `src/` changes permitted under FX007).*
- **Self-check**: Before reaching for `cat`, ask "could `minih X` answer this?" — if yes, use that. If no, that's the answer.

Cross-link from:
- `AGENTS_README.md` (existing dogfood-rule section gains link to the ADR).
- `docs/how/permissions.md` § Debugging.
- `docs/how/companion-mode.md`.

### FX007-3: ADR registry index (REQUIRED — does not exist yet)

`docs/adr/` does not exist in this repository as of this dossier. The implementer MUST create it as the FIRST step of FX007-2.

Steps:
1. `mkdir docs/adr` (will fail in CI if pre-existing — verify state first; if it exists, skip to step 2).
2. Create `docs/adr/README.md` listing all ADRs by number with title, status, link.
3. Document the ADR template (markdown, four sections: Status, Context, Decision, Consequences).
4. Document registry ownership rules: registry is append-only; ordinals are next-available; all future ADRs MUST add a row in the same PR that introduces the ADR file. FX007 owns the registry.
5. Cross-link from main README under "Architecture decisions".

## Acceptance criteria

- AC-FX7.1: AGENTS_README and README both cross-link to `docs/how/permissions.md` from coordination sections.
- AC-FX7.2: `docs/how/permissions.md` cross-links back to coordination docs (`docs/how/companion-mode.md` at minimum; `docs/how/coordination.md` only if it exists).
- AC-FX7.3: Dogfood-rule ADR exists at `docs/adr/0001-dogfood-rule-applies-to-permissions.md` with Status / Context / Decision / Consequences sections.
- AC-FX7.4: ADR is cross-linked from AGENTS_README dogfood-rule section, `docs/how/permissions.md` § Debugging, and `docs/how/companion-mode.md`.
- AC-FX7.5: ADR registry exists at exact path `docs/adr/README.md` listing 0001 with status `Accepted`. Cross-links in AGENTS_README, main README, and `docs/how/permissions.md` MUST point to this exact path (no `or equivalent`).
- AC-FX7.6: All cross-links resolve. Implementer verifies `just fft` for an existing markdown-link-check step. If absent, EITHER (a) add a `link-check` recipe to the `justfile` as part of this dossier (preferred — it's a one-line addition and FX007 is the right place for it), OR (b) run `npx markdown-link-check` manually on touched files before merge and attach output to the PR. Document choice in PR.
- AC-FX7.7: `docs/adr/README.md` declares ownership rules: registry append-only, ordinals next-available, all future ADRs MUST add a row in the same PR. Future ADR-creating dossiers consume this contract.

## Out of scope
- Backfilling ADRs for prior plan decisions (separate workstream).
- Restructuring `docs/how/` or `docs/adr/` directory layouts.
- Adding ADR templates as scaffolding tooling.
- **Any code changes to `src/`** — this dossier is pure-docs. The ADR's "auto-harvested retros surface bypass attempts" Consequences bullet MUST be framed as an aspiration ("future retro tooling SHOULD surface...") not as an existing capability.

## Risks
- ADR drifts out of sync with code reality — accept; ADRs are a point-in-time decision record by design.
- Cross-links rot when files move — mitigated by markdown-link-check (added under AC-FX7.6 if not present in `just fft`).

## Testing
- Manual: read all touched docs in sequence; verify the path from coordination → permissions is one click.
- Lightweight: link-checker on the four/five touched markdown files.

---

## Validation Record (2026-05-04)

| Agent | Lenses Covered | Issues | Verdict |
|-------|---------------|--------|---------|
| Source-Truth | Technical Constraints | 0 (cross-link targets verified) | ✅ |
| Cross-Reference | Integration & Ripple, Hidden Assumptions | 1 LOW (docs/adr/ doesn't exist — same as F007-A) → fixed inline | ⚠️ → ✅ |
| Completeness | Edge Cases, Domain Boundaries, Deployment & Ops | 1 CRITICAL (FX007-3 wrongly conditional) + 2 HIGH + 2 MEDIUM → all fixed inline | ❌ → ✅ |
| Forward-Compatibility | Forward-Compatibility (Lifecycle ownership) | 1 MEDIUM (registry ownership unclear) → fixed inline (AC-FX7.7) | ⚠️ → ✅ |

**Lens coverage**: 9/12 (above 8 floor).

**Fixes applied**: FX007-3 made REQUIRED (docs/adr/ doesn't exist — verified by glob); ADR ordinal pinned to 0001 unconditionally; "auto-harvested retros" Consequences bullet rewritten as aspiration (no `src/` changes permitted under FX007); AC-FX7.5 hedge "or equivalent" removed; AC-FX7.6 link-check verification step + remediation path added (add to `just fft` if absent; this is in scope for FX007); AC-FX7.7 added for ADR registry ownership rules.

**Overall**: ❌ → ⚠️ VALIDATED WITH FIXES — ready for `/plan-6 --fix FX007` cycle.
