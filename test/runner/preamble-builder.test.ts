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

  it('renders identity and tools stubs for coordinated agents without outside.md', () => {
    const prompt = buildInsidePreamble(
      input({
        definition: definition({ coordination: { enabled: true } }),
      }),
    );

    expect(prompt).toContain('<!-- coordination.identity-block:stub -->');
    expect(prompt).toContain('## Your Context (coordination)');
    expect(prompt).toContain('<!-- coordination.tools-section:stub -->');
    expect(prompt).toContain('## Coordination tools available to you');
    expect(prompt).not.toContain('coordination.peer-contract:stub');
    expect(prompt).toMatchInlineSnapshot(`
      "UNIVERSAL PREAMBLE

      ---

      <!-- coordination.identity-block:stub -->

      ## Your Context (coordination)

      _(P6 wires identity content here.)_

      ---

      <!-- coordination.tools-section:stub -->

      ## Coordination tools available to you

      _(P6 wires workshop-005 tools section here.)_

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

    expect(prompt).toContain('<!-- coordination.peer-contract:stub -->');
    expect(prompt).toContain("## Peer's Contract (from outside.md)");
    expect(prompt).toContain('> Outside line 1\n> Outside line 2');
  });

  it('does not expose an isResume option because callers gate resume turns', () => {
    expect('isResume' in input()).toBe(false);
  });
});
