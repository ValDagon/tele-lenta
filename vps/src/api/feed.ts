/** `GET /v1/feed` — one Карточка per visible Кластер, newest first. */

import type { FastifyInstance } from 'fastify';

import type { Store } from '../store/index.js';

import { toCard } from './cards.js';
import { encodeCursor } from './cursor.js';
import {
  parseCategory,
  parseCursor,
  parseDemand,
  parseLimit,
  parseSearch,
  parseSection,
  parseSourceIds,
} from './params.js';
import type { FeedResponse } from './types.js';

export function registerFeedRoutes(app: FastifyInstance, store: Store): void {
  app.get('/v1/feed', async (request): Promise<FeedResponse> => {
    const raw = (request.query ?? {}) as Record<string, unknown>;

    const section = parseSection(raw);
    const category = parseCategory(raw);
    const demand = parseDemand(raw);
    const sourceIds = parseSourceIds(raw);
    const search = parseSearch(raw);
    const cursor = parseCursor(raw);
    const limit = parseLimit(raw);

    const page = store.feed.feed({
      section,
      category,
      demand,
      sourceIds,
      search,
      cursor,
      limit,
    });

    return {
      cards: page.cards.map(toCard),
      next_cursor: page.nextCursor === null ? null : encodeCursor(page.nextCursor),
      total: page.total,
      updated_at: page.updatedAt,
    };
  });
}
