import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { BackfillUsageError, parseBackfillArgs } from '../src/backfill/args.js';
import { runBackfill } from '../src/backfill/index.js';
import {
  PolitenessLimiter,
  createPoliteClient,
  createRequestBudget,
  type Clock,
  type FetchLike,
} from '../src/net/polite-client.js';
import type { Listing } from '../src/store/types.js';

import {
  closeTestDatabase,
  createTestDatabase,
  type TestDatabase,
} from './helpers/database.js';
import {
  FakeClock,
  embed,
  html,
  page,
  response,
  seedSource,
  statusOnly,
  type ResponseSpec,
  type WidgetInput,
} from './helpers/tick.js';

const NOW = Date.parse('2026-11-05T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const CUTOFF = NOW - 7 * DAY;
const CHANNEL = 'montework';

type MessageEntry = {
  kind: 'message';
  id: number;
  text: string;
  datetime: string;
  photos?: readonly string[];
};
type ErrorEntry = { kind: 'status'; status: number } | { kind: 'parse_error' };
type Entry = MessageEntry | ErrorEntry;

function message(
  id: number,
  datetime: string,
  text = `Продам лот ${id} в Подгорице, ${100 + id} €, состояние хорошее, самовывоз`,
  photos?: readonly string[],
): MessageEntry {
  return { kind: 'message', id, text, datetime, ...(photos === undefined ? {} : { photos }) };
}

function toWidget(entry: MessageEntry): WidgetInput {
  return {
    id: entry.id,
    text: entry.text,
    datetime: entry.datetime,
    ...(entry.photos === undefined ? {} : { photos: entry.photos }),
  };
}

/**
 * Routes the channel first page and every embed id. An id without an entry is
 * an explicit 404, which is exactly how Telegram answers a missing post.
 */
class Fixture {
  readonly calls: string[] = [];

  constructor(
    private readonly username: string,
    private readonly entries: Map<number, Entry>,
    private readonly channel = false,
  ) {}

  private spec(url: string): ResponseSpec | undefined {
    if (this.channel && url === `https://t.me/s/${this.username}`) {
      const widgets = [...this.entries.values()]
        .filter((entry): entry is MessageEntry => entry.kind === 'message')
        .map(toWidget);
      return html(page(widgets));
    }

    const match = /^https:\/\/t\.me\/[^/]+\/(\d+)\?embed=1$/.exec(url);
    if (match === null) return undefined;
    const id = Number(match[1] as string);
    const entry = this.entries.get(id);
    if (entry === undefined) return statusOnly(404);
    if (entry.kind === 'status') return statusOnly(entry.status);
    if (entry.kind === 'parse_error') {
      return html(
        '<html><body><div class="tgme_widget_message" data-post="x/1">' +
          '<div class="tgme_widget_message_text">broken</div></div></body></html>',
      );
    }
    return html(embed(toWidget(entry)));
  }

  get transport(): FetchLike {
    return async (url) => {
      this.calls.push(url);
      const spec = this.spec(url);
      if (spec === undefined) throw new Error(`unscripted request: ${url}`);
      return response(spec.status, spec.body, spec.headers ?? {});
    };
  }
}

function clientFor(
  transport: FetchLike,
  options: { clock?: Clock; rateMs?: number } = {},
) {
  return createPoliteClient({
    transport,
    clock: options.clock ?? new FakeClock(),
    random: () => 0,
    limiter: new PolitenessLimiter(2),
    rate: { minIntervalMs: options.rateMs ?? 0, maxJitterMs: 0 },
    retry: { maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0 },
  });
}

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

function seed(
  db: TestDatabase,
  username: string,
  kind: 'group' | 'channel',
): number {
  return seedSource(db.db, { username, kind, cursor: null, enabled: false });
}

describe('backfill: discovery and commit', () => {
  it('takes the latest channel id from the first page and scans only the 7-day window', async () => {
    const db = await database('tele-lenta-backfill-channel-');
    const sourceId = seed(db, CHANNEL, 'channel');

    // id 1 is Oct 26, one per day: id 4 is Oct 29 00:00 (before the
    // 12:00 cut-off), id 5 is Oct 30 00:00 (inside it), id 10 is Nov 4.
    const start = Date.parse('2026-10-26T00:00:00.000Z');
    const entries = new Map<number, Entry>();
    for (let id = 1; id <= 10; id += 1) {
      entries.set(id, message(id, new Date(start + (id - 1) * DAY).toISOString()));
    }
    const fixture = new Fixture(CHANNEL, entries, true);

    const result = await runBackfill({
      store: db.store,
      client: clientFor(fixture.transport),
      username: CHANNEL,
      budget: createRequestBudget(100),
      ingestEnabled: true,
      now: NOW,
    });

    assert.equal(result.status, 'ok');
    if (result.status !== 'ok') return;
    assert.equal(result.latestId, 10);
    assert.equal(result.cutoffId, 5);
    assert.equal(result.inactive, false);
    assert.equal(result.counts.fetched, 6);
    assert.equal(result.counts.inserted, 6);
    assert.equal(result.cursorBefore, null);
    assert.equal(result.cursorAfter, 10);

    for (let id = 1; id <= 4; id += 1) {
      assert.equal(db.store.listings.find(sourceId, id), null, `id ${id} is before the cut-off`);
    }
    for (let id = 5; id <= 10; id += 1) {
      assert.notEqual(db.store.listings.find(sourceId, id), null, `id ${id} is inside the window`);
    }

    const source = db.store.sources.getById(sourceId);
    assert.equal(source?.cursorMessageId, 10);
    assert.equal(source?.enabled, true);
    assert.notEqual(source?.lastSuccessAt, null);

    const run = db.store.ingestRuns.lastForSource(sourceId);
    assert.equal(run?.status, 'ok');
    assert.equal(run?.cursorBefore, null);
    assert.equal(run?.cursorAfter, 10);
    assert.equal(run?.fetched, 6);
    assert.equal(run?.inserted, 6);
    assert.equal(run?.skipped, 0);

    // A second run refuses without --force and makes no request.
    const before = fixture.calls.length;
    const second = await runBackfill({
      store: db.store,
      client: clientFor(fixture.transport),
      username: CHANNEL,
      budget: createRequestBudget(100),
      ingestEnabled: true,
      now: NOW,
    });
    assert.equal(second.status, 'refused');
    if (second.status === 'refused') {
      assert.equal(second.reason, 'already_backfilled');
    }
    assert.equal(fixture.calls.length, before);
  });

  it('finds a group latest id by exponential and binary probing past holes and a missing top', async () => {
    const db = await database('tele-lenta-backfill-group-latest-');
    const sourceId = seed(db, 'montenegro_chat', 'group');

    const start = NOW - 6 * DAY;
    const entries = new Map<number, Entry>();
    for (let id = 1; id <= 100; id += 1) {
      entries.set(id, message(id, new Date(start + (id - 1) * 60 * 60 * 1000).toISOString()));
    }
    // Two deleted posts above the live top: the exponential probe hits them.
    entries.delete(98);
    entries.delete(100);
    entries.set(99, message(99, new Date(start + 98 * 60 * 60 * 1000).toISOString()));

    const fixture = new Fixture('montenegro_chat', entries);
    const result = await runBackfill({
      store: db.store,
      client: clientFor(fixture.transport),
      username: 'montenegro_chat',
      budget: createRequestBudget(500),
      ingestEnabled: true,
      now: NOW,
    });

    assert.equal(result.status, 'ok');
    if (result.status !== 'ok') return;
    assert.equal(result.latestId, 99);
    assert.equal(result.cutoffId, 1);
    assert.equal(result.counts.fetched, 98); // 1..99 minus the two holes
    assert.equal(result.cursorAfter, 99);
    assert.equal(db.store.sources.getById(sourceId)?.enabled, true);
    assert.equal(db.store.listings.find(sourceId, 98), null);
    assert.notEqual(db.store.listings.find(sourceId, 99), null);
  });

  it('leaves an inactive source with the latest cursor and no listings', async () => {
    const db = await database('tele-lenta-backfill-inactive-');
    const sourceId = seed(db, CHANNEL, 'channel');

    const old = new Date(CUTOFF - 30 * DAY).toISOString();
    const entries = new Map<number, Entry>([
      [1, message(1, old)],
      [2, message(2, new Date(Date.parse(old) + DAY).toISOString())],
      [3, message(3, new Date(Date.parse(old) + 2 * DAY).toISOString())],
    ]);
    const fixture = new Fixture(CHANNEL, entries, true);

    const result = await runBackfill({
      store: db.store,
      client: clientFor(fixture.transport),
      username: CHANNEL,
      budget: createRequestBudget(100),
      ingestEnabled: true,
      now: NOW,
    });

    assert.equal(result.status, 'ok');
    if (result.status !== 'ok') return;
    assert.equal(result.inactive, true);
    assert.equal(result.cutoffId, null);
    assert.equal(result.latestId, 3);
    assert.equal(result.counts.fetched, 0);
    assert.equal(db.store.listings.find(sourceId, 1), null);
    assert.equal(db.store.sources.getById(sourceId)?.cursorMessageId, 3);
    assert.equal(db.store.sources.getById(sourceId)?.enabled, true);
  });
});

describe('backfill: cut-off search and enumeration', () => {
  it('lands on the first id at or after the boundary across deleted holes', async () => {
    const db = await database('tele-lenta-backfill-group-cutoff-');
    const sourceId = seed(db, 'montenegro_chat', 'group');

    // Six-hour steps from Oct 28 00:00: id 6 is Oct 29 06:00 (old),
    // id 7 is Oct 29 12:00 exactly (the first id at the cut-off), id 20 is
    // Nov 2 18:00. Ids 8 and 11 are deleted inside the window.
    const start = Date.parse('2026-10-28T00:00:00.000Z');
    const entries = new Map<number, Entry>();
    for (let id = 1; id <= 20; id += 1) {
      entries.set(id, message(id, new Date(start + (id - 1) * 6 * 60 * 60 * 1000).toISOString()));
    }
    entries.delete(8);
    entries.delete(11);

    const fixture = new Fixture('montenegro_chat', entries);
    const result = await runBackfill({
      store: db.store,
      client: clientFor(fixture.transport),
      username: 'montenegro_chat',
      budget: createRequestBudget(500),
      ingestEnabled: true,
      now: NOW,
    });

    assert.equal(result.status, 'ok');
    if (result.status !== 'ok') return;
    assert.equal(result.latestId, 20);
    assert.equal(result.cutoffId, 7);
    assert.equal(result.counts.fetched, 12); // 7..20 = 14 ids, minus 8 and 11
    assert.equal(result.counts.inserted, 12);
    assert.equal(result.counts.skipped, 2);

    assert.equal(db.store.listings.find(sourceId, 6), null);
    assert.notEqual(db.store.listings.find(sourceId, 7), null);
    assert.equal(db.store.listings.find(sourceId, 8), null);
    assert.equal(db.store.listings.find(sourceId, 11), null);
    assert.notEqual(db.store.listings.find(sourceId, 12), null);

    // The holes reached the negative cache, but nothing was marked deleted.
    assert.equal(db.store.negativeCache.has(sourceId, 8), true);
    assert.equal(db.store.negativeCache.has(sourceId, 11), true);
  });

  it('collapses albums before writing and still classifies and clusters', async () => {
    const db = await database('tele-lenta-backfill-album-');
    const sourceId = seed(db, 'montenegro_chat', 'group');

    const albumText = 'Сдам уютную квартиру в Подгорице, 650 € в месяц, центр, два балкона';
    const photo = 'https://cdn4.telesco.pe/file/album-a.jpg';
    const first = NOW - 2 * DAY;
    const entries = new Map<number, Entry>([
      [1, message(1, new Date(first).toISOString(), albumText, [photo])],
      [2, message(2, new Date(first + 60_000).toISOString(), albumText, [photo])],
      [3, message(3, new Date(NOW - DAY).toISOString(), 'Продам холодильник в Баре, 250 €, хорошее состояние, самовывоз')],
      [4, message(4, new Date(NOW - 12 * 60 * 60 * 1000).toISOString(), albumText)],
    ]);

    const fixture = new Fixture('montenegro_chat', entries);
    const result = await runBackfill({
      store: db.store,
      client: clientFor(fixture.transport),
      username: 'montenegro_chat',
      budget: createRequestBudget(100),
      ingestEnabled: true,
      now: NOW,
    });

    assert.equal(result.status, 'ok');
    if (result.status !== 'ok') return;
    assert.equal(result.counts.inserted, 3); // album 1+2, post 3, bump 4
    assert.equal(result.counts.skipped, 1);

    assert.notEqual(db.store.listings.find(sourceId, 1), null);
    assert.equal(db.store.listings.find(sourceId, 2), null);
    assert.notEqual(db.store.listings.find(sourceId, 3), null);
    assert.notEqual(db.store.listings.find(sourceId, 4), null);

    const one = db.store.listings.find(sourceId, 1) as Listing;
    const three = db.store.listings.find(sourceId, 3) as Listing;
    const four = db.store.listings.find(sourceId, 4) as Listing;
    assert.equal(one.section, 'classifieds');
    assert.equal(one.category, 'real_estate');
    assert.notEqual(one.clusterId, null);
    assert.equal(four.clusterId, one.clusterId);
    assert.notEqual(three.clusterId, one.clusterId);
    assert.equal(one.photoCount, 1);
  });
});

describe('backfill: abort paths', () => {
  it('leaves the source disabled and the cursor null when the budget runs out', async () => {
    const db = await database('tele-lenta-backfill-budget-');
    const sourceId = seed(db, CHANNEL, 'channel');

    const start = Date.parse('2026-10-26T00:00:00.000Z');
    const entries = new Map<number, Entry>();
    for (let id = 1; id <= 10; id += 1) {
      entries.set(id, message(id, new Date(start + (id - 1) * DAY).toISOString()));
    }
    const fixture = new Fixture(CHANNEL, entries, true);

    const result = await runBackfill({
      store: db.store,
      client: clientFor(fixture.transport),
      username: CHANNEL,
      budget: createRequestBudget(7),
      ingestEnabled: true,
      now: NOW,
    });

    assert.equal(result.status, 'aborted');
    if (result.status !== 'aborted') return;
    assert.equal(result.reason, 'budget_exhausted');
    assert.equal(result.remaining, 4);
    assert.match(result.message, /budget/i);

    assert.equal(db.store.sources.getById(sourceId)?.cursorMessageId, null);
    assert.equal(db.store.sources.getById(sourceId)?.enabled, false);
    assert.equal(db.store.listings.find(sourceId, 5), null);
    assert.equal(db.store.ingestRuns.lastForSource(sourceId), null);
  });

  it('aborts a 5xx without mutating the source or the listings', async () => {
    const db = await database('tele-lenta-backfill-5xx-');
    const sourceId = seed(db, 'montenegro_chat', 'group');

    const entries = new Map<number, Entry>();
    for (let id = 1; id <= 5; id += 1) {
      entries.set(id, message(id, new Date(NOW - (6 - id) * 60 * 60 * 1000).toISOString()));
    }
    entries.set(3, { kind: 'status', status: 503 });

    const fixture = new Fixture('montenegro_chat', entries);
    const result = await runBackfill({
      store: db.store,
      client: clientFor(fixture.transport),
      username: 'montenegro_chat',
      budget: createRequestBudget(100),
      ingestEnabled: true,
      now: NOW,
    });

    assert.equal(result.status, 'aborted');
    if (result.status !== 'aborted') return;
    assert.equal(result.reason, 'http_error');
    assert.equal(db.store.sources.getById(sourceId)?.cursorMessageId, null);
    assert.equal(db.store.sources.getById(sourceId)?.enabled, false);
    assert.equal(db.store.listings.find(sourceId, 1), null);
    assert.equal(db.store.ingestRuns.lastForSource(sourceId), null);
  });

  it('aborts on a parse_error without writing the batch', async () => {
    const db = await database('tele-lenta-backfill-parse-');
    const sourceId = seed(db, 'montenegro_chat', 'group');

    const entries = new Map<number, Entry>();
    for (let id = 1; id <= 5; id += 1) {
      entries.set(id, message(id, new Date(NOW - (6 - id) * 60 * 60 * 1000).toISOString()));
    }
    entries.set(3, { kind: 'parse_error' });

    const fixture = new Fixture('montenegro_chat', entries);
    const result = await runBackfill({
      store: db.store,
      client: clientFor(fixture.transport),
      username: 'montenegro_chat',
      budget: createRequestBudget(100),
      ingestEnabled: true,
      now: NOW,
    });

    assert.equal(result.status, 'aborted');
    if (result.status !== 'aborted') return;
    assert.equal(result.reason, 'parse_error');
    assert.equal(db.store.sources.getById(sourceId)?.cursorMessageId, null);
    assert.equal(db.store.listings.find(sourceId, 1), null);
    assert.equal(db.store.ingestRuns.lastForSource(sourceId), null);
  });

  it('refuses an unknown source and an invalid username', async () => {
    const db = await database('tele-lenta-backfill-refuse-');
    const fixture = new Fixture('nobody', new Map());

    const unknown = await runBackfill({
      store: db.store,
      client: clientFor(fixture.transport),
      username: 'nobody',
      budget: createRequestBudget(10),
      ingestEnabled: true,
      now: NOW,
    });
    assert.equal(unknown.status, 'refused');
    if (unknown.status === 'refused') assert.equal(unknown.reason, 'source_not_found');

    const invalid = await runBackfill({
      store: db.store,
      client: clientFor(fixture.transport),
      username: 'not a username',
      budget: createRequestBudget(10),
      ingestEnabled: true,
      now: NOW,
    });
    assert.equal(invalid.status, 'refused');
    if (invalid.status === 'refused') assert.equal(invalid.reason, 'invalid_username');
    assert.equal(fixture.calls.length, 0);
  });
});

describe('backfill: idempotency and politeness', () => {
  it('does not insert duplicate ids when a forced run repeats the same window', async () => {
    const db = await database('tele-lenta-backfill-force-');
    const sourceId = seed(db, CHANNEL, 'channel');

    const start = Date.parse('2026-10-26T00:00:00.000Z');
    const entries = new Map<number, Entry>();
    for (let id = 1; id <= 10; id += 1) {
      entries.set(id, message(id, new Date(start + (id - 1) * DAY).toISOString()));
    }
    const fixture = new Fixture(CHANNEL, entries, true);
    const counts = () =>
      (db.db.prepare('SELECT COUNT(*) AS n FROM listings WHERE source_id = ?').get(sourceId) as {
        n: number;
      }).n;

    const first = await runBackfill({
      store: db.store,
      client: clientFor(fixture.transport),
      username: CHANNEL,
      budget: createRequestBudget(100),
      ingestEnabled: true,
      now: NOW,
    });
    assert.equal(first.status, 'ok');
    assert.equal(counts(), 6);

    const second = await runBackfill({
      store: db.store,
      client: clientFor(fixture.transport),
      username: CHANNEL,
      budget: createRequestBudget(100),
      ingestEnabled: true,
      now: NOW,
      force: true,
    });
    assert.equal(second.status, 'ok');
    if (second.status !== 'ok') return;
    assert.equal(second.counts.inserted, 0);
    assert.equal(second.counts.updated, 0);
    assert.equal(second.counts.skipped, 6);
    assert.equal(second.cursorBefore, 10);
    assert.equal(second.cursorAfter, 10);
    assert.equal(counts(), 6);
  });

  it('paces requests at least one second apart per source on the virtual clock', async () => {
    const db = await database('tele-lenta-backfill-politeness-');
    seed(db, 'montenegro_chat', 'group');

    const entries = new Map<number, Entry>();
    for (let id = 1; id <= 5; id += 1) {
      entries.set(id, message(id, new Date(NOW - (6 - id) * 60 * 60 * 1000).toISOString()));
    }
    const fixture = new Fixture('montenegro_chat', entries);
    const clock = new FakeClock();
    const dispatchTimes: number[] = [];
    const transport: FetchLike = (url, init) => {
      dispatchTimes.push(clock.now());
      return fixture.transport(url, init);
    };

    const result = await runBackfill({
      store: db.store,
      client: clientFor(transport, { clock, rateMs: 1_000 }),
      username: 'montenegro_chat',
      budget: createRequestBudget(100),
      ingestEnabled: true,
      now: NOW,
    });

    assert.equal(result.status, 'ok');
    assert.ok(dispatchTimes.length >= 3);
    for (let index = 1; index < dispatchTimes.length; index += 1) {
      const gap = (dispatchTimes[index] as number) - (dispatchTimes[index - 1] as number);
      assert.ok(gap >= 1_000, `request ${index} waited only ${gap}ms`);
    }
  });
});

describe('backfill: CLI arguments', () => {
  it('parses a username, an optional budget, and --force', () => {
    assert.deepEqual(parseBackfillArgs(['@montework']), {
      username: '@montework',
      budget: null,
      force: false,
    });
    assert.deepEqual(parseBackfillArgs(['montework', '--budget', '250', '--force']), {
      username: 'montework',
      budget: 250,
      force: true,
    });
    assert.deepEqual(parseBackfillArgs(['montework', '--budget=42']), {
      username: 'montework',
      budget: 42,
      force: false,
    });
  });

  it('rejects bad usage before the store is touched', () => {
    for (const argv of [
      [],
      ['montework', '--budget', '0'],
      ['montework', '--budget', '50001'],
      ['montework', '--budget'],
      ['montework', '--wat'],
      ['one', 'two'],
    ]) {
      assert.throws(() => parseBackfillArgs(argv), BackfillUsageError, argv.join(' '));
    }
  });
});
