# Workshop: `minih agent-readme` — Bundled-doc Output Command

**Type**: CLI Flow
**Plan**: 015-agent-readme-command
**Spec**: _(not yet — workshop runs first to lock the surface)_
**Created**: 2026-04-30
**Status**: Draft

**Related Documents**:
- [`docs/how/companion-mode.md`](../../../how/companion-mode.md) — companion-mode protocol; mentions but doesn't ship the AGENTS_README to other projects
- [`AGENTS_README.md`](../../../../AGENTS_README.md) — the doc this command will dump

**Domain Context**:
- **Primary Domain**: `cli` (new top-level command + program-level help-text edit)
- **Related Domains**: none
- **Out of scope**: `runner`, `mcp`, `adapter` — no behavioural change to coordinated runs

---

## Purpose

Lock the design of `minih agent-readme` — a one-command verb that prints the bundled `AGENTS_README.md` to stdout, with `--help` signposting it. Closes the gap surfaced when the user asked "is there a `minih --agents-readme` command?": the npm package today ships only `dist/` + `LICENSE`, so agents running `npx minih` on other projects have no local access to the docs and must fetch from GitHub.

This workshop is the authoritative design source for plan 015. The spec and plan derive from it.

## Key Questions Addressed

1. What's the command name and shape?
2. Does this command output the JSON envelope or raw markdown? (Breaks "all CLI commands output JSON" convention if raw — but raw is what humans + `cat`-style consumers want.)
3. Where does the AGENTS_README ship in the npm package, and how does the command find it at runtime?
4. How does `--help` signpost it?
5. What's the error path if the bundled doc is missing?
6. Does this scale to other docs (`docs/how/`) or stay AGENTS_README-only in v1?
7. SIGPIPE / `| head -20` behaviour?

---

## Overview

The npm package's `package.json` `files` array is currently:

```json
"files": ["dist", "LICENSE"]
```

Nothing else ships. The doc-dump command needs:

1. The doc to actually be in the package install — either added to `files` directly OR copied into `dist/` by the existing `scripts/copy-schemas.js` build step.
2. A CLI verb that resolves the doc's package-install location at runtime and pipes its bytes to stdout.
3. A breadcrumb in `--help` so a curious operator finds the verb.

The user's brief was deliberately tight: *"Just need --help to sign post to 'agent-readme' which dumps readme md back to terminal i think."* So the surface is one command + one help-text edit. Everything else is design discipline to keep it small.

---

## Command Surface

### Name & shape

```
$ minih agent-readme
```

| Aspect | Decision | Rationale |
|---|---|---|
| Verb name | `agent-readme` | Mirrors the filename `AGENTS_README.md`. Hyphen-separated matches the existing CLI verb style (`last-run`, no others — but lowercase + hyphenated is the project pattern in `docs/how/coordination-loop-validator.md` etc). User wrote it explicitly: "sign post to 'agent-readme'". |
| Subcommand vs flag | **Subcommand** | Flags like `--agents-readme` would clutter the top-level options table and conflict with operator muscle memory (flags toggle behaviour; verbs do things). |
| Arguments | None | v1 only dumps AGENTS_README.md. Future: `minih agent-readme <topic>` could dump `docs/how/<topic>.md`. Out of v1 (workshop O1). |
| Flags | None | No `--json`, no `--output`. Pure stdout dump. Pipe to `less`/`glow`/`cat` for downstream needs. |

### Output contract

**Stdout**: the raw markdown content of the bundled `AGENTS_README.md`, byte-for-byte, with the file's existing trailing newline.

**Stderr**: empty on success.

**Exit code**: 0 on success.

This **deviates** from the project rule "all CLI commands output JSON envelope on stdout and human-readable on stderr" (per `CLAUDE.md` § CLI output convention). The deviation is intentional and limited to documentation-dump verbs. Reasoning:

