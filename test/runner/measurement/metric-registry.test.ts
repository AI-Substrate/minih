import { describe, expect, it } from 'vitest';
import {
  getMetricDefinition,
  listMetricDefinitions,
  listMetricsByCategory,
  METRIC_REGISTRY,
} from '../../../src/runner/measurement/metric-registry.js';
import type {
  MetricCategory,
  MetricTraceabilityLevel,
} from '../../../src/runner/measurement/types.js';

const scorecardCategories: MetricCategory[] = [
  'value-evidence',
  'proof-quality',
  'flow-friction',
  'learning',
  'trust-pulse',
  'downstream-context',
];

const traceabilityLevels: MetricTraceabilityLevel[] = ['L1', 'L2', 'L3', 'L4'];

describe('metric registry contracts', () => {
  it('uses the canonical L1-L4 traceability ladder', () => {
    expect(
      new Set(METRIC_REGISTRY.map((metric) => metric.traceability.level)),
    ).toEqual(new Set(traceabilityLevels));
  });

  it('keeps every scorecard category represented without collapsing them', () => {
    for (const category of scorecardCategories) {
      expect(listMetricsByCategory(category).length).toBeGreaterThan(0);
    }
  });

  it('requires source refs, caveats, and safe wording for every metric', () => {
    for (const metric of listMetricDefinitions()) {
      expect(metric.sourceRefs.length).toBeGreaterThan(0);
      expect(metric.caveats.length).toBeGreaterThan(0);
      expect(metric.reportingPhrase).toEqual(expect.any(String));
      expect(metric.reportingPhrase.toLowerCase()).not.toContain(
        'productivity score',
      );
    }
  });

  it('marks MiniH-local metrics as mapped or aligned, not framework-native', () => {
    const localMetrics = listMetricDefinitions().filter(
      (metric) =>
        metric.traceability.level === 'L2' ||
        metric.traceability.level === 'L3',
    );

    expect(localMetrics.length).toBeGreaterThan(0);
    for (const metric of localMetrics) {
      expect(metric.frameworkNative).toBe(false);
      expect(metric.reportingPhrase).toMatch(
        /\b(aligned with|mapped to|MiniH-local)\b/,
      );
      expect(metric.reportingPhrase).not.toMatch(
        /\bDORA metric\b|\bSPACE metric\b|\bESSP metric\b/,
      );
    }
  });

  it('exposes required Phase 1 registry entries by stable id', () => {
    expect(getMetricDefinition('time-to-validated-evidence')).toMatchObject({
      category: 'value-evidence',
      traceability: { level: 'L3' },
    });
    expect(getMetricDefinition('validation-depth')).toMatchObject({
      category: 'proof-quality',
      traceability: { level: 'L3' },
    });
    expect(getMetricDefinition('proof-trust-pulse')).toMatchObject({
      category: 'trust-pulse',
      traceability: { level: 'L2' },
    });
    expect(getMetricDefinition('change-lead-time')).toMatchObject({
      category: 'downstream-context',
      traceability: { level: 'L1' },
      frameworkNative: true,
    });
  });

  it('throws on unknown metric ids instead of returning a success-shaped default', () => {
    expect(() => getMetricDefinition('missing-metric')).toThrow(
      /Unknown metric id: missing-metric/,
    );
  });
});
