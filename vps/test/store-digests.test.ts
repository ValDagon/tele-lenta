import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import type { DueSearch, Section } from '../src/store/index.js';

import {
  closeTestDatabase,
  createTestDatabase,
  type TestDatabase,
} from './helpers/database.js';
import { seedCluster, seedSource, type SeedMemberOptions } from './helpers/seed.js';

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;
const T0_MS = Date.parse('2026-11-01T08:00:00.000Z');
const T0 = new Date(T0_MS).toISOString();
const at = (hours: number): string => new Date(T0_MS + hours * HOUR).toISOString();
const before = (ms: number): string => new Date(T0_MS - ms).toISOString();
const after = (ms: number): string => new Date(T0_MS + ms).toISOString();

const USER = 9101;
const OTHER_USER = 9102;
const OFF_USER = 9103;
const DENIED_USER = 9104;
const BLOCKED_USER = 9105;

const INTERVAL = 30 * MINUTE;

let current: TestDatabase | null = null;

afterEach(async () => {
  if (current !== null) {
    await closeTestDatabase(current);
    current = null;
  }
});

async function setup(prefix: string): Promise<TestDatabase> {
  current = await createTestDatabase(prefix);
  return current;
}

function member(
  overrides: Partial<SeedMemberOptions> &
    Pick<SeedMemberOptions, 'sourceId' | 'messageId' | 'publishedAt'>,
): SeedMemberOptions {
  return { ...overrides };
}

interface Corpus {
  database: TestDatabase;
  sources: { rent: number; jobs: number; events: number; second: number };
  clusters: Record<
    | 'rent'
    | 'wantedRent'
    | 'job'
    | 'event'
    | 'multi'
    | 'hidden'
    | 'rep'
    | 'boundary',
    number
  >;
}

function seedCorpus(database: TestDatabase): Corpus {
  const { db, store } = database;

  const rent = seedSource(db, {
    username: 'rent_chat',
    title: 'Rent',
    sectionHint: 'classifieds',
  });
  const jobs = seedSource(db, { username: 'jobs_chat', sectionHint: 'jobs' });
  const events = seedSource(db, { username: 'events_chat', sectionHint: 'events' });
  const second = seedSource(db, { username: 'second_chat', sectionHint: 'classifieds' });

  const clusters = {
    rent: seedCluster(db, store, [
      member({
        sourceId: rent,
        messageId: 1,
        publishedAt: at(1),
        title: 'Сдам квартиру',
        searchText: 'sdam kvartiru podgorica',
        category: 'real_estate',
        city: 'Podgorica',
        priceRaw: '650 €',
      }),
    ]),
    wantedRent: seedCluster(db, store, [
      member({
        sourceId: second,
        messageId: 2,
        publishedAt: at(2),
        title: 'Куплю квартиру',
        searchText: 'kuplju kvartiru niksic',
        category: 'real_estate',
        demand: 'wanted',
        city: 'Nikšić',
      }),
    ]),
    job: seedCluster(db, store, [
      member({
        sourceId: jobs,
        messageId: 3,
        publishedAt: at(3),
        section: 'jobs',
        title: 'Ищу работу',
        searchText: 'ishchu rabotu podgorica',
        demand: 'wanted',
        salaryRaw: '800 €',
      }),
    ]),
    event: seedCluster(db, store, [
      member({
        sourceId: events,
        messageId: 4,
        publishedAt: at(4),
        section: 'events',
        title: 'Концерт',
        searchText: 'koncert podgorica',
        eventStartsAt: at(50),
      }),
    ]),
    multi: seedCluster(db, store, [
      member({
        sourceId: rent,
        messageId: 5,
        publishedAt: at(5),
        title: 'Кросс-пост',
        searchText: 'kross post',
        category: 'real_estate',
      }),
      member({
        sourceId: events,
        messageId: 6,
        publishedAt: at(5.5),
        section: 'events',
        title: 'Кросс-пост',
        searchText: 'kross post',
      }),
    ]),
    hidden: seedCluster(db, store, [
      member({
        sourceId: rent,
        messageId: 7,
        publishedAt: at(7),
        title: 'Скрытый',
        searchText: 'skrytyj',
        messageStatus: 'deleted',
      }),
    ]),
    rep: seedCluster(db, store, [
      member({
        sourceId: rent,
        messageId: 8,
        publishedAt: at(9),
        title: 'Удалённое объявление',
        searchText: 'udalennyj tekst',
        messageStatus: 'deleted',
      }),
      member({
        sourceId: second,
        messageId: 9,
        publishedAt: at(9.5),
        title: 'Доступное объявление',
        searchText: 'dostupnyj tekst',
      }),
    ]),
    boundary: seedCluster(db, store, [
      member({
        sourceId: second,
        messageId: 10,
        publishedAt: at(0),
        title: 'На границе',
        searchText: 'granica',
        category: 'services',
      }),
    ]),
  };

  return { database, sources: { rent, jobs, events, second }, clusters };
}

