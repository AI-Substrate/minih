/**
 * Plan 019 — Companion Idle Check-In Protocol
 *
 * Regression tests for the canonical `code-review-companion` config files
 * touched by plan 019:
 *   - input-schema.json gains three optional fields (firstContactPollThreshold,
 *     postTaskPollThreshold, replyWaitPolls) with the conservative defaults
 *     20/10/4. Existing fields (initialTask, planPath, idleBudgetMs) preserved.
 *   - output-schema.json exitReason enum gains 'no_engagement' alongside the
 *     four existing values.
 *   - prompt.md § 2 (Coordination Loop) drops the elapsed_since_last_outside_message
 *     clock-arithmetic branch and adds the unified check-in heuristic with
 *     the three loop-state counters.
 *
 * These tests are intentionally narrow (file-content assertions). Behavioral
 * smoke testing of the running companion against a real outside harness is
 * separate (and intentionally manual / dogfood-validated; see Q10 in the
 * spec's clarifications).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { DEFAULT_IDLE_BUDGET_MS } from '../../src/runner/index.js';

const COMPANION_DIR = path.resolve('agents/code-review-companion');
const INPUT_SCHEMA = path.join(COMPANION_DIR, 'input-schema.json');
const OUTPUT_SCHEMA = path.join(COMPANION_DIR, 'output-schema.json');
const PROMPT = path.join(COMPANION_DIR, 'prompt.md');

describe('plan 019 — input-schema idle check-in fields', () => {
  const schemaText = fs.readFileSync(INPUT_SCHEMA, 'utf8');
  const schema = JSON.parse(schemaText);

  it('input-schema.json parses as JSON', () => {
    expect(schema).toBeTypeOf('object');
    expect(schema.properties).toBeTypeOf('object');
  });

  it('preserves existing fields (initialTask, planPath, idleBudgetMs)', () => {
    expect(schema.properties.initialTask).toBeDefined();
    expect(schema.properties.planPath).toBeDefined();
    expect(schema.properties.idleBudgetMs).toBeDefined();
  });

  it('027 P5 (F001) — runner DEFAULT_IDLE_BUDGET_MS matches the input-schema idleBudgetMs default (no silent drift)', () => {
    // The runner mirrors the pack default so coordination_status.idleBudgetSec
    // matches what the companion would use when no param is supplied. Pin them
    // together so a future edit to either side fails this test instead of
    // silently diverging.
    expect(DEFAULT_IDLE_BUDGET_MS).toBe(schema.properties.idleBudgetMs.default);
  });

  it('declares firstContactPollThreshold (default 20, minimum 0)', () => {
    const f = schema.properties.firstContactPollThreshold;
    expect(f).toBeDefined();
    expect(f.type).toBe('integer');
    expect(f.default).toBe(20);
    expect(f.minimum).toBe(0);
  });

  it('declares postTaskPollThreshold (default 10, minimum 0)', () => {
    const f = schema.properties.postTaskPollThreshold;
    expect(f).toBeDefined();
    expect(f.type).toBe('integer');
    expect(f.default).toBe(10);
    expect(f.minimum).toBe(0);
  });

  it('declares replyWaitPolls (default 4, minimum 1)', () => {
    const f = schema.properties.replyWaitPolls;
    expect(f).toBeDefined();
    expect(f.type).toBe('integer');
    expect(f.default).toBe(4);
    expect(f.minimum).toBe(1);
  });

  it('the new fields are optional (omitted from required[])', () => {
    const required = schema.required ?? [];
    expect(required).not.toContain('firstContactPollThreshold');
    expect(required).not.toContain('postTaskPollThreshold');
    expect(required).not.toContain('replyWaitPolls');
  });

  it('AC10 — runs that omit the new fields validate cleanly', () => {
    const ajv = new Ajv2020({ strict: false });
    const validate = ajv.compile(schema);
    expect(validate({})).toBe(true);
    expect(validate({ initialTask: 'Hello' })).toBe(true);
  });

  it('AC10 — runs that supply the new fields validate cleanly', () => {
    const ajv = new Ajv2020({ strict: false });
    const validate = ajv.compile(schema);
    expect(
      validate({
        firstContactPollThreshold: 20,
        postTaskPollThreshold: 10,
        replyWaitPolls: 4,
      }),
    ).toBe(true);
  });

  it('AC9 — threshold=0 is accepted (disable escape hatch)', () => {
    const ajv = new Ajv2020({ strict: false });
    const validate = ajv.compile(schema);
    expect(
      validate({ firstContactPollThreshold: 0, postTaskPollThreshold: 0 }),
    ).toBe(true);
  });

  it('replyWaitPolls=0 is rejected (always need a wait window if check-in fires)', () => {
    const ajv = new Ajv2020({ strict: false });
    const validate = ajv.compile(schema);
    expect(validate({ replyWaitPolls: 0 })).toBe(false);
  });
});

describe('plan 019 — output-schema no_engagement exit reason', () => {
  const schemaText = fs.readFileSync(OUTPUT_SCHEMA, 'utf8');
  const schema = JSON.parse(schemaText);

  it('output-schema.json parses as JSON', () => {
    expect(schema).toBeTypeOf('object');
  });

  it('exitReason enum includes no_engagement plus the four legacy values', () => {
    const exitEnum = schema.properties.session.properties.exitReason.enum;
    expect(exitEnum).toContain('stop_requested');
    expect(exitEnum).toContain('idle_budget');
    expect(exitEnum).toContain('no_engagement');
    expect(exitEnum).toContain('timeout');
    expect(exitEnum).toContain('error');
  });

  it('AC10 — farewell envelope with no_engagement validates', () => {
    const ajv = new Ajv2020({ strict: false });
    const validate = ajv.compile(schema);
    expect(
      validate({
        session: {
          startedAt: '2026-05-07T00:00:00Z',
          endedAt: '2026-05-07T00:10:00Z',
          exitReason: 'no_engagement',
          messageCounts: {
            tasksReceived: 0,
            findingsSent: 0,
            questionsAsked: 1,
          },
        },
        findings: [],
        summary:
          'Companion booted, oriented, and waited ~10 min for outside engagement; sent first-contact check-in; no reply within wait window; exiting cleanly.',
        retrospective: {
          magicWand: 'No magic wand — clean no_engagement exit',
          magicWandTarget: 'coordination',
        },
      }),
    ).toBe(true);
  });

  it('AC10 — farewell envelope with idle_budget after post-task check-in still validates', () => {
    const ajv = new Ajv2020({ strict: false });
    const validate = ajv.compile(schema);
    expect(
      validate({
        session: {
          startedAt: '2026-05-07T00:00:00Z',
          endedAt: '2026-05-07T00:07:00Z',
          exitReason: 'idle_budget',
          messageCounts: {
            tasksReceived: 2,
            findingsSent: 5,
            questionsAsked: 1,
          },
        },
        findings: [],
        summary:
          'Reviewed two tasks, sent post-task check-in after 5 min idle; no reply within wait window; exiting on idle_budget.',
        retrospective: {
          magicWand: 'No magic wand for this run',
          magicWandTarget: 'coordination',
        },
      }),
    ).toBe(true);
  });
});

describe('plan 019 — prompt.md check-in heuristic content', () => {
  const promptText = fs.readFileSync(PROMPT, 'utf8');

  it('AC11 — DOES NOT contain the old elapsed_since_last_outside_message clock branch', () => {
    expect(promptText).not.toContain('elapsed_since_last_outside_message');
  });

  it('AC11 / 027 P5 — declares the ledger-driven loop state (poll-streak counters removed)', () => {
    expect(promptText).toContain('awaitingFirstContact');
    expect(promptText).toContain('hasCompletedTask');
    expect(promptText).toContain('askedCheckIn');
    // 027 P5 — the integer poll-streak counters are gone; stand-down is ledger-driven.
    expect(promptText).not.toContain('emptyPollStreak');
    expect(promptText).not.toContain('sentCheckInThisStreak');
  });

  it('027 P5 — consults the ledger via coordination_status (idleElapsedMs / unresolvedPeerRequests / idleBudgetSec)', () => {
    expect(promptText).toContain('coordination_status');
    expect(promptText).toContain('idleElapsedMs');
    expect(promptText).toContain('unresolvedPeerRequests');
    expect(promptText).toContain('idleBudgetSec');
    // The courtesy check-in still gates on the two poll thresholds; the exit no
    // longer depends on replyWaitPolls (ledger-driven now).
    expect(promptText).toContain('firstContactPollThreshold');
    expect(promptText).toContain('postTaskPollThreshold');
  });

  it('027 P5 — pins the first-contact case: idleElapsedMs === null is distinct from 0 (A6)', () => {
    expect(promptText).toContain('idleElapsedMs == null');
    // A never-spoke peer is ended by the absolute run-timeout backstop, never a
    // premature self-exit.
    expect(promptText).toMatch(/backstop/i);
  });

  it('AC11 — both check-in body texts are present', () => {
    expect(promptText).toContain("I've been oriented and idle since boot");
    expect(promptText).toContain("I'm idle since my last task completed");
  });

  it('AC11 / 027 P5 — idle_budget is a prompt self-exit; no_engagement is the backstop reason', () => {
    // A peer that has spoken self-exits idle_budget once idle ≥ budget. A peer
    // that NEVER spoke (idleElapsedMs === null) no longer self-exits in the
    // prompt (A6) — it is ended by the runner's absolute run-timeout backstop,
    // whose conceptual exit reason is no_engagement (documented, not a goto).
    expect(promptText).toContain("exitReason='idle_budget'");
    expect(promptText).toContain('no_engagement');
  });

  it('AC11 — preserves existing dispatch branches (control:stop, task, question, directive)', () => {
    expect(promptText).toContain("exitReason='stop_requested'");
    expect(promptText).toMatch(/msg\.type == 'task'/);
    expect(promptText).toMatch(/msg\.type == 'question'/);
    expect(promptText).toMatch(/msg\.type == 'directive'/);
  });

  it('AC9 — courtesy check-in disable hatch documented (threshold > 0 guards + prose)', () => {
    expect(promptText).toContain('input.firstContactPollThreshold > 0');
    expect(promptText).toContain('input.postTaskPollThreshold > 0');
    // Prose explains that setting either threshold to 0 disables that check-in.
    expect(promptText).toMatch(/set either to `0`/);
  });

  it('AC6 — stop-precedence is explicitly noted in prose', () => {
    expect(promptText).toMatch(/Stop-vs-everything precedence/i);
    expect(promptText).toMatch(/control:\s*stop.*always wins/i);
  });

  it('AC7 — single-shot semantics: askedCheckIn resets on engagement', () => {
    // The engagement branch must reset the check-in latch so a fresh idle
    // stretch can ask again (anti-regression for a dropped reset).
    const engagementResetBlock =
      /awaitingFirstContact = false[\s\S]{0,200}askedCheckIn = false/;
    expect(promptText).toMatch(engagementResetBlock);
  });

  it('AC4 / Q8 — post-task check-in is gated on hasCompletedTask AND non-null lastTaskId (F002 fix)', () => {
    // The bug F002 caught: post-task branch fires after any non-empty
    // engagement (briefing, question, directive) flips awaitingFirstContact
    // to false. Guard MUST require an actual completed task before sending
    // the post-task check-in with ackOf: lastTaskId. Otherwise ackOf would
    // reference null.
    expect(promptText).toContain('hasCompletedTask');
    expect(promptText).toContain('lastTaskId != null');
    // The post-task branch (the one with the post-task body text) must
    // include the hasCompletedTask + lastTaskId != null guards. Verify by
    // looking for the body text and checking the guards appear within a
    // reasonable window above it (the same `else if not awaitingFirstContact`
    // block).
    const postTaskGuards =
      /hasCompletedTask[\s\S]{0,400}lastTaskId != null[\s\S]{0,400}I'm idle since my last task completed/;
    expect(promptText).toMatch(postTaskGuards);
  });

  it('AC4 / Q8 — post-task check-in sets ackOf: lastTaskId', () => {
    expect(promptText).toMatch(/ackOf:\s*lastTaskId/);
  });

  it('Q8 — first-contact check-in does NOT set ackOf (no task to reference)', () => {
    // Find the first-contact body text and verify the surrounding
    // inbox_send call does NOT include an ackOf field.
    const firstContactBlock = promptText.match(
      /inbox_send\(\{[\s\S]{0,400}I've been oriented[\s\S]{0,400}\}\)/,
    );
    expect(firstContactBlock).not.toBeNull();
    expect(firstContactBlock?.[0]).not.toContain('ackOf');
  });

  it('boot block resets all loop-state counters to initial values', () => {
    // Anti-regression: boot must explicitly initialise every counter the
    // main loop reads, otherwise the pseudocode reads as 'use undefined value'
    // which an LLM may interpret unpredictably.
    const bootBlock = /^boot:[\s\S]+?goto main loop/m;
    const match = promptText.match(bootBlock);
    expect(match).not.toBeNull();
    const boot = match?.[0] ?? '';
    expect(boot).toContain('hasCompletedTask = false');
    expect(boot).toContain('askedCheckIn = false');
    expect(boot).toContain('lastTaskId = null');
  });

  it('initialTask path sets awaitingFirstContact = false AND hasCompletedTask = true', () => {
    // The initialTask is treated as the first inbox task — completing it
    // should both flip awaitingFirstContact (engagement) and set
    // hasCompletedTask (so the post-task branch becomes eligible).
    const initialTaskBlock = /if input\.initialTask is set:[\s\S]{0,500}else:/;
    const match = promptText.match(initialTaskBlock);
    expect(match).not.toBeNull();
    const block = match?.[0] ?? '';
    expect(block).toContain('awaitingFirstContact = false');
    expect(block).toContain('hasCompletedTask = true');
  });
});
