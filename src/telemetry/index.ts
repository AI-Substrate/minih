/**
 * Telemetry module — public API surface.
 *
 * Internal utility module consumed by all three domains.
 * Not a new architectural domain — shared utility like node:fs.
 */

// Init / lifecycle
export {
  getParentContext,
  initTelemetry,
  isTelemetryEnabled,
  isVerboseEnabled,
  shutdownTelemetry,
  withTelemetry,
} from './init.js';
export type { Logger, LogLevel } from './logger.js';
// Logger
export { createLogger } from './logger.js';
// Metrics
export {
  coordinationMessagesReceived,
  coordinationMessagesSent,
  coordinationStateTransitions,
  eventCount,
  promptTokens,
  runCount,
  runDuration,
  sessionDuration,
  toolCallCount,
  validationCount,
} from './metrics.js';
// Spans
export {
  addSpanAttributes,
  BaggageCopyProcessor,
  captureContext,
  getTraceparent,
  runInContext,
  setBaggage,
  spanContextFromTraceparent,
  withSpan,
  withSpanSync,
} from './spans.js';
