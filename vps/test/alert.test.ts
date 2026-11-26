/**
 * Operator alerts (ticket #18, layer B): a degraded source and a stale global
 * feed, each throttled to one message per hour, silenced by `INGEST_ENABLED`,
 * and never throwing out of the pass.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import {
  ALERT_THROTTLE_MS,
  FEED_STALE_ALERT_KEY,
  minutesWord,
  runAlerts,
  sourceAlertKey,
} from '../src/alert/index.js';
import type { BotSender, BotSendResult } from '../src/bot/index.js';
import type { ScanStatus } from '../src/tick/types.js';

import {
  closeTestDatabase,
  createTestDatabase,
  type TestDatabase,
} from './helpers/database.js';
import { seedSource as seedReadSource } from './helpers/seed.js';
import { seedSource as seedTickSource } from './helpers/tick.js';

const NOW = Date.parse('2026-11-05T12:00:00.000Z');
const MINUTE = 60 * 1000;
const iso = (ms: number): string => new Date(ms).toISOString();
const OWNER = 9001;

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

function addRun(
  fixture: TestDatabase,
  sourceId: number,
  status: ScanStatus,
  fetched: number,
  atMs: number,
): void {
  const id = fixture.store.ingestRuns.start(sourceId, iso(atMs));
  fixture.store.ingestRuns.finish(id, {
    status,
    fetched,
    inserted: 0,
    updated: 0,
    skipped: 0,
    errors: status === 'ok' ? 0 : 1,
    cursorBefore: 1,
    cursorAfter: 2,
    finishedAt: iso(atMs + MINUTE),
  });
}

/** Three runs that leave the source degraded. */
function degrade(fixture: TestDatabase, sourceId: number, atMs = NOW - 10 * MINUTE): void {
  addRun(fixture, sourceId, 'failed', 0, atMs);
  addRun(fixture, sourceId, 'failed', 0, atMs + MINUTE);
  addRun(fixture, sourceId, 'failed', 0, atMs + 2 * MINUTE);
}

interface StubSender extends BotSender {
  sent: Array<{ chatId: number; html: string }>;
}

function stubSender(
  result: BotSendResult | (() => BotSendResult) = { status: 'sent' },
): StubSender {
  const sent: Array<{ chatId: number; html: string }> = [];
  return {
    sent,
    async sendMessage(chatId, html) {
      sent.push({ chatId, html });
      return typeof result === 'function' ? result() : result;
    },
  };
}

