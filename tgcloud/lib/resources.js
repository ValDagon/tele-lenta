/**
 * Mini App input → VPS request mapping.
 *
 * The BFF is a thin authenticated proxy (ADR-0003). This module holds the only
 * translation between the Mini App's JSON bodies and the VPS's request targets
 * and methods, and it is pure: no `sdk`, no network, no database, so Node tests
 * exercise it directly.
 *
 * Rules:
 *
 * - Targets are the exact path plus query the upstream MAC covers. Build the
 *   query once here; the endpoint must never rebuild it.
 * - Feed filters use a fixed parameter order (section, category, demand,
 *   sources, q, cursor, limit) and percent-encode every value. `sources` is
 *   repeated, one parameter per id, not comma-joined.
 * - Absent values (`null`, `undefined`, the empty string) are omitted. `0` is a
 *   real value: `limit=0` asks the VPS for a count only.
 * - The identity comes only from the platform-verified `ctx.initData.user` or
 *   from `initData` re-verified here. No other request field is ever read as a
 *   user id.
 */

import { ERROR_CODES, EndpointError } from './errors.js';
import { verifyInitData } from './initdata.js';

const ACTIONS_SAVED_SEARCHES = Object.freeze(['list', 'create', 'update', 'delete']);
const ACTIONS_ME = Object.freeze(['get', 'update']);

function invalidRequest(message) {
  return new EndpointError(ERROR_CODES.INVALID_REQUEST, message);
}

function isPresent(value) {
  return value !== undefined && value !== null && value !== '';
}

function appendParam(parts, name, value) {
  if (!isPresent(value)) return;
  parts.push(`${name}=${encodeURIComponent(String(value))}`);
}

function actionOf(input, allowed, resource) {
  const action = input && typeof input === 'object' ? input.action : undefined;
  if (typeof action !== 'string' || !allowed.includes(action)) {
    throw invalidRequest(`${resource} action must be one of ${allowed.join(', ')}`);
  }
  return action;
}

function idSegment(id, resource) {
  if (!isPresent(id)) throw invalidRequest(`${resource} requires an id`);
  return encodeURIComponent(String(id));
}

/**
 * `/v1/feed` with the filter set in a deterministic order.
 *
 * @param {{
 *   section?: string | null,
 *   category?: string | null,
 *   demand?: string | null,
 *   sources?: Array<string | number> | string | number | null,
 *   q?: string | null,
 *   cursor?: string | null,
 *   limit?: string | number | null,
 * }} [input]
 * @returns {string}
 */
export function feedTarget(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const parts = [];

  appendParam(parts, 'section', source.section);
  appendParam(parts, 'category', source.category);
  appendParam(parts, 'demand', source.demand);

  const sources = Array.isArray(source.sources)
    ? source.sources
    : isPresent(source.sources)
      ? [source.sources]
      : [];
  for (const value of sources) appendParam(parts, 'sources', value);

  appendParam(parts, 'q', source.q);
  appendParam(parts, 'cursor', source.cursor);
  appendParam(parts, 'limit', source.limit);

  return parts.length === 0 ? '/v1/feed' : `/v1/feed?${parts.join('&')}`;
}

/** `/v1/cards/{id}`; the id is a cluster id, percent-encoded as one segment. */
export function cardTarget(id) {
  return `/v1/cards/${idSegment(id, 'card')}`;
}

/** `GET /v1/sources`. */
export function sourcesTarget() {
  return '/v1/sources';
}

/** `POST /v1/session`. */
export function sessionTarget() {
  return '/v1/session';
}

/** The session body: the verified Telegram profile, never a claimed id alone. */
export function sessionBody(user) {
  const userId = normalizeUserId(user);
  if (userId === null) throw new EndpointError(ERROR_CODES.INIT_DATA_INVALID);
  const body = { id: userId };
  if (typeof user.username === 'string' && user.username !== '') body.username = user.username;
  if (typeof user.first_name === 'string' && user.first_name !== '') {
    body.first_name = user.first_name;
  }
  return body;
}

/**
 * `GET|PATCH|DELETE /v1/saved-searches[/{id}]`.
 *
 * The VPS answers `not_found` for every action until its saved-search routes
 * land (ticket #15). The mapping stays correct so the Mini App needs no change.
 */
export function savedSearchesTarget(input = {}) {
  const action = actionOf(input, ACTIONS_SAVED_SEARCHES, 'saved-searches');
  const base = '/v1/saved-searches';
  if (action === 'list' || action === 'create') return base;
  return `${base}/${idSegment(input.id, 'saved-searches')}`;
}

/** Method for the matching `savedSearchesTarget` action. */
export function savedSearchesMethod(input = {}) {
  const action = actionOf(input, ACTIONS_SAVED_SEARCHES, 'saved-searches');
  switch (action) {
    case 'list':
      return 'GET';
    case 'create':
      return 'POST';
    case 'update':
      return 'PATCH';
    case 'delete':
      return 'DELETE';
    default:
      // Unreachable: actionOf already rejected anything else.
      throw invalidRequest('unknown saved-searches action');
  }
}

/** `GET|PATCH /v1/me`; the VPS answers `not_found` until ticket #15. */
export function meTarget(input = {}) {
  actionOf(input, ACTIONS_ME, 'me');
  return '/v1/me';
}

/** Method for the matching `meTarget` action. */
export function meMethod(input = {}) {
  const action = actionOf(input, ACTIONS_ME, 'me');
  return action === 'get' ? 'GET' : 'PATCH';
}

function normalizeUserId(user) {
  if (!user || typeof user !== 'object') return null;
  if (typeof user.id === 'number') {
    return Number.isSafeInteger(user.id) && user.id > 0 ? user.id : null;
  }
  if (typeof user.id === 'string' && /^\d+$/.test(user.id)) {
    const parsed = Number(user.id);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

/**
 * Resolves the verified Telegram user for one endpoint call.
 *
 * Two paths (ADR-0005):
 *
 * 1. `input.initData` is a string and a bot token is configured — re-verify the
 *    payload here with `verifyInitData` and use its user. A failure throws the
 *    verification code and never falls back to `ctx`.
 * 2. Otherwise use the platform-verified `ctx.initData.user`.
 *
 * A missing user or user id is `init_data_invalid`. No other field of `input`
 * (`id`, `user_id`, …) is ever consulted.
 *
 * @param {{ initData?: { user?: unknown } } | undefined} ctx platform context
 * @param {unknown} input the Mini App's JSON body
 * @param {{ botToken?: string, now?: number }} [options] `now` is epoch ms
 * @returns {Record<string, unknown> & { id: number }}
 */
export function identity(ctx, input, options = {}) {
  const body = input && typeof input === 'object' ? input : {};
  const botToken = options.botToken;

  if (
    typeof body.initData === 'string' &&
    body.initData.length > 0 &&
    typeof botToken === 'string' &&
    botToken.length > 0
  ) {
    const verified = verifyInitData(
      body.initData,
      botToken,
      options.now === undefined ? {} : { now: options.now },
    );
    if (!verified.ok) throw new EndpointError(verified.code);
    return verified.user;
  }

  const candidate = ctx && ctx.initData ? ctx.initData.user : undefined;
  const userId = normalizeUserId(candidate);
  if (userId === null) throw new EndpointError(ERROR_CODES.INIT_DATA_INVALID);

  return { ...candidate, id: userId };
}
