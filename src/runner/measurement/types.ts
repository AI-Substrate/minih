export const PROOF_LEVELS = ['L0', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6'] as const;

export type ProofLevel = (typeof PROOF_LEVELS)[number];

export type TaskKind =
  | 'setup'
  | 'change'
  | 'benchmark'
  | 'research'
  | 'coordination'
  | 'reproducibility';

export type ProofArtifactKind =
  | 'artifact'
  | 'citation'
  | 'command'
  | 'coordination-log'
  | 'decision-record'
  | 'rerun'
  | 'runtime-observation'
  | 'test';

export interface ProofArtifact {
  id: string;
  kind: ProofArtifactKind;
  description: string;
  evidenceRef: string;
}

export interface ProofLevelDefinition {
  level: ProofLevel;
  label: string;
  description: string;
  requiredArtifactKinds: readonly ProofArtifactKind[];
}

export interface ProofRequirement {
  taskKind: TaskKind;
  level: ProofLevel;
  requiredArtifactKinds: readonly ProofArtifactKind[];
  description: string;
}

export interface ProofEvaluationInput {
  taskKind: TaskKind;
  artifacts: readonly ProofArtifact[];
}

export interface ProofEvaluation {
  taskKind: TaskKind;
  level: ProofLevel;
  defaultLevel: ProofLevel;
  validated: boolean;
  requiredArtifactKinds: readonly ProofArtifactKind[];
  missingArtifactKinds: ProofArtifactKind[];
  limitations: string[];
}

export type MeasurementAuthority =
  | 'runner-fact'
  | 'interpretive-classification'
  | 'human-pulse'
  | 'downstream-context';

export type RedactionPosture =
  | 'local-only'
  | 'redacted-export'
  | 'aggregate-only';

export type MetricTraceabilityLevel = 'L1' | 'L2' | 'L3' | 'L4';

export type MetricCategory =
  | 'value-evidence'
  | 'proof-quality'
  | 'flow-friction'
  | 'learning'
  | 'trust-pulse'
  | 'downstream-context';

export type MeasurementFramework =
  | 'accelerate'
  | 'dora'
  | 'essp'
  | 'minih'
  | 'space';

export interface MetricTraceability {
  level: MetricTraceabilityLevel;
  name: string;
  description: string;
}

export interface FrameworkMapping {
  framework: MeasurementFramework;
  relationship: 'direct' | 'aligned' | 'mapped' | 'source-work-needed';
  description: string;
}

export interface MetricDefinition {
  id: string;
  displayName: string;
  category: MetricCategory;
  traceability: MetricTraceability;
  frameworkMappings: readonly FrameworkMapping[];
  frameworkNative: boolean;
  sourceRefs: readonly string[];
  caveats: readonly string[];
  reportingPhrase: string;
}
