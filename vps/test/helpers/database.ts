import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openDatabase, type Db } from '../../src/db.js';
import { migrate } from '../../src/migrate.js';
import { createStore, type Store } from '../../src/store/index.js';

export interface TestDatabase {
  dir: string;
  path: string;
  db: Db;
  store: Store;
}

/** A real temporary file database with every migration applied. */
export async function createTestDatabase(prefix = 'tele-lenta-store-'): Promise<TestDatabase> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  const path = join(dir, 'test.db');
  const db = openDatabase(path);
  migrate(db);
  return { dir, path, db, store: createStore(db) };
}

export async function closeTestDatabase(database: TestDatabase): Promise<void> {
  database.db.close();
  await rm(database.dir, { recursive: true, force: true });
}
