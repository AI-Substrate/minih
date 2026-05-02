/**
 * Telemetry SDK initialization — opt-in via MINIH_TELEMETRY=true.
 *
 * Configures NodeSDK with OTLP HTTP/protobuf exporters for traces,
 * metrics, and logs. No-ops when disabled (OTel API's built-in behavior).
 *
 * DD1: withTelemetry() wrapper ensures flush before process exit.
 * DD2: Exporter timeout 1s, shutdown timeout 2s, silent catch on all failures.
 * DD10: Resource attributes set manually, overridable via OTEL_RESOURCE_ATTRIBUTES.
 * DD11: Reads TRACEPARENT/TRACESTATE env vars for cross-process trace stitching.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Context, context, propagation } from '@opentelemetry/api';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-proto';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-node';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
  SEMRESATTRS_HOST_NAME,
  SEMRESATTRS_PROCESS_RUNTIME_NAME,
  SEMRESATTRS_PROCESS_RUNTIME_VERSION,
} from '@opentelemetry/semantic-conventions';
import { BaggageCopyProcessor } from './spans.js';

let sdk: NodeSDK | null = null;
let initialized = false;
let extractedParentContext: Context | undefined;

/** Read package version from package.json. */
function getPackageVersion(): string {
  try {
    const thisDir = path.dirname(fileURLToPath(import.meta.url));
    const pkgPath = path.resolve(thisDir, '..', '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** Check whether telemetry is enabled. */
export function isTelemetryEnabled(): boolean {
  return process.env.MINIH_TELEMETRY === 'true';
}

/** Check whether verbose telemetry is enabled. */
export function isVerboseEnabled(): boolean {
  return process.env.MINIH_TELEMETRY_VERBOSE === 'true';
}

/**
 * Get the parent context extracted from TRACEPARENT env var (DD11).
 * Returns undefined if no TRACEPARENT was present at init time.
 * Pass to withSpan() for root spans to stitch into a calling trace.
 */
export function getParentContext(): Context | undefined {
  return extractedParentContext;
}

/**
 * Initialize the OTel SDK. No-op if MINIH_TELEMETRY !== 'true'.
 * Safe to call multiple times — only the first call has effect.
 */
export function initTelemetry(): void {
  if (initialized || !isTelemetryEnabled()) return;
  initialized = true;

  const version = getPackageVersion();
  const EXPORTER_TIMEOUT = 1000; // 1s — DD2

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? 'minih',
    [ATTR_SERVICE_VERSION]: version,
    [SEMRESATTRS_PROCESS_RUNTIME_NAME]: 'node',
    [SEMRESATTRS_PROCESS_RUNTIME_VERSION]: process.version,
    [SEMRESATTRS_HOST_NAME]: os.hostname(),
  });

  const traceExporter = new OTLPTraceExporter({
    timeoutMillis: EXPORTER_TIMEOUT,
  });

  const metricExporter = new OTLPMetricExporter({
    timeoutMillis: EXPORTER_TIMEOUT,
  });

  const logExporter = new OTLPLogExporter({
    timeoutMillis: EXPORTER_TIMEOUT,
  });

  sdk = new NodeSDK({
    resource,
    spanProcessors: [
      new BaggageCopyProcessor(),
      new BatchSpanProcessor(traceExporter),
    ],
    metricReader: new PeriodicExportingMetricReader({
      exporter: metricExporter,
      exportIntervalMillis: 10_000,
    }),
    logRecordProcessors: [new BatchLogRecordProcessor(logExporter)],
  });

  try {
    sdk.start();
  } catch {
    // Best-effort: keep telemetry non-fatal
  }

  // DD11: Extract TRACEPARENT/TRACESTATE from env for cross-process stitching.
  // Store as parent context — root spans should use getParentContext() so they
  // appear as children of the calling process's trace.
  const parentContext = propagation.extract(context.active(), process.env);
  if (parentContext !== context.active()) {
    extractedParentContext = parentContext;
  }
}

/**
 * Gracefully shut down the OTel SDK (flushes all processors).
 * Capped at 2s (DD2). Silent catch — telemetry never blocks.
 */
export async function shutdownTelemetry(): Promise<void> {
  if (!sdk) return;
  try {
    await Promise.race([
      sdk.shutdown(),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]);
  } catch {
    // Silently swallow — telemetry is best-effort (DD2)
  }
  sdk = null;
  initialized = false;
}

/**
 * Wrap a CLI command action in telemetry lifecycle management.
 * Calls initTelemetry() at entry, shutdownTelemetry() on exit.
 * Telemetry failures never affect the wrapped function (DD1, DD2).
 */
export async function withTelemetry<T>(fn: () => Promise<T>): Promise<T> {
  initTelemetry();
  try {
    return await fn();
  } finally {
    await shutdownTelemetry();
  }
}
