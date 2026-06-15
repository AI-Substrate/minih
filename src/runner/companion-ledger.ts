/**
 * Plan 027 Phase 4 — companion lifecycle ledger (#36).
 *
 * A PURE deriver: given a {@link CoordinationRunLocation}, read the durable
 * inbox/state lanes off disk and compute the companion's coordination lifecycle
 * summary. No SDK, no spawn, no MCP/CLI imports — both the inside
 * `coordination_status` MCP tool and the outside `minih companion status` CLI
 * verb consume this one function, so the two surfaces can never drift.
 *
 * Derives over RAW `folder.ts` lanes (NOT `listUnackedVisible`, whose own doc
 * comment forbids ledger consumers: "a visible-message list is the wrong shape
 * for ack-chain/count work"). It reuses only the unread/ack *model* from
 * `inbox-poll.ts:170-178`: `acknowledged = { ackOf : inside ack records }`.
 *
 * Lane convention (P2 / Phase 2): a missing or empty lane file ⇒ `[]`; a torn
 * line ⇒ throw {@link CompanionLedgerError} (never a silent swallow).
 *
 * Vantage — the inside companion's ledger:
 *   - outside lane = peer → companion (inbound: task / briefing / directive)
 *   - inside lane  = companion → peer (ack / finding / summary)
 *   - an inside `ack` whose `ackOf` targets an inbound id resolves that request.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import {
  type CoordinationRunLocation,
  coordinationRunDir,
  historyPath,
  inboxLanePath,
  parseFrontmatter,
  stateFilePath,
} from './folder.js';
import type {
  CompanionAckChain,
  CompanionDraftFarewell,
  CompanionFinding,
  CompanionLedger,
  InboxMessage,
  ValidationResult,
} from './types.js';

/** Thrown when a durable lane / state file is present but unparseable. */
export class CompanionLedgerError extends Error {
  readonly code = 'COMPANION_LEDGER_CORRUPT';
  constructor(message: string) {
    super(message);
    this.name = 'CompanionLedgerError';
  }
}

/** Inbound message types that are NOT peer "requests" needing resolution. */
const NON_REQUEST_TYPES = new Set(['ack', 'briefing']);

/** Required string fields on a well-formed {@link InboxMessage}. */
const REQUIRED_FIELDS = [
  'id',
  'sender',
  'type',
  'subject',
  'body',
  'ts',
] as const;

/**
 * Read one NDJSON inbox lane into typed messages.
 * - Missing / empty file ⇒ `[]`.
 * - A line that is not a JSON object, or is missing a required string field,
 *   ⇒ throws {@link CompanionLedgerError} (throw-on-corrupt; no swallow).
 *
 * The inbox-poll parser is module-private, so the ledger parses lanes itself
 * (PIC-A) — but it keeps the same strict contract.
 */
function readLane(file: string): InboxMessage[] {
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf-8');
  } catch {
    return [];
  }
  const out: InboxMessage[] = [];
  const lines = raw.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '') continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new CompanionLedgerError(
        `corrupt inbox line ${i + 1} in ${file}: not valid JSON`,
      );
    }
    if (typeof parsed !== 'object' || parsed === null) {
      throw new CompanionLedgerError(
        `corrupt inbox line ${i + 1} in ${file}: not an object`,
      );
    }
    const record = parsed as Record<string, unknown>;
    for (const field of REQUIRED_FIELDS) {
      if (typeof record[field] !== 'string') {
        throw new CompanionLedgerError(
          `corrupt inbox line ${i + 1} in ${file}: missing/invalid "${field}"`,
        );
      }
    }
    out.push(parsed as InboxMessage);
  }
  return out;
}

/** Read the inside-state status. Missing ⇒ unpublished; torn ⇒ throw. */
function readInsideState(location: CoordinationRunLocation): {
  status: string | null;
  published: boolean;
} {
  const file = stateFilePath(location, 'inside');
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf-8');
  } catch {
    return { status: null, published: false };
  }
  if (raw.trim() === '') return { status: null, published: false };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CompanionLedgerError(`corrupt inside state file ${file}`);
  }
  const status = (parsed as { status?: unknown })?.status;
  return {
    status: typeof status === 'string' ? status : null,
    published: true,
  };
}

