/**
 * The minute tick end to end (ticket #18, layer B): retention runs before the
 * digest, alerts run last, and neither can fail the collector run.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import type { BotSender } from '../src/bot/index.js';
import { FEED_STALE_ALERT_KEY } from '../src/alert/index.js';
import { INGEST_ENABLED_KEY, runTick } from '../src/tick/tick.js';

import {
  closeTestDatabase,
  createTestDatabase,
  type TestDatabase,
} from './helpers/database.js';
import { seedCluster, seedSource as seedReadSource } from './helpers/seed.js';
import { ScriptedServer, testClient, testConfig } from './helpers/tick.js';

const NOW = Date.parse('2026-11-05T12:00:00.000Z');
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
const iso = (ms: number): string => new Date(ms).toISOString();
const OWNER = 9002;

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

/** An enabled source the tick will not poll (no cursor) but freshness can read. */
function idleSource(fixture: TestDatabase, username: string, lastSuccessAt: string): number {
  const id = seedReadSource(fixture.db, { username, lastSuccessAt });
  fixture.db.prepare('UPDATE sources SET cursor_message_id = NULL WHERE id = ?').run(id);
  return id;
}

function stuckSender(outcome: 'throw' | 'blocked'): BotSender {
  return {
    async sendMessage() {
      if (outcome === 'throw') throw new Error('network down');
      return { status: 'blocked' };
    },
  };
}

function recordingSender(): { sender: BotSender; sent: string[] } {
  const sent: string[] = [];
  return {
    sent,
    sender: {
      async sendMessage(_chatId, html) {
        sent.push(html);
        return { status: 'sent' };
      },
    },
  };
}

function danglingClusterReferences(fixture: TestDatabase): number {
  const row = fixture.db
    .prepare(
      `SELECT COUNT(*) AS n
       FROM listings l
       LEFT JOIN clusters c ON c.id = l.cluster_id
       WHERE l.cluster_id IS NOT NULL AND c.id IS NULL`,
    )
    .get() as { n: number };
  return row.n;
}