describe('runAlerts', () => {
  it('alerts the owner once about a source degraded by three failed runs', async () => {
    const fixture = await database('tele-lenta-alert-degraded-');
    const source = seedTickSource(fixture.db, { username: 'alert_broken' });
    degrade(fixture, source);
    const sender = stubSender();

    const result = await runAlerts({
      store: fixture.store,
      sender,
      ownerId: OWNER,
      now: () => NOW,
    });

    assert.deepEqual(result, {
      skipped: null,
      sent: 1,
      throttled: 0,
      failed: 0,
      degraded: [source],
      stale: false,
    });
    assert.equal(sender.sent.length, 1);
    assert.equal(sender.sent[0]?.chatId, OWNER);
    assert.match(sender.sent[0]?.html ?? '', /@alert_broken/);
    assert.match(sender.sent[0]?.html ?? '', /три тика подряд/);
    assert.equal(
      fixture.store.appState.get(sourceAlertKey(source)),
      iso(NOW),
      'the successful send stamps the throttle key',
    );
  });

  it('throttles the same source for an hour and sends again after it', async () => {
    const fixture = await database('tele-lenta-alert-throttle-');
    const source = seedTickSource(fixture.db, { username: 'alert_throttle' });
    degrade(fixture, source);

    const first = stubSender();
    await runAlerts({ store: fixture.store, sender: first, ownerId: OWNER, now: () => NOW });
    assert.equal(first.sent.length, 1);

    const soon = stubSender();
    const throttled = await runAlerts({
      store: fixture.store,
      sender: soon,
      ownerId: OWNER,
      now: () => NOW + 30 * MINUTE,
    });
    assert.equal(soon.sent.length, 0);
    assert.equal(throttled.sent, 0);
    assert.equal(throttled.throttled, 1);
    assert.deepEqual(throttled.degraded, [source], 'the condition is still reported');

    const later = stubSender();
    const sent = await runAlerts({
      store: fixture.store,
      sender: later,
      ownerId: OWNER,
      now: () => NOW + 61 * MINUTE,
    });
    assert.equal(later.sent.length, 1);
    assert.equal(sent.sent, 1);
    assert.equal(sent.throttled, 0);
  });

  it('stays quiet after only two failed runs', async () => {
    const fixture = await database('tele-lenta-alert-two-');
    const source = seedTickSource(fixture.db, { username: 'alert_two' });
    addRun(fixture, source, 'failed', 0, NOW - 2 * MINUTE);
    addRun(fixture, source, 'failed', 0, NOW - MINUTE);
    const sender = stubSender();

    const result = await runAlerts({
      store: fixture.store,
      sender,
      ownerId: OWNER,
      now: () => NOW,
    });

    assert.equal(result.sent, 0);
    assert.deepEqual(result.degraded, []);
    assert.equal(sender.sent.length, 0);
  });

  it('treats three zero-yield ok runs as degraded', async () => {
    const fixture = await database('tele-lenta-alert-zero-');
    const source = seedTickSource(fixture.db, { username: 'alert_zero' });
    addRun(fixture, source, 'ok', 0, NOW - 3 * MINUTE);
    addRun(fixture, source, 'ok', 0, NOW - 2 * MINUTE);
    addRun(fixture, source, 'ok', 0, NOW - MINUTE);
    const sender = stubSender();

    const result = await runAlerts({
      store: fixture.store,
      sender,
      ownerId: OWNER,
      now: () => NOW,
    });

    assert.deepEqual(result.degraded, [source]);
    assert.equal(result.sent, 1);
  });

  it('ignores a source disabled by its kill switch', async () => {
    const fixture = await database('tele-lenta-alert-disabled-source-');
    const source = seedTickSource(fixture.db, {
      username: 'alert_disabled',
      enabled: false,
    });
    degrade(fixture, source);
    const sender = stubSender();

    const result = await runAlerts({
      store: fixture.store,
      sender,
      ownerId: OWNER,
      now: () => NOW,
    });

    assert.deepEqual(result.degraded, []);
    assert.equal(result.sent, 0);
    assert.equal(sender.sent.length, 0);
  });

  it('alerts when the newest successful source poll is 31 minutes old', async () => {
    const fixture = await database('tele-lenta-alert-stale-');
    seedReadSource(fixture.db, {
      username: 'alert_stale',
      lastSuccessAt: iso(NOW - 31 * MINUTE),
    });
    const sender = stubSender();

    const result = await runAlerts({
      store: fixture.store,
      sender,
      ownerId: OWNER,
      now: () => NOW,
    });

    assert.equal(result.stale, true);
    assert.equal(result.sent, 1);
    assert.equal(sender.sent.length, 1);
    const text = sender.sent[0]?.html ?? '';
    assert.match(text, /Лента не обновлялась 31 минуту/);
    assert.equal(fixture.store.appState.get(FEED_STALE_ALERT_KEY), iso(NOW));
  });

  it('does not alert when the feed is only 29 minutes old', async () => {
    const fixture = await database('tele-lenta-alert-fresh-');
    seedReadSource(fixture.db, {
      username: 'alert_fresh',
      lastSuccessAt: iso(NOW - 29 * MINUTE),
    });
    const sender = stubSender();

    const result = await runAlerts({
      store: fixture.store,
      sender,
      ownerId: OWNER,
      now: () => NOW,
    });

    assert.equal(result.stale, false);
    assert.equal(result.sent, 0);
    assert.equal(sender.sent.length, 0);
  });

  it('does not alert when no source has ever succeeded', async () => {
    const fixture = await database('tele-lenta-alert-never-');
    seedReadSource(fixture.db, { username: 'alert_never', lastSuccessAt: null });
    const sender = stubSender();

    const result = await runAlerts({
      store: fixture.store,
      sender,
      ownerId: OWNER,
      now: () => NOW,
    });

    assert.equal(result.stale, false);
    assert.equal(result.sent, 0);
  });

  it('throttles the stale alert by the same hour', async () => {
    const fixture = await database('tele-lenta-alert-stale-throttle-');
    seedReadSource(fixture.db, {
      username: 'alert_stale_throttle',
      lastSuccessAt: iso(NOW - 40 * MINUTE),
    });

    const first = stubSender();
    await runAlerts({ store: fixture.store, sender: first, ownerId: OWNER, now: () => NOW });
    assert.equal(first.sent.length, 1);

    const second = stubSender();
    const result = await runAlerts({
      store: fixture.store,
      sender: second,
      ownerId: OWNER,
      now: () => NOW + ALERT_THROTTLE_MS - 1,
    });
    assert.equal(result.stale, true);
    assert.equal(result.throttled, 1);
    assert.equal(second.sent.length, 0);
  });

  it('skips everything while ingestion is disabled', async () => {
    const fixture = await database('tele-lenta-alert-ingest-off-');
    const source = seedTickSource(fixture.db, { username: 'alert_ingest_off' });
    degrade(fixture, source);
    seedReadSource(fixture.db, {
      username: 'alert_ingest_off_fresh',
      lastSuccessAt: iso(NOW - 2 * 60 * MINUTE),
    });
    fixture.store.appState.set('INGEST_ENABLED', 'false');
    const sender = stubSender();

    const result = await runAlerts({
      store: fixture.store,
      sender,
      ownerId: OWNER,
      now: () => NOW,
    });

    assert.equal(result.skipped, 'ingestion_disabled');
    assert.equal(result.sent, 0);
    assert.deepEqual(result.degraded, []);
    assert.equal(sender.sent.length, 0);
  });

  it('counts a blocked send as failed and leaves the key unwritten', async () => {
    const fixture = await database('tele-lenta-alert-blocked-');
    const source = seedTickSource(fixture.db, { username: 'alert_blocked' });
    degrade(fixture, source);
    const blocked = stubSender({ status: 'blocked' });

    const first = await runAlerts({
      store: fixture.store,
      sender: blocked,
      ownerId: OWNER,
      now: () => NOW,
    });

    assert.equal(first.failed, 1);
    assert.equal(first.sent, 0);
    assert.equal(fixture.store.appState.get(sourceAlertKey(source)), null);

    const next = stubSender();
    const second = await runAlerts({
      store: fixture.store,
      sender: next,
      ownerId: OWNER,
      now: () => NOW + MINUTE,
    });
    assert.equal(second.sent, 1, 'the next tick retries immediately');
    assert.equal(next.sent.length, 1);
  });

  it('does not throw when the sender throws', async () => {
    const fixture = await database('tele-lenta-alert-throws-');
    const source = seedTickSource(fixture.db, { username: 'alert_throws' });
    degrade(fixture, source);
    const sender: BotSender = {
      async sendMessage() {
        throw new Error('network down');
      },
    };

    const result = await runAlerts({
      store: fixture.store,
      sender,
      ownerId: OWNER,
      now: () => NOW,
    });

    assert.equal(result.failed, 1);
    assert.deepEqual(result.degraded, [source]);
    assert.equal(fixture.store.appState.get(sourceAlertKey(source)), null);
  });

  it('skips when the sender is not configured', async () => {
    const fixture = await database('tele-lenta-alert-unconfigured-');
    const source = seedTickSource(fixture.db, { username: 'alert_unconfigured' });
    degrade(fixture, source);

    const noSender = await runAlerts({
      store: fixture.store,
      sender: null,
      ownerId: OWNER,
      now: () => NOW,
    });
    assert.equal(noSender.skipped, 'unconfigured');

    const noOwner = await runAlerts({
      store: fixture.store,
      sender: stubSender(),
      ownerId: null,
      now: () => NOW,
    });
    assert.equal(noOwner.skipped, 'unconfigured');
  });

  it('escapes the source title and keeps the username in parentheses', async () => {
    const fixture = await database('tele-lenta-alert-escape-');
    const source = seedReadSource(fixture.db, {
      username: 'alert_escape',
      title: 'Bed & <Breakfast>',
      lastSuccessAt: iso(NOW),
    });
    degrade(fixture, source);
    const sender = stubSender();

    await runAlerts({ store: fixture.store, sender, ownerId: OWNER, now: () => NOW });

    const text = sender.sent[0]?.html ?? '';
    assert.match(text, /Bed &amp; &lt;Breakfast&gt;/);
    assert.match(text, /\(@alert_escape\)/);
    assert.ok(!text.includes('<Breakfast>'), 'raw markup never reaches HTML');
  });
});

describe('alert wording', () => {
  it('declines «минута» for a person reading the message', () => {
    assert.equal(minutesWord(1), 'минуту');
    assert.equal(minutesWord(2), 'минуты');
    assert.equal(minutesWord(5), 'минут');
    assert.equal(minutesWord(11), 'минут');
    assert.equal(minutesWord(21), 'минуту');
    assert.equal(minutesWord(31), 'минуту');
    assert.equal(minutesWord(45), 'минут');
  });
});