/** Whether the state history lane holds ≥1 entry (best-effort; absent ⇒ false). */
function historyHasEntries(location: CoordinationRunLocation): boolean {
  try {
    const raw = fs.readFileSync(historyPath(location), 'utf-8');
    return raw.split('\n').some((l) => l.trim() !== '');
  } catch {
    return false;
  }
}

/**
 * Pin `coordinationMode` to the binary frontmatter source (PIC-B). Reads the
 * run's frozen `prompt.md`; absent / unparseable ⇒ `'disabled'`.
 */
function readCoordinationMode(
  location: CoordinationRunLocation,
): 'enabled' | 'disabled' {
  const promptPath = path.join(coordinationRunDir(location), 'prompt.md');
  let content: string;
  try {
    content = fs.readFileSync(promptPath, 'utf-8');
  } catch {
    return 'disabled';
  }
  try {
    const { coordination } = parseFrontmatter(content);
    return coordination.enabled ? 'enabled' : 'disabled';
  } catch {
    return 'disabled';
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

/** The five structured fields a {@link CompanionFinding} carries. */
const FINDING_FIELDS = [
  'severity',
  'file',
  'category',
  'issue',
  'recommendation',
] as const;
type FindingField = (typeof FINDING_FIELDS)[number];

/**
 * Parse a labelled-body finding (`severity: …\nfile: …\n…`) into its fields.
 *
 * The companion prompt's concrete `inbox_send` example carries the finding in
 * the message BODY, not `meta` (F004) — every real companion finding is
 * body-structured. A line `label: value` opens a field; subsequent unlabelled
 * non-empty lines append to it (multi-line values). Unrecognised text ⇒ `{}`.
 */
function parseLabelledFindingBody(
  body: string,
): Partial<Record<FindingField, string>> {
  const out: Partial<Record<FindingField, string>> = {};
  let current: FindingField | null = null;
  for (const line of body.split('\n')) {
    const match = line.match(
      /^(severity|file|category|issue|recommendation)\s*:\s*(.*)$/i,
    );
    if (match) {
      current = match[1].toLowerCase() as FindingField;
      out[current] = match[2].trim();
    } else if (current && line.trim() !== '') {
      out[current] = `${out[current]}\n${line.trim()}`.trim();
    }
  }
  return out;
}

/**
 * Parse an inside-lane `finding` message into a {@link CompanionFinding}.
 *
 * Structured fields are read from `meta` when present (the prompt.md:227/284
 * shape), falling back to the labelled message BODY (F004 — real findings are
 * body-only). A message that yields NO structured content from either source is
 * safe-nulled rather than emitted as an empty-string shell.
 */
function toFinding(m: InboxMessage): CompanionFinding | null {
  const meta = (m.meta ?? {}) as Record<string, unknown>;
  const fromMeta = (k: FindingField): string | undefined =>
    typeof meta[k] === 'string' && (meta[k] as string).trim() !== ''
      ? (meta[k] as string)
      : undefined;
  const body = parseLabelledFindingBody(m.body);
  const pick = (k: FindingField): string | undefined => fromMeta(k) ?? body[k];

  const severity = pick('severity');
  const file = pick('file');
  const category = pick('category');
  const recommendation = pick('recommendation');
  const issue = pick('issue');

  // A "finding" with no severity/file/category/recommendation from either source
  // carries no reviewable content — drop it rather than persist empty strings.
  if (!severity && !file && !category && !recommendation) {
    return null;
  }
  return {
    severity: severity ?? 'UNKNOWN',
    file: file ?? '',
    category: category ?? '',
    issue: issue ?? m.body,
    recommendation: recommendation ?? '',
  };
}

/**
 * Derive the resolved request chains (F001): for each inbound id referenced by
 * an inside-lane `ackOf`, the ordered list of inside responses that resolve it.
 */
function deriveAckChains(
  inbound: InboxMessage[],
  outbound: InboxMessage[],
): CompanionAckChain[] {
  const inboundById = new Map(inbound.map((m) => [m.id, m]));
  const byInbound = new Map<string, Array<{ id: string; type: string }>>();
  for (const m of outbound) {
    if (typeof m.ackOf !== 'string') continue;
    const responses = byInbound.get(m.ackOf) ?? [];
    responses.push({ id: m.id, type: m.type });
    byInbound.set(m.ackOf, responses);
  }
  const chains: CompanionAckChain[] = [];
  for (const [inboundId, responses] of byInbound) {
    const src = inboundById.get(inboundId);
    if (!src) continue; // only chains that resolve a real inbound message
    chains.push({ inboundId, inboundType: src.type, responses });
  }
  return chains.sort((a, b) => a.inboundId.localeCompare(b.inboundId));
}

/**
 * Derive the {@link CompanionLedger} for a coordination run from its durable
 * lanes. Pure: depends only on disk state and `opts.now` (default `Date.now()`,
 * injectable for deterministic tests).
 */
export function deriveCompanionLedger(
  location: CoordinationRunLocation,
  opts: { now?: number } = {},
): CompanionLedger {
  const now = opts.now ?? Date.now();

  const inbound = readLane(inboxLanePath(location, 'outside')); // peer → companion
  const outbound = readLane(inboxLanePath(location, 'inside')); // companion → peer

  // Unread/ack MODEL (inbox-poll.ts:170-178) over raw lanes: the inside agent's
  // ack records carry `ackOf` pointing at the inbound ids they resolve.
  const ackedIds = unique(
    outbound
      .filter((m) => m.type === 'ack' && typeof m.ackOf === 'string')
      .map((m) => m.ackOf as string),
  ).sort();
  const acknowledged = new Set(ackedIds);

  const inboundTasks = inbound.filter((m) => m.type === 'task');
  const inboundTaskIds = new Set(inboundTasks.map((m) => m.id));

  // F002: a task is REVIEWED only with completion evidence — an inside `summary`
  // whose `ackOf` targets it. (`acknowledged`/receipt acks fire on arrival,
  // before review, so they over-count.) `ackedIds` keeps the receipt set.
  const reviewedIds = unique(
    outbound
      .filter((m) => m.type === 'summary' && typeof m.ackOf === 'string')
      .map((m) => m.ackOf as string)
      .filter((id) => inboundTaskIds.has(id)),
  ).sort();

  const findingMessages = outbound.filter((m) => m.type === 'finding');
  const findings = findingMessages
    .map(toFinding)
    .filter((f): f is CompanionFinding => f !== null);
  // Coordination metric: messages emitted (matches report.findingsSent), which
  // may exceed findings.length when a message carries no structured content.
  const findingsCount = findingMessages.length;
  const summariesCount = outbound.filter((m) => m.type === 'summary').length;
  const progressCount = outbound.filter((m) => m.type === 'progress').length;

  const ackChains = deriveAckChains(inbound, outbound);

  const unresolvedPeerRequests = inbound.filter(
    (m) => !NON_REQUEST_TYPES.has(m.type) && !acknowledged.has(m.id),
  ).length;

  const inboundTimestamps = inbound
    .map((m) => Date.parse(m.ts))
    .filter((t) => !Number.isNaN(t));
  const idleElapsedMs =
    inboundTimestamps.length === 0
      ? null
      : Math.max(0, now - Math.max(...inboundTimestamps));

  // Lanes are append-ordered, so the last task line is the most recent request.
  const lastTaskId =
    inboundTasks.length === 0 ? null : (inboundTasks.at(-1)?.id ?? null);

  const { status: state, published } = readInsideState(location);
  const statePublished = published || historyHasEntries(location);
  const coordinationMode = readCoordinationMode(location);

  return {
    coordinationMode,
    state,
    statePublished,
    reviewedIds,
    ackedIds,
    findingsCount,
    summariesCount,
    progressCount,
    unresolvedPeerRequests,
    idleElapsedMs,
    lastTaskId,
    findings,
    ackChains,
  };
}

// ---------------------------------------------------------------------------
// Draft farewell — strict validate before offer/write (AC-9, finding 04).
//
// `system-output.json` is `additionalProperties:true` and does NOT require the
// `retrospective.coordination` block, and `validator.ts` runs AFTER `report.json`
// is written. So a malformed / incomplete draft would slip through and persist.
// The strict sub-schema below closes that gap: a draft is validated against BOTH
// the canonical contract AND this strict shape BEFORE it is offered or written;
// a draft that fails is safe-nulled and never reaches `report.json`.
// ---------------------------------------------------------------------------

const SYSTEM_OUTPUT_SCHEMA_PATH = fileURLToPath(
  new URL('../schemas/system-output.json', import.meta.url),
);

/** Strict draft shape — `additionalProperties:false`, coordination required. */
const STRICT_DRAFT_FAREWELL_SCHEMA: Record<string, unknown> = {
  type: 'object',
  required: ['summary', 'retrospective'],
  additionalProperties: false,
  properties: {
    summary: { type: 'string', minLength: 20 },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['severity', 'file', 'category', 'issue', 'recommendation'],
        additionalProperties: true,
        properties: {
          severity: { type: 'string' },
          file: { type: 'string' },
          category: { type: 'string' },
          issue: { type: 'string' },
          recommendation: { type: 'string' },
        },
      },
    },
    retrospective: {
      type: 'object',
      required: ['workedWell', 'confusing', 'magicWand', 'coordination'],
      additionalProperties: false,
      properties: {
        workedWell: { type: 'string', minLength: 10 },
        confusing: { type: 'string', minLength: 10 },
        magicWand: { type: 'string', minLength: 20 },
        coordination: {
          type: 'object',
          required: [
            'peerUpdatesSent',
            'unresolvedPeerRequests',
            'statePublished',
          ],
          additionalProperties: false,
          properties: {
            peerUpdatesSent: { type: 'integer', minimum: 0 },
            unresolvedPeerRequests: { type: 'integer', minimum: 0 },
            statePublished: { type: 'boolean' },
          },
        },
      },
    },
  },
};

