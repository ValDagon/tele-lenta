import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import {
  closeTestDatabase,
  createTestDatabase,
  type TestDatabase,
} from './helpers/database.js';

const T0 = '2026-11-01T08:00:00.000Z';
const T1 = '2026-11-01T09:00:00.000Z';
const T2 = '2026-11-01T10:00:00.000Z';

const USER = 7001;
const OTHER_USER = 7002;

let current: TestDatabase | null = null;

afterEach(async () => {
  if (current !== null) {
    await closeTestDatabase(current);
    current = null;
  }
});

async function database(prefix: string): Promise<TestDatabase> {
  current = await createTestDatabase(prefix);
  // Saved searches cascade from the user row, so both ids must exist.
  for (const id of [USER, OTHER_USER]) {
    current.db
      .prepare(
        `INSERT INTO users (telegram_user_id, username, first_name, allowed, created_at)
         VALUES (?, ?, ?, 1, ?)`,
      )
      .run(id, `user_${id}`, `User ${id}`, T0);
  }
  return current;
}

describe('saved search store', () => {
  it('creates a search with defaults and seeds last_checked_at from created_at', async () => {
    const { store } = await database('tele-lenta-saved-create-');

    const created = store.savedSearches.create(USER, { name: 'Квартира' }, T0);

    assert.ok(created);
    assert.equal(created.userId, USER);
    assert.equal(created.name, 'Квартира');
    assert.equal(created.query, '');
    assert.equal(created.section, null);
    assert.deepEqual(created.categories, []);
    assert.equal(created.demand, null);
    assert.deepEqual(created.sources, []);
    assert.equal(created.enabled, true);
    assert.equal(created.createdAt, T0);
    // The first digest contains only what appeared after saving.
    assert.equal(created.lastCheckedAt, created.createdAt);
    assert.equal(created.lastSentAt, null);
  });

  it('round-trips every filter field', async () => {
    const { store } = await database('tele-lenta-saved-roundtrip-');

    const created = store.savedSearches.create(
      USER,
      {
        name: 'Работа в Подгорице',
        query: 'подгорица',
        section: 'jobs',
        categories: ['services', 'other'],
        demand: 'wanted',
        sources: [3, 7],
        enabled: false,
      },
      T0,
    );

    assert.ok(created);
    const read = store.savedSearches.get(USER, created.id);
    assert.ok(read);
    assert.deepEqual(read, created);
    assert.equal(read.query, 'подгорица');
    assert.equal(read.section, 'jobs');
    assert.deepEqual(read.categories, ['services', 'other']);
    assert.equal(read.demand, 'wanted');
    assert.deepEqual(read.sources, [3, 7]);
    assert.equal(read.enabled, false);
  });

  it('lists newest first, then by descending id', async () => {
    const { store } = await database('tele-lenta-saved-list-');

    const first = store.savedSearches.create(USER, { name: 'Первый' }, T0);
    const second = store.savedSearches.create(USER, { name: 'Второй' }, T1);
    const tie = store.savedSearches.create(USER, { name: 'Тот же миг' }, T1);
    assert.ok(first && second && tie);

    assert.deepEqual(
      store.savedSearches.list(USER).map((row) => row.name),
      ['Тот же миг', 'Второй', 'Первый'],
    );
  });

  it('never shows or updates another user’s search', async () => {
    const { store } = await database('tele-lenta-saved-scope-');

    const mine = store.savedSearches.create(USER, { name: 'Мой' }, T0);
    assert.ok(mine);

    assert.equal(store.savedSearches.get(OTHER_USER, mine.id), null);
    assert.deepEqual(store.savedSearches.list(OTHER_USER), []);
    assert.equal(
      store.savedSearches.update(OTHER_USER, mine.id, { name: 'Чужой' }, T1),
      null,
    );
    assert.equal(store.savedSearches.delete(OTHER_USER, mine.id), false);

    const untouched = store.savedSearches.get(USER, mine.id);
    assert.ok(untouched);
    assert.equal(untouched.name, 'Мой');
  });

  it('caps a user at ten saved searches', async () => {
    const { store } = await database('tele-lenta-saved-limit-');

    for (let index = 0; index < 10; index += 1) {
      const created = store.savedSearches.create(USER, { name: `Поиск ${index}` }, T0);
      assert.ok(created, `search ${index} must be created`);
    }

    assert.equal(store.savedSearches.count(USER), 10);
    assert.equal(store.savedSearches.create(USER, { name: 'Одиннадцатый' }, T1), null);
    assert.equal(store.savedSearches.count(USER), 10);

    // The cap is per user, not global.
    assert.ok(store.savedSearches.create(OTHER_USER, { name: 'Свой' }, T1));
  });

  it('patches only the supplied fields and keeps bookkeeping columns', async () => {
    const { store } = await database('tele-lenta-saved-patch-');

    const created = store.savedSearches.create(
      USER,
      {
        name: 'Старое имя',
        query: 'квартира',
        section: 'classifieds',
        categories: ['real_estate'],
        demand: 'offer',
        sources: [1],
      },
      T0,
    );
    assert.ok(created);

    const renamed = store.savedSearches.update(USER, created.id, { name: 'Новое имя' }, T1);
    assert.ok(renamed);
    assert.equal(renamed.name, 'Новое имя');
    assert.equal(renamed.query, 'квартира');
    assert.equal(renamed.section, 'classifieds');
    assert.deepEqual(renamed.categories, ['real_estate']);
    assert.equal(renamed.demand, 'offer');
    assert.deepEqual(renamed.sources, [1]);
    assert.equal(renamed.createdAt, T0);
    assert.equal(renamed.lastCheckedAt, T0);
    assert.equal(renamed.lastSentAt, null);

    const cleared = store.savedSearches.update(
      USER,
      created.id,
      { section: null, demand: null, query: '', categories: [], sources: [], enabled: false },
      T2,
    );
    assert.ok(cleared);
    assert.equal(cleared.name, 'Новое имя');
    assert.equal(cleared.section, null);
    assert.equal(cleared.demand, null);
    assert.equal(cleared.query, '');
    assert.deepEqual(cleared.categories, []);
    assert.deepEqual(cleared.sources, []);
    assert.equal(cleared.enabled, false);
    assert.equal(cleared.createdAt, T0);
  });

  it('reports an update on a missing id as null', async () => {
    const { store } = await database('tele-lenta-saved-patch-missing-');

    assert.equal(store.savedSearches.update(USER, 999_999, { name: 'Нет' }, T0), null);
  });

  it('deletes an owned search and reports whether a row existed', async () => {
    const { store } = await database('tele-lenta-saved-delete-');

    const created = store.savedSearches.create(USER, { name: 'Удалить' }, T0);
    assert.ok(created);

    assert.equal(store.savedSearches.delete(USER, created.id), true);
    assert.equal(store.savedSearches.get(USER, created.id), null);
    assert.equal(store.savedSearches.delete(USER, created.id), false);
  });

  it('reads corrupted JSON as an empty array instead of throwing', async () => {
    const { db, store } = await database('tele-lenta-saved-bad-json-');

    const created = store.savedSearches.create(USER, { name: 'Битый' }, T0);
    assert.ok(created);
    db.prepare('UPDATE saved_searches SET categories_json = ?, sources_json = ? WHERE id = ?').run(
      '{not json',
      'also broken',
      created.id,
    );

    const list = store.savedSearches.list(USER);
    assert.equal(list.length, 1);
    assert.deepEqual(list[0]?.categories, []);
    assert.deepEqual(list[0]?.sources, []);
  });
});
