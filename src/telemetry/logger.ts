/**
 * Logger factory with automatic OTel context enrichment.
 *
 * createLogger(moduleName) returns a structured logger that emits
 * OTel log records with module.name attribute and auto-correlated
 * trace context. Respects MINIH_LOG_LEVEL (DD6).
 *
 * When telemetry is disabled, the OTel logs API returns a no-op logger —
 * all calls are effectively free.
 */

import { logs, SeverityNumber } from '@opentelemetry/api-logs';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const SEVERITY_MAP: Record<LogLevel, SeverityNumber> = {
  debug: SeverityNumber.DEBUG,
  info: SeverityNumber.INFO,
  warn: SeverityNumber.WARN,
  error: SeverityNumber.ERROR,
};

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function getMinLevel(): LogLevel {
  const env = process.env.MINIH_LOG_LEVEL?.toLowerCase();
  if (env && env in LEVEL_ORDER) return env as LogLevel;
  return 'info';
}

export interface Logger {
  debug(message: string, attributes?: Record<string, unknown>): void;
  info(message: string, attributes?: Record<string, unknown>): void;
  warn(message: string, attributes?: Record<string, unknown>): void;
  error(message: string, attributes?: Record<string, unknown>): void;
}

/**
 * Create a logger for a given module.
 * Automatically attaches module.name and inherits active span context.
 */
export function createLogger(moduleName: string): Logger {
  const otelLogger = logs.getLogger('minih');
  const minLevel = getMinLevel();

  function emit(
    level: LogLevel,
    message: string,
    attributes?: Record<string, unknown>,
  ): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;
    otelLogger.emit({
      severityNumber: SEVERITY_MAP[level],
      severityText: level.toUpperCase(),
      body: message,
      attributes: { 'module.name': moduleName, ...attributes },
    });
  }

  return {
    debug: (msg, attrs) => emit('debug', msg, attrs),
    info: (msg, attrs) => emit('info', msg, attrs),
    warn: (msg, attrs) => emit('warn', msg, attrs),
    error: (msg, attrs) => emit('error', msg, attrs),
  };
}
