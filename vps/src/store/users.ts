/**
 * The allowlist and per-user session settings. The VPS `users` table is the
 * source of truth for access (spec «API and auth»): every `/v1/*` request loads
 * one row and denies it when `allowed` is false. `admin allow|deny|list|forget`
 * (ticket #6) and `POST /v1/session` are the only writers.
 *
 * A row starts with `allowed = 0`. A session request for an unknown id records
 * the profile with `upsertProfile` so the owner can see who tried to get in and
 * allow them later; the session itself still answers `not_invited` until then.
 */

import type { Db } from '../db.js';

import { USER_COLUMNS, nowIso, toUser, toUserSettings, type UserRow } from './rows.js';
import type { User, UserProfileInput, UserSettings } from './types.js';

/** What `admin allow` may set on the row it turns on. */
export interface AllowUserOptions {
  /** Injected clock; defaults to the current time. */
  at?: string;
  username?: string | null;
  firstName?: string | null;
}

/**
 * The rows `admin forget` removed. Every count is the number of rows deleted
 * in the same transaction, so a second forget reports zeros.
 */
export interface ForgetResult {
  users: number;
  savedSearches: number;
  savedSearchMatches: number;
}

export interface UserStore {
  get(telegramUserId: number): User | null;
  /**
   * Inserts the profile with `allowed = 0` when the id is unknown, or refreshes
   * username/first name and `last_seen_at` when it exists. It never changes
   * `allowed` or the settings, and a successful upsert clears
   * `digest_undeliverable_at` (the bot retries a returning user).
   */
  upsertProfile(input: UserProfileInput): User;
  /** Turns the allowlist on or off; false when no row exists. */
  setAllowed(telegramUserId: number, allowed: boolean): boolean;
  /**
   * Allows an id, creating the row when it does not exist yet. Display fields
   * are updated only when supplied; a missing profile never clears a stored one.
   */
  allow(telegramUserId: number, options?: AllowUserOptions): boolean;
  /** Blocks an existing id; false when no row exists. */
  deny(telegramUserId: number): boolean;
  list(): User[];
  /**
   * `admin forget`: removes the user, their saved searches, and their digest
   * matches in one transaction and reports how many rows of each were removed.
   * The user's own settings row is deleted too, so a returning id is a stranger.
   */
  forget(telegramUserId: number): ForgetResult;
  /**
   * The digest/filter settings of an existing row. `null` when the id has no
   * row: the store never invents defaults for a user it does not know.
   */
  getSettings(telegramUserId: number): UserSettings | null;
  /**
   * Partial settings update: omitted keys keep their stored value, and
   * `allowed` and the profile columns are never touched. `null` when the id
   * has no row.
   */
  updateSettings(
    telegramUserId: number,
    patch: Partial<UserSettings>,
  ): UserSettings | null;
}

export function createUserStore(db: Db): UserStore {
  const selectById = db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE telegram_user_id = ?`);
  const selectAll = db.prepare(`SELECT ${USER_COLUMNS} FROM users ORDER BY telegram_user_id`);

  // The profile upsert is the session path: it may create a denied row, but it
  // must never grant access or overwrite settings.
  const upsert = db.prepare(`
    INSERT INTO users
      (telegram_user_id, username, first_name, allowed, created_at, last_seen_at)
    VALUES (?, ?, ?, 0, ?, ?)
    ON CONFLICT (telegram_user_id) DO UPDATE SET
      username = excluded.username,
      first_name = excluded.first_name,
      last_seen_at = excluded.last_seen_at,
      digest_undeliverable_at = NULL
  `);
  const updateAllowed = db.prepare(
    'UPDATE users SET allowed = ? WHERE telegram_user_id = ?',
  );
  const insertAllowed = db.prepare(`
    INSERT INTO users (telegram_user_id, username, first_name, allowed, created_at)
    VALUES (?, ?, ?, 1, ?)
    ON CONFLICT (telegram_user_id) DO UPDATE SET
      allowed = 1,
      username = COALESCE(excluded.username, users.username),
      first_name = COALESCE(excluded.first_name, users.first_name)
  `);
  const updateSettingsRow = db.prepare(`
    UPDATE users SET
      digest_enabled = COALESCE(?, digest_enabled),
      quiet_start = COALESCE(?, quiet_start),
      quiet_end = COALESCE(?, quiet_end),
      spam_filter = COALESCE(?, spam_filter),
      ad_filter = COALESCE(?, ad_filter)
    WHERE telegram_user_id = ?
  `);
  const remove = db.prepare('DELETE FROM users WHERE telegram_user_id = ?');
  const removeMatches = db.prepare(`
    DELETE FROM saved_search_matches
    WHERE saved_search_id IN (SELECT id FROM saved_searches WHERE user_id = ?)
  `);
  const removeSearches = db.prepare('DELETE FROM saved_searches WHERE user_id = ?');

  // Explicit deletes rather than relying only on the foreign-key cascade keep
  // the counts exact and make the erasure work even if a connection is opened
  // without `foreign_keys = ON`. All three run in one transaction.
  const forgetUser = db.transaction((telegramUserId: number): ForgetResult => {
    const matches = removeMatches.run(telegramUserId).changes;
    const searches = removeSearches.run(telegramUserId).changes;
    const users = remove.run(telegramUserId).changes;
    return {
      users,
      savedSearches: searches,
      savedSearchMatches: matches,
    };
  });

  const get = (telegramUserId: number): User | null => {
    const row = selectById.get(telegramUserId) as UserRow | undefined;
    return row === undefined ? null : toUser(row);
  };

  const userStore: UserStore = {
    get,
    upsertProfile(input: UserProfileInput): User {
      upsert.run(
        input.telegramUserId,
        input.username ?? null,
        input.firstName ?? null,
        input.at,
        input.at,
      );
      const row = get(input.telegramUserId);
      // The upsert just wrote the row; a missing read is a programming error.
      if (row === null) throw new Error('user row disappeared during upsert');
      return row;
    },
    setAllowed(telegramUserId: number, allowed: boolean): boolean {
      const result = updateAllowed.run(allowed ? 1 : 0, telegramUserId);
      return result.changes > 0;
    },
    allow(telegramUserId: number, options: AllowUserOptions = {}): boolean {
      const result = insertAllowed.run(
        telegramUserId,
        options.username ?? null,
        options.firstName ?? null,
        options.at ?? nowIso(),
      );
      return result.changes > 0;
    },
    deny(telegramUserId: number): boolean {
      const result = updateAllowed.run(0, telegramUserId);
      return result.changes > 0;
    },
    list(): User[] {
      return (selectAll.all() as UserRow[]).map(toUser);
    },
    forget(telegramUserId: number): ForgetResult {
      return forgetUser(telegramUserId);
    },
    getSettings(telegramUserId: number): UserSettings | null {
      const row = selectById.get(telegramUserId) as UserRow | undefined;
      return row === undefined ? null : toUserSettings(row);
    },
    updateSettings(
      telegramUserId: number,
      patch: Partial<UserSettings>,
    ): UserSettings | null {
      const result = updateSettingsRow.run(
        patch.digestEnabled === undefined ? null : patch.digestEnabled ? 1 : 0,
        patch.quietStart ?? null,
        patch.quietEnd ?? null,
        patch.spamFilter === undefined ? null : patch.spamFilter ? 1 : 0,
        patch.adFilter === undefined ? null : patch.adFilter ? 1 : 0,
        telegramUserId,
      );
      if (result.changes === 0) return null;
      return userStore.getSettings(telegramUserId);
    },
  };

  return userStore;
}
