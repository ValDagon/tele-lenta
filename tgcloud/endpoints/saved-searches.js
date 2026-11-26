/**
 * `saved-searches` — list, create, update, delete.
 *
 * Input: `{ action: 'list' | 'create' | 'update' | 'delete', id?, data? }`.
 * `id` is required for `update` and `delete`; `data` is the saved-search body
 * for `create` and `update`.
 *
 * Upstream:
 *   list    GET    /v1/saved-searches
 *   create  POST   /v1/saved-searches          body = data
 *   update  PATCH  /v1/saved-searches/{id}     body = data
 *   delete  DELETE /v1/saved-searches/{id}
 *
 * The VPS has no saved-search routes yet (ticket #15), so every action currently
 * answers `not_found`. The mapping is correct and the Mini App needs no change
 * when those routes land.
 */

import { identity, savedSearchesMethod, savedSearchesTarget } from '../lib/resources.js';
import { forward, toEndpointError } from '../lib/runtime.js';

export default async function savedSearches(input, ctx) {
  try {
    const user = identity(ctx, input);
    const method = savedSearchesMethod(input);
    const target = savedSearchesTarget(input);
    const body = method === 'POST' || method === 'PATCH' ? input.data : undefined;

    return await forward({ userId: user.id, method, target, body });
  } catch (error) {
    throw toEndpointError(error);
  }
}
