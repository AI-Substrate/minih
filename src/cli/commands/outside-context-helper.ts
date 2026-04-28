/**
 * Outside context builder — extracted from former outside-context.ts so both
 * the new `outside context` subcommand and any future Phase 2 (Ink TUI)
 * consumer can reuse it.
 */

import type { AgentDefinition } from '../../runner/index.js';

const SYSTEM_CONTEXT = `# Outside Context - minih coordination surface

You are the outside half of a minih agent run: a human at a shell, a CI step, or a host agent driving an inside minih session.

## How minih works

minih is a declarative agent runner. All non-interactive minih commands write JSON envelopes on stdout and human-readable text on stderr. Use \`2>/dev/null\` when you need clean JSON.

## Coordination commands (lane-grouped, plan 010)

- \`minih outside inbox send <slug> --type <t> --subject "..." --body "..."\` sends a message to the inside agent.
- \`minih outside inbox list <slug> [--wait <ms>] [--type <t>] [--unread] [--after <id>]\` lists outside-lane messages (what you sent), with optional long-poll.
- \`minih inside inbox list <slug> [--wait <ms>] [--type <t>] [--unread] [--after <id>]\` reads messages the inside agent sent back, with optional long-poll.
- \`minih outside state get <slug> [--key <dot.path>]\` reads outside state.
- \`minih inside state get <slug> [--key <dot.path>]\` reads inside state (read-only from CLI).
- \`minih state get <slug>\` reads BOTH lanes (cross-lane view).
- \`minih outside state set <slug> --status <s>\` updates outside state.
- \`minih outside state transition <slug> --to <s> [--reason "..."]\` records an outside status transition.
- \`minih outside retro add <slug> --body "..."\` records your coordination feedback.
- \`minih inside retro show <slug>\` reads the inside retro from the agent's farewell envelope.
- \`minih retros [--agent <slug>] [--side inside|outside] [--target project|minih|coordination]\` reviews accumulated feedback.

## Coordination state

The inside agent owns \`inside.json\`; outside owns \`outside.json\`. minih validates shapes and appends history, but it does not enforce a rule machine. If one side disagrees with the other side's state, coordinate with inbox messages.

## Reporting back

Your experience improves the harness. When done, send:

    minih outside retro add <slug> --body "WORKED WELL: ...
    CONFUSING: ...
    MAGIC WAND: ..."
`;

export function buildOutsideContext(definition: AgentDefinition | null): {
  context: string;
  hasOutsideContract: boolean | null;
  contractStatus: 'system-only' | 'present' | 'empty' | 'absent';
} {
  if (!definition) {
    return {
      context: SYSTEM_CONTEXT,
      hasOutsideContract: null,
      contractStatus: 'system-only',
    };
  }

  const header = `\n---\n\n# Per-agent contract: ${definition.slug}\n\n`;
  if (definition.outsideContract === undefined) {
    return {
      context:
        SYSTEM_CONTEXT +
        header +
        `This agent has no outside.md. Run \`minih init ${definition.slug} --coordinated\` to scaffold one, or ask the agent author what coordination behavior to expect.\n`,
      hasOutsideContract: false,
      contractStatus: 'absent',
    };
  }

  if (definition.outsideContract === '') {
    return {
      context:
        SYSTEM_CONTEXT +
        header +
        'This agent has an empty outside.md. Treat that as no additional per-agent outside contract.\n',
      hasOutsideContract: true,
      contractStatus: 'empty',
    };
  }

  return {
    context: SYSTEM_CONTEXT + header + definition.outsideContract,
    hasOutsideContract: true,
    contractStatus: 'present',
  };
}
