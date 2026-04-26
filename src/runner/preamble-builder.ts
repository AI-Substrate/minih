import type { AgentDefinition } from './types.js';

const SECTION_DIVIDER = '\n\n---\n\n';

const IDENTITY_BLOCK_STUB = `<!-- coordination.identity-block:stub -->

## Your Context (coordination)

_(P6 wires identity content here.)_`;

const TOOLS_SECTION_STUB = `<!-- coordination.tools-section:stub -->

## Coordination tools available to you

_(P6 wires workshop-005 tools section here.)_`;

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
    IDENTITY_BLOCK_STUB,
    TOOLS_SECTION_STUB,
    peerContractSection(input.definition.outsideContract),
    input.outputHint,
    input.paramsHint,
    input.userPrompt,
    input.instructions,
    input.systemOutputInstructions,
  ]
    .filter(Boolean)
    .join(SECTION_DIVIDER);
}

function peerContractSection(
  outsideContract: string | undefined,
): string | null {
  if (outsideContract === undefined) return null;
  const quoted = outsideContract
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
  return `<!-- coordination.peer-contract:stub -->

## Peer's Contract (from outside.md)

${quoted}`;
}