- The output is documentation, not structured data. Wrapping it in `{"data": {"content": "..."}}` would force every reader (humans, agents, `| less`) to either parse JSON first or use `jq -r .data.content`. Net friction without a benefit.
- There is no failure mode where partial markdown is meaningful. Either the doc is there (status: ok) and you get the bytes, or it's not (error → stderr + non-zero exit, see below).
- This matches how `--help` and `--version` work today — they dump human-readable text to stdout, not envelopes.

The deviation is documented in:
- The command's own `--help` text (`This command outputs raw markdown, not the standard JSON envelope.`)
- `AGENTS_README.md` § Output convention (when it gets updated next time)
- `docs/project-rules/idioms.md` if/when it exists

### Error path

When the bundled doc is missing (e.g., a corrupted package install), output a JSON envelope to **stderr** (matching the rest of the CLI's error shape) and exit non-zero:

```jsonc
// stderr
{
  "command": "agent-readme",
  "status": "error",
  "timestamp": "2026-04-30T...",
  "error": {
    "code": "E160",
    "message": "Bundled AGENTS_README.md not found at <path>. The npm package may be corrupted; try reinstalling.",
    "details": { "expectedPath": "..." }
  }
}
```

New error code: `E160 README_NOT_FOUND`. Defined in `src/cli/output.ts:ErrorCodes`.

The command's stdout in this error case is empty (no partial markdown). Exit code is 1.

### `--help` signposting

The existing `--help` postscript:

```
Docs: https://github.com/AI-Substrate/minih/blob/main/AGENTS_README.md
```

Becomes:

```
Docs: https://github.com/AI-Substrate/minih/blob/main/AGENTS_README.md
      or run: minih agent-readme
```

Implementation: Commander's `addHelpText('after', ...)`. The new `agent-readme` subcommand also gets its own `--help` description from Commander auto-generation (just the action's `.description()` text).

---

## Bundled-doc Resolution

### Where the file lives at runtime

The doc must end up at a stable path inside the published npm package. Two viable approaches:

| Approach | Files config | Where to find at runtime |
|---|---|---|
| **A. Add to `files` directly** | `["dist", "LICENSE", "AGENTS_README.md"]` | Package root: `import.meta.url` resolves to `<pkg>/dist/cli/index.js`; `path.resolve(__dirname, '../../AGENTS_README.md')` |
| **B. Copy into `dist/` via build script** | `["dist", "LICENSE"]` (unchanged) | `<pkg>/dist/AGENTS_README.md`; `path.resolve(__dirname, '../AGENTS_README.md')` |

**Decision: B (copy into dist).** Rationale:

- `dist/` is already declared as the self-contained "what we ship" boundary. Adding sibling files outside `dist/` violates the boundary and makes the install layout less predictable.
- `scripts/copy-schemas.js` already exists and copies `src/templates/shared-preamble.md` and the JSON schemas. Adding one more `cp` line is trivial.
- A future `agent-readme <topic>` extension would copy `docs/how/*.md` into `dist/docs/how/` — same pattern, same script.
- Tests can refer to a stable post-build location instead of repo-root paths.

### Build step (the only behavioural change to the build)

`scripts/copy-schemas.js` gains roughly:

```js
import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../../');
const dist = path.join(repoRoot, 'dist');

mkdirSync(dist, { recursive: true });
copyFileSync(
  path.join(repoRoot, 'AGENTS_README.md'),
  path.join(dist, 'AGENTS_README.md'),
);
```

(Pseudo-syntax; align with existing helpers in the script.)

### Runtime resolution

```ts
// src/cli/commands/agent-readme.ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const docPath = path.resolve(
  fileURLToPath(import.meta.url),
  '..', '..', 'AGENTS_README.md', // dist/cli/commands/* → dist/AGENTS_README.md
);
```

Adjust the relative path based on where the command file lives in `dist/cli/`.

---

## Worked Examples

### Example 1: Operator wants to read the docs locally

```
$ minih agent-readme | less
```

Pages through the markdown. No paging built in — agent-readme is a pure dump.

### Example 2: Operator wants the first 50 lines

```
$ minih agent-readme | head -50
```

`head` closes its read end. Node's stdout EPIPE is the standard hazard. Implementation MUST handle SIGPIPE / EPIPE silently:

