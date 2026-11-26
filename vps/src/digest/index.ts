/**
 * The Дайджест module.
 *
 * Layer A (this ticket) owns the pure pieces: due-search matching, the match
 * ledger, quiet hours, and the message text. Layer B adds `runDigest`, which
 * reads due searches, calls `matchSearch` / `recordCheck`, sends the composed
 * message through the Bot API, and records success with `markSent` or a blocked
 * user with `markUndeliverable`.
 *
 * Nothing here performs network I/O.
 */

import type { UnsentMatch } from '../store/index.js';

export {
  DIGEST_INTERVAL_MS,
  DIGEST_TIME_ZONE,
  MAX_DIGEST_CARDS,
} from './constants.js';
export { isQuietTime, localMinutes } from './quiet.js';
export {
  composeDigest,
  escapeHtml,
  type ComposedDigest,
  type ComposeDigestInput,
  type DigestGroupInput,
} from './message.js';

export type { DigestLogger, DigestRunResult, RunDigestOptions } from './worker.js';

export interface DigestGroup {
  searchName: string;
  matches: UnsentMatch[];
}

/**
 * Groups unsent matches by saved search, preserving the order in which each
 * search first appears. Matches inside a group keep their input order, which
 * `unsentForUser` already sorts newest first.
 */
export function groupForDigest(matches: readonly UnsentMatch[]): DigestGroup[] {
  const groups = new Map<number, DigestGroup>();

  for (const match of matches) {
    const existing = groups.get(match.searchId);
    if (existing !== undefined) {
      existing.matches.push(match);
      continue;
    }
    groups.set(match.searchId, {
      searchName: match.searchName,
      matches: [match],
    });
  }

  return [...groups.values()];
}
