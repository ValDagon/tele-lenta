/**
 * Argument parsing for `npm -w vps run backfill -- <username> [--budget N]
 * [--force]`. Kept separate from the CLI entry point so tests can exercise it
 * without running `main()`.
 */

export const BACKFILL_USAGE = `usage: npm -w vps run backfill -- <username> [--budget N] [--force]

  <username>   Telegram username of a registered source (with or without @)
  --budget N   request budget for this run (1..50000; default TL_BACKFILL_BUDGET)
  --force      re-run a source that already has a cursor

The source row must already exist, disabled with a null cursor. On success the
command sets the cursor, enables the source, and writes one ingest_runs row.
Nothing is written when the run aborts.
`;

export class BackfillUsageError extends Error {
  override name = 'BackfillUsageError';
}

export interface ParsedBackfillArgs {
  username: string;
  /** Present only when `--budget` was given; otherwise config decides. */
  budget: number | null;
  force: boolean;
}

const MIN_BUDGET = 1;
const MAX_BUDGET = 50_000;

export function parseBackfillArgs(argv: readonly string[]): ParsedBackfillArgs {
  let username: string | null = null;
  let budget: number | null = null;
  let force = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) continue;

    if (token === '-h' || token === '--help') {
      throw new BackfillUsageError('help');
    }

    if (token === '--force') {
      if (force) throw new BackfillUsageError('duplicate flag "--force"');
      force = true;
      continue;
    }

    if (token === '--budget' || token.startsWith('--budget=')) {
      if (budget !== null) throw new BackfillUsageError('duplicate flag "--budget"');
      const raw = token === '--budget' ? argv[index + 1] : token.slice('--budget='.length);
      if (token === '--budget') index += 1;
      if (raw === undefined || raw.startsWith('--')) {
        throw new BackfillUsageError('flag "--budget" needs a value');
      }
      if (!/^\d+$/.test(raw)) {
        throw new BackfillUsageError(`--budget must be an integer, got "${raw}"`);
      }
      budget = Number(raw);
      if (budget < MIN_BUDGET || budget > MAX_BUDGET) {
        throw new BackfillUsageError(`--budget must be between ${MIN_BUDGET} and ${MAX_BUDGET}`);
      }
      continue;
    }

    if (token.startsWith('-')) {
      throw new BackfillUsageError(`unknown flag "${token}"`);
    }

    if (username !== null) {
      throw new BackfillUsageError('backfill takes exactly one username');
    }
    username = token;
  }

  if (username === null) {
    throw new BackfillUsageError('missing username');
  }

  return { username, budget, force };
}
