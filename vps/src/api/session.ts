/**
 * `POST /v1/session` — upserts the allowlisted user from the BFF's verified
 * Telegram profile and returns the session.
 *
 * The user id comes from the signed `X-TL-User` header. The body's optional
 * `id` exists only as a cross-check: when present it must equal the signed id,
 * and a mismatch is `invalid_request`, never a switch of identity.
 *
 * This route is the one `/v1/*` route exempt from the hook's allowlist check
 * (`config.tlAllowUninvited`), because an unknown or denied id still records
 * its profile so `admin list` can show who tried to get in and the owner can
 * allow them later. The handler writes the row first, then enforces the same
 * `not_invited` rule as every other route. A successful upsert never changes
 * `allowed` or the settings; it refreshes the profile and `last_seen_at` and
 * clears `digest_undeliverable_at`.
 */

import type { FastifyInstance } from 'fastify';

import { denyRequest } from '../auth/index.js';
import type { Store } from '../store/index.js';

import { invalidRequest } from './errors.js';
import type { SessionResponse } from './types.js';

/** Listings older than this are purged by retention; the Mini App states it. */
export const RETENTION_DAYS = 30;

/** The fixed v1 digest cadence (spec: 30 minutes). */
export const DIGEST_INTERVAL_SECONDS = 1_800;

const MAX_USERNAME_LENGTH = 64;
const MAX_NAME_LENGTH = 128;

interface ParsedProfile {
  /** Absent when the BFF did not send the id; the signed header is authoritative. */
  claimedId: number | null;
  username: string | null;
  firstName: string | null;
}

function optionalText(
  value: unknown,
  field: string,
  maxLength: number,
): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw invalidRequest(`${field} must be a string`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw invalidRequest(`${field} must be at most ${maxLength} characters`);
  }
  return trimmed === '' ? null : trimmed;
}

function parseProfile(body: unknown): ParsedProfile {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw invalidRequest('body must be a JSON object');
  }
  const raw = body as Record<string, unknown>;

  let claimedId: number | null = null;
  if (raw.id !== undefined && raw.id !== null) {
    if (
      typeof raw.id !== 'number' ||
      !Number.isSafeInteger(raw.id) ||
      raw.id <= 0
    ) {
      throw invalidRequest('id must be a positive Telegram user id');
    }
    claimedId = raw.id;
  }

  return {
    claimedId,
    username: optionalText(raw.username, 'username', MAX_USERNAME_LENGTH),
    firstName: optionalText(raw.first_name, 'first_name', MAX_NAME_LENGTH),
  };
}

export interface SessionRouteOptions {
  /** Injected clock in milliseconds; production passes `Date.now`. */
  now: () => number;
}

export function registerSessionRoutes(
  app: FastifyInstance,
  store: Store,
  options: SessionRouteOptions,
): void {
  app.post(
    '/v1/session',
    { config: { tlAllowUninvited: true } },
    async (request): Promise<SessionResponse> => {
      const telegramUserId = request.tlTelegramUserId;
      if (telegramUserId === undefined) {
        // The auth hook always sets this for `/v1/*`; reaching here is a bug.
        throw new Error('auth hook did not bind a Telegram user id');
      }

      const profile = parseProfile(request.body);
      if (profile.claimedId !== null && profile.claimedId !== telegramUserId) {
        throw invalidRequest('body id does not match the signed user');
      }

      const user = store.users.upsertProfile({
        telegramUserId,
        username: profile.username,
        firstName: profile.firstName,
        at: new Date(options.now()).toISOString(),
      });

      if (!user.allowed) {
        denyRequest(request, {
          code: 'not_invited',
          statusCode: 403,
          message: 'this Telegram account is not invited',
          telegramUserId,
          displayName: user.firstName ?? user.username ?? null,
        });
      }

      return {
        allowed: true,
        settings: {
          digest_enabled: user.digestEnabled,
          quiet_start: user.quietStart,
          quiet_end: user.quietEnd,
          spam_filter: user.spamFilter,
          ad_filter: user.adFilter,
        },
        enabled_source_count: store.sources.listEnabled().length,
        retention_days: RETENTION_DAYS,
        digest_interval_seconds: DIGEST_INTERVAL_SECONDS,
      };
    },
  );
}
