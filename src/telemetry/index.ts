/**
 * Telemetry module — public API surface.
 *
 * Internal utility module consumed by all three domains.
 * Not a new architectural domain — shared utility like node:fs.
 */

// Init / lifecycle
export {
  initTelemetry,
  shutdownTelemetry,
  withTelemetry,
  isTelemetryEnabled,
  isVerboseEnabled,
} from './init.js';

// Logger
export { createLogger } from './logger.js';
export type { Logger, LogLevel } from './logger.js';

// Spans
export {
  withSpan,
  withSpanSync,
  setBaggage,
  captureContext,
  runInContext,
  BaggageCopyProcessor,
} from './spans.js';

// Metrics
export {
  runDuration,
  runCount,
  toolCallCount,
  eventCount,
  validationCount,
  promptTokens,
  sessionDuration,
} from './metrics.js';
