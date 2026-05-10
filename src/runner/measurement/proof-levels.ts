import type {
  ProofEvaluation,
  ProofEvaluationInput,
  ProofLevel,
  ProofLevelDefinition,
  ProofRequirement,
  TaskKind,
} from './types.js';
import { PROOF_LEVELS } from './types.js';

const proofLevelRank = new Map<ProofLevel, number>(
  PROOF_LEVELS.map((level, index) => [level, index]),
);

export const PROOF_LEVEL_DEFINITIONS: readonly ProofLevelDefinition[] = [
  {
    level: 'L0',
    label: 'No evidence',
    description: 'No durable evidence has been captured.',
    requiredArtifactKinds: [],
    scorecardValidated: false,
  },
  {
    level: 'L1',
    label: 'Narrated claim',
    description:
      'A claim exists with a citation or note but no executable proof.',
    requiredArtifactKinds: ['citation'],
    scorecardValidated: false,
  },
  {
    level: 'L2',
    label: 'Static artifact',
    description: 'A concrete artifact exists but has not been executed.',
    requiredArtifactKinds: ['artifact'],
    scorecardValidated: false,
  },
  {
    level: 'L3',
    label: 'Command evidence',
    description: 'A relevant command or tool invocation produced evidence.',
    requiredArtifactKinds: ['command'],
    scorecardValidated: false,
  },
  {
    level: 'L4',
    label: 'Evidence-backed contract',
    description:
      'A cited decision, contract, or coordination outcome is backed by concrete evidence.',
    requiredArtifactKinds: ['citation', 'decision-record'],
    scorecardValidated: false,
  },
  {
    level: 'L5',
    label: 'Validated working state',
    description:
      'A setup, change, or benchmark has command, test, and observed working-state evidence.',
    requiredArtifactKinds: ['command', 'test', 'runtime-observation'],
    scorecardValidated: true,
  },
  {
    level: 'L6',
    label: 'Reproducible proof',
    description:
      'The proof bundle was independently rerun or replayed from captured evidence.',
    requiredArtifactKinds: ['command', 'test', 'runtime-observation', 'rerun'],
    scorecardValidated: true,
  },
];

const taskRequirements: Record<TaskKind, ProofRequirement> = {
  setup: {
    taskKind: 'setup',
    level: 'L5',
    requiredArtifactKinds: ['command', 'test', 'runtime-observation'],
    description:
      'Setup claims need command, automated check, and observed state evidence.',
  },
  change: {
    taskKind: 'change',
    level: 'L5',
    requiredArtifactKinds: ['command', 'test', 'runtime-observation'],
    description:
      'Change claims need command, automated check, and observed state evidence.',
  },
  benchmark: {
    taskKind: 'benchmark',
    level: 'L5',
    requiredArtifactKinds: ['command', 'test', 'runtime-observation'],
    description:
      'Benchmark claims need command, automated check, and observed scenario evidence.',
  },
  research: {
    taskKind: 'research',
    level: 'L4',
    requiredArtifactKinds: ['citation', 'decision-record'],
    description:
      'Research claims need cited evidence and a durable decision record.',
  },
  coordination: {
    taskKind: 'coordination',
    level: 'L4',
    requiredArtifactKinds: ['citation', 'coordination-log'],
    description:
      'Coordination claims need cited evidence and coordination transcript/log proof.',
  },
  reproducibility: {
    taskKind: 'reproducibility',
    level: 'L6',
    requiredArtifactKinds: ['command', 'test', 'runtime-observation', 'rerun'],
    description:
      'Reproducibility claims need the L5 bundle plus clean rerun evidence.',
  },
};

export function getProofLevelDefinition(
  level: ProofLevel,
): ProofLevelDefinition {
  const definition = PROOF_LEVEL_DEFINITIONS.find(
    (item) => item.level === level,
  );
  if (!definition) {
    throw new Error(`Unknown proof level: ${level}`);
  }
  return definition;
}

export function getDefaultProofRequirement(
  taskKind: TaskKind,
): ProofRequirement {
  return taskRequirements[taskKind];
}

export function compareProofLevels(
  left: ProofLevel,
  right: ProofLevel,
): number {
  return rankProofLevel(left) - rankProofLevel(right);
}

export function evaluateProof(input: ProofEvaluationInput): ProofEvaluation {
  const requirement = getDefaultProofRequirement(input.taskKind);
  const presentKinds = new Set(
    input.artifacts.map((artifact) => artifact.kind),
  );
  const missingArtifactKinds = requirement.requiredArtifactKinds.filter(
    (kind) => !presentKinds.has(kind),
  );
  const validated = missingArtifactKinds.length === 0;
  const level = validated
    ? requirement.level
    : lowerConfidenceLevel(requirement.level);

  return {
    taskKind: input.taskKind,
    level,
    defaultLevel: requirement.level,
    validated,
    requiredArtifactKinds: requirement.requiredArtifactKinds,
    missingArtifactKinds,
    limitations: validated
      ? []
      : [
          `Missing ${missingArtifactKinds.join(', ')} evidence for ${requirement.level}.`,
          `Report as lower-confidence ${level}, not as validated ${requirement.level}.`,
        ],
  };
}

function rankProofLevel(level: ProofLevel): number {
  const rank = proofLevelRank.get(level);
  if (rank === undefined) {
    throw new Error(`Unknown proof level: ${level}`);
  }
  return rank;
}

function lowerConfidenceLevel(level: ProofLevel): ProofLevel {
  const rank = Math.max(0, rankProofLevel(level) - 1);
  return PROOF_LEVELS[rank];
}
