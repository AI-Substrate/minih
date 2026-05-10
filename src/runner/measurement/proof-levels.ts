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
  },
  {
    level: 'L1',
    label: 'Narrated claim',
    description:
      'A claim exists with a citation or note but no executable proof.',
    requiredArtifactKinds: ['citation'],
  },
  {
    level: 'L2',
    label: 'Static artifact',
    description: 'A concrete artifact exists but has not been executed.',
    requiredArtifactKinds: ['artifact'],
  },
  {
    level: 'L3',
    label: 'Command evidence',
    description: 'A relevant command or tool invocation produced evidence.',
    requiredArtifactKinds: ['command'],
  },
  {
    level: 'L4',
    label: 'Evidence-backed contract',
    description:
      'A cited decision, contract, or coordination outcome is backed by concrete evidence.',
    requiredArtifactKinds: ['citation', 'decision-record'],
  },
  {
    level: 'L5',
    label: 'Validated working state',
    description:
      'A setup, change, or benchmark has command, test, and observed working-state evidence.',
    requiredArtifactKinds: ['command', 'test', 'runtime-observation'],
  },
  {
    level: 'L6',
    label: 'Reproducible proof',
    description:
      'The proof bundle was independently rerun or replayed from captured evidence.',
    requiredArtifactKinds: ['command', 'test', 'runtime-observation', 'rerun'],
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

export function meetsDefaultValidatedThreshold(
  level: ProofLevel,
  taskKind: TaskKind,
): boolean {
  return (
    compareProofLevels(level, getDefaultProofRequirement(taskKind).level) >= 0
  );
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
    : supportedProofLevel(input.taskKind, presentKinds);

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

function supportedProofLevel(
  taskKind: TaskKind,
  presentKinds: ReadonlySet<ProofEvaluationInput['artifacts'][number]['kind']>,
): ProofLevel {
  if (
    taskKind === 'reproducibility' &&
    hasKinds(presentKinds, ['command', 'test', 'runtime-observation'])
  ) {
    return 'L5';
  }

  if (
    taskKind === 'research' &&
    hasKinds(presentKinds, ['citation', 'decision-record'])
  ) {
    return 'L4';
  }

  if (
    taskKind === 'coordination' &&
    hasKinds(presentKinds, ['citation', 'coordination-log'])
  ) {
    return 'L4';
  }

  if (hasKinds(presentKinds, ['command', 'test', 'runtime-observation'])) {
    return 'L5';
  }

  if (hasKinds(presentKinds, ['command'])) {
    return 'L3';
  }

  if (hasKinds(presentKinds, ['artifact'])) {
    return 'L2';
  }

  if (hasKinds(presentKinds, ['citation'])) {
    return 'L1';
  }

  return 'L0';
}

function hasKinds(
  presentKinds: ReadonlySet<ProofEvaluationInput['artifacts'][number]['kind']>,
  requiredKinds: readonly ProofEvaluationInput['artifacts'][number]['kind'][],
): boolean {
  return requiredKinds.every((kind) => presentKinds.has(kind));
}
