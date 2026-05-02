/**
 * Telemetry module — public API surface.
 *
 * Internal utility module consumed by all three domains.
 * Not a new architectural domain — shared utility like node:fs.
 */

// Init / lifecycle
export {
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
  BaggageCopyProcessor,
  captureContext,
  runInContext,
  setBaggage,
  withSpan,
  withSpanSync,
} from './spans.js';
