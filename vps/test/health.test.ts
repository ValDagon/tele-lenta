import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';

import type { FastifyInstance } from 'fastify';

import { buildApp } from '../src/app.js';
import { loadConfig, requireSharedSecret } from '../src/config.js';
import { openDatabase } from '../src/db.js';
import { migrate } from '../src/migrate.js';

import { TEST_SHARED_SECRET, injectSigned, seedUser } from './helpers/auth.js';

const tempDirs: string[] = [];
let databasePath: string;

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tele-lenta-health-'));
  tempDirs.push(dir);
  databasePath = join(dir, 'test.db');
});

after(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

function migratedApp(): { app: FastifyInstance; db: ReturnType<typeof openDatabase> } {
  const db = openDatabase(databasePath);
  migrate(db);
  const app = buildApp({
    db,
    logger: false,
    auth: { sharedSecret: TEST_SHARED_SECRET },
  });
  return { app, db };
}

describe('GET /health', () => {
  it('returns an empty zeroed state on a freshly migrated database', async () => {
    const { app, db } = migratedApp();

    const response = await app.inject({ method: 'GET', url: '/health' });

    assert.equal(response.statusCode, 200);
    assert.match(response.headers['content-type'] ?? '', /^application\/json/);

    const body = response.json();
    assert.deepEqual(Object.keys(body).sort(), [
      'age_seconds',
      'checked_at',
      'last_success_at',
      'sources',
      'status',
    ]);
    assert.equal(body.status, 'ok');
    assert.equal(body.last_success_at, null);
    assert.equal(body.age_seconds, null);
    assert.deepEqual(body.sources, []);
    assert.ok(!Number.isNaN(Date.parse(body.checked_at)));

    await app.close();
    db.close();
  });

  it('reports global and per-source freshness without ingest internals', async () => {
    const { app, db } = migratedApp();
    const older = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const newer = new Date(Date.now() - 60 * 1000).toISOString();
    const insert = db.prepare(
      'INSERT INTO sources (username, title, enabled, last_success_at) VALUES (?, ?, ?, ?)',
    );
    insert.run('older_chat', 'Older chat', 1, older);
    insert.run('newer_chat', 'Newer chat', 1, newer);
    insert.run('disabled_chat', 'Disabled chat', 0, newer);

    const response = await app.inject({ method: 'GET', url: '/health' });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.last_success_at, newer);
    assert.ok(body.age_seconds >= 59 && body.age_seconds <= 65);

    assert.equal(body.sources.length, 2);
    const usernames = body.sources.map((source: { username: string }) => source.username).sort();
    assert.deepEqual(usernames, ['newer_chat', 'older_chat']);
    for (const source of body.sources) {
      assert.deepEqual(Object.keys(source).sort(), [
        'age_seconds',
        'id',
        'last_success_at',
        'username',
      ]);
      assert.equal(typeof source.age_seconds, 'number');
    }

    const serialized = response.body;
    for (const forbidden of ['consecutive_failures', 'error', 'cursor', 'ingest_runs', 'text']) {
      assert.ok(!serialized.includes(forbidden), `health must not expose "${forbidden}"`);
    }

    await app.close();
    db.close();
  });

  it('stays public while every /v1 route requires a signed request', async () => {
    const { app, db } = migratedApp();
    seedUser(db);

    assert.equal((await app.inject({ method: 'GET', url: '/health' })).statusCode, 200);

    const unsigned = await app.inject({ method: 'GET', url: '/v1/feed' });
    assert.equal(unsigned.statusCode, 400);
    assert.equal(unsigned.json().error.code, 'invalid_request');

    const feed = await injectSigned(app, { url: '/v1/feed' });
    assert.equal(feed.statusCode, 200);
    assert.deepEqual(feed.json().cards, []);
    assert.equal(feed.json().total, 0);

    const sources = await injectSigned(app, { url: '/v1/sources' });
    assert.equal(sources.statusCode, 200);

    await app.close();
    db.close();
  });

  it('binds to localhost by default', () => {
    const config = loadConfig({});
    assert.equal(config.host, '127.0.0.1');
  });

  it('actually listens on the loopback address', async () => {
    const { app, db } = migratedApp();
    await app.listen({ host: loadConfig({}).host, port: 0 });

    const address = app.server.address();
    assert.ok(address !== null && typeof address === 'object');
    assert.equal(address.address, '127.0.0.1');

    const response = await fetch(`http://127.0.0.1:${address.port}/health`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as { status: string };
    assert.equal(body.status, 'ok');

    await app.close();
    db.close();
  });
});

describe('environment config', () => {
  it('rejects an invalid port instead of booting on a random one', () => {
    assert.throws(() => loadConfig({ TL_PORT: 'not-a-port' }), /TL_PORT/);
    assert.throws(() => loadConfig({ TL_PORT: '70000' }), /TL_PORT/);
  });

  it('requires a shared secret to boot the API', () => {
    assert.throws(() => requireSharedSecret(loadConfig({})), /TL_SHARED_SECRET/);
    assert.throws(
      () => loadConfig({ TL_SHARED_SECRET: 'too-short' }),
      /TL_SHARED_SECRET/,
    );
    assert.equal(
      requireSharedSecret(loadConfig({ TL_SHARED_SECRET: 'x'.repeat(32) })),
      'x'.repeat(32),
    );
  });

  it('reads the owner id when configured', () => {
    assert.equal(loadConfig({}).ownerTelegramId, null);
    assert.equal(loadConfig({ TL_OWNER_TELEGRAM_ID: '4242' }).ownerTelegramId, 4242);
    assert.throws(() => loadConfig({ TL_OWNER_TELEGRAM_ID: 'owner' }), /TL_OWNER_TELEGRAM_ID/);
  });

  it('reads the optional bot credentials and rejects a malformed username', () => {
    const empty = loadConfig({});
    assert.equal(empty.botToken, null);
    assert.equal(empty.botUsername, null);

    const configured = loadConfig({
      TL_BOT_TOKEN: '  123:secret  ',
      TL_BOT_USERNAME: '  @tele_lenta_bot  ',
    });
    assert.equal(configured.botToken, '123:secret');
    assert.equal(configured.botUsername, 'tele_lenta_bot');

    assert.equal(loadConfig({ TL_BOT_TOKEN: '   ' }).botToken, null);
    assert.equal(loadConfig({ TL_BOT_USERNAME: '  ' }).botUsername, null);
    assert.throws(() => loadConfig({ TL_BOT_USERNAME: 'no' }), /TL_BOT_USERNAME/);
    assert.throws(() => loadConfig({ TL_BOT_USERNAME: 'bad name' }), /TL_BOT_USERNAME/);
  });

  it('reads overrides from the environment', () => {
    const config = loadConfig({
      TL_HOST: '127.0.0.1',
      TL_PORT: '9000',
      TL_DATABASE_PATH: '/tmp/example.db',
      TL_LOG_LEVEL: 'debug',
    });
    assert.equal(config.port, 9000);
    assert.equal(config.databasePath, '/tmp/example.db');
    assert.equal(config.logLevel, 'debug');
  });
});
