/**
 * Metric instrument definitions — singleton meter with named instruments.
 *
 * All instruments are acquired from the OTel API meter. When telemetry
 * is disabled, the API returns no-op instruments (zero overhead).
 */

import { metrics } from '@opentelemetry/api';

const meter = metrics.getMeter('minih');

/** Agent run duration in milliseconds. */
export const runDuration = meter.createHistogram('minih.run.duration', {
  description: 'Agent run duration',
  unit: 'ms',
});

/** Total agent runs (with result attribute: completed/failed/timeout). */
export const runCount = meter.createCounter('minih.run.count', {
  description: 'Total agent runs',
  unit: '{runs}',
});

/** Tool calls per run. */
export const toolCallCount = meter.createHistogram('minih.run.tool_calls', {
  description: 'Tool calls per run',
  unit: '{calls}',
});

/** Total events emitted. */
export const eventCount = meter.createCounter('minih.run.events', {
  description: 'Total events emitted',
  unit: '{events}',
});

/** Validation attempts (with valid attribute). */
export const validationCount = meter.createCounter('minih.validation.count', {
  description: 'Validation attempts',
  unit: '{validations}',
});

/** Assembled prompt token count. */
export const promptTokens = meter.createHistogram('minih.prompt.tokens', {
  description: 'Assembled prompt token count',
  unit: '{tokens}',
});

/** SDK session active duration in milliseconds. */
export const sessionDuration = meter.createHistogram(
  'minih.adapter.session_duration',
  {
    description: 'SDK session active duration',
    unit: 'ms',
  },
);
