import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { runTick } from '../src/tick/tick.js';
import type { Listing } from '../src/store/types.js';

import {
  closeTestDatabase,
  createTestDatabase,
  type TestDatabase,
} from './helpers/database.js';
import {
  EMPTY_PAGE,
  ScriptedServer,
  fixture,
  html,
  page,
  seedSource,
  statusOnly,
  testClient,
  testConfig,
} from './helpers/tick.js';

const CHANNEL = 'montework';

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

function channelUrl(before?: number): string {
  return before === undefined ? `https://t.me/s/${CHANNEL}` : `https://t.me/s/${CHANNEL}?before=${before}`;
}

describe('channel scan', () => {
  it('inserts a new post once and advances the cursor', async () => {
    const databaseUnderTest = await database('tele-lenta-tick-channel-');
    const sourceId = seedSource(databaseUnderTest.db, {
      username: CHANNEL,
      kind: 'channel',
      sectionHint: 'classifieds',
      cursor: 100,
    });
    const server = new ScriptedServer()
      .on(
        channelUrl(),
        html(
          page([
            { id: 101, text: 'Продам холодильник в Подгорице, 200 €, самовывоз, хорошее состояние' },
            { id: 102, text: 'Сдам квартиру в Баре, 500 € в месяц, рядом с морем, два балкона' },
          ]),
        ),
      )
      .on(channelUrl(101), html(EMPTY_PAGE));
    const client = testClient(server);
    const config = testConfig(databaseUnderTest.path, { tickRequestBudget: 5 });

    const first = await runTick({ config, store: databaseUnderTest.store, client });
    assert.equal(first.runs.length, 1);
    assert.equal(first.runs[0]?.status, 'ok');
    assert.equal(first.runs[0]?.counts.inserted, 2);
    assert.equal(first.runs[0]?.counts.fetched, 2);
    assert.equal(first.runs[0]?.counts.requests, 2);
    assert.equal(first.runs[0]?.cursorBefore, 100);
    assert.equal(first.runs[0]?.cursorAfter, 102);
    assert.equal(databaseUnderTest.store.sources.getById(sourceId)?.cursorMessageId, 102);

    const second = await runTick({ config, store: databaseUnderTest.store, client });
    assert.equal(second.runs[0]?.counts.inserted, 0);
    assert.equal(second.runs[0]?.counts.skipped, 2);
    assert.equal(databaseUnderTest.store.sources.getById(sourceId)?.cursorMessageId, 102);

    const run = databaseUnderTest.store.ingestRuns.lastForSource(sourceId);
    assert.equal(run?.status, 'ok');
    assert.equal(run?.inserted, 0);
    assert.equal(run?.cursorBefore, 102);
    assert.equal(run?.cursorAfter, 102);
  });

  it('paginates backwards with ?before= until it reaches the cursor', async () => {
    const databaseUnderTest = await database('tele-lenta-tick-channel-pages-');
    seedSource(databaseUnderTest.db, {
      username: CHANNEL,
      kind: 'channel',
      cursor: 100,
    });
    const server = new ScriptedServer()
      .on(channelUrl(), html(page([{ id: 101, text: 'Первый пост в канале, очень длинный текст для кластера' }])))
      .on(
        channelUrl(101),
        html(page([{ id: 99, text: 'Старый пост канала, который уже был прочитан ранее' }])),
      );
    const config = testConfig(databaseUnderTest.path, { tickRequestBudget: 5 });

    const result = await runTick({ config, store: databaseUnderTest.store, client: testClient(server) });

    assert.equal(result.runs[0]?.status, 'ok');
    assert.equal(server.callsTo(channelUrl()), 1);
    assert.equal(server.callsTo(channelUrl(101)), 1);
    assert.equal(result.runs[0]?.cursorAfter, 101);
    assert.equal(result.runs[0]?.counts.fetched, 2);
  });

  it('updates an edited post and moves it between clusters', async () => {
    const databaseUnderTest = await database('tele-lenta-tick-channel-edit-');
    const sourceId = seedSource(databaseUnderTest.db, {
      username: CHANNEL,
      kind: 'channel',
      cursor: 199,
    });
    const config = testConfig(databaseUnderTest.path, { tickRequestBudget: 5 });

    const before =
      'Продам квартиру в Подгорице, 650 € в месяц, центр, два балкона, лифт, рядом школа';
    const after = 'Сдам гараж в Баре, 50 € в месяц, рядом с морем, сухой и тёплый, с охраной';

    const firstServer = new ScriptedServer()
      .on(channelUrl(), html(page([{ id: 200, text: before }])))
      .on(channelUrl(200), html(EMPTY_PAGE));
    await runTick({ config, store: databaseUnderTest.store, client: testClient(firstServer) });

    const stored = databaseUnderTest.store.listings.find(sourceId, 200);
    assert.ok(stored !== null);
    const firstClusterId = stored.clusterId;
    assert.notEqual(firstClusterId, null);

    const secondServer = new ScriptedServer().on(channelUrl(), html(page([{ id: 200, text: after }])));
    const second = await runTick({
      config,
      store: databaseUnderTest.store,
      client: testClient(secondServer),
    });

    assert.equal(second.runs[0]?.counts.updated, 1);
    const edited = databaseUnderTest.store.listings.find(sourceId, 200) as Listing;
    assert.equal(edited.textRaw, after);
    assert.notEqual(edited.contentHash, stored.contentHash);
    assert.notEqual(edited.clusterId, firstClusterId);
    assert.equal(edited.editedAt !== null, true);
    assert.equal(databaseUnderTest.store.clusters.getCluster(firstClusterId as number), null);
  });

  it('marks a stored listing deleted when its id is inside the fetched range but absent', async () => {
    const databaseUnderTest = await database('tele-lenta-tick-channel-deleted-');
    const sourceId = seedSource(databaseUnderTest.db, {
      username: CHANNEL,
      kind: 'channel',
      cursor: 199,
    });
    const config = testConfig(databaseUnderTest.path, { tickRequestBudget: 5 });
    const texts = new Map<number, string>([
      [200, 'Продам диван в Подгорице, 150 €, самовывоз, в хорошем состоянии'],
      [201, 'Продам стол в Никшиче, 80 €, дерево, можно забрать сегодня'],
      [202, 'Продам кресло в Баре, 60 €, мягкое, почти новое, без пятен'],
    ]);

    const firstServer = new ScriptedServer()
      .on(
        channelUrl(),
        html(page([200, 201, 202].map((id) => ({ id, text: texts.get(id) ?? '' })))),
      )
      .on(channelUrl(200), html(EMPTY_PAGE));
    await runTick({ config, store: databaseUnderTest.store, client: testClient(firstServer) });
    assert.notEqual(databaseUnderTest.store.listings.find(sourceId, 201), null);

    const secondServer = new ScriptedServer()
      .on(channelUrl(), html(page([
        { id: 200, text: texts.get(200) ?? '' },
        { id: 202, text: texts.get(202) ?? '' },
      ])));
    await runTick({ config, store: databaseUnderTest.store, client: testClient(secondServer) });

    assert.equal(databaseUnderTest.store.listings.find(sourceId, 201)?.messageStatus, 'deleted');
    assert.equal(databaseUnderTest.store.listings.find(sourceId, 200)?.messageStatus, 'available');
    assert.equal(databaseUnderTest.store.listings.find(sourceId, 202)?.messageStatus, 'available');
  });

  it('fails the run on a page parse_error and inserts nothing', async () => {
    const databaseUnderTest = await database('tele-lenta-tick-channel-parse-');
    const sourceId = seedSource(databaseUnderTest.db, {
      username: CHANNEL,
      kind: 'channel',
      cursor: 100,
    });
    const server = new ScriptedServer().on(channelUrl(), html(fixture('corrupted-message-class.html')));
    const config = testConfig(databaseUnderTest.path, { tickRequestBudget: 5 });

    const result = await runTick({ config, store: databaseUnderTest.store, client: testClient(server) });

    assert.equal(result.runs[0]?.status, 'failed');
    assert.equal(result.runs[0]?.counts.inserted, 0);
    assert.match(result.runs[0]?.errorSample ?? '', /parse_error/);
    assert.equal(databaseUnderTest.store.sources.getById(sourceId)?.cursorMessageId, 100);
    assert.equal(databaseUnderTest.store.ingestRuns.lastForSource(sourceId)?.status, 'failed');
  });

  it('counts page budget exhaustion without failing the run', async () => {
    const databaseUnderTest = await database('tele-lenta-tick-channel-budget-');
    seedSource(databaseUnderTest.db, {
      username: CHANNEL,
      kind: 'channel',
      cursor: 100,
    });
    const server = new ScriptedServer().on(
      channelUrl(),
      html(page([
        { id: 101, text: 'Продам велосипед в Подгорице, 120 €, почти новый, с замком' },
        { id: 102, text: 'Продам шкаф в Баре, 90 €, дубовый, разбирается, самовывоз' },
      ])),
    );
    const config = testConfig(databaseUnderTest.path, { tickRequestBudget: 1 });

    const result = await runTick({ config, store: databaseUnderTest.store, client: testClient(server) });

    assert.equal(result.runs[0]?.status, 'ok');
    assert.equal(result.runs[0]?.counts.errors, 1);
    assert.equal(result.runs[0]?.counts.requests, 1);
    assert.equal(result.runs[0]?.counts.inserted, 2);
    assert.equal(server.calls.length, 1);
  });

  it('propagates an HTTP failure as a failed run without a cursor move', async () => {
    const databaseUnderTest = await database('tele-lenta-tick-channel-http-');
    seedSource(databaseUnderTest.db, {
      username: CHANNEL,
      kind: 'channel',
      cursor: 100,
    });
    const server = new ScriptedServer().on(channelUrl(), statusOnly(500));
    const config = testConfig(databaseUnderTest.path, { tickRequestBudget: 5 });

    const result = await runTick({ config, store: databaseUnderTest.store, client: testClient(server) });

    assert.equal(result.runs[0]?.status, 'failed');
    assert.equal(result.runs[0]?.cursorAfter, 100);
    assert.equal(result.runs[0]?.counts.errors, 1);
  });
});