describe('tick retention and alerts', () => {
  it('runs retention in the same tick and deletes an old listing', async () => {
    const fixture = await database('tele-lenta-tick-retention-');
    const source = idleSource(fixture, 'tick_retention_src', iso(NOW - 5 * MINUTE));
    seedCluster(fixture.db, fixture.store, [
      {
        sourceId: source,
        messageId: 1,
        publishedAt: iso(NOW - 31 * DAY),
        title: 'Старое объявление',
      },
    ]);

    const result = await runTick({
      config: testConfig(fixture.path),
      store: fixture.store,
      client: testClient(new ScriptedServer()),
      now: () => NOW,
    });

    assert.deepEqual(result.runs, []);
    assert.ok(result.retention, 'retention runs even when no source was polled');
    assert.equal(result.retention.listingsDeleted, 1);
    assert.equal(result.retention.clustersDeleted, 1);
    assert.equal(result.alerts, null, 'alerts were not configured');
    assert.equal(
      (fixture.db.prepare('SELECT COUNT(*) AS n FROM listings').get() as { n: number }).n,
      0,
    );
  });

  it('sends one stale alert and throttles the next tick', async () => {
    const fixture = await database('tele-lenta-tick-stale-');
    idleSource(fixture, 'tick_stale_src', iso(NOW - 31 * MINUTE));
    const { sender, sent } = recordingSender();
    const config = testConfig(fixture.path);

    const first = await runTick({
      config,
      store: fixture.store,
      client: testClient(new ScriptedServer()),
      now: () => NOW,
      alerts: { sender, ownerId: OWNER },
    });

    assert.ok(first.alerts);
    assert.equal(first.alerts.stale, true);
    assert.equal(first.alerts.sent, 1);
    assert.equal(sent.length, 1);
    assert.match(sent[0] ?? '', /Лента не обновлялась 31 минут/);
    assert.equal(fixture.store.appState.get(FEED_STALE_ALERT_KEY), iso(NOW));

    const second = await runTick({
      config,
      store: fixture.store,
      client: testClient(new ScriptedServer()),
      now: () => NOW + MINUTE,
      alerts: { sender, ownerId: OWNER },
    });

    assert.ok(second.alerts);
    assert.equal(second.alerts.throttled, 1);
    assert.equal(second.alerts.sent, 0);
    assert.equal(sent.length, 1, 'no second message inside the hour');
  });

  it('exits before retention and alerts when ingestion is disabled', async () => {
    const fixture = await database('tele-lenta-tick-alerts-off-');
    const source = idleSource(fixture, 'tick_alerts_off_src', iso(NOW - 2 * 60 * MINUTE));
    seedCluster(fixture.db, fixture.store, [
      {
        sourceId: source,
        messageId: 1,
        publishedAt: iso(NOW - 31 * DAY),
      },
    ]);
    fixture.store.appState.set(INGEST_ENABLED_KEY, 'false');
    const { sender, sent } = recordingSender();

    const result = await runTick({
      config: testConfig(fixture.path),
      store: fixture.store,
      client: testClient(new ScriptedServer()),
      now: () => NOW,
      alerts: { sender, ownerId: OWNER },
    });

    assert.equal(result.ingestionDisabled, true);
    assert.equal(result.retention, null);
    assert.equal(result.alerts, null);
    assert.equal(sent.length, 0);
    assert.equal(
      (fixture.db.prepare('SELECT COUNT(*) AS n FROM listings').get() as { n: number }).n,
      1,
      'no housekeeping while the ingest kill switch is off',
    );
  });

  it('keeps the tick alive when the alert sender fails', async () => {
    const fixture = await database('tele-lenta-tick-alert-fails-');
    idleSource(fixture, 'tick_alert_fails_src', iso(NOW - 31 * MINUTE));

    const result = await runTick({
      config: testConfig(fixture.path),
      store: fixture.store,
      client: testClient(new ScriptedServer()),
      now: () => NOW,
      alerts: { sender: stuckSender('throw'), ownerId: OWNER },
    });

    assert.ok(result.alerts, 'a failed alert is a result, not a thrown tick');
    assert.equal(result.alerts.failed, 1);
    assert.equal(result.alerts.sent, 0);
    assert.equal(result.alerts.stale, true);
  });

  it('counts a blocked alert as failed without failing the tick', async () => {
    const fixture = await database('tele-lenta-tick-alert-blocked-');
    idleSource(fixture, 'tick_alert_blocked_src', iso(NOW - 31 * MINUTE));

    const result = await runTick({
      config: testConfig(fixture.path),
      store: fixture.store,
      client: testClient(new ScriptedServer()),
      now: () => NOW,
      alerts: { sender: stuckSender('blocked'), ownerId: OWNER },
    });

    assert.equal(result.alerts?.failed, 1);
    assert.equal(fixture.store.appState.get(FEED_STALE_ALERT_KEY), null);
  });

  it('leaves fresh rows alone and no cluster references dangle after the tick', async () => {
    const fixture = await database('tele-lenta-tick-retention-order-');
    const source = idleSource(fixture, 'tick_retention_order_src', iso(NOW - 5 * MINUTE));
    const fresh = seedCluster(fixture.db, fixture.store, [
      {
        sourceId: source,
        messageId: 1,
        publishedAt: iso(NOW - DAY),
      },
      {
        sourceId: source,
        messageId: 2,
        publishedAt: iso(NOW - 31 * DAY),
      },
    ]);

    const result = await runTick({
      config: testConfig(fixture.path),
      store: fixture.store,
      client: testClient(new ScriptedServer()),
      now: () => NOW,
    });

    assert.equal(result.retention?.listingsDeleted, 1);
    assert.equal(danglingClusterReferences(fixture), 0);
    const cluster = fixture.store.clusters.getCluster(fresh);
    assert.ok(cluster, 'the cluster survives on its fresh member');
    assert.equal(cluster.listingCount, 1);
    assert.equal(cluster.earliestPublishedAt, iso(NOW - DAY));
  });

  it('can turn retention off for a tick that only wants ingestion', async () => {
    const fixture = await database('tele-lenta-tick-retention-off-');
    const source = idleSource(fixture, 'tick_retention_off_src', iso(NOW - 5 * MINUTE));
    seedCluster(fixture.db, fixture.store, [
      {
        sourceId: source,
        messageId: 1,
        publishedAt: iso(NOW - 31 * DAY),
      },
    ]);

    const result = await runTick({
      config: testConfig(fixture.path),
      store: fixture.store,
      client: testClient(new ScriptedServer()),
      now: () => NOW,
      retention: false,
    });

    assert.equal(result.retention, null);
    assert.equal(
      (fixture.db.prepare('SELECT COUNT(*) AS n FROM listings').get() as { n: number }).n,
      1,
    );
  });
});
