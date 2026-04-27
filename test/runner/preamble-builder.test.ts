import { describe, expect, it } from 'vitest';
import {
  buildInsidePreamble,
  type PreambleAssemblyInput,
} from '../../src/runner/preamble-builder.js';
import type { AgentDefinition } from '../../src/runner/types.js';

function definition(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    slug: 'coord-agent',
    description: 'Coordination agent',
    tags: [],
    dir: '/agents/coord-agent',
    promptPath: '/agents/coord-agent/prompt.md',
    schemaPath: null,
    instructionsPath: null,
    inputSchemaPath: null,
    ...overrides,
  };
}

function input(
  overrides: Partial<PreambleAssemblyInput> = {},
): PreambleAssemblyInput {
  return {
    definition: definition(),
    runId: 'run-123',
    preamble: 'UNIVERSAL PREAMBLE',
    instructions: 'AGENT INSTRUCTIONS',
    outputHint: 'Write your final JSON report to: /tmp/report.json',
    paramsHint: '## Input Parameters\n\nfile_path: /src/main.ts',
    userPrompt: '# Agent Body\n\nDo the thing.',
    systemOutputInstructions: 'SYSTEM OUTPUT INSTRUCTIONS',
    ...overrides,
  };
}

describe('buildInsidePreamble', () => {
  it('matches the existing inline assembly exactly when coordination is disabled', () => {
    const assemblyInput = input({
      definition: definition({ coordination: { enabled: false } }),
    });

    const expected = [
      assemblyInput.preamble,
      assemblyInput.instructions,
      assemblyInput.outputHint,
      assemblyInput.paramsHint,
      assemblyInput.userPrompt,
      assemblyInput.systemOutputInstructions,
    ]
      .filter(Boolean)
      .join('\n\n---\n\n');

    expect(buildInsidePreamble(assemblyInput)).toBe(expected);
    expect(buildInsidePreamble(assemblyInput)).toMatchInlineSnapshot(`
      "UNIVERSAL PREAMBLE

      ---

      AGENT INSTRUCTIONS

      ---

      Write your final JSON report to: /tmp/report.json

      ---

      ## Input Parameters

      file_path: /src/main.ts

      ---

      # Agent Body

      Do the thing.

      ---

      SYSTEM OUTPUT INSTRUCTIONS"
    `);
  });

  it('defaults absent coordination to the disabled byte-equivalent path', () => {
    const assemblyInput = input({ definition: definition() });

    const expected = [
      assemblyInput.preamble,
      assemblyInput.instructions,
      assemblyInput.outputHint,
      assemblyInput.paramsHint,
      assemblyInput.userPrompt,
      assemblyInput.systemOutputInstructions,
    ]
      .filter(Boolean)
      .join('\n\n---\n\n');

    expect(buildInsidePreamble(assemblyInput)).toBe(expected);
  });

  it('renders the coordinated identity block without outside.md', () => {
    const prompt = buildInsidePreamble(
      input({
        definition: definition({ coordination: { enabled: true } }),
      }),
    );

    expect(prompt).toContain('<!-- coordination.identity-block -->');
    expect(prompt).toContain('## Your Context (coordination)');
    expect(prompt).toContain(
      'You are running as the inside minih agent for `coord-agent`.',
    );
    expect(prompt).toContain('This run id is `run-123`.');
    expect(prompt).toContain('You have a peer outside the minih session');
    expect(prompt).toContain('Treat outside inbox messages and outside state');
    expect(prompt).toContain('<!-- coordination.tools-section -->');
    expect(prompt).toContain('## Coordination tools available to you');
    for (const tool of [
      'inbox_list',
      'inbox_send',
      'inbox_ack',
      'state_get',
      'state_set',
      'state_transition',
    ]) {
      expect(prompt).toContain(tool);
    }
    expect(prompt).toContain('## Coordination pre-completion checklist');
    expect(
      prompt.indexOf('## Coordination pre-completion checklist'),
    ).toBeLessThan(prompt.indexOf('SYSTEM OUTPUT INSTRUCTIONS'));
    expect(prompt).not.toContain('coordination.peer-contract');
    expect(prompt).toMatchInlineSnapshot(`
      "UNIVERSAL PREAMBLE

      ---

      <!-- coordination.identity-block -->

      ## Your Context (coordination)

      - You are running as the inside minih agent for \`coord-agent\`.
      - This run id is \`run-123\`.
      - You have a peer outside the minih session: the host caller, human, CI job, or sibling agent coordinating this work.
      - Treat outside inbox messages and outside state as peer context, and send inside replies/state updates when the peer needs progress or review evidence.

      ---

      <!-- coordination.tools-section -->

      ## Coordination tools available to you

      Use the inside MCP tools when you need to coordinate with the outside peer:

      - \`inbox_list\` — read outside messages; use \`unread: true\` to focus on new work.
      - \`inbox_send\` — send progress, questions, review evidence, or completion notes to the outside peer.
      - \`inbox_ack\` — acknowledge an outside message after you have handled it.
      - \`state_get\` — inspect your inside state and the outside peer state.
      - \`state_set\` — publish your current inside state.
      - \`state_transition\` — move your inside status and append transition history.

      ---

      Write your final JSON report to: /tmp/report.json

      ---

      ## Input Parameters

      file_path: /src/main.ts

      ---

      # Agent Body

      Do the thing.

      ---

      AGENT INSTRUCTIONS

      ---

      <!-- coordination.pre-completion-checklist -->

      ## Coordination pre-completion checklist

      Before writing the final JSON report:

      - Check \`inbox_list\` for unresolved outside requests.
      - Send final progress or review evidence with \`inbox_send\` when the outside peer needs it.
      - Update inside state with \`state_set\` or \`state_transition\` so the peer can observe your final status.
      - Mention coordination blockers or follow-ups in \`retrospective.coordination\` when relevant.

      ---

      SYSTEM OUTPUT INSTRUCTIONS"
    `);
  });

  it('renders outside.md as a blockquote-framed peer contract when present', () => {
    const prompt = buildInsidePreamble(
      input({
        definition: definition({
          coordination: { enabled: true },
          outsideContract: 'Outside line 1\nOutside line 2',
        }),
      }),
    );

    expect(prompt).toContain('<!-- coordination.peer-contract -->');
    expect(prompt).toContain("## Peer's Contract (from outside.md)");
    expect(prompt).toContain('> Outside line 1\n> Outside line 2');
  });

  it('does not expose an isResume option because callers gate resume turns', () => {
    expect('isResume' in input()).toBe(false);
  });
});
