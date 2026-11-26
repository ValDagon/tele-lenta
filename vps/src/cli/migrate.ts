import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { loadConfig } from '../config.js';
import { openDatabase } from '../db.js';
import { migrate } from '../migrate.js';

const config = loadConfig();
mkdirSync(dirname(config.databasePath), { recursive: true });

const db = openDatabase(config.databasePath);
try {
  const { applied } = migrate(db);
  if (applied.length === 0) {
    process.stdout.write('No pending migrations.\n');
  } else {
    process.stdout.write(`Applied ${applied.length} migration(s):\n`);
    for (const version of applied) {
      process.stdout.write(`  ${version}\n`);
    }
  }
} finally {
  db.close();
}
