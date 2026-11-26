/**
 * Digest constants shared by the worker (layer B) and the message composer.
 *
 * They live in their own module rather than in `api/session.ts` so the minute
 * tick can import them without pulling the API surface into the worker.
 */

/**
 * One digest check per saved search every 30 minutes (spec «Bot and digest»).
 * The search is due when `last_checked_at <= now - DIGEST_INTERVAL_MS`.
 */
export const DIGEST_INTERVAL_MS = 30 * 60 * 1000;

/** The total card cap of one digest message; the rest becomes «и ещё N». */
export const MAX_DIGEST_CARDS = 10;

export { DIGEST_TIME_ZONE } from './quiet.js';