/** A `DueSearch` value for the matcher; only the listed fields are read. */
function search(
  overrides: Partial<DueSearch> & Pick<DueSearch, 'id' | 'userId'>,
): DueSearch {
  return {
    name: `search ${overrides.id}`,
    query: '',
    section: null,
    categories: [],
    demand: null,
    sources: [],
    lastCheckedAt: T0,
    digestEnabled: true,
    quietStart: '23:00',
    quietEnd: '08:00',
    digestUndeliverableAt: null,
    ...overrides,
  };
}

const ids = (matches: readonly { clusterId: number }[]): number[] =>
  matches.map((match) => match.clusterId);

const NOW = after(40 * MINUTE);
const EPOCH = '1970-01-01T00:00:00.000Z';
const FAR_FUTURE = '2100-01-01T00:00:00.000Z';

describe('digest store: listDue', () => {
  it('selects enabled searches for allowed users with digests on and an old check', async () => {
    const database = await setup('tele-lenta-digests-due-');
    const { store } = database;

    store.users.allow(USER, { at: T0 });
    store.users.allow(OTHER_USER, { at: T0 });
    store.users.allow(OFF_USER, { at: T0 });
    store.users.upsertProfile({ telegramUserId: DENIED_USER, at: T0 });
    store.users.allow(BLOCKED_USER, { at: T0 });
    store.users.updateSettings(OFF_USER, { digestEnabled: false });

    const due = store.savedSearches.create(USER, { name: 'Должен' }, before(60 * MINUTE));
    const recent = store.savedSearches.create(USER, { name: 'Рано' }, after(20 * MINUTE));
    const disabled = store.savedSearches.create(
      USER,
      { name: 'Выключен', enabled: false },
      before(60 * MINUTE),
    );
    const other = store.savedSearches.create(OTHER_USER, { name: 'Другой' }, before(60 * MINUTE));
    store.savedSearches.create(OFF_USER, { name: 'Без дайджеста' }, before(60 * MINUTE));
    store.savedSearches.create(DENIED_USER, { name: 'Без допуска' }, before(60 * MINUTE));
    const blocked = store.savedSearches.create(
      BLOCKED_USER,
      { name: 'Недоставляемый' },
      before(60 * MINUTE),
    );
    assert.ok(due && recent && disabled && other && blocked);

    store.digests.markUndeliverable(BLOCKED_USER, T0);

    const result = store.digests.listDue(NOW, INTERVAL);

    assert.deepEqual(
      result.map((item) => [item.userId, item.id]),
      [
        [USER, due.id],
        [OTHER_USER, other.id],
      ],
    );

    const first = result[0];
    assert.ok(first);
    assert.equal(first.name, 'Должен');
    assert.equal(first.query, '');
    assert.equal(first.section, null);
    assert.deepEqual(first.categories, []);
    assert.equal(first.demand, null);
    assert.deepEqual(first.sources, []);
    assert.equal(first.lastCheckedAt, before(60 * MINUTE));
    assert.equal(first.digestEnabled, true);
    assert.equal(first.quietStart, '23:00');
    assert.equal(first.quietEnd, '08:00');
    assert.equal(first.digestUndeliverableAt, null);
  });

  it('makes a search due exactly at the interval boundary', async () => {
    const database = await setup('tele-lenta-digests-boundary-');
    const { store } = database;
    store.users.allow(USER, { at: T0 });

    const created = store.savedSearches.create(USER, { name: 'Ровно' }, before(INTERVAL));
    assert.ok(created);

    assert.deepEqual(
      store.digests.listDue(NOW, INTERVAL).map((item) => item.id),
      [created.id],
    );
    assert.deepEqual(store.digests.listDue(before(INTERVAL - 1000), INTERVAL), []);
  });
});

