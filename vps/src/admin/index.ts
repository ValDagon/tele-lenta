/**
 * The `admin` command surface: `list`, `allow`, `deny`, and `forget` over the
 * `users` allowlist (spec «API and auth», ticket #6). It is a VPS-local CLI,
 * never a Serverless bot handler, and it refuses to run unless
 * `TL_OWNER_TELEGRAM_ID` is configured — the owner check is a local comparison
 * against configuration, not a remote call.
 *
 * All testable logic lives in `runAdmin`, which takes the store, config, and
 * output writers directly. The CLI entry point only loads config, opens the
 * database, and maps the returned exit code. Commands are parsed and validated
 * completely before the store is touched, so a bad id or flag writes nothing.
 */

import type { Config } from '../config.js';
import type { Store } from '../store/index.js';

/** Writes one chunk of command output; the CLI passes `process.stdout.write`. */
export type Write = (text: string) => void;

export interface AdminDeps {
  store: Store;
  config: Pick<Config, 'ownerTelegramId'>;
  stdout: Write;
  /** Defaults to discarding; the CLI passes `process.stderr.write`. */
  stderr?: Write;
}

export interface AdminResult {
  exitCode: 0 | 1;
}

export const ADMIN_USAGE = `usage: npm -w vps run admin -- <command>

commands:
  list                              print the allowlist (no secrets)
  allow <id> [--username <name>] [--first-name <name>]
                                    allow an id, creating the row if needed
  deny <id>                         keep the row but block access
  forget <id>                       delete the user, saved searches, and digest matches

The CLI needs TL_OWNER_TELEGRAM_ID in the environment; without it every
command is refused.
`;

const TELEGRAM_ID = /^[1-9]\d{0,15}$/;

const MAX_USERNAME_LENGTH = 64;
const MAX_NAME_LENGTH = 128;

class AdminError extends Error {
  override name = 'AdminError';
}

function fail(message: string): never {
  throw new AdminError(message);
}

interface Command {
  name: 'list' | 'allow' | 'deny' | 'forget' | 'help';
  positionals: string[];
  flags: Map<string, string>;
}

const ALLOWED_FLAGS: Record<Command['name'], readonly string[]> = {
  list: [],
  allow: ['username', 'first-name'],
  deny: [],
  forget: [],
  help: [],
};

const POSITIONAL_COUNT: Record<Command['name'], number> = {
  list: 0,
  allow: 1,
  deny: 1,
  forget: 1,
  help: 0,
};

function parseCommand(argv: readonly string[]): Command {
  const first = argv[0];
  if (first === undefined) fail('missing command');
  if (first === '-h' || first === '--help') {
    return { name: 'help', positionals: [], flags: new Map() };
  }
  if (!['list', 'allow', 'deny', 'forget', 'help'].includes(first)) {
    fail(`unknown command "${first}"`);
  }
  const name = first as Command['name'];
  const allowed = ALLOWED_FLAGS[name];

  const positionals: string[] = [];
  const flags = new Map<string, string>();

  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) continue;

    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }

    const body = token.slice(2);
    const equals = body.indexOf('=');
    const flag = equals === -1 ? body : body.slice(0, equals);
    if (!allowed.includes(flag)) {
      fail(`unknown flag "--${flag}" for "${name}"`);
    }
    if (flags.has(flag)) {
      fail(`duplicate flag "--${flag}"`);
    }

    let value: string | undefined;
    if (equals !== -1) {
      value = body.slice(equals + 1);
    } else {
      value = argv[index + 1];
      index += 1;
    }
    if (value === undefined || value.startsWith('--')) {
      fail(`flag "--${flag}" needs a value`);
    }
    flags.set(flag, value);
  }

  const expected = POSITIONAL_COUNT[name];
  if (positionals.length !== expected) {
    fail(
      expected === 1
        ? `"${name}" takes exactly one Telegram id`
        : `"${name}" takes no arguments`,
    );
  }

  return { name, positionals, flags };
}

