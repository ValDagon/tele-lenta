import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { runAdmin, type AdminDeps, type Write } from '../src/admin/index.js';
import { loadConfig, type Config } from '../src/config.js';

import {
  closeTestDatabase,
  createTestDatabase,
  type TestDatabase,
} from './helpers/database.js';

const T0 = '2026-11-01T08:00:00.000Z';

let current: TestDatabase | null = null;

afterEach(async () => {
  if (current !== null) {
    await closeTestDatabase(current);
    current = null;
  }
});

async function newDatabase(prefix: string): Promise<TestDatabase> {
  current = await createTestDatabase(prefix);
  return current;
}

function config(ownerTelegramId: string | null): Config {
  return loadConfig(
    ownerTelegramId === null
      ? {}
      : ({ TL_OWNER_TELEGRAM_ID: ownerTelegramId } as NodeJS.ProcessEnv),
  );
}

interface Captured {
  stdout: string[];
  stderr: string[];
}

function run(
  database: TestDatabase,
  argv: readonly string[],
  ownerTelegramId: string | null = '777',
): { result: ReturnType<typeof runAdmin>; output: Captured } {
  const output: Captured = { stdout: [], stderr: [] };
  const write = (bucket: string[]): Write => (text) => {
    bucket.push(text);
  };
  const deps: AdminDeps = {
    store: database.store,
    config: config(ownerTelegramId),
    stdout: write(output.stdout),
    stderr: write(output.stderr),
  };
  return { result: runAdmin(argv, deps), output };
}

function count(database: TestDatabase, table: string): number {
  return (
    database.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
      count: number;
    }
  ).count;
}

function userCount(database: TestDatabase): number {
  return count(database, 'users');
}

function seedUser(database: TestDatabase, id: number): void {
  database.db
    .prepare(
      `INSERT INTO users (telegram_user_id, username, first_name, allowed, created_at)
       VALUES (?, ?, ?, 1, ?)`,
    )
    .run(id, `user_${id}`, `User ${id}`, T0);
}

describe('admin CLI owner check', () => {
  it('refuses every subcommand when TL_OWNER_TELEGRAM_ID is not configured', async () => {
    const database = await newDatabase('tele-lenta-admin-no-owner-');

    for (const argv of [['list'], ['allow', '1001'], ['deny', '1001'], ['forget', '1001']]) {
      const { result, output } = run(database, argv, null);
      assert.equal(result.exitCode, 1, argv.join(' '));
      assert.deepEqual(output.stdout, [], `${argv.join(' ')} must not write output`);
      assert.ok(
        output.stderr.join('').includes('TL_OWNER_TELEGRAM_ID'),
        `${argv.join(' ')} must explain the missing owner id`,
      );
    }

    assert.equal(userCount(database), 0, 'a refused command must not write');
  });
});

describe('admin list', () => {
  it('prints the allowlist fields with no secret columns', async () => {
    const database = await newDatabase('tele-lenta-admin-list-');
    seedUser(database, 1002);
    seedUser(database, 1001);

    const { result, output } = run(database, ['list']);

    assert.equal(result.exitCode, 0);
    const text = output.stdout.join('');
    const lines = text.trimEnd().split('\n');
    assert.equal(lines[0], 'telegram_id\tusername\tfirst_name\tallowed\tcreated_at');
    assert.equal(lines.length, 3);
    assert.equal(lines[1], `1001\tuser_1001\tUser 1001\tyes\t${T0}`);
    assert.equal(lines[2], `1002\tuser_1002\tUser 1002\tyes\t${T0}`);

    for (const forbidden of ['secret', 'hash', 'initData', 'token']) {
      assert.ok(!text.includes(forbidden), `list output must not contain "${forbidden}"`);
    }
  });

  it('prints only the header on an empty allowlist', async () => {
    const database = await newDatabase('tele-lenta-admin-list-empty-');

    const { result, output } = run(database, ['list']);

    assert.equal(result.exitCode, 0);
    assert.equal(
      output.stdout.join(''),
      'telegram_id\tusername\tfirst_name\tallowed\tcreated_at\n',
    );
  });
});

