/** `GET /v1/sources` — enabled Источники for the filter sheet and settings. */

import type { FastifyInstance } from 'fastify';

import type { Store } from '../store/index.js';

import { monogram } from './monogram.js';
import type { SourceListItem, SourcesResponse } from './types.js';

export function registerSourceRoutes(app: FastifyInstance, store: Store): void {
  app.get('/v1/sources', async (): Promise<SourcesResponse> => {
    const sources: SourceListItem[] = store.sources.listEnabled().map((source) => {
      const name = source.title ?? source.username;
      return {
        id: source.id,
        username: source.username,
        name,
        monogram: monogram(name),
        kind: source.kind,
        section: source.sectionHint,
      };
    });

    return { sources };
  });
}
