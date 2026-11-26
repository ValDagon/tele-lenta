/**
 * `npm -w vps run backfill -- <username> [--budget N] [--force]`.
 *
 * The second step of adding a Источник: the row already exists, disabled with a
 * null cursor. This command discovers the latest id, binary-searches the 7-day
 * cut-off, enumerates forward politely, and only then sets the cursor and
 * enables the source. The minute tick skips null-cursor sources, so a source is
 * never polled before this succeeds.
 *
 * Exit codes:
 *   0  backfill committed (including an inactive source older than 7 days)
 *   1  refused before fetching: bad usage, unknown source, already backfilled
 *   2  aborted mid-run: budget, HTTP/network failure, or a parse error; nothing
 *      was written, and running the same command again restarts the same
 *      deterministic boundary search
 */

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import {
  BACKFILL_USAGE,
  BackfillUsageError,
  parseBackfillArgs,
  type ParsedBackfillArgs,
} from '../backfill/args.js';
import { runBackfill } from '../backfill/index.js';
import { loadConfig, type Config } from '../config.js';
import { openDatabase } from '../db.js';
import { createRequestBudget, createPoliteClient } from '../net/polite-client.js';
import { createStore } from '../store/index.js';
import { INGEST_ENABLED_KEY } from '../tick/tick.js';

export interface BackfillCliDeps {
  config: Config;
  store: ReturnType<typeof createStore>;
  client: ReturnType<typeof createPoliteClient>;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

/** Runs one parsed command; maps a `BackfillResult` onto output and exit code. */
export async function runBackfillCommand(
  args: ParsedBackfillArgs,
  deps: BackfillCliDeps,
): Promise<number> {
  const { config, store, client, stdout, stderr } = deps;
  const budgetLimit = args.budget ?? config.backfillBudget;
  const ingestEnabled = store.appState.get(INGEST_ENABLED_KEY) !== 'false';

  const result = await runBackfill({
    store,
    client,
    username: args.username,
    budget: createRequestBudget(budgetLimit),
    ingestEnabled,
    force: args.force,
  });

  if (result.status === 'refused') {
    stderr(`error: ${result.message}\n`);
    return 1;
  }

  if (result.status === 'aborted') {
    stderr(`error: backfill aborted (${result.reason}): ${result.message}\n`);
    if (result.remaining !== undefined) {
      stderr(
        `note: ${result.remaining} message ids remain; run the same command again — ` +
          `the boundary search is deterministic and nothing was written\n`,
      );
    } else {
      stderr(
        'note: nothing was written; fix the failure and run the same command again\n',
      );
    }
    return 2;
  }

  const cutoff = result.cutoffId === null ? 'none' : String(result.cutoffId);
  const counts = result.counts;
  stdout(
    `backfill ok source=${result.username} latest=${result.latestId} cutoff=${cutoff}` +
      `${result.inactive ? ' inactive=true' : ''} cursor=${String(result.cursorBefore)}->${String(
        result.cursorAfter,
      )} fetched=${counts.fetched} inserted=${counts.inserted} updated=${counts.updated} ` +
      `skipped=${counts.skipped} errors=${counts.errors} requests=${counts.requests}\n`,
  );
  return 0;
}

async function main(): Promise<void> {
  let args: ParsedBackfillArgs;
  try {
    args = parseBackfillArgs(process.argv.slice(2));
  } catch (error) {
    if (error instanceof BackfillUsageError) {
      if (error.message !== 'help') process.stderr.write(`error: ${error.message}\n`);
      process.stderr.write(BACKFILL_USAGE);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  const config = loadConfig();
  mkdirSync(dirname(config.databasePath), { recursive: true });

  const db = openDatabase(config.databasePath);
  try {
    const store = createStore(db);
    const client = createPoliteClient({
      transport: fetch,
      userAgent: config.userAgent,
      timeoutMs: config.requestTimeoutMs,
    });

    process.exitCode = await runBackfillCommand(args, {
      config,
      store,
      client,
      stdout: (text) => process.stdout.write(text),
      stderr: (text) => process.stderr.write(text),
    });
  } finally {
    db.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `backfill failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
