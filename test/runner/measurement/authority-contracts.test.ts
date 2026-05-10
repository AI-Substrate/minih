import { describe, expect, it } from 'vitest';
import {
  FORBIDDEN_MEASUREMENT_VIEWS,
  isForbiddenMeasurementView,
  MEASUREMENT_AUTHORITY_CONTRACTS,
  MEASUREMENT_DATA_STATUSES,
  MEASUREMENT_SCHEMA_VERSION,
  MISSING_DATA_REASONS,
  REDACTION_POSTURE_CONTRACTS,
} from '../../../src/runner/measurement/authority.js';
import type {
  MeasurementAuthority,
  RedactionPosture,
} from '../../../src/runner/measurement/types.js';

describe('measurement authority and redaction contracts', () => {
  it('keeps the schema version and missing-data vocabulary explicit', () => {
    expect(MEASUREMENT_SCHEMA_VERSION).toBe('1');
    expect(MISSING_DATA_REASONS).toEqual([
      'not-applicable',
      'not-collected',
      'not-configured',
      'redacted',
    ]);
    expect(MEASUREMENT_DATA_STATUSES).toEqual([
      'available',
      'missing',
      'not-applicable',
      'not-configured',
      'redacted',
    ]);
  });

  it('defines every authority class without allowing runner-fact overrides', () => {
    const authorities: MeasurementAuthority[] = [
      'runner-fact',
      'interpretive-classification',
      'human-pulse',
      'downstream-context',
    ];

    expect(Object.keys(MEASUREMENT_AUTHORITY_CONTRACTS).sort()).toEqual(
      [...authorities].sort(),
    );

    for (const authority of authorities) {
      const contract = MEASUREMENT_AUTHORITY_CONTRACTS[authority];
      expect(contract.authority).toBe(authority);
      expect(contract.sourceOfTruth).toEqual(expect.any(String));
      expect(contract.canOverrideRunnerFacts).toBe(false);
    }

    expect(MEASUREMENT_AUTHORITY_CONTRACTS['runner-fact']).toMatchObject({
      createsRunnerFacts: true,
      defaultRedactionPosture: 'redacted-export',
    });
    expect(
      MEASUREMENT_AUTHORITY_CONTRACTS['interpretive-classification'],
    ).toMatchObject({
      createsRunnerFacts: false,
      defaultRedactionPosture: 'redacted-export',
    });
    expect(MEASUREMENT_AUTHORITY_CONTRACTS['human-pulse']).toMatchObject({
      createsRunnerFacts: false,
      defaultRedactionPosture: 'aggregate-only',
    });
  });

  it('defines export posture constraints, including pulse minimum group size', () => {
    const postures: RedactionPosture[] = [
      'aggregate-only',
      'local-only',
      'redacted-export',
    ];

    expect(Object.keys(REDACTION_POSTURE_CONTRACTS).sort()).toEqual(
      [...postures].sort(),
    );

    for (const posture of postures) {
      const contract = REDACTION_POSTURE_CONTRACTS[posture];
      expect(contract.posture).toBe(posture);
      expect(contract.requiresProvenance).toBe(true);
      expect(contract.allowsIndividualRows).toBe(false);
    }

    expect(REDACTION_POSTURE_CONTRACTS['aggregate-only']).toMatchObject({
      exportable: true,
      minimumGroupSize: 5,
    });
    expect(REDACTION_POSTURE_CONTRACTS['local-only'].exportable).toBe(false);
  });

  it('names the reporting views that measurement contracts must reject', () => {
    expect(FORBIDDEN_MEASUREMENT_VIEWS).toEqual([
      'composite-productivity-score',
      'individual-productivity-score',
      'inferred-sentiment-from-telemetry',
      'stack-ranking',
      'unsupported-causal-claim',
    ]);
    expect(isForbiddenMeasurementView('composite-productivity-score')).toBe(
      true,
    );
    expect(isForbiddenMeasurementView('balanced-scorecard-category')).toBe(
      false,
    );
  });
});