describe('digest store: matchSearch', () => {
  it('applies section, categories, demand, sources, and the query together', async () => {
    const database = await setup('tele-lenta-digests-filters-');
    const corpus = seedCorpus(database);
    const { store } = database;
    const c = corpus.clusters;

    const match = (overrides: Partial<DueSearch>): number[] =>
      ids(store.digests.matchSearch(search({ id: 1, userId: USER, ...overrides }), EPOCH, FAR_FUTURE));

    assert.deepEqual(match({}), [
      c.rep,
      c.multi,
      c.event,
      c.job,
      c.wantedRent,
      c.rent,
      c.boundary,
    ]);
    assert.deepEqual(match({ section: 'jobs' as Section }), [c.job]);
    assert.deepEqual(match({ categories: ['real_estate'] }), [
      c.multi,
      c.wantedRent,
      c.rent,
    ]);
    assert.deepEqual(match({ categories: ['real_estate', 'services'] }), [
      c.multi,
      c.wantedRent,
      c.rent,
      c.boundary,
    ]);
    assert.deepEqual(match({ demand: 'wanted' }), [c.job, c.wantedRent]);
    assert.deepEqual(match({ sources: [corpus.sources.rent] }), [
      c.rep,
      c.multi,
      c.rent,
    ]);
    assert.deepEqual(match({ sources: [corpus.sources.rent, corpus.sources.events] }), [
      c.rep,
      c.multi,
      c.event,
      c.rent,
    ]);
    assert.deepEqual(
      match({
        section: 'classifieds',
        demand: 'offer',
        sources: [corpus.sources.rent],
        query: 'Подгорица',
      }),
      [c.rent],
    );
  });

  it('normalizes the stored query and matches the representative search_text', async () => {
    const database = await setup('tele-lenta-digests-query-');
    const corpus = seedCorpus(database);
    const { store } = database;

    const match = (query: string): number[] =>
      ids(
        store.digests.matchSearch(
          search({ id: 1, userId: USER, query }),
          EPOCH,
          FAR_FUTURE,
        ),
      );

    // «Подгорица» reaches the Latin `podgorica` in search_text.
    assert.deepEqual(match('Подгорица'), [
      corpus.clusters.event,
      corpus.clusters.job,
      corpus.clusters.rent,
    ]);
    // A deleted member is never the representative, so its text does not match.
    assert.deepEqual(match('udalennyj'), []);
    assert.deepEqual(match('dostupnyj'), [corpus.clusters.rep]);
    // An empty query is not a condition at all.
    assert.equal(match('').length, 7);
    // A query with no searchable characters is also not a condition.
    assert.equal(match('!!!').length, 7);
  });

  it('excludes hidden clusters and bounds the window strictly after since', async () => {
    const database = await setup('tele-lenta-digests-window-');
    const corpus = seedCorpus(database);
    const { store } = database;

    const idsSince = (sinceIso: string): number[] =>
      ids(store.digests.matchSearch(search({ id: 1, userId: USER }), sinceIso, FAR_FUTURE));

    const fromT0 = idsSince(T0);
    assert.ok(!fromT0.includes(corpus.clusters.boundary));
    assert.ok(!fromT0.includes(corpus.clusters.hidden));
    assert.ok(fromT0.includes(corpus.clusters.rent));

    const justBefore = idsSince(new Date(T0_MS - 1).toISOString());
    assert.ok(justBefore.includes(corpus.clusters.boundary));
    assert.equal(justBefore.length, fromT0.length + 1);

    // `<= now` keeps a cluster published at the boundary and drops later ones.
    const upToEvent = ids(
      store.digests.matchSearch(search({ id: 1, userId: USER }), EPOCH, at(4)),
    );
    assert.deepEqual(upToEvent, [
      corpus.clusters.event,
      corpus.clusters.job,
      corpus.clusters.wantedRent,
      corpus.clusters.rent,
      corpus.clusters.boundary,
    ]);
  });

  it('returns the representative display fields', async () => {
    const database = await setup('tele-lenta-digests-display-');
    const corpus = seedCorpus(database);
    const { store } = database;

    const matches = store.digests.matchSearch(
      search({ id: 1, userId: USER, query: 'dostupnyj' }),
      EPOCH,
      FAR_FUTURE,
    );
    assert.equal(matches.length, 1);
    const rep = matches[0];
    assert.ok(rep);
    assert.equal(rep.clusterId, corpus.clusters.rep);
    assert.equal(rep.earliestPublishedAt, at(9));
    assert.equal(rep.section, 'classifieds');
    assert.equal(rep.category, 'other');
    assert.equal(rep.demand, 'offer');
    assert.equal(rep.title, 'Доступное объявление');
    assert.equal(rep.city, null);
    assert.equal(rep.priceRaw, null);
    assert.equal(rep.salaryRaw, null);
    assert.equal(rep.eventStartsAt, null);

    const job = store.digests.matchSearch(
      search({ id: 1, userId: USER, section: 'jobs' }),
      EPOCH,
      FAR_FUTURE,
    )[0];
    assert.ok(job);
    assert.equal(job.salaryRaw, '800 €');
  });

  /**
   * The digest predicate must be the feed predicate. For every filter set the
   * ordered cluster ids of `GET /v1/feed` and `matchSearch` are compared
   * directly; the time window is widened past the whole corpus so it cannot
   * mask a filter difference.
   */
  it('selects the same clusters as the feed for every filter set', async () => {
    const database = await setup('tele-lenta-digests-parity-');
    const corpus = seedCorpus(database);
    const { store } = database;

    const cases: ReadonlyArray<{
      label: string;
      filters: {
        section: Section | null;
        category: string | null;
        demand: 'offer' | 'wanted' | null;
        sourceIds: number[] | null;
        search: string | null;
      };
      searchQuery: string;
    }> = [
      {
        label: 'no filters',
        filters: { section: null, category: null, demand: null, sourceIds: null, search: null },
        searchQuery: '',
      },
      {
        label: 'section',
        filters: { section: 'classifieds', category: null, demand: null, sourceIds: null, search: null },
        searchQuery: '',
      },
      {
        label: 'category',
        filters: { section: null, category: 'real_estate', demand: null, sourceIds: null, search: null },
        searchQuery: '',
      },
      {
        label: 'demand',
        filters: { section: null, category: null, demand: 'wanted', sourceIds: null, search: null },
        searchQuery: '',
      },
      {
        label: 'one source',
        filters: { section: null, category: null, demand: null, sourceIds: [corpus.sources.rent], search: null },
        searchQuery: '',
      },
      {
        label: 'two sources',
        filters: {
          section: null,
          category: null,
          demand: null,
          sourceIds: [corpus.sources.rent, corpus.sources.events],
          search: null,
        },
        searchQuery: '',
      },
      {
        label: 'query',
        filters: { section: null, category: null, demand: null, sourceIds: null, search: 'podgorica' },
        searchQuery: 'Подгорица',
      },
      {
        label: 'combined',
        filters: {
          section: 'classifieds',
          category: null,
          demand: 'offer',
          sourceIds: [corpus.sources.rent],
          search: 'podgorica',
        },
        searchQuery: 'Подгорица',
      },
    ];

    for (const testCase of cases) {
      const page = store.feed.feed({
        ...testCase.filters,
        cursor: null,
        limit: 100,
      });
      const matched = store.digests.matchSearch(
        search({
          id: 1,
          userId: USER,
          query: testCase.searchQuery,
          section: testCase.filters.section,
          categories: testCase.filters.category === null ? [] : [testCase.filters.category],
          demand: testCase.filters.demand,
          sources: testCase.filters.sourceIds ?? [],
        }),
        EPOCH,
        FAR_FUTURE,
      );

      assert.deepEqual(
        ids(matched),
        page.cards.map((card) => card.clusterId),
        `feed and digest disagreed for ${testCase.label}`,
      );
    }
  });
});

