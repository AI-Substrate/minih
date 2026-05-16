/**
 * AJV strict-mode validation of the four coordination schemas added in P1.
 *
 * Verifies:
 * - Each schema parses as plain JSON (no JSONC comments).
 * - AJV (strict mode) compiles each without error.
 * - `ajv-formats` is registered so `format: date-time` actually rejects bad input.
 * - Positive + negative samples assert correctly per schema.
 * - A malformed schema string surfaces a clear load error.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';

const SCHEMAS_DIR = path.resolve(__dirname, '../../src/schemas');
const SCHEMA_FILES = [
  'inbox-message.json',
  'outside-state.json',
  'inside-state.json',
  'state-history-entry.json',
] as const;

const MEASUREMENT_SCHEMA_FILES = [
  'measurement-event.json',
  'proof-summary.json',
  'measurement-scorecard.json',
  'measurement-classification.json',
  'pulse-aggregate.json',
  'benchmark-catalog.json',
] as const;

function makeAjv(): Ajv2020 {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  return ajv;
}

function loadSchema(file: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(SCHEMAS_DIR, file), 'utf8'));
}

function compileSchema(file: string) {
  return makeAjv().compile(loadSchema(file));
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe('coordination schemas (P1)', () => {
  it.each(SCHEMA_FILES)('%s parses as plain JSON (no comments)', (file) => {
    const raw = fs.readFileSync(path.join(SCHEMAS_DIR, file), 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it.each(SCHEMA_FILES)('%s compiles via AJV strict mode', (file) => {
    const schema = JSON.parse(
      fs.readFileSync(path.join(SCHEMAS_DIR, file), 'utf8'),
    );
    const ajv = makeAjv();
    expect(() => ajv.compile(schema)).not.toThrow();
    expect(schema.$id).toMatch(/^https:\/\/minih\.dev\/schemas\//);
  });

  it.each(SCHEMA_FILES)('%s declares draft-2020-12 $schema', (file) => {
    const schema = JSON.parse(
      fs.readFileSync(path.join(SCHEMAS_DIR, file), 'utf8'),
    );
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
  });

  describe('inbox-message.json samples', () => {
    const schema = JSON.parse(
      fs.readFileSync(path.join(SCHEMAS_DIR, 'inbox-message.json'), 'utf8'),
    );
    const validate = makeAjv().compile(schema);

    it('accepts a well-formed message', () => {
      expect(
        validate({
          id: '01HZ7T8B0Z9MQ3GHJK4M5N6PQR',
          sender: 'outside',
          type: 'note',
          subject: 'milestone 2 done',
          body: 'ready for review',
          ts: '2026-04-26T05:00:00.000Z',
        }),
      ).toBe(true);
    });

    it('rejects a message with bad date-time (proves ajv-formats is wired)', () => {
      expect(
        validate({
          id: '01HZ7T8B0Z9MQ3GHJK4M5N6PQR',
          sender: 'outside',
          type: 'note',
          subject: 'x',
          body: '',
          ts: 'not-a-date',
        }),
      ).toBe(false);
    });

    it('rejects an id that does not match the ULID pattern', () => {
      expect(
        validate({
          id: 'not-a-ulid',
          sender: 'outside',
          type: 'note',
          subject: 'x',
          body: '',
          ts: '2026-04-26T05:00:00.000Z',
        }),
      ).toBe(false);
    });

    it('rejects an unknown sender enum value', () => {
      expect(
        validate({
          id: '01HZ7T8B0Z9MQ3GHJK4M5N6PQR',
          sender: 'martian',
          type: 'note',
          subject: 'x',
          body: '',
          ts: '2026-04-26T05:00:00.000Z',
        }),
      ).toBe(false);
    });
  });

  describe('outside-state.json samples', () => {
    const schema = JSON.parse(
      fs.readFileSync(path.join(SCHEMAS_DIR, 'outside-state.json'), 'utf8'),
    );
    const validate = makeAjv().compile(schema);

    it('accepts a default-shape outside state', () => {
      expect(
        validate({
          status: 'in-progress',
          data: { milestone: 2 },
          updatedAt: '2026-04-26T05:00:00.000Z',
          updatedBy: 'outside',
        }),
      ).toBe(true);
    });

    it('rejects updatedBy: inside on outside state', () => {
      expect(
        validate({
          status: 'in-progress',
          data: {},
          updatedAt: '2026-04-26T05:00:00.000Z',
          updatedBy: 'inside',
        }),
      ).toBe(false);
    });

    it('rejects an unknown status value', () => {
      expect(
        validate({
          status: 'reviewing',
          data: {},
          updatedAt: '2026-04-26T05:00:00.000Z',
          updatedBy: 'outside',
        }),
      ).toBe(false);
    });
  });

  describe('inside-state.json samples', () => {
    const schema = JSON.parse(
      fs.readFileSync(path.join(SCHEMAS_DIR, 'inside-state.json'), 'utf8'),
    );
    const validate = makeAjv().compile(schema);

    it('accepts the inside-only "reviewing" status', () => {
      expect(
        validate({
          status: 'reviewing',
          data: {},
          updatedAt: '2026-04-26T05:00:00.000Z',
          updatedBy: 'inside',
        }),
      ).toBe(true);
    });

    it('rejects updatedBy: outside on inside state', () => {
      expect(
        validate({
          status: 'idle',
          data: {},
          updatedAt: '2026-04-26T05:00:00.000Z',
          updatedBy: 'outside',
        }),
      ).toBe(false);
    });
  });

  describe('state-history-entry.json samples', () => {
    const schema = JSON.parse(
      fs.readFileSync(
        path.join(SCHEMAS_DIR, 'state-history-entry.json'),
        'utf8',
      ),
    );
    const validate = makeAjv().compile(schema);

    it('accepts a transition with peerStateAtTime snapshot', () => {
      expect(
        validate({
          ts: '2026-04-26T05:00:00.000Z',
          side: 'inside',
          from: 'idle',
          to: 'in-progress',
          reason: 'kickoff',
          peerStateAtTime: { status: 'in-progress' },
        }),
      ).toBe(true);
    });

    it('accepts a null reason', () => {
      expect(
        validate({
          ts: '2026-04-26T05:00:00.000Z',
          side: 'outside',
          from: 'idle',
          to: 'in-progress',
          reason: null,
          peerStateAtTime: { status: 'idle' },
        }),
      ).toBe(true);
    });

    it('rejects missing peerStateAtTime', () => {
      expect(
        validate({
          ts: '2026-04-26T05:00:00.000Z',
          side: 'outside',
          from: 'idle',
          to: 'in-progress',
          reason: null,
        }),
      ).toBe(false);
    });
  });

  it('a malformed schema string surfaces a load error loudly', () => {
    const malformed = '{"type":"object",}'; // trailing comma → invalid JSON
    expect(() => JSON.parse(malformed)).toThrow();
  });
});

describe('measurement schemas (plan 020)', () => {
  it.each(MEASUREMENT_SCHEMA_FILES)('%s parses as plain JSON', (file) => {
    expect(() => loadSchema(file)).not.toThrow();
  });

  it.each(
    MEASUREMENT_SCHEMA_FILES,
  )('%s compiles via AJV strict mode', (file) => {
    const schema = loadSchema(file) as { $id?: string };
    const ajv = makeAjv();

    expect(() => ajv.compile(schema)).not.toThrow();
    expect(schema.$id).toMatch(/^https:\/\/minih\.dev\/schemas\//);
  });

  it.each(
    MEASUREMENT_SCHEMA_FILES,
  )('%s declares draft-2020-12 $schema', (file) => {
    const schema = loadSchema(file) as { $schema?: string };
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
  });

  describe('measurement-event.json samples', () => {
    const validate = compileSchema('measurement-event.json');

    it('accepts a runner-owned factual event with provenance and redaction', () => {
      expect(validate(measurementEventSample())).toBe(true);
    });

    it('rejects missing provenance or redaction metadata', () => {
      const missingProvenance = clone(measurementEventSample());
      delete (missingProvenance as Record<string, unknown>).provenance;

      const missingRedaction = clone(measurementEventSample());
      delete (missingRedaction as Record<string, unknown>).redaction;

      expect(validate(missingProvenance)).toBe(false);
      expect(validate(missingRedaction)).toBe(false);
    });
  });

  describe('proof-summary.json samples', () => {
    const validate = compileSchema('proof-summary.json');

    it('accepts a validated L5 proof bundle', () => {
      expect(validate(proofSummarySample())).toBe(true);
    });

    it('rejects omitted proof artifact inventory', () => {
      const invalid = clone(proofSummarySample());
      delete (invalid as Record<string, unknown>).artifacts;

      expect(validate(invalid)).toBe(false);
    });
  });

  describe('measurement-scorecard.json samples', () => {
    const validate = compileSchema('measurement-scorecard.json');

    it('accepts a balanced scorecard with separated categories', () => {
      expect(validate(scorecardSample())).toBe(true);
    });

    it('rejects composite productivity scores and individual rankings', () => {
      expect(
        validate({
          ...scorecardSample(),
          compositeProductivityScore: 94,
        }),
      ).toBe(false);

      const invalid = clone(scorecardSample());
      invalid.categories.valueEvidence.individualRankings = ['dev-a'];
      expect(validate(invalid)).toBe(false);
    });

    it('rejects metric values that contradict missing-data semantics', () => {
      const missingNumber = clone(scorecardSample());
      missingNumber.categories.valueEvidence.metrics[0].value = {
        kind: 'number',
        display: 'n/a',
      };

      const missingWithZero = clone(scorecardSample());
      missingWithZero.categories.downstreamContext.metrics[0].value = {
        kind: 'missing',
        display: 'not configured',
        reason: 'not-configured',
        number: 0,
      };

      expect(validate(missingNumber)).toBe(false);
      expect(validate(missingWithZero)).toBe(false);
    });

    it('rejects unsupported downstream causal claims', () => {
      const invalid = clone(scorecardSample());
      invalid.categories.downstreamContext.metrics[0].causalClaim =
        'MiniH caused deployment frequency to improve.';

      expect(validate(invalid)).toBe(false);
    });
  });

  describe('measurement-classification.json samples', () => {
    const validate = compileSchema('measurement-classification.json');

    it('accepts an explicitly interpretive, evidence-cited classification', () => {
      expect(validate(classificationSample())).toBe(true);
    });

    it('rejects classifications without evidence citations or interpretive marker', () => {
      const missingEvidence = clone(classificationSample());
      missingEvidence.labels[0].evidenceIds = [];

      const missingMarker = clone(classificationSample());
      missingMarker.interpretive = false;

      expect(validate(missingEvidence)).toBe(false);
      expect(validate(missingMarker)).toBe(false);
    });

    it('rejects attempts to override runner-owned facts', () => {
      const invalid = clone(classificationSample());
      invalid.runnerFactOverrides = ['event-1'];

      expect(validate(invalid)).toBe(false);
    });
  });

  describe('pulse-aggregate.json samples', () => {
    const validate = compileSchema('pulse-aggregate.json');

    it('accepts aggregate-only pulse data above the privacy threshold', () => {
      expect(validate(pulseAggregateSample())).toBe(true);
    });

    it('rejects individual response fields and under-threshold groups', () => {
      expect(
        validate({
          ...pulseAggregateSample(),
          individualResponses: [{ person: 'dev-a', response: 5 }],
        }),
      ).toBe(false);

      const underSample = clone(pulseAggregateSample());
      underSample.sampleSize = 1;

      const underQuestion = clone(pulseAggregateSample());
      underQuestion.questions[0].aggregate.responseCount = 1;

      expect(validate(underSample)).toBe(false);
      expect(validate(underQuestion)).toBe(false);
    });
  });

  describe('benchmark-catalog.json samples', () => {
    const validate = compileSchema('benchmark-catalog.json');

    it('accepts benchmark catalogue contracts without execution results', () => {
      expect(validate(benchmarkCatalogSample())).toBe(true);
    });

    it('rejects benchmark execution results in the catalogue contract', () => {
      const invalid = clone(benchmarkCatalogSample());
      invalid.benchmarks[0].executionResults = [{ passed: true }];

      expect(validate(invalid)).toBe(false);
    });
  });
});

function provenance(source = 'runner') {
  return {
    source,
    generatedAt: '2026-05-10T02:00:00.000Z',
    evidenceIds: ['evidence-1'],
  };
}

function redaction(posture = 'redacted-export') {
  return {
    posture,
    containsPersonalData: false,
    exportSafe: true,
    notes: 'No raw personal data is included.',
  };
}

function measurementEventSample() {
  return {
    schemaVersion: '1',
    eventId: 'event-1',
    runId: 'run-1',
    occurredAt: '2026-05-10T02:00:00.000Z',
    authority: 'runner-fact',
    kind: 'validation',
    evidenceId: 'evidence-1',
    summary: 'Focused validation passed.',
    data: { command: 'npx vitest run test/runner/schemas.test.ts' },
    missingData: [],
    provenance: provenance(),
    redaction: redaction(),
  };
}

function proofSummarySample() {
  return {
    schemaVersion: '1',
    proofId: 'proof-1',
    runId: 'run-1',
    taskKind: 'change',
    authority: 'runner-fact',
    defaultProofLevel: 'L5',
    supportedProofLevel: 'L5',
    validated: true,
    requiredArtifactKinds: ['command', 'test', 'runtime-observation'],
    missingArtifactKinds: [],
    artifacts: [
      {
        id: 'artifact-command',
        kind: 'command',
        description: 'Build command',
        evidenceRef: 'evidence-command',
      },
      {
        id: 'artifact-test',
        kind: 'test',
        description: 'Vitest result',
        evidenceRef: 'evidence-test',
      },
      {
        id: 'artifact-runtime',
        kind: 'runtime-observation',
        description: 'CLI response',
        evidenceRef: 'evidence-runtime',
      },
    ],
    limitations: [],
    provenance: provenance(),
    redaction: redaction(),
  };
}

function scorecardSample() {
  const availableCategory = {
    status: 'available',
    summary: 'Evidence is available.',
    metrics: [
      {
        metricId: 'validated-proof-count',
        authority: 'runner-fact',
        status: 'available',
        traceabilityLevel: 'L3',
        value: { kind: 'number', display: '3', number: 3 },
        evidenceIds: ['evidence-1'],
        caveats: ['MiniH-local metric; not framework-native.'],
      },
    ],
    evidenceIds: ['evidence-1'],
    missingData: [],
  };
  const missingCategory = {
    status: 'not-configured',
    summary: 'Downstream delivery data is not configured.',
    metrics: [
      {
        metricId: 'downstream-dora-context',
        authority: 'downstream-context',
        status: 'not-configured',
        traceabilityLevel: 'L4',
        value: {
          kind: 'missing',
          display: 'not configured',
          reason: 'not-configured',
        },
        evidenceIds: [],
        caveats: ['Unavailable until a downstream source is configured.'],
      },
    ],
    evidenceIds: [],
    missingData: [
      {
        field: 'downstreamContext',
        reason: 'not-configured',
        description: 'No downstream source was configured.',
      },
    ],
  };

  return {
    schemaVersion: '1',
    scorecardId: 'scorecard-1',
    runId: 'run-1',
    generatedAt: '2026-05-10T02:00:00.000Z',
    authority: 'runner-fact',
    categories: {
      downstreamContext: missingCategory,
      flowFriction: availableCategory,
      learning: availableCategory,
      proofQuality: availableCategory,
      trustPulse: missingCategory,
      valueEvidence: availableCategory,
    },
    missingData: [],
    provenance: provenance(),
    redaction: redaction(),
  };
}

function classificationSample() {
  return {
    schemaVersion: '1',
    classificationId: 'classification-1',
    runId: 'run-1',
    producedAt: '2026-05-10T02:00:00.000Z',
    authority: 'interpretive-classification',
    interpretive: true,
    classifier: {
      name: 'measurement-classifier',
      source: 'agent',
      version: '1',
    },
    target: { type: 'task', id: 'T008' },
    labels: [
      {
        label: 'schema-contract',
        category: 'proof-quality',
        confidence: 0.82,
        rationale: 'The task adds strict schema evidence.',
        evidenceIds: ['evidence-1'],
        proofArtifactIds: ['artifact-test'],
        caveats: ['Interpretive label; runner facts remain authoritative.'],
      },
    ],
    runnerFactOverrides: [],
    provenance: provenance('agent'),
    redaction: redaction(),
  };
}

function pulseAggregateSample() {
  return {
    schemaVersion: '1',
    pulseId: 'pulse-1',
    runId: 'run-1',
    collectedAt: '2026-05-10T02:00:00.000Z',
    authority: 'human-pulse',
    aggregationLevel: 'team',
    minimumGroupSize: 5,
    sampleSize: 5,
    questions: [
      {
        questionId: 'proof-trust',
        prompt: 'I trust the proof attached to this change.',
        dimension: 'proof-trust',
        responseScale: 'likert-5',
        aggregate: {
          responseCount: 5,
          distribution: { '1': 0, '2': 0, '3': 1, '4': 2, '5': 2 },
          mean: { available: true, value: 4.2 },
        },
      },
    ],
    missingData: [],
    provenance: provenance('human'),
    redaction: redaction('aggregate-only'),
  };
}

function benchmarkCatalogSample() {
  return {
    schemaVersion: '1',
    catalogVersion: '1',
    generatedAt: '2026-05-10T02:00:00.000Z',
    benchmarks: [
      {
        id: 'schema-contract-benchmark',
        displayName: 'Schema contract benchmark',
        scenario: 'Validate all measurement schema contracts.',
        taskKind: 'benchmark',
        defaultProofLevel: 'L5',
        requiredArtifactKinds: ['command', 'test', 'runtime-observation'],
        metricIds: ['validated-proof-count'],
        successCriteria: ['All schemas compile in strict AJV.'],
        sourceRefs: ['docs/domains/measurement/domain.md'],
        redaction: redaction(),
      },
    ],
    provenance: provenance(),
    redaction: redaction(),
  };
}
