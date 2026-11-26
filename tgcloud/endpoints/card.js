/**
 * `card` — one Карточка with its full text, photos, hashtags, and source trail.
 *
 * Input: `{ id }`, the cluster id.
 * Upstream: `GET /v1/cards/{id}`; the VPS card-detail JSON is returned
 * unchanged. An unknown or hidden cluster is `not_found`.
 */

import { cardTarget, identity } from '../lib/resources.js';
import { forward, toEndpointError } from '../lib/runtime.js';

export default async function card(input, ctx) {
  try {
    const user = identity(ctx, input);
    return await forward({
      userId: user.id,
      method: 'GET',
      target: cardTarget(input && input.id),
    });
  } catch (error) {
    throw toEndpointError(error);
  }
}
