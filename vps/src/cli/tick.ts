/**
 * `npm -w vps run tick` — one collector tick, meant for system cron every
 * minute.
 *
 * Exit code 0 means the tick ran, including when individual sources failed:
 * their failure is in `ingest_runs` and must not make cron page anyone. A
 * non-zero exit is reserved for infrastructure: unreadable config, a database
 * that cannot be opened, or an unexpected throw before the tick could start.
 */

import { createBotSender } from '../bot/index.js';
import { loadConfig } from '../config.js';
import { openDatabase } from '../db.js';
import { createPoliteClient } from '../net/polite-client.js';
import { createStore } from '../store/index.js';
import { runTick } from '../tick/tick.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const db = openDatabase(config.databasePath);

  try {
    const store = createStore(db);
    const client = createPoliteClient({
      transport: fetch,
      userAgent: config.userAgent,
      timeoutMs: config.requestTimeoutMs,
    });

    // One sender for the whole tick: the digest and the alerts share its Bot
    // API pacing, so one process never bursts past the 30 messages per second.
    const sender = config.botToken === null ? null : createBotSender({ token: config.botToken });

    const digest =
      sender !== null && config.botUsername !== null
        ? { sender, botUsername: config.botUsername }
        : null;

    const alerts =
      sender !== null && config.ownerTelegramId !== null
        ? { sender, ownerId: config.ownerTelegramId }
        : null;

    const result = await runTick({ config, store, client, digest, alerts });

    if (result.skippedByLock) {
      process.stdout.write('tick skipped: another tick holds the lock\n');
      return;
    }
    if (result.ingestionDisabled) {
      process.stdout.write('tick skipped: INGEST_ENABLED is false\n');
      return;
    }

    for (const run of result.runs) {
      const counts = run.counts;
      const error = run.errorSample === null ? '' : ` error="${run.errorSample}"`;
      process.stdout.write(
        `source=${run.username} status=${run.status} cursor=${String(run.cursorBefore)}->${String(
          run.cursorAfter,
        )} fetched=${counts.fetched} inserted=${counts.inserted} updated=${counts.updated} ` +
          `skipped=${counts.skipped} errors=${counts.errors} requests=${counts.requests}${error}\n`,
      );
    }
    if (result.runs.length === 0) {
      process.stdout.write('tick finished: no source ready to poll\n');
    }

    if (result.retention === null) {
      process.stdout.write('retention skipped: failed\n');
    } else {
      const counts = result.retention;
      process.stdout.write(
        `retention listings=${counts.listingsDeleted} clusters=${counts.clustersDeleted} ` +
          `failures=${counts.parserFailuresPruned}\n`,
      );
    }

    if (digest === null) {
      process.stdout.write('digest skipped: unconfigured\n');
    } else if (result.digest === null) {
      process.stdout.write('digest skipped: failed\n');
    } else if (result.digest.skipped !== null) {
      process.stdout.write(`digest skipped: ${result.digest.skipped}\n`);
    } else {
      const counts = result.digest;
      process.stdout.write(
        `digest users=${counts.users} matched=${counts.matched} sent=${counts.sent} ` +
          `blocked=${counts.blocked} failed=${counts.failed}\n`,
      );
    }

    if (alerts === null) {
      process.stdout.write('alerts skipped: unconfigured\n');
    } else if (result.alerts === null) {
      process.stdout.write('alerts skipped: failed\n');
    } else if (result.alerts.skipped !== null) {
      process.stdout.write(`alerts skipped: ${result.alerts.skipped}\n`);
    } else {
      const counts = result.alerts;
      const degraded = counts.degraded.length === 0 ? 'none' : counts.degraded.join(',');
      process.stdout.write(
        `alerts sent=${counts.sent} throttled=${counts.throttled} failed=${counts.failed} ` +
          `degraded=${degraded} stale=${String(counts.stale)}\n`,
      );
    }
  } finally {
    db.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`tick failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