```ts
process.stdout.on('error', (err) => {
  if ((err as NodeJS.ErrnoException).code === 'EPIPE') process.exit(0);
  throw err;
});
```

This is a well-known Node CLI pattern. Test by piping to `head -1` and asserting exit code 0.

### Example 3: Agent fetches the docs into its prompt

```bash
README=$(minih agent-readme)
```

Captures the full markdown into a shell variable for inclusion in agent context. No JSON parsing needed.

### Example 4: Discoverability via `--help`

```
$ minih --help
Usage: minih [options] [command]

Standalone declarative agent runner with self-improving feedback

Options:
  ...
Commands:
  ...
  agent-readme                       Print the bundled AGENTS_README.md to
                                     stdout (raw markdown, not JSON envelope)
  ...

Docs: https://github.com/AI-Substrate/minih/blob/main/AGENTS_README.md
      or run: minih agent-readme
```

The bottom-of-help footer mentions both the GitHub link and the local verb. The verb itself appears in the alphabetical command list with a one-line description.

### Example 5: Bundled doc missing (e.g., corrupted install)

```
$ minih agent-readme
$ echo $?  # → 1
```

Stderr (formatted):
```jsonc
{"command":"agent-readme","status":"error","timestamp":"...","error":{"code":"E160","message":"Bundled AGENTS_README.md not found at /usr/.../dist/AGENTS_README.md. The npm package may be corrupted; try reinstalling.","details":{"expectedPath":"..."}}}
```

---

## Error Codes

| Code | Message | Cause |
|---|---|---|
| `E160 README_NOT_FOUND` | `Bundled AGENTS_README.md not found at <path>. The npm package may be corrupted; try reinstalling.` | The expected `dist/AGENTS_README.md` does not exist at runtime. |

(No other error paths in v1. The command is bytes-in-bytes-out.)

---

## Open Questions

### O1 — RESOLVED: scope (AGENTS_README only in v1; how-docs deferred)

User explicitly scoped this small: *"Just need --help to sign post to 'agent-readme' which dumps readme md back to terminal."* No `agent-readme <topic>` for `docs/how/` in v1. Same envelope `data` shape (just bytes) makes future addition trivial.

### O2 — RESOLVED: subcommand, not flag

`minih agent-readme` (verb), not `minih --agents-readme` (flag). Flags should toggle behaviour or set parameters; verbs do things.

### O3 — RESOLVED: raw markdown, not JSON envelope

Documentation is raw bytes. Wrapping in JSON adds friction without benefit. Deviation from the project's general "all CLI outputs JSON" rule is intentional, limited to documentation-dump verbs, and documented in the command's `--help` text.

### O4 — RESOLVED: bundle in `dist/`, not at package root

`scripts/copy-schemas.js` adds one `cp` line. Keeps `dist/` as the self-contained ship boundary. Future how-doc subcommand copies `docs/how/*.md` into `dist/docs/how/` — same pattern.

### O5 — RESOLVED: SIGPIPE handled silently

Standard Node EPIPE handler at the top of the command. Test with `| head -1`.

### O6 — DEFERRED: `--list` mode for discoverable how-doc topics

If `agent-readme <topic>` ever ships, a sibling `--list` flag (or sub-subcommand) would print available topics. Not in v1.

### O7 — DEFERRED: `agent-readme` reading from a *user-provided* override path

Some operators might want to point at a forked/customized `AGENTS_README.md` (e.g., a project that wraps minih and wants its own boilerplate). A future `--agents-readme-path <path>` global flag could override resolution. Out of v1 scope.

---

## TypeScript Sketch

