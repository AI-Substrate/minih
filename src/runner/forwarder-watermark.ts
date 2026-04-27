import * as fs from 'node:fs';
import * as path from 'node:path';
import { writeFileAtomic } from './atomic-write.js';
import type { CoordinationRunLocation } from './folder.js';
import { watermarkPath } from './folder.js';

const WATERMARK_VERSION = 1;

export type ForwarderWatermarkLocation = CoordinationRunLocation;

export interface ForwarderWatermark {
  version: 1;
  inbox: {
    outsideOffset: number;
  };
  state: {
    outsideFingerprint: string | null;
  };
}

export interface LoadedForwarderWatermark {
  path: string;
  value: ForwarderWatermark;
  recoveredFromCorruption: boolean;
  recoveryReason?: string;
}

export class CoordinationPathEscapeError extends Error {
  constructor(target: string, agentsDir: string) {
    super(`${target} resolves outside agentsDir ${agentsDir}`);
    this.name = 'CoordinationPathEscapeError';
  }
}

export class InvalidForwarderWatermarkError extends Error {
  constructor(message: string) {
    super(`invalid forwarder watermark: ${message}`);
    this.name = 'InvalidForwarderWatermarkError';
  }
}

export function defaultForwarderWatermark(): ForwarderWatermark {
  return {
    version: WATERMARK_VERSION,
    inbox: { outsideOffset: 0 },
    state: { outsideFingerprint: null },
  };
}

export function readForwarderWatermark(
  location: ForwarderWatermarkLocation,
): LoadedForwarderWatermark {
  const target = resolveWatermarkPath(location);
  assertPathInsideAgentsDir(target, location.agentsDir);
  if (!fs.existsSync(target)) {
    return {
      path: target,
      value: defaultForwarderWatermark(),
      recoveredFromCorruption: false,
    };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(target, 'utf8'));
    return {
      path: target,
      value: parseForwarderWatermark(parsed),
      recoveredFromCorruption: false,
    };
  } catch (error) {
    return {
      path: target,
      value: defaultForwarderWatermark(),
      recoveredFromCorruption: true,
      recoveryReason: error instanceof Error ? error.message : String(error),
    };
  }
}

export function writeForwarderWatermark(
  location: ForwarderWatermarkLocation,
  value: ForwarderWatermark,
): void {
  const target = resolveWatermarkPath(location);
  const normalized = parseForwarderWatermark(value);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  assertPathInsideAgentsDir(target, location.agentsDir);
  writeFileAtomic(target, `${JSON.stringify(normalized, null, 2)}\n`);
}

export function updateForwarderWatermark(
  location: ForwarderWatermarkLocation,
  update: (current: ForwarderWatermark) => ForwarderWatermark,
): LoadedForwarderWatermark {
  const current = readForwarderWatermark(location);
  const next = update(current.value);
  writeForwarderWatermark(location, next);
  return readForwarderWatermark(location);
}

export function withInboxOffset(
  value: ForwarderWatermark,
  outsideOffset: number,
): ForwarderWatermark {
  if (
    typeof outsideOffset !== 'number' ||
    !Number.isSafeInteger(outsideOffset) ||
    outsideOffset < 0
  ) {
    throw new InvalidForwarderWatermarkError(
      `inbox.outsideOffset must be a non-negative safe integer, got ${outsideOffset}`,
    );
  }
  return {
    version: WATERMARK_VERSION,
    inbox: { outsideOffset },
    state: { ...value.state },
  };
}

export function withStateFingerprint(
  value: ForwarderWatermark,
  outsideFingerprint: string | null,
): ForwarderWatermark {
  if (outsideFingerprint !== null && typeof outsideFingerprint !== 'string') {
    throw new InvalidForwarderWatermarkError(
      'state.outsideFingerprint must be a string or null',
    );
  }
  return {
    version: WATERMARK_VERSION,
    inbox: { ...value.inbox },
    state: { outsideFingerprint },
  };
}

export function assertPathInsideAgentsDir(
  targetPath: string,
  agentsDir: string,
): void {
  const absoluteAgentsDir = path.resolve(agentsDir);
  const absoluteTarget = path.resolve(targetPath);
  if (!isInsidePath(absoluteTarget, absoluteAgentsDir)) {
    throw new CoordinationPathEscapeError(absoluteTarget, absoluteAgentsDir);
  }

  const realAgentsDir = fs.realpathSync(absoluteAgentsDir);
  const existing = nearestExistingPath(absoluteTarget);
  const realExisting = fs.realpathSync(existing);
  if (!isInsidePath(realExisting, realAgentsDir)) {
    throw new CoordinationPathEscapeError(realExisting, realAgentsDir);
  }
}

function resolveWatermarkPath(location: ForwarderWatermarkLocation): string {
  return watermarkPath(location);
}

function parseForwarderWatermark(value: unknown): ForwarderWatermark {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new InvalidForwarderWatermarkError('root must be an object');
  }

  const record = value as Record<string, unknown>;
  if (record.version !== WATERMARK_VERSION) {
    throw new InvalidForwarderWatermarkError(
      `version must be ${WATERMARK_VERSION}`,
    );
  }

  const inbox = parseRecord(record.inbox, 'inbox');
  const state = parseRecord(record.state, 'state');
  const outsideOffset = inbox.outsideOffset;
  const outsideFingerprint = state.outsideFingerprint;

  if (
    typeof outsideOffset !== 'number' ||
    !Number.isSafeInteger(outsideOffset) ||
    outsideOffset < 0
  ) {
    throw new InvalidForwarderWatermarkError(
      'inbox.outsideOffset must be a non-negative safe integer',
    );
  }

  if (outsideFingerprint !== null && typeof outsideFingerprint !== 'string') {
    throw new InvalidForwarderWatermarkError(
      'state.outsideFingerprint must be a string or null',
    );
  }

  return {
    version: WATERMARK_VERSION,
    inbox: { outsideOffset },
    state: { outsideFingerprint },
  };
}

function parseRecord(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new InvalidForwarderWatermarkError(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function nearestExistingPath(targetPath: string): string {
  let current = targetPath;
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) return current;
    current = parent;
  }
  return current;
}

function isInsidePath(targetPath: string, parentPath: string): boolean {
  const relative = path.relative(parentPath, targetPath);
  return (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  );
}
