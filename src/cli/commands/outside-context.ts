import type { Command } from 'commander';
import type { AgentDefinition } from '../../runner/index.js';
import { resolveAgentOrExit } from '../coordination.js';
import { exitWithEnvelope, formatSuccess } from '../output.js';

const COMMAND = 'outside-context';

const SYSTEM_CONTEXT = `# Outside Context - minih coordination surface

You are the outside half of a minih agent run: a human at a shell, a CI step, or a host agent driving an inside minih session.

## How minih works

minih is a declarative agent runner. All non-interactive minih commands write JSON envelopes on stdout and human-readable text on stderr. Use \`2>/dev/null\` when you need clean JSON.

## Coordination commands

- \`minih outside-send <slug> --type <t> --subject "..." --body "..."\` sends a message to the inside agent.
- \`minih outside-inbox-list <slug> [--type <t>] [--unread]\` reads messages the inside agent sent back.
- \`minih state get <slug> [--side outside|inside|both] [--key <dot.path>]\` inspects coordination state.
- \`minih state set <slug> --side outside --status <s>\` or \`--key status --value <s>\` updates your side.
- \`minih state transition <slug> --to <s> [--reason "..."]\` records an outside status transition.
- \`minih outside-retro <slug> --body "..."\` records your coordination feedback.
- \`minih retros [--agent <slug>] [--side inside|outside] [--target project|minih|coordination]\` reviews accumulated feedback.

## Coordination state

The inside agent owns \`inside.json\`; outside owns \`outside.json\`. minih validates shapes and appends history, but it does not enforce a rule machine. If one side disagrees with the other side's state, coordinate with inbox messages.

## Reporting back

Your experience improves the harness. When done, send:

    minih outside-retro <slug> --body "WORKED WELL: ...
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
        `This agent has no outside.md. Run \`minih init ${definition.slug} --coordinated\` after Phase 6 scaffolding lands, or ask the agent author what coordination behavior to expect.\n`,
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

export function registerOutsideContextCommand(program: Command): void {
  program
    .command(`${COMMAND} [slug]`)
    .description('Print the outside coordination context markdown')
    .action((slug: string | undefined) => {
      const agentsDir = program.opts().agentsDir ?? 'agents';
      const definition = slug
        ? resolveAgentOrExit(COMMAND, slug, agentsDir)
        : null;
      const built = buildOutsideContext(definition);

      process.stderr.write(`${built.context}\n`);

      exitWithEnvelope(
        formatSuccess(COMMAND, {
          slug: slug ?? null,
          ...built,
        }),
      );
    });
}
