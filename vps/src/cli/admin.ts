/**
 * `npm -w vps run admin -- <command>` — the owner's allowlist CLI.
 *
 * This is a VPS-local command, never a Serverless bot handler. It refuses to
 * run without `TL_OWNER_TELEGRAM_ID`, and it writes only through the store, so
 * `admin forget` is the same erasure path the tests exercise.
 *
 * Exit code 0 means the command ran and wrote its result; 1 covers a usage
 * error, a missing row, an unconfigured owner id, or an infrastructure failure
 * (unreadable config, unopenable database).
 */

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { runAdmin } from '../admin/index.js';
import { loadConfig } from '../config.js';
import { openDatabase } from '../db.js';
import { createStore } from '../store/index.js';

function main(): void {
  const config = loadConfig();
  mkdirSync(dirname(config.databasePath), { recursive: true });

  const db = openDatabase(config.databasePath);
  try {
    const result = runAdmin(process.argv.slice(2), {
      store: createStore(db),
      config,
      stdout: (text) => process.stdout.write(text),
      stderr: (text) => process.stderr.write(text),
    });
    process.exitCode = result.exitCode;
  } finally {
    db.close();
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(
    `admin failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