describe('digest store: recordCheck', () => {
  it('inserts matches idempotently and advances last_checked_at even when empty', async () => {
    const database = await setup('tele-lenta-digests-record-');
    const corpus = seedCorpus(database);
    const { store, db } = database;
    store.users.allow(USER, { at: T0 });

    const created = store.savedSearches.create(USER, { name: 'Квартира' }, T0);
    assert.ok(created);

    store.digests.recordCheck(
      created.id,
      [{ clusterId: corpus.clusters.rent }, { clusterId: corpus.clusters.job }],
      at(1),
    );

    const countRows = (): number =>
      (
        db
          .prepare('SELECT COUNT(*) AS count FROM saved_search_matches WHERE saved_search_id = ?')
          .get(created.id) as { count: number }
      ).count;

    assert.equal(countRows(), 2);
    assert.equal(store.savedSearches.get(USER, created.id)?.lastCheckedAt, at(1));

    store.digests.recordCheck(
      created.id,
      [{ clusterId: corpus.clusters.rent }, { clusterId: corpus.clusters.job }],
      at(2),
    );
    assert.equal(countRows(), 2);
    assert.equal(store.savedSearches.get(USER, created.id)?.lastCheckedAt, at(2));

    store.digests.recordCheck(created.id, [], at(3));
    assert.equal(countRows(), 2);
    assert.equal(store.savedSearches.get(USER, created.id)?.lastCheckedAt, at(3));
  });
});

