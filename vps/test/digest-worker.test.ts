import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { DIGEST_INTERVAL_MS, type DigestRunResult } from '../src/digest/index.js';
import { runDigest } from '../src/digest/worker.js';
import type { BotSendResult, BotSender } from '../src/bot/index.js';

import {
  closeTestDatabase,
  createTestDatabase,
  type TestDatabase,
} from './helpers/database.js';
import { seedCluster, seedSource } from './helpers/seed.js';

const MINUTE = 60 * 1000;
const T0 = Date.parse('2026-11-05T12:00:00.000Z');
const USER = 5150;

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

interface Sent {
  chatId: number;
  html: string;
}

function recordingSender(
  result: BotSendResult | (() => BotSendResult) = { status: 'sent' },
): { sender: BotSender; sent: Sent[] } {
  const sent: Sent[] = [];
  return {
    sent,
    sender: {
      async sendMessage(chatId, html) {
        sent.push({ chatId, html });
        return typeof result === 'function' ? result() : result;
      },
    },
  };
}

function grab(database: TestDatabase, searchId: number): {
  lastCheckedAt: string;
  lastSentAt: string | null;
} {
  return database.db
    .prepare('SELECT last_checked_at AS lastCheckedAt, last_sent_at AS lastSentAt FROM saved_searches WHERE id = ?')
    .get(searchId) as { lastCheckedAt: string; lastSentAt: string | null };
}

function prepare(
  database: TestDatabase,
  options: { at?: number; quietStart?: string; quietEnd?: string } = {},
): { sourceId: number; searchId: number } {
  const at = new Date(options.at ?? T0).toISOString();
  const { store, db } = database;
  store.users.allow(USER, { at, firstName: 'Аня' });
  if (options.quietStart !== undefined || options.quietEnd !== undefined) {
    store.users.updateSettings(USER, {
      ...(options.quietStart === undefined ? {} : { quietStart: options.quietStart }),
      ...(options.quietEnd === undefined ? {} : { quietEnd: options.quietEnd }),
    });
  }
  const sourceId = seedSource(db, { username: 'digest_chat' });
  const search = store.savedSearches.create(USER, { name: 'Квартира' }, at);
  assert.ok(search !== null);
  return { sourceId, searchId: search.id };
}

function addCluster(
  database: TestDatabase,
  sourceId: number,
  messageId: number,
  publishedAt: string,
  title = 'Сдам квартиру',
): number {
  return seedCluster(database.db, database.store, [
    { sourceId, messageId, publishedAt, title, searchText: `sdam kvartiru ${messageId}`, city: 'Podgorica' },
  ]);
}

const options = (
  database: TestDatabase,
  sender: BotSender | null,
  now: number,
): Parameters<typeof runDigest>[0] => ({
  store: database.store,
  sender,
  botUsername: 'tele_lenta_bot',
  now: () => now,
});

