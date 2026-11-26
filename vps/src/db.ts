import Database from 'better-sqlite3';

export type Db = Database.Database;

const BUSY_TIMEOUT_MS = 5_000;

/**
 * Opens the SQLite store with the pragmas every writer relies on:
 * WAL for concurrent reads during writes, foreign keys on, and a busy
 * timeout so the API and the worker tick wait instead of failing fast.
 */
export function openDatabase(path: string): Db {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`);
  return db;
}
