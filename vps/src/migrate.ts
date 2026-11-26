import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Db } from './db.js';

/** Resolves to `vps/migrations` from both `src/` and the compiled `dist/`. */
export const migrationsDir = fileURLToPath(new URL('../migrations/', import.meta.url));

const MIGRATION_FILE = /^\d{4}_[a-z0-9_]+\.sql$/;

export interface MigrationResult {
  applied: string[];
}

/**
 * Applies numbered SQL files in order, each inside a transaction and recorded
 * in `migrations`, so a second run applies nothing.
 */
export function migrate(db: Db, directory: string = migrationsDir): MigrationResult {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  const done = new Set(
    db
      .prepare('SELECT version FROM migrations')
      .all()
      .map((row) => (row as { version: string }).version),
  );

  const files = readdirSync(directory)
    .filter((name) => MIGRATION_FILE.test(name))
    .sort();

  const record = db.prepare('INSERT INTO migrations (version, applied_at) VALUES (?, ?)');
  const applied: string[] = [];

  for (const file of files) {
    if (done.has(file)) continue;

    const sql = readFileSync(join(directory, file), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      record.run(file, new Date().toISOString());
    })();
    applied.push(file);
  }

  return { applied };
}