describe('admin input validation', () => {
  it('rejects malformed ids without writing', async () => {
    const database = await newDatabase('tele-lenta-admin-bad-ids-');

    for (const argv of [
      ['allow', 'abc'],
      ['allow', '0'],
      ['allow', '-1'],
      ['deny', '1.5'],
      ['forget', ''],
    ]) {
      const { result, output } = run(database, argv);
      assert.equal(result.exitCode, 1, argv.join(' '));
      assert.deepEqual(output.stdout, []);
      assert.ok(output.stderr.join('').startsWith('error:'));
    }

    assert.equal(userCount(database), 0);
  });

  it('rejects unknown flags, missing flag values, and extra arguments without writing', async () => {
    const database = await newDatabase('tele-lenta-admin-bad-flags-');

    for (const argv of [
      ['allow', '1001', '--bogus', 'x'],
      ['allow', '1001', '--username'],
      ['allow', '1001', '--username', '--first-name', 'Тест'],
      ['allow', '1001', 'extra'],
      ['allow'],
      ['list', 'extra'],
      ['deny', '1001', '--username', 'x'],
      ['frobnicate'],
    ]) {
      const { result, output } = run(database, argv);
      assert.equal(result.exitCode, 1, argv.join(' '));
      assert.deepEqual(output.stdout, []);
    }

    assert.equal(userCount(database), 0);
  });
});

describe('admin allow, deny, and forget round-trip', () => {
  it('allows an unknown id, denies it, re-allows it, and forgets it with counts', async () => {
    const database = await newDatabase('tele-lenta-admin-roundtrip-');

    const allowed = run(database, ['allow', '3001', '--username', 'beta', '--first-name', 'Тест']);
    assert.equal(allowed.result.exitCode, 0);
    assert.equal(allowed.output.stdout.join(''), 'allowed 3001\n');

    let user = database.store.users.get(3001);
    assert.ok(user);
    assert.equal(user.allowed, true);
    assert.equal(user.username, 'beta');
    assert.equal(user.firstName, 'Тест');

    const denied = run(database, ['deny', '3001']);
    assert.equal(denied.result.exitCode, 0);
    assert.equal(denied.output.stdout.join(''), 'denied 3001\n');
    user = database.store.users.get(3001);
    assert.ok(user, 'deny must keep the row');
    assert.equal(user.allowed, false);
    assert.equal(userCount(database), 1);

    const reallowed = run(database, ['allow', '3001']);
    assert.equal(reallowed.result.exitCode, 0);
    user = database.store.users.get(3001);
    assert.ok(user);
    assert.equal(user.allowed, true);
    assert.equal(user.username, 'beta', 'a flagless allow keeps the profile');

    database.db
      .prepare(
        `INSERT INTO clusters
           (cluster_key, section, category, demand, earliest_published_at, first_seen_at)
         VALUES ('k1', 'classifieds', 'goods', 'offer', ?, ?)`,
      )
      .run(T0, T0);
    const search = database.db
      .prepare(
        `INSERT INTO saved_searches (user_id, name, query, created_at)
         VALUES (3001, 'Квартира', 'квартира', ?)`,
      )
      .run(T0);
    database.db
      .prepare(
        `INSERT INTO saved_search_matches (saved_search_id, cluster_id, matched_at)
         VALUES (?, 1, ?)`,
      )
      .run(Number(search.lastInsertRowid), T0);

    const forgotten = run(database, ['forget', '3001']);
    assert.equal(forgotten.result.exitCode, 0);
    assert.equal(
      forgotten.output.stdout.join(''),
      'forgot 3001 users=1 saved_searches=1 saved_search_matches=1\n',
    );
    assert.equal(database.store.users.get(3001), null);
    assert.equal(count(database, 'saved_searches'), 0);
    assert.equal(count(database, 'saved_search_matches'), 0);
  });

  it('errors without writing when deny or forget targets a missing row', async () => {
    const database = await newDatabase('tele-lenta-admin-missing-');

    const denied = run(database, ['deny', '4001']);
    assert.equal(denied.result.exitCode, 1);
    assert.deepEqual(denied.output.stdout, []);
    assert.ok(denied.output.stderr.join('').includes('4001'));

    const forgotten = run(database, ['forget', '4001']);
    assert.equal(forgotten.result.exitCode, 1);
    assert.deepEqual(forgotten.output.stdout, []);
    assert.ok(forgotten.output.stderr.join('').includes('4001'));

    assert.equal(userCount(database), 0);
  });
});
