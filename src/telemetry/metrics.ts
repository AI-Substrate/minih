/**
 * Metric instrument definitions — lazy meter acquisition.
 *
 * Instruments are created on first use (not at import time) so that
 * the MeterProvider registered by initTelemetry() is available.
 * When telemetry is disabled, the API returns no-op instruments (zero overhead).
 */

import {
  type Attributes,
  type Counter,
  type Histogram,
  metrics,
} from '@opentelemetry/api';

function getMeter() {
  return metrics.getMeter('minih');
}

/** Agent run duration in milliseconds. */
let _runDuration: Histogram | undefined;
export const runDuration = {
  record(value: number, attrs?: Attributes) {
    (_runDuration ??= getMeter().createHistogram('minih.run.duration', {
      description: 'Agent run duration',
      unit: 'ms',
    })).record(value, attrs);
  },
};

/** Total agent runs (with result attribute: completed/failed/timeout). */
let _runCount: Counter | undefined;
export const runCount = {
  add(value: number, attrs?: Attributes) {
    (_runCount ??= getMeter().createCounter('minih.run.count', {
      description: 'Total agent runs',
      unit: '{runs}',
    })).add(value, attrs);
  },
};

/** Tool calls per run. */
let _toolCallCount: Histogram | undefined;
export const toolCallCount = {
  record(value: number, attrs?: Attributes) {
    (_toolCallCount ??= getMeter().createHistogram('minih.run.tool_calls', {
      description: 'Tool calls per run',
      unit: '{calls}',
    })).record(value, attrs);
  },
};

/** Total events emitted. */
let _eventCount: Counter | undefined;
export const eventCount = {
  add(value: number, attrs?: Attributes) {
    (_eventCount ??= getMeter().createCounter('minih.run.events', {
      description: 'Total events emitted',
      unit: '{events}',
    })).add(value, attrs);
  },
};

/** Validation attempts (with valid attribute). */
let _validationCount: Counter | undefined;
export const validationCount = {
  add(value: number, attrs?: Attributes) {
    (_validationCount ??= getMeter().createCounter('minih.validation.count', {
      description: 'Validation attempts',
      unit: '{validations}',
    })).add(value, attrs);
  },
};

/** Assembled prompt token count. */
let _promptTokens: Histogram | undefined;
export const promptTokens = {
  record(value: number, attrs?: Attributes) {
    (_promptTokens ??= getMeter().createHistogram('minih.prompt.tokens', {
      description: 'Assembled prompt token count',
      unit: '{tokens}',
    })).record(value, attrs);
  },
};

/** SDK session active duration in milliseconds. */
let _sessionDuration: Histogram | undefined;
export const sessionDuration = {
  record(value: number, attrs?: Attributes) {
    (_sessionDuration ??= getMeter().createHistogram(
      'minih.adapter.session_duration',
      {
        description: 'SDK session active duration',
        unit: 'ms',
      },
    )).record(value, attrs);
  },
};
