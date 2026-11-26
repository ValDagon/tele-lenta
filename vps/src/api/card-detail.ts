/** `GET /v1/cards/{id}` — full text, photos, hashtags, and source trail. */

import type { FastifyInstance } from 'fastify';

import type { Store } from '../store/index.js';

import { toCardDetail } from './cards.js';
import type { DetailProbe } from './detail-probe.js';
import { notFound } from './errors.js';
import { parseClusterId } from './params.js';
import type { CardDetail } from './types.js';

export interface CardRouteOptions {
  /** Live not-found probe; null disables it (unit tests that do not care). */
  detailProbe: DetailProbe | null;
}

export function registerCardRoutes(
  app: FastifyInstance,
  store: Store,
  options: CardRouteOptions,
): void {
  app.get('/v1/cards/:id', async (request): Promise<CardDetail> => {
    const { id } = request.params as { id: string };
    const clusterId = parseClusterId(id);

    let row = store.feed.detail(clusterId);
    // A hidden cluster is indistinguishable from an absent one on the wire.
    if (row === null) throw notFound('card not found');

    // Before rendering, give a stale available source one chance to report
    // that its message is gone. The probe never throws and only flips a row
    // on an explicit not-found, so a failure leaves this response intact.
    const probe = options.detailProbe;
    if (probe !== null && (await probe.probe(row))) {
      row = store.feed.detail(clusterId);
      // The probe deleted the last available member: the cluster is hidden now.
      if (row === null) throw notFound('card not found');
    }

    return toCardDetail(row);
  });
}
