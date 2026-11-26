import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';

import { openDatabase } from '../src/db.js';
import { migrationsDir, migrate } from '../src/migrate.js';

const tempDirs: string[] = [];
let databasePath: string;

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tele-lenta-migrations-'));
  tempDirs.push(dir);
  databasePath = join(dir, 'test.db');
});

after(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('migrations', () => {
  it('records every migration file and is idempotent on a second run', async () => {
    const files = (await readdir(migrationsDir))
      .filter((name) => name.endsWith('.sql'))
      .sort();
    assert.ok(files.length > 0, 'expected at least one migration file');

    const db = openDatabase(databasePath);

    const first = migrate(db);
    assert.deepEqual(first.applied, files);

    const recorded = db
      .prepare('SELECT version FROM migrations ORDER BY version')
      .all()
      .map((row) => (row as { version: string }).version);
    assert.deepEqual(recorded, files);

    const second = migrate(db);
    assert.deepEqual(second.applied, []);

    const count = db.prepare('SELECT COUNT(*) AS count FROM migrations').get() as { count: number };
    assert.equal(count.count, files.length);

    db.close();
  });

  it('runs SQLite in WAL mode with foreign keys on and a busy timeout', () => {
    const db = openDatabase(databasePath);

    assert.equal(db.pragma('journal_mode', { simple: true }), 'wal');
    assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
    assert.ok((db.pragma('busy_timeout', { simple: true }) as number) >= 1000);

    db.close();
  });
});
