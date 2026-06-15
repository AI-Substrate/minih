/**
 * Plan 027 Phase 4 (#36) — `coordination_status` MCP tool.
 *
 * Always-allowed inside tool. Returns the companion's derived lifecycle ledger
 * + a strict-validated draft farewell + the pinned `coordinationMode`, so a
 * coordinated agent can self-introspect ("where am I in my lifecycle?") without
 * firing a request. Mirrors `permission-status.ts`: the handler takes only the
 * context and returns `{ content, structuredContent }`.
 *
 * Reads the SAME pure `deriveCompanionLedger` runner deriver that the outside
 * `minih companion status` CLI verb uses, so the two surfaces never diverge.
 */

import * as fs from 'node:fs';
import {
  buildDraftFarewell,
  type CompanionDraftFarewell,
  type CompanionLedger,
  CompanionLedgerError,
  coordinationRunLocation,
  deriveCompanionLedger,
  readIdleBudgetMs,
} from '../../runner/index.js';
import type { McpServerContext } from '../context.js';
import { McpToolError, type McpToolResult } from '../types.js';
import { insideStateSchemaPath } from './inside-state-schema.js';

export interface CoordinationStatusResult {
  /** Slug of the agent this MCP server is serving. */
  agentSlug: string;
  /** Pinned to the binary frontmatter source (PIC-B): `'enabled' | 'disabled'`. */
  coordinationMode: 'enabled' | 'disabled';
  /** The derived companion lifecycle ledger. */
  ledger: CompanionLedger;
  /** Strict-validated draft farewell, or null when the draft failed validation. */
  draftFarewell: CompanionDraftFarewell | null;
  /**
   * Plan 027 Phase 5 (#35) — the configured idle budget in SECONDS (AC-12), read
   * off the run's recorded `run.json` `budgets.idleBudgetMs`. Lets the companion
   * discover its effective stand-down budget at runtime instead of inferring it.
   * `idleBudgetSec` (not `*Ms`) is the Phase-6 self-discovery trio name.
   */
  idleBudgetSec: number;
  /**
   * Plan 027 Phase 6 (#29) — AC-14. The per-pack inside-state status enum,
   * resolved via the shared mcp resolver from the agent ROOT (PIC-1). With
   * `coordinationMode` + `idleBudgetSec` this completes the self-discovery trio
   * in ONE call: the coordinated agent learns which states it may transition
   * into without firing a request. `[]` when no schema resolves or it carries no
   * `status` enum.
   */
  allowedStates: string[];
}

/**
 * Reads the per-pack inside-state status enum via the shared mcp resolver
 * (T002), defaulting to `[]` when the schema can't be resolved/parsed or has no
 * `status` enum. Robust-by-design: never throws — `allowedStates` is advisory
 * self-discovery, not a validation gate (validation stays in `state.ts`).
 */
function resolveAllowedStates(context: McpServerContext): string[] {
  try {
    const schema = JSON.parse(
      fs.readFileSync(insideStateSchemaPath(context), 'utf8'),
    ) as { properties?: { status?: { enum?: unknown } } };
    const values = schema.properties?.status?.enum;
    if (Array.isArray(values) && values.every((v) => typeof v === 'string')) {
      return values;
    }
    return [];
  } catch {
    return [];
  }
}

export function coordinationStatus(
  context: McpServerContext,
): McpToolResult<CoordinationStatusResult> {
  const location = coordinationRunLocation(
    context.agentSlug,
    context.agentsDir,
    context.runId,
  );

  let ledger: CompanionLedger;
  try {
    ledger = deriveCompanionLedger(location);
  } catch (err) {
    if (err instanceof CompanionLedgerError) {
      throw new McpToolError('MCP_INBOX_CORRUPT', err.message);
    }
    throw err;
  }

  const result: CoordinationStatusResult = {
    agentSlug: context.agentSlug,
    coordinationMode: ledger.coordinationMode,
    ledger,
    draftFarewell: buildDraftFarewell(ledger),
    idleBudgetSec: Math.round(readIdleBudgetMs(context.runDir) / 1000),
    allowedStates: resolveAllowedStates(context),
  };

  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    structuredContent: result,
  };
}
