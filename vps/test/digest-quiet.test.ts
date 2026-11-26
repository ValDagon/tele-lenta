import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isQuietTime, localMinutes } from '../src/digest/quiet.js';

/**
 * Quiet hours are Europe/Podgorica wall-clock times. The fixtures below pin the
 * CET/CEST transitions in 2026 so a fixed UTC offset can never pass:
 *
 * - 29 March 2026, 02:00 CET -> 03:00 CEST (UTC+1 -> UTC+2);
 * - 25 October 2026, 03:00 CEST -> 02:00 CET (UTC+2 -> UTC+1).
 */
describe('digest quiet hours', () => {
  it('reads wall-clock minutes in Podgorica', () => {
    assert.equal(localMinutes('2026-11-01T21:59:00.000Z'), 22 * 60 + 59);
    assert.equal(localMinutes('2026-11-01T22:00:00.000Z'), 23 * 60);
    assert.equal(localMinutes('2026-11-02T06:59:00.000Z'), 7 * 60 + 59);
    assert.equal(localMinutes('2026-11-02T07:00:00.000Z'), 8 * 60);
    assert.equal(localMinutes('2026-11-01T23:00:00.000Z'), 0);
  });

  it('honours an explicit time zone', () => {
    assert.equal(localMinutes('2026-11-01T12:00:00.000Z', 'UTC'), 12 * 60);
    assert.equal(localMinutes('2026-11-01T12:00:00.000Z', 'Europe/Belgrade'), 13 * 60);
  });

  it('treats the default window 23:00-08:00 as quiet across midnight', () => {
    assert.equal(isQuietTime('23:00', '08:00', '2026-11-01T21:59:00.000Z'), false);
    assert.equal(isQuietTime('23:00', '08:00', '2026-11-01T22:00:00.000Z'), true);
    assert.equal(isQuietTime('23:00', '08:00', '2026-11-02T06:59:00.000Z'), true);
    assert.equal(isQuietTime('23:00', '08:00', '2026-11-02T07:00:00.000Z'), false);
  });

  it('supports a window that does not cross midnight', () => {
    assert.equal(isQuietTime('13:00', '14:00', '2026-11-01T11:59:00.000Z'), false);
    assert.equal(isQuietTime('13:00', '14:00', '2026-11-01T12:00:00.000Z'), true);
    assert.equal(isQuietTime('13:00', '14:00', '2026-11-01T12:59:00.000Z'), true);
    assert.equal(isQuietTime('13:00', '14:00', '2026-11-01T13:00:00.000Z'), false);
    assert.equal(isQuietTime('13:00', '14:00', '2026-11-01T02:00:00.000Z'), false);
  });

  it('never treats an empty window (start equals end) as quiet', () => {
    assert.equal(isQuietTime('08:00', '08:00', '2026-11-01T07:00:00.000Z'), false);
    assert.equal(isQuietTime('08:00', '08:00', '2026-11-01T23:00:00.000Z'), false);
  });

  it('follows the spring DST transition without a one-hour drift', () => {
    // 00:30 CET, then 03:30 CEST after the skipped hour.
    assert.equal(localMinutes('2026-03-28T23:30:00.000Z'), 30);
    assert.equal(localMinutes('2026-03-29T00:30:00.000Z'), 90);
    assert.equal(localMinutes('2026-03-29T01:30:00.000Z'), 210);

    assert.equal(isQuietTime('23:00', '08:00', '2026-03-29T00:30:00.000Z'), true);
    // 08:00 CEST, now outside the window.
    assert.equal(isQuietTime('23:00', '08:00', '2026-03-29T06:00:00.000Z'), false);
  });

  it('follows the autumn DST transition without a one-hour drift', () => {
    // 02:00 CEST, then 03:00 CET after the repeated hour.
    assert.equal(localMinutes('2026-10-24T22:00:00.000Z'), 0);
    assert.equal(localMinutes('2026-10-25T00:00:00.000Z'), 120);
    assert.equal(localMinutes('2026-10-25T02:00:00.000Z'), 180);

    assert.equal(isQuietTime('23:00', '08:00', '2026-10-24T22:30:00.000Z'), true);
    assert.equal(isQuietTime('23:00', '08:00', '2026-10-25T07:00:00.000Z'), false);
  });
});