describe('digest worker', () => {
  it('matches a due search, sends one message, and advances both timestamps', async () => {
    const database = await setup('tele-lenta-digest-worker-send-');
    const { sourceId, searchId } = prepare(database);
    addCluster(database, sourceId, 1, new Date(T0 + 5 * MINUTE).toISOString());
    const { sender, sent } = recordingSender();
    const now = T0 + 31 * MINUTE;

    const result = await runDigest(options(database, sender, now));

    assert.deepEqual(
      { users: result.users, matched: result.matched, sent: result.sent, blocked: result.blocked, failed: result.failed },
      { users: 1, matched: 1, sent: 1, blocked: 0, failed: 0 },
    );
    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.chatId, USER);
    assert.match(sent[0]?.html ?? '', /Квартира/);

    const row = grab(database, searchId);
    assert.equal(row.lastCheckedAt, new Date(now).toISOString());
    assert.equal(row.lastSentAt, new Date(now).toISOString());
    assert.deepEqual(database.store.digests.unsentForUser(USER), []);
  });

  it('sends nothing on the next check when no new cluster appeared', async () => {
    const database = await setup('tele-lenta-digest-worker-repeat-');
    const { sourceId, searchId } = prepare(database);
    addCluster(database, sourceId, 1, new Date(T0 + 5 * MINUTE).toISOString());
    const { sender, sent } = recordingSender();

    await runDigest(options(database, sender, T0 + 31 * MINUTE));
    const second = await runDigest(options(database, sender, T0 + 62 * MINUTE));

    assert.equal(sent.length, 1);
    assert.equal(second.sent, 0);
    assert.equal(grab(database, searchId).lastCheckedAt, new Date(T0 + 62 * MINUTE).toISOString());
  });

  it('includes a new cluster next time and never repeats the old one', async () => {
    const database = await setup('tele-lenta-digest-worker-new-');
    const { sourceId } = prepare(database);
    addCluster(database, sourceId, 1, new Date(T0 + 5 * MINUTE).toISOString(), 'Старая квартира');
    const { sender, sent } = recordingSender();

    await runDigest(options(database, sender, T0 + 31 * MINUTE));
    addCluster(database, sourceId, 2, new Date(T0 + 40 * MINUTE).toISOString(), 'Новая квартира');
    const second = await runDigest(options(database, sender, T0 + 62 * MINUTE));

    assert.equal(second.matched, 1);
    assert.equal(sent.length, 2);
    assert.doesNotMatch(sent[1]?.html ?? '', /Старая квартира/);
    assert.match(sent[1]?.html ?? '', /Новая квартира/);
  });

  it('batches two due searches of one user into one message with two groups', async () => {
    const database = await setup('tele-lenta-digest-worker-batch-');
    const { sourceId } = prepare(database);
    addCluster(database, sourceId, 1, new Date(T0 + 5 * MINUTE).toISOString());
    database.store.savedSearches.create(USER, { name: 'Работа' }, new Date(T0).toISOString());
    const { sender, sent } = recordingSender();

    const result = await runDigest(options(database, sender, T0 + 31 * MINUTE));

    assert.equal(result.users, 1);
    assert.equal(sent.length, 1);
    assert.match(sent[0]?.html ?? '', /Квартира/);
    assert.match(sent[0]?.html ?? '', /Работа/);
  });

  it('caps the message at ten cards and says how many are left', async () => {
    const database = await setup('tele-lenta-digest-worker-cap-');
    const { sourceId } = prepare(database);
    for (let index = 1; index <= 12; index += 1) {
      addCluster(database, sourceId, index, new Date(T0 + index * MINUTE).toISOString());
    }
    const { sender, sent } = recordingSender();

    await runDigest(options(database, sender, T0 + 31 * MINUTE));

    assert.equal(sent.length, 1);
    assert.match(sent[0]?.html ?? '', /и ещё 2/);
    assert.equal((sent[0]?.html.match(/startapp=card_/g) ?? []).length, 10);
  });

  it('records matches in quiet hours and sends the backlog after the window', async () => {
    // 22:30Z is 23:30 in Podgorica (CET), inside 23:00-08:00.
    const quietNow = Date.parse('2026-11-05T22:30:00.000Z');
    const database = await setup('tele-lenta-digest-worker-quiet-');
    const { sourceId, searchId } = prepare(database, { at: quietNow - 31 * MINUTE });
    addCluster(database, sourceId, 1, new Date(quietNow - 10 * MINUTE).toISOString());
    const { sender, sent } = recordingSender();

    const during = await runDigest(options(database, sender, quietNow));

    assert.equal(during.sent, 0);
    assert.equal(sent.length, 0);
    assert.equal(database.store.digests.unsentForUser(USER).length, 1);
    assert.equal(grab(database, searchId).lastCheckedAt, new Date(quietNow).toISOString());

    const afterWindow = Date.parse('2026-11-06T07:00:00.000Z'); // 08:00 CET
    const backlog = await runDigest(options(database, sender, afterWindow));

    assert.equal(backlog.sent, 1);
    assert.equal(sent.length, 1);
    assert.match(sent[0]?.html ?? '', /Квартира/);
    assert.deepEqual(database.store.digests.unsentForUser(USER), []);
  });

  it('marks a 403 user undeliverable and skips them on the next run', async () => {
    const database = await setup('tele-lenta-digest-worker-blocked-');
    const { sourceId } = prepare(database);
    addCluster(database, sourceId, 1, new Date(T0 + 5 * MINUTE).toISOString());
    const { sender } = recordingSender({ status: 'blocked' });

    const first = await runDigest(options(database, sender, T0 + 31 * MINUTE));
    const second = await runDigest(options(database, sender, T0 + 62 * MINUTE));

    assert.equal(first.blocked, 1);
    assert.equal(first.sent, 0);
    assert.notEqual(database.store.users.get(USER)?.digestUndeliverableAt, null);
    assert.equal(second.users, 0);
  });

  it('leaves rows unsent on retry and sends the same rows on the next run', async () => {
    const database = await setup('tele-lenta-digest-worker-retry-');
    const { sourceId, searchId } = prepare(database);
    addCluster(database, sourceId, 1, new Date(T0 + 5 * MINUTE).toISOString());
    let attempt = 0;
    const { sender, sent } = recordingSender(() => {
      attempt += 1;
      return attempt === 1 ? { status: 'retry', retryAfterMs: null } : { status: 'sent' };
    });

    const first = await runDigest(options(database, sender, T0 + 31 * MINUTE));

    assert.equal(first.failed, 1);
    assert.equal(first.sent, 0);
    assert.equal(database.store.digests.unsentForUser(USER).length, 1);
    assert.equal(grab(database, searchId).lastSentAt, null);
    const firstAttemptHtml = sent[0]?.html;

    const second = await runDigest(options(database, sender, T0 + 62 * MINUTE));

    assert.equal(second.sent, 1);
    assert.equal(sent.length, 2);
    assert.equal(sent[1]?.html, firstAttemptHtml);
    assert.equal(second.matched, 0);
    assert.equal(grab(database, searchId).lastCheckedAt, new Date(T0 + 62 * MINUTE).toISOString());
    assert.deepEqual(database.store.digests.unsentForUser(USER), []);
  });

  it('advances last_checked_at without sending when nothing matches', async () => {
    const database = await setup('tele-lenta-digest-worker-empty-');
    const { searchId } = prepare(database);
    const { sender, sent } = recordingSender();

    const result = await runDigest(options(database, sender, T0 + 31 * MINUTE));

    assert.equal(result.sent, 0);
    assert.equal(sent.length, 0);
    assert.equal(grab(database, searchId).lastCheckedAt, new Date(T0 + 31 * MINUTE).toISOString());
  });

  it('does nothing when the bot is not configured', async () => {
    const database = await setup('tele-lenta-digest-worker-config-');
    const { sourceId, searchId } = prepare(database);
    addCluster(database, sourceId, 1, new Date(T0 + 5 * MINUTE).toISOString());

    const result = await runDigest({
      store: database.store,
      sender: null,
      botUsername: 'tele_lenta_bot',
      now: () => T0 + 31 * MINUTE,
    });

    assert.equal(result.skipped, 'unconfigured');
    assert.equal(result.users, 0);
    assert.equal(grab(database, searchId).lastCheckedAt, new Date(T0).toISOString());
  });

  it('keeps going when one user throws', async () => {
    const database = await setup('tele-lenta-digest-worker-isolation-');
    const { sourceId } = prepare(database);
    addCluster(database, sourceId, 1, new Date(T0 + 5 * MINUTE).toISOString());
    const other = 5151;
    database.store.users.allow(other, { at: new Date(T0).toISOString() });
    database.store.savedSearches.create(other, { name: 'Второй' }, new Date(T0).toISOString());

    const sent: number[] = [];
    const sender: BotSender = {
      async sendMessage(chatId) {
        if (chatId === USER) throw new Error('boom');
        sent.push(chatId);
        return { status: 'sent' };
      },
    };

    const result: DigestRunResult = await runDigest(options(database, sender, T0 + 31 * MINUTE));

    assert.equal(result.failed, 1);
    assert.equal(result.sent, 1);
    assert.deepEqual(sent, [other]);
  });

  it('is not due before the thirty-minute interval', async () => {
    const database = await setup('tele-lenta-digest-worker-tooearly-');
    const { searchId } = prepare(database);
    const { sender, sent } = recordingSender();

    const result = await runDigest(options(database, sender, T0 + 20 * MINUTE));

    assert.equal(result.users, 0);
    assert.equal(sent.length, 0);
    assert.equal(grab(database, searchId).lastCheckedAt, new Date(T0).toISOString());
    assert.equal(DIGEST_INTERVAL_MS, 30 * MINUTE);
  });

  it('marks the whole backlog, including a search that is not due yet', async () => {
    const database = await setup('tele-lenta-digest-worker-backlog-');
    const { store, db } = database;
    const at = (iso: string): string => iso;

    // Podgorica is UTC+1 in November: 06:30Z is 07:30 local (quiet), 07:00Z is
    // 08:00 local (the first eligible send).
    const createdFirst = at('2026-11-05T04:00:00.000Z');
    const createdSecond = at('2026-11-05T06:40:00.000Z');
    const quietRun = '2026-11-05T06:30:00.000Z';
    const secondCheck = '2026-11-05T06:50:00.000Z';
    const sendRun = '2026-11-05T07:00:00.000Z';
    const nextRun = '2026-11-05T07:31:00.000Z';

    store.users.allow(USER, { at: createdFirst, firstName: 'Аня' });
    const sourceId = seedSource(db, { username: 'digest_chat' });
    const first = store.savedSearches.create(USER, { name: 'Первый' }, createdFirst);
    const second = store.savedSearches.create(USER, { name: 'Второй' }, createdSecond);
    assert.ok(first !== null && second !== null);

    addCluster(database, sourceId, 1, at('2026-11-05T05:00:00.000Z'), 'Первый кластер');
    const secondCluster = addCluster(
      database,
      sourceId,
      2,
      at('2026-11-05T06:45:00.000Z'),
      'Второй кластер',
    );

    // Quiet hours: the first search is checked and matched, nothing is sent.
    const quietSender = recordingSender();
    const quiet = await runDigest(options(database, quietSender.sender, Date.parse(quietRun)));
    assert.equal(quiet.sent, 0);
    assert.equal(quietSender.sent.length, 0);

    // The second search was checked ten minutes before 08:00, so at the send
    // tick it is not due, but its backlog row is part of the same message.
    store.digests.recordCheck(
      second.id,
      [{ clusterId: secondCluster }],
      secondCheck,
    );

    const { sender, sent } = recordingSender();
    const result = await runDigest(options(database, sender, Date.parse(sendRun)));

    assert.equal(result.sent, 1);
    assert.equal(sent.length, 1);
    assert.match(sent[0]?.html ?? '', /Первый/);
    assert.match(sent[0]?.html ?? '', /Второй/);
    assert.deepEqual(store.digests.unsentForUser(USER), []);

    // The next run must not send the same cluster again.
    const again = await runDigest(options(database, sender, Date.parse(nextRun)));
    assert.equal(again.sent, 0);
    assert.equal(sent.length, 1);
  });
});
