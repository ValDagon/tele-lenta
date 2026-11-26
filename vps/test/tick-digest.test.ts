import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import type { BotSender } from '../src/bot/index.js';
import { LAST_INGEST_AT_KEY, runTick } from '../src/tick/tick.js';

import {
  closeTestDatabase,
  createTestDatabase,
  type TestDatabase,
} from './helpers/database.js';
import { seedCluster } from './helpers/seed.js';
import {
  EMPTY_PAGE,
  ScriptedServer,
  html,
  page,
  seedSource,
  testClient,
  testConfig,
} from './helpers/tick.js';

const MINUTE = 60 * 1000;
const NOW = Date.parse('2026-11-05T12:00:00.000Z');
const USER = 6160;

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

function prepare(database: TestDatabase): { sourceId: number } {
  const { store, db } = database;
  const at = new Date(NOW - 31 * MINUTE).toISOString();
  store.users.allow(USER, { at });
  const sourceId = seedSource(db, { username: 'tick_digest_chat', cursor: 9 });
  assert.ok(store.savedSearches.create(USER, { name: 'Квартира' }, at) !== null);
  seedCluster(db, store, [
    {
      sourceId,
      messageId: 5,
      publishedAt: new Date(NOW - 10 * MINUTE).toISOString(),
      title: 'Сдам квартиру',
      searchText: 'sdam kvartiru',
      city: 'Podgorica',
    },
  ]);
  return { sourceId };
}

function server(): ScriptedServer {
  return new ScriptedServer()
    .on('https://t.me/s/tick_digest_chat', html(page([{ id: 10, text: 'Продам велосипед, 200 €' }])))
    .on('https://t.me/s/tick_digest_chat?before=10', html(EMPTY_PAGE));
}

describe('tick digest integration', () => {
  it('runs the digest after ingestion and after the ingest run row exists', async () => {
    const database = await setup('tele-lenta-tick-digest-order-');
    prepare(database);
    const sent: string[] = [];
    let runsAtSend = -1;
    const sender: BotSender = {
      async sendMessage(_chatId, htmlText) {
        sent.push(htmlText);
        runsAtSend = (
          database.db.prepare('SELECT COUNT(*) AS count FROM ingest_runs').get() as {
            count: number;
          }
        ).count;
        return { status: 'sent' };
      },
    };

    const result = await runTick({
      config: testConfig(database.path, { tickRequestBudget: 5 }),
      store: database.store,
      client: testClient(server()),
      now: () => NOW,
      digest: { sender, botUsername: 'tele_lenta_bot' },
    });

    assert.equal(result.runs.length, 1);
    assert.equal(runsAtSend, 1);
    assert.equal(result.digest?.sent, 1);
    assert.equal(sent.length, 1);
    assert.equal(database.store.appState.get(LAST_INGEST_AT_KEY), new Date(NOW).toISOString());
  });

  it('does not fail the tick when the sender throws', async () => {
    const database = await setup('tele-lenta-tick-digest-throw-');
    prepare(database);
    const sender: BotSender = {
      async sendMessage() {
        throw new Error('network down');
      },
    };

    const result = await runTick({
      config: testConfig(database.path, { tickRequestBudget: 5 }),
      store: database.store,
      client: testClient(server()),
      now: () => NOW,
      digest: { sender, botUsername: 'tele_lenta_bot' },
    });

    assert.equal(result.runs.length, 1);
    assert.equal(result.digest?.failed, 1);
    assert.equal(result.digest?.sent, 0);
    assert.equal(database.store.appState.get(LAST_INGEST_AT_KEY), new Date(NOW).toISOString());
  });

  it('does not call the digest when no digest option is passed', async () => {
    const database = await setup('tele-lenta-tick-digest-absent-');
    prepare(database);
    let calls = 0;
    const sender: BotSender = {
      async sendMessage() {
        calls += 1;
        return { status: 'sent' };
      },
    };
    void sender;

    const result = await runTick({
      config: testConfig(database.path, { tickRequestBudget: 5 }),
      store: database.store,
      client: testClient(server()),
      now: () => NOW,
    });

    assert.equal(result.digest, null);
    assert.equal(calls, 0);
    const row = database.db
      .prepare('SELECT last_checked_at AS at FROM saved_searches WHERE user_id = ?')
      .get(USER) as { at: string };
    assert.equal(row.at, new Date(NOW - 31 * MINUTE).toISOString());
  });
});
