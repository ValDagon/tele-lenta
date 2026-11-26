/**
 * `GET|POST /v1/saved-searches` and `PATCH|DELETE /v1/saved-searches/{id}`.
 *
 * The list answers a bare JSON array, because the Mini App's client returns
 * `SavedSearch[]` and the BFF forwards the VPS body unchanged. Create answers
 * `201` with the new row, patch `200` with the updated row, and delete `200`
 * with `{ deleted: true }`; a missing or foreign id is `not_found`.
 *
 * The user is always the signed `X-TL-User`: the body never names a user. All
 * validation lives here, so the store receives a fully formed input; an
 * unknown body key is ignored, as on the other routes.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';

import { CATEGORIES } from '../ingest/facets.js';
import type {
  SavedSearch,
  SavedSearchInput,
  SavedSearchPatch,
  Section,
  Store,
} from '../store/index.js';

import { invalidRequest, notFound } from './errors.js';
import { parseSavedSearchId } from './params.js';
import type { DeleteSavedSearchResponse, SavedSearch as SavedSearchResponse } from './types.js';

const MAX_NAME_LENGTH = 80;
const MAX_QUERY_LENGTH = 100;
const MAX_SOURCES = 50;
const SECTIONS: readonly Section[] = ['classifieds', 'jobs', 'events'];
const DEMANDS = ['offer', 'wanted'] as const;

type Demand = (typeof DEMANDS)[number];
type Body = Record<string, unknown>;

function requireObject(body: unknown): Body {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw invalidRequest('body must be a JSON object');
  }
  return body as Body;
}

function present(body: Body, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key) && body[key] !== undefined;
}

function parseName(value: unknown): string {
  if (typeof value !== 'string') throw invalidRequest('name must be a string');
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_NAME_LENGTH) {
    throw invalidRequest(`name must be 1..${MAX_NAME_LENGTH} characters`);
  }
  return trimmed;
}

/** `null` reads as "no query", the same as an empty string. */
function parseQuery(value: unknown): string {
  if (value === null) return '';
  if (typeof value !== 'string') throw invalidRequest('query must be a string');
  const trimmed = value.trim();
  if (trimmed.length > MAX_QUERY_LENGTH) {
    throw invalidRequest(`query must be at most ${MAX_QUERY_LENGTH} characters`);
  }
  return trimmed;
}

function parseSectionValue(value: unknown): Section | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !SECTIONS.includes(value as Section)) {
    throw invalidRequest('section must be one of classifieds, jobs, events, or null');
  }
  return value as Section;
}

function parseCategories(value: unknown): string[] {
  if (!Array.isArray(value)) throw invalidRequest('categories must be an array');
  const known = CATEGORIES as readonly string[];
  const categories: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || !known.includes(item)) {
      throw invalidRequest(`categories must contain only: ${known.join(', ')}`);
    }
    if (!categories.includes(item)) categories.push(item);
  }
  return categories;
}

function parseDemand(value: unknown): Demand | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !DEMANDS.includes(value as Demand)) {
    throw invalidRequest('demand must be offer, wanted, or null');
  }
  return value as Demand;
}

function parseSources(value: unknown): number[] {
  if (!Array.isArray(value)) throw invalidRequest('sources must be an array');
  const sources: number[] = [];
  for (const item of value) {
    if (typeof item !== 'number' || !Number.isSafeInteger(item) || item <= 0) {
      throw invalidRequest('sources must be positive integer source ids');
    }
    if (!sources.includes(item)) sources.push(item);
  }
  if (sources.length > MAX_SOURCES) {
    throw invalidRequest(`sources must hold at most ${MAX_SOURCES} ids`);
  }
  return sources;
}

function parseEnabled(value: unknown): boolean {
  if (typeof value !== 'boolean') throw invalidRequest('enabled must be a boolean');
  return value;
}

/** A create body: `name` is required, every other field takes its default. */
function parseCreate(body: unknown): SavedSearchInput {
  const raw = requireObject(body);
  if (!present(raw, 'name')) throw invalidRequest('name is required');

  return {
    name: parseName(raw.name),
    query: present(raw, 'query') ? parseQuery(raw.query) : '',
    section: present(raw, 'section') ? parseSectionValue(raw.section) : null,
    categories: present(raw, 'categories') ? parseCategories(raw.categories) : [],
    demand: present(raw, 'demand') ? parseDemand(raw.demand) : null,
    sources: present(raw, 'sources') ? parseSources(raw.sources) : [],
    enabled: present(raw, 'enabled') ? parseEnabled(raw.enabled) : true,
  };
}

/** A patch body: only present keys appear in the result. */
function parsePatch(body: unknown): SavedSearchPatch {
  const raw = requireObject(body);
  const patch: SavedSearchPatch = {};

  if (present(raw, 'name')) patch.name = parseName(raw.name);
  if (present(raw, 'query')) patch.query = parseQuery(raw.query);
  if (present(raw, 'section')) patch.section = parseSectionValue(raw.section);
  if (present(raw, 'categories')) patch.categories = parseCategories(raw.categories);
  if (present(raw, 'demand')) patch.demand = parseDemand(raw.demand);
  if (present(raw, 'sources')) patch.sources = parseSources(raw.sources);
  if (present(raw, 'enabled')) patch.enabled = parseEnabled(raw.enabled);

  return patch;
}

/** Drops the internal `userId` so the wire shape matches the Mini App's type. */
function toResponse(search: SavedSearch): SavedSearchResponse {
  return {
    id: search.id,
    name: search.name,
    query: search.query,
    section: search.section,
    categories: search.categories,
    demand: search.demand,
    sources: search.sources,
    enabled: search.enabled,
    last_checked_at: search.lastCheckedAt,
    last_sent_at: search.lastSentAt,
    created_at: search.createdAt,
  };
}

function userIdOf(request: FastifyRequest): number {
  const userId = request.tlTelegramUserId;
  if (userId === undefined) {
    // The auth hook always sets this for `/v1/*`; reaching here is a bug.
    throw new Error('auth hook did not bind a Telegram user id');
  }
  return userId;
}

export function registerSavedSearchRoutes(app: FastifyInstance, store: Store): void {
  app.get('/v1/saved-searches', async (request): Promise<SavedSearchResponse[]> => {
    const userId = userIdOf(request);
    return store.savedSearches.list(userId).map(toResponse);
  });

  app.post('/v1/saved-searches', async (request, reply): Promise<SavedSearchResponse> => {
    const userId = userIdOf(request);
    const created = store.savedSearches.create(userId, parseCreate(request.body));
    if (created === null) {
      throw invalidRequest('a user may have at most 10 saved searches');
    }
    reply.code(201);
    return toResponse(created);
  });

  app.patch(
    '/v1/saved-searches/:id',
    async (request): Promise<SavedSearchResponse> => {
      const userId = userIdOf(request);
      const id = parseSavedSearchId((request.params as { id: string }).id);
      const updated = store.savedSearches.update(userId, id, parsePatch(request.body));
      if (updated === null) throw notFound('saved search not found');
      return toResponse(updated);
    },
  );

  app.delete(
    '/v1/saved-searches/:id',
    async (request): Promise<DeleteSavedSearchResponse> => {
      const userId = userIdOf(request);
      const id = parseSavedSearchId((request.params as { id: string }).id);
      if (!store.savedSearches.delete(userId, id)) {
        throw notFound('saved search not found');
      }
      return { deleted: true };
    },
  );
}
