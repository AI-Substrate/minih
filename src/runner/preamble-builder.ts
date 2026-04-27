import type { AgentDefinition } from './types.js';

const SECTION_DIVIDER = '\n\n---\n\n';

const COORDINATION_TOOLS_SECTION = `<!-- coordination.tools-section -->

## Coordination tools available to you

Use the inside MCP tools when you need to coordinate with the outside peer:

- \`inbox_list\` — read outside messages; use \`unread: true\` to focus on new work.
- \`inbox_send\` — send progress, questions, review evidence, or completion notes to the outside peer.
- \`inbox_ack\` — acknowledge an outside message after you have handled it.
- \`state_get\` — inspect your inside state and the outside peer state.
- \`state_set\` — publish your current inside state.
- \`state_transition\` — move your inside status and append transition history.`;

const COORDINATION_PRE_COMPLETION_CHECKLIST = `<!-- coordination.pre-completion-checklist -->

## Coordination pre-completion checklist

Before writing the final JSON report:

- Check \`inbox_list\` for unresolved outside requests.
- Send final progress or review evidence with \`inbox_send\` when the outside peer needs it.
- Update inside state with \`state_set\` or \`state_transition\` so the peer can observe your final status.
- Mention coordination blockers or follow-ups in \`retrospective.coordination\` when relevant.`;

export interface PreambleAssemblyInput {
  definition: AgentDefinition;
  runId: string;
  preamble: string | null;
  instructions: string | null;
  outputHint: string;
  paramsHint: string | null;
  userPrompt: string;
  systemOutputInstructions: string;
}

/**
 * Assemble the full inside-agent preamble for a fresh run.
 *
 * Always assembles the full inside preamble; do not call for resume turns.
 * Resume callers send only the follow-up message because SDK conversation
 * history already contains the original preamble.
 */
export function buildInsidePreamble(input: PreambleAssemblyInput): string {
  const coord = input.definition.coordination ?? { enabled: false };
  if (!coord.enabled) {
    return [
      input.preamble,
      input.instructions,
      input.outputHint,
      input.paramsHint,
      input.userPrompt,
      input.systemOutputInstructions,
    ]
      .filter(Boolean)
      .join(SECTION_DIVIDER);
  }

  return [
    input.preamble,
    identityBlock(input.definition.slug, input.runId),
    COORDINATION_TOOLS_SECTION,
    peerContractSection(input.definition.outsideContract),
    input.outputHint,
    input.paramsHint,
    input.userPrompt,
    input.instructions,
    COORDINATION_PRE_COMPLETION_CHECKLIST,
    input.systemOutputInstructions,
  ]
    .filter(Boolean)
    .join(SECTION_DIVIDER);
}

function identityBlock(slug: string, runId: string): string {
  return `<!-- coordination.identity-block -->

## Your Context (coordination)

- You are running as the inside minih agent for \`${slug}\`.
- This run id is \`${runId}\`.
- You have a peer outside the minih session: the host caller, human, CI job, or sibling agent coordinating this work.
- Treat outside inbox messages and outside state as peer context, and send inside replies/state updates when the peer needs progress or review evidence.`;
}

function peerContractSection(
  outsideContract: string | undefined,
): string | null {
  if (outsideContract === undefined) return null;
  const quoted = outsideContract
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
  return `<!-- coordination.peer-contract -->

## Peer's Contract (from outside.md)

${quoted}`;
}
