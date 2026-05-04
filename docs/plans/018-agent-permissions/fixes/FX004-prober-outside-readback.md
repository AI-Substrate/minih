# FX004 — Prober scenarios for outside-CLI denial readback

**Status**: DEFERRED (post-R6)
**Plan**: 018-agent-permissions
**Origin**: Workshop 004 § Q10.

## Motivation

The 10-scenario matrix covers preset behaviour and FS-guard semantics. It doesn't cover the OUTSIDE-CLI experience after denial:
- `minih outside inbox list <slug>` — does the `permission-error` envelope render cleanly?
- `minih view <slug>` — TUI styling for the denial state?
- `minih validate <slug>` — clean failure with E200 + envelope payload?

These surfaces aren't probed by the inside-only prober.

## Scope

Add 3-4 scenarios under matrix `outside-readback`:
1. **outside-inbox-readback**: force denial; verify message presence + shape.
2. **outside-state-readback**: verify state/inside.json status: error.
3. **view-tui-rendering**: minih view --snapshot --json includes permissionError.
4. **validate-after-denial**: minih validate exits 1 with E200.

## Acceptance criteria

- AC-FX4.1: 3-4 new scenarios under matrix `outside-readback`.
- AC-FX4.2: Aggregator reads outside-inbox + view JSON; trust gate enforces envelope match.
- AC-FX4.3: `minih probe --matrix outside-readback` produces matrix.html.

## Implementation outline

1. Extend `aggregateReport()` to read outside-inbox + view JSON.
2. No new agent; just aggregator probes.

## Out of scope
- Extending the inside-prober to peek outward (slippery slope).
- TUI screenshot regression (plan 016 owns).

## Risks
- CI flakiness across terminals — parse JSON only, not human output.
- Best-effort coordination signals — distinguish "didn't try" from "tried and failed".

## Testing
- Lightweight per scenario.
- Manual: `--matrix outside-readback --ci` green.
