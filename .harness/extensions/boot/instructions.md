# `harness boot` — agent briefing

## What this verb computes (the deterministic part)

Five read-only sensors, in order, returning one envelope:

1. `lint` — `npx biome check .` (read-only; never `--write`)
2. `typecheck` — `npx tsc --noEmit`
3. `build+test` — `just check` (`npm run build` + `npm test`)
4. `minih-doctor` — `minih doctor`, then `minih doctor --strict`; plain-pass +
   strict-fail means warnings-only (minih doctor has no `--json` envelope yet,
   so exit codes are the deterministic signal — observed as DL-001)
5. `audit` — `npm audit --audit-level=high --json`; unreachable registry
   soft-skips (sdk-check precedent), findings are never masked

Verdict mapping: any sensor `fail` → `error` (exit 1); doctor warnings or
high/critical vulnerabilities → `degraded` (exit 0); all pass → `ok` (exit 0).
`skipped` never gates. `data.sensors` carries per-sensor outcomes;
`data.orientation` is the machine-readable re-orientation digest (branch,
governance location, the friction-capture command, the mutating commit gate).

## Your role (the inference part)

- Treat `degraded` as workable-with-awareness: read which sensors warned and
  judge whether the warnings touch the code you are about to change. The
  day-one state is honestly degraded (known minih doctor warnings + a known
  high/critical advisory chain) — do not "fix" boot to hide that.
- On `error`, fix the named sensor before starting feature work; the failure
  detail in the envelope is the evidence.
- Boot proves the environment; it does not run `just fft` — that gate mutates
  the tree (biome format `--write`) and belongs at commit time, not session
  start.

## Watch out for

- `just check` runs the full test suite; a known intermittent flake lives in
  `test/runner/agent-pack/extractor.test.ts`. A lone failure there may be the
  flake — re-run before concluding the tree is broken, and capture the event:
  `harness observe "<what happened>" --kind difficulty`.
- The audit sensor is network-dependent; `skipped` means *unproven*, not safe.
- minih-doctor warning detection rides `--strict`'s exit code; it cannot count
  warnings — run `minih doctor` yourself for the list.
