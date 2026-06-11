# Domain: eng-harness

**Purpose**: Session-level engineering harness for *developing* minih, running on harness-core (the global `harness` CLI). Owns the `.harness/` substrate — governance contract, composite boot verb, friction-capture loop, committed retro records — plus the AGENTS.md routing block and the deep guide. It proves the dev environment and captures engineering friction; it never participates in minih's runtime.

## Boundary

**Owns**: `.harness/engineering-harness.md` (governance/BIO contract), `.harness/extensions/` (the composite `boot` verb + agent briefings), `.harness/records/` (committed harness records), `.harness/temp/` (gitignored observe scratch), the AGENTS.md engineering-harness block, `docs/how/engineering-harness.md`

**Excludes**: The minih **product** harness — runner's retro ledger writers and `minih harvest` targeting `docs/retros/` (runner/cli domains own those; eng-harness reads them only at harvest time, see Rules). The harness-core CLI itself (upstream `harness-engineering` repo — consumed globally, never vendored). minih source (`src/**`, `dist/**` — this plan makes zero src changes). The eng-harness skills (installed globally at the user level, not in this repo).

### Hard boundary rules

1. **Shell-wrappers only** — extensions invoke repo commands via `ctx.exec` and **never import from `src/` or `dist/`**; the only import is the type-only harness-core contract, erased at runtime (jiti).
2. **Zero inbound edges** — no minih domain (cli, runner, mcp, adapter, measurement) may depend on, import from, or reference eng-harness; minih builds, tests, and ships identically with `.harness/` deleted.
3. **Envelope-only observation** — eng-harness observes minih exclusively through published CLI envelopes and exit codes at the process boundary (`minih doctor` exit signals, `minih retros --json`, …); it never reads minih's private run files (the dogfood rule applies to the harness too).
4. **Single one-way map edge** — `eng-harness → cli` (process boundary, never imports); no other edges exist on the domain map.

## Composition

| File | Classification | Purpose |
|------|---------------|---------|
| `.harness/engineering-harness.md` | contract | Governance: BIO contract, harness-core contract surface, boot sensors as built, Phase Gates, Dogfood Rules, Injection map, legacy read paths, History |
| `.harness/extensions/boot/extension.ts` | internal | Composite boot verb — five read-only sensors → one envelope verdict (024) |
| `.harness/extensions/boot/instructions.md` | contract | Agent briefing served by `harness instructions boot` |
| `.harness/records/retro/**` | internal | Committed retro records created by `harness record retro` (dated, CLI-templated frontmatter) |
| `.harness/temp/` | internal | Gitignored observe scratch (self-gitignored + repo-level defense-in-depth) |
| `docs/how/engineering-harness.md` | contract | The one deep guide: loop narrative, command map, copy-paste validation block |

## Contracts

| Contract | Type | Consumers |
|----------|------|-----------|
| `harness boot --json` envelope | CLI envelope | Dev-session agents (session-start proof), plan-6 pre-implement seam, AC batteries |
| `harness record retro --slug <slug>` → `.harness/records/retro/<date>/<NNN>-<slug>.md` | CLI + path contract | Retro drain (observe buffer → committed record), harvest |
| Governance BIO contract (`.harness/engineering-harness.md`) | Document contract | eng-harness-flow router (S2 file-exists signal; S3 `## Injection map` signal), boot orientation digest, future agents |
| `harness instructions boot` briefing | CLI | Any agent about to run or interpret boot |

## Concepts

| Concept | Definition |
|---------|-----------|
| Composite boot | One `harness boot` run executes five read-only sensors and folds them into a single envelope verdict — `ok` / `degraded` / `error`. Hand-written (not `--wrap`) because wrapping one command would lose per-sensor status nuance. |
| Sensor | One deterministic check inside boot (lint, typecheck, build+test, minih-doctor, audit) with outcome `pass / warn / fail / skipped`. `skipped` means *unproven* (e.g. registry offline) and never gates. |
| Envelope | The harness-core return contract: `{command, status, data, error?, next_action?, timestamp}`, status ∈ `ok / degraded / unconfigured / error` → exits 0/0/2/1. Machine contract on stdout; humans read stderr. |
| Degraded-is-honest | `degraded` is a truthful "workable-with-awareness" verdict, not a failure — day one it names known minih-doctor warnings + a known advisory chain. Boot is never tuned to hide it. |
| Observe buffer | `harness observe "<what>" --kind <kind>` appends one silent line to gitignored `.harness/temp/` scratch — friction captured the moment it bites, zero ceremony. |
| Retro record | `harness record retro --slug <plan>` drains buffered observations into a committed, dated record under `.harness/records/retro/` — the durable end of the friction loop. |
| Governance | The BIO contract at `.harness/engineering-harness.md`: what boots the system, how to interact/observe, phase gates, dogfood rules, maturity snapshot, history. The router's S2 setup signal. |
| Injection map | The `## Injection map` governance section recording where the SDD flow self-fires `/eng-harness-flow --event <seam>` — usage made structural, not remembered. The router's S3 signal. |

## Tests & Validation

| Area | Validation |
|------|-----------|
| Substrate shape + envelope legality + read-only proof + friction round-trip | Behavioral AC battery (AC-1 … AC-6) run live and captured in `docs/plans/024-core-harness/execution.log.md` — real verbs, envelope assertions, no mocks, no test infra |
| Extension loads cleanly | `harness doctor --json` → extensions layer `1 loaded, 0 failed, 0 conflicts` |
| Lint discipline | `extension.ts` is biome-clean under repo-wide `npx biome check .` (records are `.md`, biome-inert) |
| Repo gate | `just fft` green with the substrate in the tree (AC-11) |

No vitest suite by design: the domain's testing strategy is Lightweight behavioral verification through the real CLI surface (spec § Testing Strategy).

## History

| Phase | Changes |
|-------|---------|
| 024-core-harness | Domain created and **registered as the sixth domain by user decision**, overriding the research dossier's keep-`.harness`-outside-the-registry lean (DB-08): the boundary is real and worth enforcing (zero inbound edges, envelope-only observation), so it earns registry visibility rather than a tooling footnote. **Revisit note**: if the meta-domain's registry presence proves heavier than its value (e.g. domain tooling starts assuming every registered domain has `src/` + vitest), demote to a registry tooling note and keep this doc as the boundary contract. Delivered: governance migration onto harness-core 0.2.0, composite boot (built in the 024 setup excursion, verified here), observe→record loop, AGENTS.md routing, docs/how guide. |
