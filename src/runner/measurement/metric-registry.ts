import type {
  MetricCategory,
  MetricDefinition,
  MetricTraceabilityLevel,
} from './types.js';

export const TRACEABILITY_LEVELS: Record<MetricTraceabilityLevel, string> = {
  L1: 'Direct Literature',
  L2: 'Literature-Aligned',
  L3: 'Local Harness Extension',
  L4: 'Needs Source Work',
};

export const METRIC_REGISTRY = [
  {
    id: 'time-to-validated-evidence',
    displayName: 'Time to Validated Evidence',
    category: 'value-evidence',
    traceability: {
      level: 'L3',
      name: TRACEABILITY_LEVELS.L3,
      description:
        'MiniH-local north-star metric for elapsed time from task intent to trustworthy evidence.',
    },
    frameworkMappings: [
      {
        framework: 'space',
        relationship: 'mapped',
        description:
          'Maps to SPACE efficiency/flow and outcome-quality framing.',
      },
      {
        framework: 'essp',
        relationship: 'mapped',
        description:
          'Maps to ESSP leading indicators near engineering friction points.',
      },
      {
        framework: 'dora',
        relationship: 'aligned',
        description:
          'Aligned with DORA improvement-loop leading-indicator guidance.',
      },
    ],
    frameworkNative: false,
    sourceRefs: [
      'workshops/001-literature-traceability-matrix.md:64',
      'minih-harness-measurement-spec.md:25',
    ],
    caveats: [
      'Not a named SPACE, DORA, ESSP, or Accelerate metric.',
      'Must be paired with proof quality so speed does not weaken evidence.',
    ],
    reportingPhrase:
      'MiniH-local north-star metric mapped to SPACE/ESSP/DORA improvement guidance.',
  },
  {
    id: 'validation-depth',
    displayName: 'Validation Depth / Proof Level',
    category: 'proof-quality',
    traceability: {
      level: 'L3',
      name: TRACEABILITY_LEVELS.L3,
      description: 'MiniH-local L0-L6 evidence-strength control.',
    },
    frameworkMappings: [
      {
        framework: 'essp',
        relationship: 'mapped',
        description: 'Maps to ESSP quality and performance zones.',
      },
      {
        framework: 'space',
        relationship: 'mapped',
        description: 'Maps to SPACE performance/outcome quality.',
      },
    ],
    frameworkNative: false,
    sourceRefs: [
      'workshops/001-literature-traceability-matrix.md:74',
      'minih-harness-measurement-spec.md:31',
    ],
    caveats: [
      'Not direct literature; it is a MiniH-specific quality contract.',
      'L5 is the default validated threshold for setup/change/benchmark claims.',
    ],
    reportingPhrase:
      'MiniH-local proof-level metric mapped to ESSP Quality and SPACE Performance.',
  },
  {
    id: 'retry-count-by-milestone',
    displayName: 'Retry Count by Milestone',
    category: 'flow-friction',
    traceability: {
      level: 'L2',
      name: TRACEABILITY_LEVELS.L2,
      description:
        'Operationalizes flow/friction from repeated attempts before a proof stage succeeds.',
    },
    frameworkMappings: [
      {
        framework: 'space',
        relationship: 'aligned',
        description: 'Aligned with SPACE efficiency/flow friction.',
      },
      {
        framework: 'essp',
        relationship: 'aligned',
        description:
          'Aligned with ESSP leading indicators for day-to-day friction.',
      },
    ],
    frameworkNative: false,
    sourceRefs: ['workshops/001-literature-traceability-matrix.md:85'],
    caveats: [
      'Repeated identical failures need deduplication before trend reporting.',
      'Retry counts alone are not value delivery.',
    ],
    reportingPhrase: 'Flow-friction signal aligned with SPACE and ESSP.',
  },
  {
    id: 'difficulty-half-life',
    displayName: 'Difficulty Half-Life',
    category: 'learning',
    traceability: {
      level: 'L3',
      name: TRACEABILITY_LEVELS.L3,
      description:
        'MiniH-local metric for how quickly discovered friction becomes verified reusable capability.',
    },
    frameworkMappings: [
      {
        framework: 'accelerate',
        relationship: 'mapped',
        description: 'Maps to capability-improvement framing.',
      },
      {
        framework: 'dora',
        relationship: 'aligned',
        description: 'Aligned with DORA continuous-improvement loops.',
      },
    ],
    frameworkNative: false,
    sourceRefs: ['workshops/001-literature-traceability-matrix.md:89'],
    caveats: [
      'Not found in DORA/SPACE/Accelerate/ESSP as a named metric.',
      'Requires verified mitigation lifecycle data before reporting.',
    ],
    reportingPhrase:
      'MiniH-local learning metric mapped to Accelerate/DORA capability improvement.',
  },
  {
    id: 'proof-trust-pulse',
    displayName: 'Proof Trust Pulse',
    category: 'trust-pulse',
    traceability: {
      level: 'L2',
      name: TRACEABILITY_LEVELS.L2,
      description:
        'MiniH-specific aggregate pulse question aligned with developer satisfaction/trust.',
    },
    frameworkMappings: [
      {
        framework: 'space',
        relationship: 'aligned',
        description: 'Aligned with SPACE satisfaction and well-being.',
      },
      {
        framework: 'essp',
        relationship: 'aligned',
        description: 'Aligned with ESSP engineering tooling satisfaction.',
      },
    ],
    frameworkNative: false,
    sourceRefs: ['workshops/001-literature-traceability-matrix.md:107'],
    caveats: [
      'Human trust cannot be inferred solely from telemetry.',
      'Pulse data must remain team/system aggregate only.',
    ],
    reportingPhrase:
      'Aggregate trust signal aligned with SPACE satisfaction and ESSP tooling satisfaction.',
  },
  {
    id: 'change-lead-time',
    displayName: 'Change Lead Time',
    category: 'downstream-context',
    traceability: {
      level: 'L1',
      name: TRACEABILITY_LEVELS.L1,
      description:
        'DORA downstream delivery-speed metric from the local source corpus.',
    },
    frameworkMappings: [
      {
        framework: 'dora',
        relationship: 'direct',
        description:
          'Direct DORA metric when sourced from delivery-system data.',
      },
      {
        framework: 'essp',
        relationship: 'direct',
        description:
          'Direct ESSP velocity metric when sourced from delivery-system data.',
      },
    ],
    frameworkNative: true,
    sourceRefs: ['workshops/001-literature-traceability-matrix.md:117'],
    caveats: [
      'Requires VCS-to-deploy linkage and is not a MiniH leading metric.',
      'Should be unavailable/not configured until downstream data exists.',
    ],
    reportingPhrase:
      'DORA/ESSP downstream delivery context when an explicit delivery source is configured.',
  },
  {
    id: 'reliability-source-version',
    displayName: 'Reliability Source Version',
    category: 'downstream-context',
    traceability: {
      level: 'L4',
      name: TRACEABILITY_LEVELS.L4,
      description:
        'Placeholder for reliability claims that need stronger source-version selection.',
    },
    frameworkMappings: [
      {
        framework: 'dora',
        relationship: 'source-work-needed',
        description:
          'DORA reliability wording depends on the selected source version.',
      },
    ],
    frameworkNative: false,
    sourceRefs: ['workshops/001-literature-traceability-matrix.md:122'],
    caveats: [
      'Do not report reliability as a supported DORA metric without choosing and citing the source version.',
      'This record exists to keep downstream context honest, not to score MiniH.',
    ],
    reportingPhrase:
      'source-work-needed downstream context; do not report as a supported framework metric.',
  },
] satisfies readonly MetricDefinition[];

export function listMetricDefinitions(): readonly MetricDefinition[] {
  return METRIC_REGISTRY;
}

export function listMetricsByCategory(
  category: MetricCategory,
): readonly MetricDefinition[] {
  return METRIC_REGISTRY.filter((metric) => metric.category === category);
}

export function getMetricDefinition(metricId: string): MetricDefinition {
  const metric = METRIC_REGISTRY.find((item) => item.id === metricId);
  if (!metric) {
    throw new Error(`Unknown metric id: ${metricId}`);
  }
  return metric;
}