/**
 * Assemble a draft farewell envelope from a ledger. The stub prose fields are
 * deliberately authored to satisfy the system-output minLengths so a real draft
 * never self-fails as false-malformed (the companion overwrites them at farewell).
 */
export function assembleDraftFarewell(
  ledger: CompanionLedger,
): CompanionDraftFarewell {
  return {
    summary: `Companion farewell draft: ${ledger.reviewedIds.length} reviewed, ${ledger.findingsCount} finding(s), ${ledger.summariesCount} summary(ies); coordination mode ${ledger.coordinationMode}.`,
    retrospective: {
      workedWell:
        'Coordination lifecycle derived cleanly from the durable inbox and state lanes.',
      confusing:
        'Draft pre-fill is a stub the companion overwrites with its own farewell.',
      magicWand:
        'Auto-derive more of the farewell retrospective directly from the coordination ledger.',
      coordination: {
        // F003: progress heartbeats are peer updates too (Workshop 003).
        peerUpdatesSent:
          ledger.findingsCount + ledger.summariesCount + ledger.progressCount,
        unresolvedPeerRequests: ledger.unresolvedPeerRequests,
        statePublished: ledger.statePublished,
      },
    },
    // #32 — report.findings[] is DERIVED from the ledger, never re-authored.
    findings: ledger.findings,
  };
}