describe('digest store: unsentForUser and markSent', () => {
  it('lists unsent visible matches by search, newest first, with the search name', async () => {
    const database = await setup('tele-lenta-digests-unsent-');
    const corpus = seedCorpus(database);
    const { store } = database;
    store.users.allow(USER, { at: T0 });
    store.users.allow(OTHER_USER, { at: T0 });

    const first = store.savedSearches.create(USER, { name: 'Первый' }, T0);
    const second = store.savedSearches.create(USER, { name: 'Второй' }, T0);
    const foreign = store.savedSearches.create(OTHER_USER, { name: 'Чужой' }, T0);
    assert.ok(first && second && foreign);

    store.digests.recordCheck(
      first.id,
      [
        { clusterId: corpus.clusters.boundary },
        { clusterId: corpus.clusters.rent },
        { clusterId: corpus.clusters.hidden },
      ],
      at(1),
    );
    store.digests.recordCheck(
      second.id,
      [{ clusterId: corpus.clusters.job }, { clusterId: corpus.clusters.event }],
      at(1),
    );
    store.digests.recordCheck(foreign.id, [{ clusterId: corpus.clusters.multi }], at(1));

    const unsent = store.digests.unsentForUser(USER);
    assert.deepEqual(
      unsent.map((match) => [match.searchId, match.clusterId]),
      [
        [first.id, corpus.clusters.rent],
        [first.id, corpus.clusters.boundary],
        [second.id, corpus.clusters.event],
        [second.id, corpus.clusters.job],
      ],
    );
    assert.equal(unsent[0]?.searchName, 'Первый');
    assert.equal(unsent[0]?.title, 'Сдам квартиру');
    assert.equal(unsent[0]?.city, 'Podgorica');
    assert.equal(unsent[0]?.priceRaw, '650 €');
    assert.equal(unsent[0]?.matchedAt, at(1));

    // The hidden cluster is retained in the ledger but never offered to a send.
    assert.ok(!unsent.some((match) => match.clusterId === corpus.clusters.hidden));
    assert.deepEqual(store.digests.unsentForUser(OTHER_USER).map((m) => m.clusterId), [
      corpus.clusters.multi,
    ]);
  });

  it('marks only the sent rows and stamps last_sent_at on every listed search', async () => {
    const database = await setup('tele-lenta-digests-sent-');
    const corpus = seedCorpus(database);
    const { store, db } = database;
    store.users.allow(USER, { at: T0 });

    const withMatches = store.savedSearches.create(USER, { name: 'С матчами' }, T0);
    const withoutMatches = store.savedSearches.create(USER, { name: 'Без матчей' }, T0);
    assert.ok(withMatches && withoutMatches);

    store.digests.recordCheck(
      withMatches.id,
      [{ clusterId: corpus.clusters.rent }, { clusterId: corpus.clusters.job }],
      at(1),
    );

    store.digests.markSent(USER, [withMatches.id, withoutMatches.id], [corpus.clusters.rent], at(2));

    assert.deepEqual(store.digests.unsentForUser(USER).map((match) => match.clusterId), [
      corpus.clusters.job,
    ]);
    assert.equal(store.savedSearches.get(USER, withMatches.id)?.lastSentAt, at(2));
    assert.equal(store.savedSearches.get(USER, withoutMatches.id)?.lastSentAt, at(2));

    const sentAt = (
      db
        .prepare(
          `SELECT sent_at FROM saved_search_matches
           WHERE saved_search_id = ? AND cluster_id = ?`,
        )
        .get(withMatches.id, corpus.clusters.rent) as { sent_at: string | null }
    ).sent_at;
    assert.equal(sentAt, at(2));
  });

  it('is a no-op for empty id lists and never touches another user', async () => {
    const database = await setup('tele-lenta-digests-sent-guard-');
    const corpus = seedCorpus(database);
    const { store } = database;
    store.users.allow(USER, { at: T0 });
    store.users.allow(OTHER_USER, { at: T0 });

    const mine = store.savedSearches.create(USER, { name: 'Мой' }, T0);
    const theirs = store.savedSearches.create(OTHER_USER, { name: 'Чужой' }, T0);
    assert.ok(mine && theirs);

    store.digests.recordCheck(theirs.id, [{ clusterId: corpus.clusters.rent }], at(1));

    assert.doesNotThrow(() => store.digests.markSent(USER, [], [], at(2)));
    store.digests.markSent(USER, [mine.id], [corpus.clusters.rent], at(2));

    assert.equal(store.savedSearches.get(OTHER_USER, theirs.id)?.lastSentAt, null);
    assert.equal(store.digests.unsentForUser(OTHER_USER).length, 1);
  });
});

describe('digest store: markUndeliverable', () => {
  it('records the blocked delivery and removes the user from future runs', async () => {
    const database = await setup('tele-lenta-digests-blocked-');
    const { store } = database;
    store.users.allow(USER, { at: T0 });
    const created = store.savedSearches.create(USER, { name: 'Поиск' }, before(60 * MINUTE));
    assert.ok(created);

    assert.equal(store.digests.listDue(NOW, INTERVAL).length, 1);
    store.digests.markUndeliverable(USER, at(1));

    assert.equal(store.users.get(USER)?.digestUndeliverableAt, at(1));
    assert.deepEqual(store.digests.listDue(NOW, INTERVAL), []);
  });
});
