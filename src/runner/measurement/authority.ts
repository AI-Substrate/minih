import type {
  ForbiddenMeasurementView,
  MeasurementAuthority,
  MeasurementAuthorityContract,
  MeasurementRedactionContract,
  RedactionPosture,
} from './types.js';

export const MEASUREMENT_SCHEMA_VERSION = '1' as const;

export const MISSING_DATA_REASONS = [
  'not-applicable',
  'not-collected',
  'not-configured',
  'redacted',
] as const;

export const MEASUREMENT_DATA_STATUSES = [
  'available',
  'missing',
  'not-applicable',
  'not-configured',
  'redacted',
] as const;

export const FORBIDDEN_MEASUREMENT_VIEWS = [
  'composite-productivity-score',
  'individual-productivity-score',
  'inferred-sentiment-from-telemetry',
  'stack-ranking',
  'unsupported-causal-claim',
] as const satisfies readonly ForbiddenMeasurementView[];

export const MEASUREMENT_AUTHORITY_CONTRACTS: Record<
  MeasurementAuthority,
  MeasurementAuthorityContract
> = {
  'runner-fact': {
    authority: 'runner-fact',
    sourceOfTruth:
      'Runner-derived evidence such as manifests, events, validations, artifacts, retros, difficulties, coordination snapshots, and benchmark results.',
    mayInterpret: ['cli', 'agents', 'companions'],
    defaultRedactionPosture: 'redacted-export',
    createsRunnerFacts: true,
    canOverrideRunnerFacts: false,
  },
  'interpretive-classification': {
    authority: 'interpretive-classification',
    sourceOfTruth:
      'Agent or companion output that cites runner facts or proof artifacts.',
    mayInterpret: ['agents', 'companions'],
    defaultRedactionPosture: 'redacted-export',
    createsRunnerFacts: false,
    canOverrideRunnerFacts: false,
  },
  'human-pulse': {
    authority: 'human-pulse',
    sourceOfTruth:
      'Explicit aggregate human input about team or system experience.',
    mayInterpret: ['cli', 'agents'],
    defaultRedactionPosture: 'aggregate-only',
    createsRunnerFacts: false,
    canOverrideRunnerFacts: false,
  },
  'downstream-context': {
    authority: 'downstream-context',
    sourceOfTruth:
      'Optional external delivery-system summaries with visible source definitions.',
    mayInterpret: ['cli', 'agents'],
    defaultRedactionPosture: 'redacted-export',
    createsRunnerFacts: false,
    canOverrideRunnerFacts: false,
  },
};

export const REDACTION_POSTURE_CONTRACTS: Record<
  RedactionPosture,
  MeasurementRedactionContract
> = {
  'local-only': {
    posture: 'local-only',
    exportable: false,
    requiresProvenance: true,
    allowsIndividualRows: false,
    description:
      'Record may be used locally but is not safe to export beyond the run context.',
  },
  'redacted-export': {
    posture: 'redacted-export',
    exportable: true,
    requiresProvenance: true,
    allowsIndividualRows: false,
    description:
      'Record may be exported only with evidence IDs, provenance, and personal or sensitive fields removed.',
  },
  'aggregate-only': {
    posture: 'aggregate-only',
    exportable: true,
    requiresProvenance: true,
    allowsIndividualRows: false,
    minimumGroupSize: 5,
    description:
      'Only team or system aggregate records are exportable; individual rows and under-threshold groups are suppressed.',
  },
};

export function isForbiddenMeasurementView(
  view: string,
): view is ForbiddenMeasurementView {
  return FORBIDDEN_MEASUREMENT_VIEWS.includes(view as ForbiddenMeasurementView);
}