function ajvErrorStrings(
  prefix: string,
  errors: Array<{ instancePath?: string; message?: string }> | null | undefined,
): string[] {
  return (errors ?? []).map(
    (e) => `${prefix} ${e.instancePath || '/'}: ${e.message ?? 'invalid'}`,
  );
}

/**
 * Validate a draft against BOTH the canonical `system-output.json` contract and
 * the strict draft sub-schema. Never throws — a missing/unreadable schema is
 * reported as an error so the caller safe-nulls rather than writing blind.
 */
export function validateDraftFarewell(draft: unknown): ValidationResult {
  const errors: string[] = [];

  const ajvStrict = new Ajv2020({ allErrors: true });
  const strict = ajvStrict.compile(STRICT_DRAFT_FAREWELL_SCHEMA);
  if (!strict(draft)) {
    errors.push(...ajvErrorStrings('[strict]', strict.errors));
  }

  try {
    const canonicalSchema = JSON.parse(
      fs.readFileSync(SYSTEM_OUTPUT_SCHEMA_PATH, 'utf-8'),
    ) as Record<string, unknown>;
    const ajvCanonical = new Ajv2020({ allErrors: true });
    const canonical = ajvCanonical.compile(canonicalSchema);
    if (!canonical(draft)) {
      errors.push(...ajvErrorStrings('[system-output]', canonical.errors));
    }
  } catch (err) {
    errors.push(
      `[system-output] schema unavailable: ${(err as Error).message}`,
    );
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Build a validated draft farewell from a ledger, or `null` if the assembled
 * draft fails strict validation. The `null` is the safe-null that guarantees a
 * malformed draft never reaches `report.json` (AC-9).
 */
export function buildDraftFarewell(
  ledger: CompanionLedger,
): CompanionDraftFarewell | null {
  const draft = assembleDraftFarewell(ledger);
  return validateDraftFarewell(draft).valid ? draft : null;
}
