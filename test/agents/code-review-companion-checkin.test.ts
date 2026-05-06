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
import Ajv2020 from 'ajv/dist/2020.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

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

  it('AC11 — declares the three loop-state counters', () => {
    expect(promptText).toContain('awaitingFirstContact');
    expect(promptText).toContain('emptyPollStreak');
    expect(promptText).toContain('sentCheckInThisStreak');
  });

  it('AC11 — references all three input-schema threshold fields', () => {
    expect(promptText).toContain('firstContactPollThreshold');
    expect(promptText).toContain('postTaskPollThreshold');
    expect(promptText).toContain('replyWaitPolls');
  });

  it('AC11 — both check-in body texts are present', () => {
    expect(promptText).toContain(
      "I've been oriented and idle since boot",
    );
    expect(promptText).toContain(
      "I'm idle since my last task completed",
    );
  });

  it('AC11 — both exit reasons are present (no_engagement + idle_budget)', () => {
    expect(promptText).toContain("exitReason='no_engagement'");
    expect(promptText).toContain("exitReason='idle_budget'");
  });

  it('AC11 — preserves existing dispatch branches (control:stop, task, question, directive)', () => {
    expect(promptText).toContain("exitReason='stop_requested'");
    expect(promptText).toMatch(/msg\.type == 'task'/);
    expect(promptText).toMatch(/msg\.type == 'question'/);
    expect(promptText).toMatch(/msg\.type == 'directive'/);
  });

  it('AC9 — disable escape hatch documented (threshold > 0 guard, prose mention)', () => {
    expect(promptText).toContain('input.firstContactPollThreshold > 0');
    expect(promptText).toContain('input.postTaskPollThreshold > 0');
    expect(promptText).toMatch(/firstContactPollThreshold:\s*0/);
    expect(promptText).toMatch(/postTaskPollThreshold:\s*0/);
  });

  it('AC6 — stop-precedence is explicitly noted in prose', () => {
    expect(promptText).toMatch(/Stop-vs-everything precedence/i);
    expect(promptText).toMatch(/control:\s*stop.*always wins/i);
  });

  it('AC7 — single-shot semantics: sentCheckInThisStreak resets only on engagement', () => {
    // Verify the engagement reset block contains all three counter resets in
    // a contiguous span (anti-regression: a future edit that splits or
    // accidentally drops a reset breaks the protocol).
    const engagementResetBlock = /awaitingFirstContact = false[\s\S]{0,200}emptyPollStreak = 0[\s\S]{0,200}sentCheckInThisStreak = false/;
    expect(promptText).toMatch(engagementResetBlock);
  });
});