function parseTelegramId(raw: string): number {
  if (!TELEGRAM_ID.test(raw)) {
    fail(`"${raw}" is not a positive Telegram user id`);
  }
  const id = Number(raw);
  if (!Number.isSafeInteger(id)) {
    fail(`"${raw}" is not a positive Telegram user id`);
  }
  return id;
}

function displayValue(value: string | null): string {
  return value === null || value === '' ? '-' : value;
}

/** A profile field is trimmed, length-capped, and empty becomes "not given". */
function parseProfileField(flags: Map<string, string>, flag: string, maxLength: number): string | null {
  const raw = flags.get(flag);
  if (raw === undefined) return null;
  const value = raw.trim();
  if (value === '') fail(`--${flag} must not be empty`);
  if (value.length > maxLength) {
    fail(`--${flag} must be at most ${maxLength} characters`);
  }
  return value;
}

function execute(command: Command, deps: AdminDeps): void {
  const { store, stdout } = deps;
  const now = new Date().toISOString();

  switch (command.name) {
    case 'help':
      stdout(ADMIN_USAGE);
      return;

    case 'list': {
      const users = store.users.list();
      const lines = ['telegram_id\tusername\tfirst_name\tallowed\tcreated_at'];
      for (const user of users) {
        lines.push(
          [
            String(user.telegramUserId),
            displayValue(user.username),
            displayValue(user.firstName),
            user.allowed ? 'yes' : 'no',
            user.createdAt,
          ].join('\t'),
        );
      }
      stdout(`${lines.join('\n')}\n`);
      return;
    }

    case 'allow': {
      const rawId = command.positionals[0];
      if (rawId === undefined) fail('missing Telegram id');
      const id = parseTelegramId(rawId);
      const username = parseProfileField(command.flags, 'username', MAX_USERNAME_LENGTH);
      const firstName = parseProfileField(command.flags, 'first-name', MAX_NAME_LENGTH);

      store.users.allow(id, { at: now, username, firstName });
      stdout(`allowed ${id}\n`);
      return;
    }

    case 'deny': {
      const rawId = command.positionals[0];
      if (rawId === undefined) fail('missing Telegram id');
      const id = parseTelegramId(rawId);
      if (!store.users.deny(id)) {
        fail(`user ${id} does not exist; "allow ${id}" creates it`);
      }
      stdout(`denied ${id}\n`);
      return;
    }

    case 'forget': {
      const rawId = command.positionals[0];
      if (rawId === undefined) fail('missing Telegram id');
      const id = parseTelegramId(rawId);
      const counts = store.users.forget(id);
      if (counts.users === 0) {
        fail(`user ${id} does not exist`);
      }
      stdout(
        `forgot ${id} users=${counts.users} saved_searches=${counts.savedSearches} ` +
          `saved_search_matches=${counts.savedSearchMatches}\n`,
      );
      return;
    }
  }
}

/**
 * Runs one admin command and returns its exit code. Expected failures — a bad
 * id, an unknown flag, a missing row, an unconfigured owner id — write a single
 * `error:` line to stderr and return 1; they never throw and never write.
 */
export function runAdmin(argv: readonly string[], deps: AdminDeps): AdminResult {
  const stderr = deps.stderr ?? (() => {});

  if (deps.config.ownerTelegramId === null) {
    stderr(
      'error: TL_OWNER_TELEGRAM_ID is not configured; admin commands are refused\n',
    );
    return { exitCode: 1 };
  }

  try {
    const command = parseCommand(argv);
    execute(command, deps);
    return { exitCode: 0 };
  } catch (error) {
    if (error instanceof AdminError) {
      stderr(`error: ${error.message}\n`);
      if (argv[0] === undefined) stderr(ADMIN_USAGE);
      return { exitCode: 1 };
    }
    throw error;
  }
}
