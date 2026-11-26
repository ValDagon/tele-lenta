import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import {
  DIGEST_INTERVAL_MS,
  DIGEST_TIME_ZONE,
  MAX_DIGEST_CARDS,
  composeDigest,
  groupForDigest,
} from '../src/digest/index.js';
import type { UnsentMatch } from '../src/store/index.js';

import {
  closeTestDatabase,
  createTestDatabase,
  type TestDatabase,
} from './helpers/database.js';
import { seedCluster, seedSource } from './helpers/seed.js';

const MINUTE = 60 * 1000;
const T0_MS = Date.parse('2026-11-01T08:00:00.000Z');
const T0 = new Date(T0_MS).toISOString();
const at = (minutes: number): string => new Date(T0_MS + minutes * MINUTE).toISOString();

const USER = 9201;

let current: TestDatabase | null = null;

afterEach(async () => {
  if (current !== null) {
    await closeTestDatabase(current);
    current = null;
  }
});

function unsent(overrides: Partial<UnsentMatch> & Pick<UnsentMatch, 'clusterId' | 'searchId'>): UnsentMatch {
  return {
    earliestPublishedAt: T0,
    section: 'classifieds',
    category: 'other',
    demand: 'offer',
    title: `Карточка ${overrides.clusterId}`,
    city: null,
    priceRaw: null,
    salaryRaw: null,
    eventStartsAt: null,
    searchName: `Поиск ${overrides.searchId}`,
    matchedAt: T0,
    ...overrides,
  };
}

describe('digest constants', () => {
  it('pins the v1 interval, card cap, and time zone', () => {
    assert.equal(DIGEST_INTERVAL_MS, 30 * MINUTE);
    assert.equal(MAX_DIGEST_CARDS, 10);
    assert.equal(DIGEST_TIME_ZONE, 'Europe/Podgorica');
  });
});

describe('groupForDigest', () => {
  it('groups by search id in first-appearance order and keeps inner order', () => {
    const groups = groupForDigest([
      unsent({ clusterId: 3, searchId: 20 }),
      unsent({ clusterId: 1, searchId: 10 }),
      unsent({ clusterId: 2, searchId: 20 }),
    ]);

    assert.deepEqual(
      groups.map((group) => [group.searchName, group.matches.map((match) => match.clusterId)]),
      [
        ['Поиск 20', [3, 2]],
        ['Поиск 10', [1]],
      ],
    );
  });

  it('returns no groups for no matches', () => {
    assert.deepEqual(groupForDigest([]), []);
  });
});

describe('digest layer A flow', () => {
  it('matches due searches, batches both into one message, and marks it sent', async () => {
    current = await createTestDatabase('tele-lenta-digest-flow-');
    const { store, db } = current;
    store.users.allow(USER, { at: T0 });

    const rentSource = seedSource(db, { username: 'flow_rent', sectionHint: 'classifieds' });
    const jobsSource = seedSource(db, { username: 'flow_jobs', sectionHint: 'jobs' });

    const rentCluster = seedCluster(db, store, [
      {
        sourceId: rentSource,
        messageId: 1,
        publishedAt: at(1),
        title: 'Сдам квартиру',
        searchText: 'sdam kvartiru podgorica',
        category: 'real_estate',
        city: 'Podgorica',
        priceRaw: '650 €',
      },
    ]);
    const jobCluster = seedCluster(db, store, [
      {
        sourceId: jobsSource,
        messageId: 2,
        publishedAt: at(2),
        section: 'jobs',
        title: 'Ищу работу',
        searchText: 'ishchu rabotu podgorica',
        demand: 'wanted',
        salaryRaw: '800 €',
      },
    ]);

    const rentSearch = store.savedSearches.create(
      USER,
      { name: 'Квартира', query: 'Подгорица', categories: ['real_estate'] },
      T0,
    );
    const jobSearch = store.savedSearches.create(
      USER,
      { name: 'Работа', query: 'работу', section: 'jobs' },
      T0,
    );
    assert.ok(rentSearch && jobSearch);

    const now = at(31);
    const due = store.digests.listDue(now, DIGEST_INTERVAL_MS);
    assert.deepEqual(due.map((search) => search.id), [rentSearch.id, jobSearch.id]);

    for (const search of due) {
      const matches = store.digests.matchSearch(search, search.lastCheckedAt, now);
      store.digests.recordCheck(search.id, matches, now);
    }

    const rows = store.digests.unsentForUser(USER);
    assert.deepEqual(rows.map((row) => row.clusterId), [rentCluster, jobCluster]);

    const digest = composeDigest({
      groups: groupForDigest(rows),
      botUsername: 'telenta_bot',
    });

    assert.deepEqual(digest.clusterIds, [rentCluster, jobCluster]);
    assert.equal(digest.hasMore, false);
    assert.ok(digest.html.includes('<b>Работа</b>'));
    assert.ok(digest.html.includes('<b>Квартира</b>'));
    assert.ok(
      digest.html.includes(`https://t.me/telenta_bot?startapp=card_${rentCluster}`),
    );

    store.digests.markSent(
      USER,
      due.map((search) => search.id),
      digest.clusterIds,
      now,
    );

    assert.deepEqual(store.digests.unsentForUser(USER), []);
    assert.equal(store.savedSearches.get(USER, rentSearch.id)?.lastSentAt, now);
    assert.equal(store.savedSearches.get(USER, jobSearch.id)?.lastSentAt, now);
    assert.equal(store.savedSearches.get(USER, rentSearch.id)?.lastCheckedAt, now);
  });
});
