/**
 * Registration point for the `/v1/*` API. The auth hook installed in
 * `src/app.ts` wraps everything registered here; no route implements its own
 * authentication.
 */

import type { FastifyInstance } from 'fastify';

import type { Store } from '../store/index.js';

import { registerCardRoutes } from './card-detail.js';
import type { DetailProbe } from './detail-probe.js';
import { registerFeedRoutes } from './feed.js';
import { registerMeRoutes } from './me.js';
import { registerSavedSearchRoutes } from './saved-searches.js';
import { registerSessionRoutes } from './session.js';
import { registerSourceRoutes } from './sources.js';

export interface ApiRouteOptions {
  /** Injected clock in milliseconds for session timestamps. */
  now: () => number;
  /** Live detail probe; null disables it. */
  detailProbe: DetailProbe | null;
}

export function registerApiRoutes(
  app: FastifyInstance,
  store: Store,
  options: ApiRouteOptions,
): void {
  registerSessionRoutes(app, store, { now: options.now });
  registerFeedRoutes(app, store);
  registerCardRoutes(app, store, { detailProbe: options.detailProbe });
  registerSourceRoutes(app, store);
  registerSavedSearchRoutes(app, store);
  registerMeRoutes(app, store);
}
