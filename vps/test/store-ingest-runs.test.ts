/**
 * `degradedSourceIds` (ticket #18, layer B): the SQL half of the source-health
 * alert. A source is degraded when its newest `streak` runs are all failed or
 * zero-yield; one `ok` run that fetched something clears the condition.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import type { ScanStatus } from '../src/tick/types.js';

import {
  closeTestDatabase,
  createTestDatabase,
  type TestDatabase,
} from './helpers/database.js';
import { seedSource } from './helpers/seed.js';

const T0 = Date.parse('2026-11-01T08:00:00.000Z');
const MINUTE = 60 * 1000;
const iso = (ms: number): string => new Date(ms).toISOString();

let current: TestDatabase | null = null;

afterEach(async () => {
  if (current !== null) {
    await closeTestDatabase(current);
    current = null;
  }
});

async function database(prefix: string): Promise<TestDatabase> {
  current = await createTestDatabase(prefix);
  return current;
}

/** Writes one finished run; `id` order follows call order. */
function addRun(
  databaseUnderTest: TestDatabase,
  sourceId: number,
  status: ScanStatus,
  fetched: number,
  atMs: number,
): number {
  const startedAt = iso(atMs);
  const id = databaseUnderTest.store.ingestRuns.start(sourceId, startedAt);
  databaseUnderTest.store.ingestRuns.finish(id, {
    status,
    fetched,
    inserted: status === 'ok' ? Math.min(fetched, 1) : 0,
    updated: 0,
    skipped: 0,
    errors: status === 'ok' ? 0 : 1,
    cursorBefore: 1,
    cursorAfter: 2,
    finishedAt: iso(atMs + MINUTE),
  });
  return id;
}

describe('degradedSourceIds', () => {
  it('reports a source with three failed runs', async () => {
    const fixture = await database('tele-lenta-runs-degraded-');
    const source = seedSource(fixture.db, { username: 'degraded_failed' });
    addRun(fixture, source, 'failed', 0, T0);
    addRun(fixture, source, 'failed', 0, T0 + MINUTE);
    addRun(fixture, source, 'failed', 0, T0 + 2 * MINUTE);

    assert.deepEqual(fixture.store.ingestRuns.degradedSourceIds(3), [source]);
  });

  it('does not report two failed runs followed by an ok run that fetched', async () => {
    const fixture = await database('tele-lenta-runs-recovered-');
    const source = seedSource(fixture.db, { username: 'degraded_recovered' });
    addRun(fixture, source, 'failed', 0, T0);
    addRun(fixture, source, 'failed', 0, T0 + MINUTE);
    addRun(fixture, source, 'ok', 7, T0 + 2 * MINUTE);

    assert.deepEqual(fixture.store.ingestRuns.degradedSourceIds(3), []);
  });

  it('reports three ok runs that all fetched nothing', async () => {
    const fixture = await database('tele-lenta-runs-zero-');
    const source = seedSource(fixture.db, { username: 'degraded_zero' });
    addRun(fixture, source, 'ok', 0, T0);
    addRun(fixture, source, 'ok', 0, T0 + MINUTE);
    addRun(fixture, source, 'ok', 0, T0 + 2 * MINUTE);

    assert.deepEqual(fixture.store.ingestRuns.degradedSourceIds(3), [source]);
  });

  it('does not report three ok runs that fetched messages', async () => {
    const fixture = await database('tele-lenta-runs-healthy-');
    const source = seedSource(fixture.db, { username: 'degraded_healthy' });
    addRun(fixture, source, 'ok', 4, T0);
    addRun(fixture, source, 'ok', 3, T0 + MINUTE);
    addRun(fixture, source, 'ok', 2, T0 + 2 * MINUTE);

    assert.deepEqual(fixture.store.ingestRuns.degradedSourceIds(3), []);
  });

  it('ignores a disabled source even when its last runs failed', async () => {
    const fixture = await database('tele-lenta-runs-disabled-');
    const source = seedSource(fixture.db, { username: 'degraded_disabled', enabled: false });
    addRun(fixture, source, 'failed', 0, T0);
    addRun(fixture, source, 'failed', 0, T0 + MINUTE);
    addRun(fixture, source, 'failed', 0, T0 + 2 * MINUTE);

    assert.deepEqual(fixture.store.ingestRuns.degradedSourceIds(3), []);
  });

  it('needs a full window: two failed runs are not enough', async () => {
    const fixture = await database('tele-lenta-runs-short-');
    const source = seedSource(fixture.db, { username: 'degraded_short' });
    addRun(fixture, source, 'failed', 0, T0);
    addRun(fixture, source, 'failed', 0, T0 + MINUTE);

    assert.deepEqual(fixture.store.ingestRuns.degradedSourceIds(3), []);
  });

  it('only looks at the newest window, so an older success does not save it', async () => {
    const fixture = await database('tele-lenta-runs-window-');
    const source = seedSource(fixture.db, { username: 'degraded_window' });
    addRun(fixture, source, 'ok', 9, T0);
    addRun(fixture, source, 'failed', 0, T0 + MINUTE);
    addRun(fixture, source, 'failed', 0, T0 + 2 * MINUTE);
    addRun(fixture, source, 'ok', 0, T0 + 3 * MINUTE);

    assert.deepEqual(fixture.store.ingestRuns.degradedSourceIds(3), [source]);
  });

  it('orders several degraded sources by id', async () => {
    const fixture = await database('tele-lenta-runs-many-');
    const second = seedSource(fixture.db, { username: 'degraded_second' });
    const first = seedSource(fixture.db, { username: 'degraded_first' });
    for (const sourceId of [second, first]) {
      addRun(fixture, sourceId, 'failed', 0, T0);
      addRun(fixture, sourceId, 'failed', 0, T0 + MINUTE);
      addRun(fixture, sourceId, 'failed', 0, T0 + 2 * MINUTE);
    }

    const ordered = [first, second].sort((a, b) => a - b);
    assert.deepEqual(fixture.store.ingestRuns.degradedSourceIds(3), ordered);
  });
});
