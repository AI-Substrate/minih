import { describe, expect, it } from 'vitest';
import {
  evaluateProof,
  getDefaultProofRequirement,
  getProofLevelDefinition,
  PROOF_LEVEL_DEFINITIONS,
} from '../../../src/runner/measurement/proof-levels.js';
import type {
  ProofArtifact,
  ProofLevel,
  TaskKind,
} from '../../../src/runner/measurement/types.js';

const allProofLevels: ProofLevel[] = ['L0', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6'];

function artifact(kind: ProofArtifact['kind']): ProofArtifact {
  return {
    id: `artifact-${kind}`,
    kind,
    description: `${kind} evidence`,
    evidenceRef: `evidence:${kind}`,
  };
}

describe('proof-level contracts', () => {
  it('defines exactly the local L0-L6 proof ladder', () => {
    expect(
      PROOF_LEVEL_DEFINITIONS.map((definition) => definition.level),
    ).toEqual(allProofLevels);

    for (const level of allProofLevels) {
      const definition = getProofLevelDefinition(level);
      expect(definition.level).toBe(level);
      expect(definition.label).toEqual(expect.any(String));
      expect(definition.description).toEqual(expect.any(String));
      expect(definition.scorecardValidated).toBe(
        level === 'L5' || level === 'L6',
      );
    }
  });

  it.each([
    ['setup', 'L5'],
    ['change', 'L5'],
    ['benchmark', 'L5'],
    ['research', 'L4'],
    ['coordination', 'L4'],
    ['reproducibility', 'L6'],
  ] satisfies Array<
    [TaskKind, ProofLevel]
  >)('uses %s task default proof threshold %s', (taskKind, expectedLevel) => {
    expect(getDefaultProofRequirement(taskKind).level).toBe(expectedLevel);
  });

  it('requires state/system evidence for setup, change, and benchmark defaults', () => {
    for (const taskKind of [
      'setup',
      'change',
      'benchmark',
    ] satisfies TaskKind[]) {
      expect(
        getDefaultProofRequirement(taskKind).requiredArtifactKinds,
      ).toEqual(['command', 'test', 'runtime-observation']);
    }
  });

  it('requires cited contract evidence for research and coordination defaults', () => {
    expect(
      getDefaultProofRequirement('research').requiredArtifactKinds,
    ).toEqual(['citation', 'decision-record']);
    expect(
      getDefaultProofRequirement('coordination').requiredArtifactKinds,
    ).toEqual(['citation', 'coordination-log']);
  });

  it('reserves L6 for reproducibility claims with rerun evidence', () => {
    const requirement = getDefaultProofRequirement('reproducibility');

    expect(requirement.level).toBe('L6');
    expect(requirement.requiredArtifactKinds).toEqual([
      'command',
      'test',
      'runtime-observation',
      'rerun',
    ]);
  });

  it('validates a setup proof when all default artifacts are present', () => {
    expect(
      evaluateProof({
        taskKind: 'setup',
        artifacts: [
          artifact('command'),
          artifact('test'),
          artifact('runtime-observation'),
        ],
      }),
    ).toMatchObject({
      level: 'L5',
      defaultLevel: 'L5',
      validated: true,
      missingArtifactKinds: [],
    });
  });

  it('labels incomplete default proof as lower-confidence instead of validated', () => {
    expect(
      evaluateProof({
        taskKind: 'change',
        artifacts: [artifact('command'), artifact('test')],
      }),
    ).toMatchObject({
      level: 'L4',
      defaultLevel: 'L5',
      validated: false,
      missingArtifactKinds: ['runtime-observation'],
    });
  });

  it('validates research and coordination claims at L4 with cited artifacts', () => {
    expect(
      evaluateProof({
        taskKind: 'research',
        artifacts: [artifact('citation'), artifact('decision-record')],
      }),
    ).toMatchObject({ level: 'L4', validated: true });

    expect(
      evaluateProof({
        taskKind: 'coordination',
        artifacts: [artifact('citation'), artifact('coordination-log')],
      }),
    ).toMatchObject({ level: 'L4', validated: true });
  });

  it('does not validate reproducibility without rerun evidence', () => {
    expect(
      evaluateProof({
        taskKind: 'reproducibility',
        artifacts: [
          artifact('command'),
          artifact('test'),
          artifact('runtime-observation'),
        ],
      }),
    ).toMatchObject({
      level: 'L5',
      defaultLevel: 'L6',
      validated: false,
      missingArtifactKinds: ['rerun'],
    });
  });
});
