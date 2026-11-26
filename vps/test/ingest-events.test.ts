import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseEventStart } from '../src/ingest/events.js';

const PUBLISHED = '2026-11-05T10:00:00.000Z';

function startsAt(text: string, publishedAt = PUBLISHED): string {
  const result = parseEventStart(text, publishedAt);
  assert.equal(result.kind, 'parsed', `expected ${JSON.stringify(text)} to parse`);
  if (result.kind !== 'parsed') throw new Error('unreachable');
  return result.startsAt;
}

function failure(text: string, publishedAt = PUBLISHED): string {
  const result = parseEventStart(text, publishedAt);
  assert.equal(result.kind, 'unparseable', `expected ${JSON.stringify(text)} to fail`);
  if (result.kind !== 'unparseable') throw new Error('unreachable');
  return result.error;
}

describe('parseEventStart formats', () => {
  it('parses a Russian day, month, and time', () => {
    assert.equal(startsAt('Концерт 5 ноября в 19:00, вход 10 €'), '2026-11-05T18:00:00.000Z');
  });

  it('parses numeric day and month', () => {
    assert.equal(startsAt('05.11 19:00'), '2026-11-05T18:00:00.000Z');
  });

  it('parses numeric day, month, and year', () => {
    assert.equal(startsAt('05.11.2026 19:00'), '2026-11-05T18:00:00.000Z');
    assert.equal(startsAt('5.11.26 19.00'), '2026-11-05T18:00:00.000Z');
  });

  it('parses an ISO date and time', () => {
    assert.equal(startsAt('2026-11-05T19:00:00+01:00'), '2026-11-05T18:00:00.000Z');
    assert.equal(startsAt('2026-11-05 19:00'), '2026-11-05T18:00:00.000Z');
  });

  it('parses Montenegrin month names', () => {
    assert.equal(startsAt('5. novembra u 19:00'), '2026-11-05T18:00:00.000Z');
  });

  it('uses the summer DST offset for a summer date', () => {
    assert.equal(startsAt('20 мая в 19:00'), '2026-05-20T17:00:00.000Z');
  });
});

describe('parseEventStart year inference', () => {
  it('keeps the publish year for an upcoming date', () => {
    assert.equal(startsAt('5 декабря в 19:00'), '2026-12-05T18:00:00.000Z');
  });

  it('keeps a date less than 180 days in the past', () => {
    // 20 May 2026 is 169 days before 5 November 2026.
    assert.equal(startsAt('20 мая в 19:00'), '2026-05-20T17:00:00.000Z');
  });

  it('rolls a date more than 180 days in the past into the next year', () => {
    // 5 March 2026 is 245 days before 5 November 2026.
    assert.equal(startsAt('5 марта в 19:00'), '2027-03-05T18:00:00.000Z');
  });

  it('does not roll an explicit year, even when it is in the past', () => {
    assert.equal(startsAt('5 ноября 2025 в 19:00'), '2025-11-05T18:00:00.000Z');
  });
});

describe('parseEventStart failures', () => {
  it('fails when the time is missing', () => {
    assert.match(failure('Концерт 5 ноября'), /time/i);
  });

  it('fails when the date is missing', () => {
    assert.match(failure('Концерт в 19:00'), /date/i);
  });

  it('fails when the text has neither', () => {
    assert.match(failure('Просто анонс без даты'), /date/i);
  });

  it('fails on an invalid calendar date', () => {
    assert.match(failure('30.02 19:00'), /date/i);
  });
});
