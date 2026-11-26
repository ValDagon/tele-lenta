import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import {
  closeTestDatabase,
  createTestDatabase,
  type TestDatabase,
} from './helpers/database.js';

const T0 = '2026-11-01T08:00:00.000Z';

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

/** A mature user row without going through the session path. */
function seedUser(db: TestDatabase['db'], id: number, allowed = 1): void {
  db.prepare(
    `INSERT INTO users (telegram_user_id, username, first_name, allowed, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, `user_${id}`, `User ${id}`, allowed, T0);
}

let clusterSequence = 0;

function seedCluster(db: TestDatabase['db']): number {
  clusterSequence += 1;
  const result = db
    .prepare(
      `INSERT INTO clusters
         (cluster_key, section, category, demand, earliest_published_at, first_seen_at)
       VALUES (?, 'classifieds', 'goods', 'offer', ?, ?)`,
    )
    .run(`key-${clusterSequence}`, T0, T0);
  return Number(result.lastInsertRowid);
}

function seedSearch(
  db: TestDatabase['db'],
  userId: number,
  name: string,
): number {
  const result = db
    .prepare(
      `INSERT INTO saved_searches (user_id, name, query, created_at)
       VALUES (?, ?, 'квартира', ?)`,
    )
    .run(userId, name, T0);
  return Number(result.lastInsertRowid);
}

function seedMatch(
  db: TestDatabase['db'],
  savedSearchId: number,
  clusterId: number,
): void {
  db.prepare(
    `INSERT INTO saved_search_matches (saved_search_id, cluster_id, matched_at)
     VALUES (?, ?, ?)`,
  ).run(savedSearchId, clusterId, T0);
}

function count(db: TestDatabase['db'], table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
}

describe('user allowlist store', () => {
  it('creates an unknown id as allowed with the supplied profile', async () => {
    const { db, store } = await database('tele-lenta-users-allow-');

    assert.equal(store.users.get(1001), null);
    assert.equal(
      store.users.allow(1001, { at: T0, username: 'beta', firstName: 'Тест' }),
      true,
    );

    const user = store.users.get(1001);
    assert.ok(user);
    assert.equal(user.telegramUserId, 1001);
    assert.equal(user.allowed, true);
    assert.equal(user.username, 'beta');
    assert.equal(user.firstName, 'Тест');
    assert.equal(user.createdAt, T0);
  });

  it('turns an existing denied row back on without clearing its profile', async () => {
    const { db, store } = await database('tele-lenta-users-reallow-');
    seedUser(db, 1002, 0);

    assert.equal(store.users.allow(1002, { at: T0 }), true);

    const user = store.users.get(1002);
    assert.ok(user);
    assert.equal(user.allowed, true);
    assert.equal(user.username, 'user_1002');
    assert.equal(user.firstName, 'User 1002');
  });

  it('deny keeps the row and clears the allowlist bit', async () => {
    const { db, store } = await database('tele-lenta-users-deny-');
    seedUser(db, 1003, 1);

    assert.equal(store.users.deny(1003), true);

    const user = store.users.get(1003);
    assert.ok(user, 'deny must not delete the row');
    assert.equal(user.allowed, false);
    assert.equal(user.username, 'user_1003');
  });

  it('deny on a missing id changes nothing and reports false', async () => {
    const { db, store } = await database('tele-lenta-users-deny-missing-');

    assert.equal(store.users.deny(9999), false);
    assert.equal(count(db, 'users'), 0);
  });
});

describe('user settings store', () => {
  it('reads the row defaults and reports a missing row as null', async () => {
    const { db, store } = await database('tele-lenta-users-settings-read-');
    seedUser(db, 3001, 1);

    assert.deepEqual(store.users.getSettings(3001), {
      digestEnabled: true,
      quietStart: '23:00',
      quietEnd: '08:00',
      spamFilter: true,
      adFilter: false,
    });
    assert.equal(store.users.getSettings(9999), null);
  });

  it('patches only the supplied settings and never the allowlist', async () => {
    const { db, store } = await database('tele-lenta-users-settings-patch-');
    seedUser(db, 3002, 1);

    const patched = store.users.updateSettings(3002, {
      digestEnabled: false,
      quietStart: '22:30',
      adFilter: true,
    });

    assert.deepEqual(patched, {
      digestEnabled: false,
      quietStart: '22:30',
      quietEnd: '08:00',
      spamFilter: true,
      adFilter: true,
    });
    assert.equal(store.users.get(3002)?.allowed, true);
    assert.equal(store.users.get(3002)?.username, 'user_3002');
  });

  it('reports an update on a missing user as null', async () => {
    const { store } = await database('tele-lenta-users-settings-missing-');

    assert.equal(store.users.updateSettings(9999, { adFilter: true }), null);
  });
});

describe('user forget', () => {
  it('deletes the user, their saved searches, and their matches, leaving others intact', async () => {
    const { db, store } = await database('tele-lenta-users-forget-');

    seedUser(db, 2001);
    seedUser(db, 2002);

    const clusterA = seedCluster(db);
    const clusterB = seedCluster(db);

    const searchOne = seedSearch(db, 2001, 'Квартира');
    const searchTwo = seedSearch(db, 2001, 'Работа');
    const otherSearch = seedSearch(db, 2002, 'Своё');

    seedMatch(db, searchOne, clusterA);
    seedMatch(db, searchOne, clusterB);
    seedMatch(db, searchTwo, clusterA);
    seedMatch(db, otherSearch, clusterA);

    const result = store.users.forget(2001);

    assert.deepEqual(result, { users: 1, savedSearches: 2, savedSearchMatches: 3 });
    assert.equal(store.users.get(2001), null);
    assert.equal(count(db, 'saved_searches'), 1);
    assert.equal(count(db, 'saved_search_matches'), 1);

    const survivor = store.users.get(2002);
    assert.ok(survivor, 'another user must be untouched');
    assert.equal(survivor.allowed, true);
    const remainingSearch = db
      .prepare('SELECT user_id FROM saved_searches WHERE id = ?')
      .get(otherSearch) as { user_id: number };
    assert.equal(remainingSearch.user_id, 2002);
    const remainingMatch = db
      .prepare('SELECT saved_search_id FROM saved_search_matches')
      .get() as { saved_search_id: number };
    assert.equal(remainingMatch.saved_search_id, otherSearch);
  });

  it('reports zeros for an id that is already gone', async () => {
    const { store } = await database('tele-lenta-users-forget-missing-');

    assert.deepEqual(store.users.forget(9999), {
      users: 0,
      savedSearches: 0,
      savedSearchMatches: 0,
    });
  });
});
