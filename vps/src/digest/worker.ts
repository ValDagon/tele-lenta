/**
 * The Дайджест worker: one pass over the due saved searches, one message per
 * user.
 *
 * Layer A owns matching, quiet hours, and the message text. This module wires
 * them to the store and the Bot API:
 *
 * 1. `listDue` selects enabled searches for allowed users whose digests are on
 *    and whose `last_checked_at` is at least thirty minutes old.
 * 2. Every due search is checked and its `last_checked_at` advances, even in
 *    quiet hours and even when nothing matches. That is what makes the next
 *    window start where this one ended.
 * 3. Outside quiet hours, the user's still-unsent rows become one message.
 *    `sent` stamps them; `blocked` remembers the user cannot be reached;
 *    `retry`/`fatal` leave the rows alone for the next tick.
 *
 * One user's failure never stops the next user. The sender owns the 30/1s
 * pacing, so users are processed sequentially.
 */

import type { BotSender } from '../bot/index.js';
import type { Store } from '../store/index.js';

import { DIGEST_INTERVAL_MS, MAX_DIGEST_CARDS, DIGEST_TIME_ZONE } from './constants.js';
import { composeDigest, groupForDigest } from './index.js';
import { isQuietTime } from './quiet.js';

export interface DigestRunResult {
  skipped: 'unconfigured' | 'disabled' | null;
  users: number;
  matched: number;
  sent: number;
  blocked: number;
  failed: number;
}

export interface DigestLogger {
  info(message: string): void;
  warn(message: string): void;
}

export interface RunDigestOptions {
  store: Store;
  sender: BotSender | null;
  botUsername: string | null;
  /** Epoch ms; defaults to `Date.now`, injectable for deterministic tests. */
  now?: () => number;
  logger?: DigestLogger;
}

const silentLogger: DigestLogger = { info: () => {}, warn: () => {} };

/**
 * Runs one digest pass. Returns counters for the CLI line; it never throws for
 * a per-user or per-send failure.
 */
export async function runDigest(options: RunDigestOptions): Promise<DigestRunResult> {
  const result: DigestRunResult = {
    skipped: null,
    users: 0,
    matched: 0,
    sent: 0,
    blocked: 0,
    failed: 0,
  };

  if (options.sender === null || options.botUsername === null) {
    result.skipped = 'unconfigured';
    return result;
  }

  const nowMs = options.now ?? Date.now;
  const nowIso = new Date(nowMs()).toISOString();
  const due = options.store.digests.listDue(nowIso, DIGEST_INTERVAL_MS);
  if (due.length === 0) {
    result.skipped = 'disabled';
    return result;
  }

  const byUser = new Map<number, typeof due>();
  for (const search of due) {
    const existing = byUser.get(search.userId);
    if (existing === undefined) {
      byUser.set(search.userId, [search]);
    } else {
      existing.push(search);
    }
  }

  const { sender, botUsername } = options;
  const logger = options.logger ?? silentLogger;

  for (const [userId, searches] of byUser) {
    result.users += 1;

    try {
      for (const search of searches) {
        const candidates = options.store.digests.matchSearch(
          search,
          search.lastCheckedAt,
          nowIso,
        );
        options.store.digests.recordCheck(search.id, candidates, nowIso);
        result.matched += candidates.length;
      }

      const window = searches[0];
      if (window === undefined) continue;
      if (
        isQuietTime(window.quietStart, window.quietEnd, nowIso, DIGEST_TIME_ZONE)
      ) {
        continue;
      }

      const unsent = options.store.digests.unsentForUser(userId);
      if (unsent.length === 0) continue;

      const user = options.store.users.get(userId);
      const message = composeDigest({
        userName: user?.firstName ?? null,
        groups: groupForDigest(unsent),
        botUsername,
        limit: MAX_DIGEST_CARDS,
      });
      if (message.html === '') continue;

      const send = await sender.sendMessage(userId, message.html);
      if (send.status === 'sent') {
        options.store.digests.markSent(
          userId,
          searches.map((search) => search.id),
          message.clusterIds,
          nowIso,
        );
        result.sent += 1;
      } else if (send.status === 'blocked') {
        options.store.digests.markUndeliverable(userId, nowIso);
        result.blocked += 1;
        logger.warn(`digest user=${userId} blocked`);
      } else {
        result.failed += 1;
        logger.warn(`digest user=${userId} send=${send.status}`);
      }
    } catch (error) {
      result.failed += 1;
      logger.warn(
        `digest user=${userId} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  logger.info(
    `digest users=${result.users} matched=${result.matched} sent=${result.sent} ` +
      `blocked=${result.blocked} failed=${result.failed}`,
  );
  return result;
}
