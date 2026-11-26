/**
 * `GET|PATCH /v1/me` — the reader's digest switch, quiet hours, and filters.
 *
 * The allowlist hook has already loaded and admitted the user, so identity and
 * settings come from the same `users` row. `allowed` is read-only here: only
 * the VPS CLI (`admin allow|deny`) changes access, and a body key named
 * `allowed` is ignored like any other unknown key.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';

import type { Store, User, UserSettings } from '../store/index.js';

import { ApiError, invalidRequest } from './errors.js';
import type { MeResponse } from './types.js';

/** Quiet hours are wall-clock `HH:MM`, 00:00–23:59. */
const QUIET_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function parseQuietTime(value: unknown, field: string): string {
  if (typeof value !== 'string' || !QUIET_TIME.test(value)) {
    throw invalidRequest(`${field} must be a HH:MM time between 00:00 and 23:59`);
  }
  return value;
}

function parseBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw invalidRequest(`${field} must be a boolean`);
  return value;
}

function requireObject(body: unknown): Record<string, unknown> {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw invalidRequest('body must be a JSON object');
  }
  return body as Record<string, unknown>;
}

function present(body: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key) && body[key] !== undefined;
}

/** Only present keys are returned, so the store leaves the rest alone. */
function parseSettingsPatch(body: unknown): Partial<UserSettings> {
  const raw = requireObject(body);
  const patch: Partial<UserSettings> = {};

  if (present(raw, 'digest_enabled')) {
    patch.digestEnabled = parseBoolean(raw.digest_enabled, 'digest_enabled');
  }
  if (present(raw, 'quiet_start')) {
    patch.quietStart = parseQuietTime(raw.quiet_start, 'quiet_start');
  }
  if (present(raw, 'quiet_end')) {
    patch.quietEnd = parseQuietTime(raw.quiet_end, 'quiet_end');
  }
  if (present(raw, 'spam_filter')) {
    patch.spamFilter = parseBoolean(raw.spam_filter, 'spam_filter');
  }
  if (present(raw, 'ad_filter')) {
    patch.adFilter = parseBoolean(raw.ad_filter, 'ad_filter');
  }

  return patch;
}

function toResponse(user: User): MeResponse {
  return {
    telegram_user_id: user.telegramUserId,
    username: user.username,
    first_name: user.firstName,
    allowed: user.allowed,
    digest_enabled: user.digestEnabled,
    quiet_start: user.quietStart,
    quiet_end: user.quietEnd,
    spam_filter: user.spamFilter,
    ad_filter: user.adFilter,
  };
}

function userOf(request: FastifyRequest): User {
  const user = request.tlUser;
  if (user === undefined) {
    // The hook admits only allowed ids; a missing row here is a bug or a
    // deletion between the hook and the handler.
    throw new ApiError('not_invited', 'this Telegram account is not invited', 403);
  }
  return user;
}

export function registerMeRoutes(app: FastifyInstance, store: Store): void {
  app.get('/v1/me', async (request): Promise<MeResponse> => toResponse(userOf(request)));

  app.patch('/v1/me', async (request): Promise<MeResponse> => {
    const user = userOf(request);
    const updated = store.users.updateSettings(
      user.telegramUserId,
      parseSettingsPatch(request.body),
    );
    if (updated === null) {
      throw new ApiError('not_found', 'user not found', 404);
    }
    return toResponse({ ...user, ...updated });
  });
}
