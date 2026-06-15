import { readFileSync, writeFileSync } from 'node:fs';
import {
  buildDraftFarewell,
  CompanionLedgerError,
  deriveCompanionLedger,
} from './companion-ledger.js';
import type { CoordinationRunLocation } from './folder.js';
import type { CompanionLedger } from './types.js';

/**
 * Plan 027 Phase 5 (#35) — shutdown / report-write drain.
 *
 * `drainAndReadInbox` re-derives the companion ledger over the RAW live lanes at
 * the pre-report-write point (AFTER the final `inboxForwarder.commit()`, BEFORE
 * report.json is written/snapshotted — PIC-P5-C). This is the "hook" that
 * re-reads the inbox after the last forward so a peer message landing in the
 * shutdown window is captured rather than stranded (AC-13, plan Findings 05/06).
 *
 * It deliberately re-derives over raw `folder.ts` lanes via
 * `deriveCompanionLedger` rather than `listUnackedVisible` — a visible-message
 * list is the wrong shape for ack-chain/count/finding work, and both
 * `inbox-poll.ts` and `companion-ledger.ts` doc-comments foreclose drain
 * consumers from that export (PIC-P5-B).
 *
 * Tolerant by construction: the shutdown window is exactly when a concurrent
 * write may leave a half-written NDJSON tail. A torn lane (`CompanionLedgerError`)
 * returns `null` so the caller skips the reconcile and degrades to the
 * agent-authored report — it must NEVER fail an otherwise-successful run
 * (PIC-P5-G).
 */
export function drainAndReadInbox(
  location: CoordinationRunLocation,
  opts: { now?: number } = {},
): CompanionLedger | null {
  try {
    return deriveCompanionLedger(location, opts);
  } catch (err) {
    if (err instanceof CompanionLedgerError) return null;
    throw err;
  }
}

/**
 * Reconcile `report.findings[]` from a drained ledger.
 *
 * Overwrites ONLY `report.findings[]` on the **agent-authored** report.json with
 * the ledger's derived findings (the #32 single home), preserving the agent's
 * `summary` / `retrospective` (PIC-P5-F). Findings are taken through
 * `buildDraftFarewell` (validate-before-write) so a malformed draft never lands.
 *
 * Never fabricates: if report.json is absent or unparseable (e.g. the raw-string
 * SDK fallback), it is left untouched and the function returns `false`. Returns
 * `true` only when it wrote reconciled findings.
 */
export function reconcileReportFindings(
  reportPath: string,
  ledger: CompanionLedger,
): boolean {
  let raw: string;
  try {
    raw = readFileSync(reportPath, 'utf8');
  } catch {
    return false; // absent → skip (never fabricate)
  }

  let report: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return false; // not a JSON object (raw SDK fallback) → skip
    }
    report = parsed as Record<string, unknown>;
  } catch {
    return false; // unparseable → skip
  }

  const draft = buildDraftFarewell(ledger);
  if (!draft) return false; // validate-before-write: never write a bad draft

  report.findings = draft.findings; // overwrite ONLY findings
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return true;
}
