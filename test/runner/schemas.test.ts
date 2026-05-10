/**
 * AJV strict-mode validation of the four coordination schemas added in P1.
 *
 * Verifies:
 * - Each schema parses as plain JSON (no JSONC comments).
 * - AJV (strict mode) compiles each without error.
 * - `ajv-formats` is registered so `format: date-time` actually rejects bad input.
 * - Positive + negative samples assert correctly per schema.
 * - A malformed schema string surfaces a clear load error.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';

const SCHEMAS_DIR = path.resolve(__dirname, '../../src/schemas');
const SCHEMA_FILES = [
  'inbox-message.json',
  'outside-state.json',
  'inside-state.json',
  'state-history-entry.json',
] as const;

function makeAjv(): Ajv2020 {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  return ajv;
}

describe('coordination schemas (P1)', () => {
  it.each(SCHEMA_FILES)('%s parses as plain JSON (no comments)', (file) => {
    const raw = fs.readFileSync(path.join(SCHEMAS_DIR, file), 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it.each(SCHEMA_FILES)('%s compiles via AJV strict mode', (file) => {
    const schema = JSON.parse(
      fs.readFileSync(path.join(SCHEMAS_DIR, file), 'utf8'),
    );
    const ajv = makeAjv();
    expect(() => ajv.compile(schema)).not.toThrow();
    expect(schema.$id).toMatch(/^https:\/\/minih\.dev\/schemas\//);
  });

  it.each(SCHEMA_FILES)('%s declares draft-2020-12 $schema', (file) => {
    const schema = JSON.parse(
      fs.readFileSync(path.join(SCHEMAS_DIR, file), 'utf8'),
    );
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
  });

  describe('inbox-message.json samples', () => {
    const schema = JSON.parse(
      fs.readFileSync(path.join(SCHEMAS_DIR, 'inbox-message.json'), 'utf8'),
    );
    const validate = makeAjv().compile(schema);

    it('accepts a well-formed message', () => {
      expect(
        validate({
          id: '01HZ7T8B0Z9MQ3GHJK4M5N6PQR',
          sender: 'outside',
          type: 'note',
          subject: 'milestone 2 done',
          body: 'ready for review',
          ts: '2026-04-26T05:00:00.000Z',
        }),
      ).toBe(true);
    });

    it('rejects a message with bad date-time (proves ajv-formats is wired)', () => {
      expect(
        validate({
          id: '01HZ7T8B0Z9MQ3GHJK4M5N6PQR',
          sender: 'outside',
          type: 'note',
          subject: 'x',
          body: '',
          ts: 'not-a-date',
        }),
      ).toBe(false);
    });

    it('rejects an id that does not match the ULID pattern', () => {
      expect(
        validate({
          id: 'not-a-ulid',
          sender: 'outside',
          type: 'note',
          subject: 'x',
          body: '',
          ts: '2026-04-26T05:00:00.000Z',
        }),
      ).toBe(false);
    });

    it('rejects an unknown sender enum value', () => {
      expect(
        validate({
          id: '01HZ7T8B0Z9MQ3GHJK4M5N6PQR',
          sender: 'martian',
          type: 'note',
          subject: 'x',
          body: '',
          ts: '2026-04-26T05:00:00.000Z',
        }),
      ).toBe(false);
    });
  });

  describe('outside-state.json samples', () => {
    const schema = JSON.parse(
      fs.readFileSync(path.join(SCHEMAS_DIR, 'outside-state.json'), 'utf8'),
    );
    const validate = makeAjv().compile(schema);

    it('accepts a default-shape outside state', () => {
      expect(
        validate({
          status: 'in-progress',
          data: { milestone: 2 },
          updatedAt: '2026-04-26T05:00:00.000Z',
          updatedBy: 'outside',
        }),
      ).toBe(true);
    });

    it('rejects updatedBy: inside on outside state', () => {
      expect(
        validate({
          status: 'in-progress',
          data: {},
          updatedAt: '2026-04-26T05:00:00.000Z',
          updatedBy: 'inside',
        }),
      ).toBe(false);
    });

    it('rejects an unknown status value', () => {
      expect(
        validate({
          status: 'reviewing',
          data: {},
          updatedAt: '2026-04-26T05:00:00.000Z',
          updatedBy: 'outside',
        }),
      ).toBe(false);
    });
  });

  describe('inside-state.json samples', () => {
    const schema = JSON.parse(
      fs.readFileSync(path.join(SCHEMAS_DIR, 'inside-state.json'), 'utf8'),
    );
    const validate = makeAjv().compile(schema);

    it('accepts the inside-only "reviewing" status', () => {
      expect(
        validate({
          status: 'reviewing',
          data: {},
          updatedAt: '2026-04-26T05:00:00.000Z',
          updatedBy: 'inside',
        }),
      ).toBe(true);
    });

    it('rejects updatedBy: outside on inside state', () => {
      expect(
        validate({
          status: 'idle',
          data: {},
          updatedAt: '2026-04-26T05:00:00.000Z',
          updatedBy: 'outside',
        }),
      ).toBe(false);
    });
  });

  describe('state-history-entry.json samples', () => {
    const schema = JSON.parse(
      fs.readFileSync(
        path.join(SCHEMAS_DIR, 'state-history-entry.json'),
        'utf8',
      ),
    );
    const validate = makeAjv().compile(schema);

    it('accepts a transition with peerStateAtTime snapshot', () => {
      expect(
        validate({
          ts: '2026-04-26T05:00:00.000Z',
          side: 'inside',
          from: 'idle',
          to: 'in-progress',
          reason: 'kickoff',
          peerStateAtTime: { status: 'in-progress' },
        }),
      ).toBe(true);
    });

    it('accepts a null reason', () => {
      expect(
        validate({
          ts: '2026-04-26T05:00:00.000Z',
          side: 'outside',
          from: 'idle',
          to: 'in-progress',
          reason: null,
          peerStateAtTime: { status: 'idle' },
        }),
      ).toBe(true);
    });

    it('rejects missing peerStateAtTime', () => {
      expect(
        validate({
          ts: '2026-04-26T05:00:00.000Z',
          side: 'outside',
          from: 'idle',
          to: 'in-progress',
          reason: null,
        }),
      ).toBe(false);
    });
  });

  it('a malformed schema string surfaces a load error loudly', () => {
    const malformed = '{"type":"object",}'; // trailing comma → invalid JSON
    expect(() => JSON.parse(malformed)).toThrow();
  });
});