```ts
// src/cli/commands/agent-readme.ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Command } from 'commander';
import { ErrorCodes, formatError } from '../output.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// dist/cli/commands/agent-readme.js → dist/AGENTS_README.md
const DEFAULT_README_PATH = path.resolve(HERE, '..', '..', 'AGENTS_README.md');

export function registerAgentReadmeCommand(program: Command): void {
  program
    .command('agent-readme')
    .description(
      'Print the bundled AGENTS_README.md to stdout (raw markdown — this command does NOT use the JSON envelope).',
    )
    .action(() => runAgentReadme());
}

function runAgentReadme(): void {
  // Handle EPIPE silently for `| head` style pipelines
  process.stdout.on('error', (err) => {
    if ((err as NodeJS.ErrnoException).code === 'EPIPE') {
      process.exit(0);
    }
    throw err;
  });

  if (!fs.existsSync(DEFAULT_README_PATH)) {
    const envelope = formatError(
      'agent-readme',
      ErrorCodes.README_NOT_FOUND,
      `Bundled AGENTS_README.md not found at ${DEFAULT_README_PATH}. The npm package may be corrupted; try reinstalling.`,
      { expectedPath: DEFAULT_README_PATH },
    );
    process.stderr.write(`${JSON.stringify(envelope)}\n`);
    process.exit(1);
  }

  const content = fs.readFileSync(DEFAULT_README_PATH);
  process.stdout.write(content);
}
```

```ts
// src/cli/output.ts — add to ErrorCodes
export const ErrorCodes = {
  // ... existing
  README_NOT_FOUND: 'E160',
} as const;
```

```ts
// src/cli/index.ts — register + signpost
import { registerAgentReadmeCommand } from './commands/agent-readme.js';

// ... existing program setup
registerAgentReadmeCommand(program);

program.addHelpText(
  'after',
  '\nDocs: https://github.com/AI-Substrate/minih/blob/main/AGENTS_README.md' +
    '\n      or run: minih agent-readme\n',
);
```

```js
// scripts/copy-schemas.js — add at the bottom
import { copyFileSync } from 'node:fs';
copyFileSync(
  path.join(repoRoot, 'AGENTS_README.md'),
  path.join(dist, 'AGENTS_README.md'),
);
```

---

## Decision Log Summary

| Q | Decision |
|---|---|
| Q1 — name | `minih agent-readme` (verb, hyphenated, mirrors filename) |
| Q2 — JSON envelope? | NO — raw markdown to stdout. Documentation is bytes-in-bytes-out. Deviation documented in --help. |
| Q3 — bundle location | `dist/AGENTS_README.md`, copied by `scripts/copy-schemas.js` |
| Q4 — `--help` signpost | Add `or run: minih agent-readme` to existing footer. Verb appears in alphabetical Commands list. |
| Q5 — error path | New error code `E160 README_NOT_FOUND`; JSON envelope to stderr; exit 1. |
| Q6 — scope | v1 = AGENTS_README only. Future `agent-readme <topic>` for how-docs deferred. |
| Q7 — SIGPIPE | Standard Node EPIPE handler; silent exit 0 on `| head` pipelines. |

---

## Implementation Reuse Map

| Need | Existing primitive |
|---|---|
| Commander subcommand registration | `src/cli/commands/*.ts` patterns |
| `--help` postscript | Commander's `program.addHelpText('after', ...)` |
| Error envelope | `src/cli/output.ts` `formatError` + `ErrorCodes` |
| Build-time copy | `scripts/copy-schemas.js` |
| Runtime path resolution | `import.meta.url` + `fileURLToPath` (used in `src/mcp/tools/state.ts:18` for the schema path) |

Estimated implementation surface: ~50 LOC new code + ~50 LOC tests + 2 lines in `package.json` (no `files` change) + 4 lines in `copy-schemas.js`. CS-1.

---

## Quick Reference (cheat sheet for plan-3)

```bash
minih agent-readme              # dumps bundled AGENTS_README.md to stdout
minih agent-readme | less       # paginate
minih agent-readme | head -50   # works (SIGPIPE handled)
minih agent-readme > out.md     # capture
minih --help                     # bottom footer mentions: or run: minih agent-readme
```

**Not in v1**: `agent-readme <topic>`, `agent-readme --list`, `--agents-readme-path` override flag, JSON envelope variant.

---

**Status**: Draft, ready for review. Once approved → `/plan-1b-v2-specify --simple` to derive a CS-1 spec.
