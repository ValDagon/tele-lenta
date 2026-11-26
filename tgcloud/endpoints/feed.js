/**
 * `feed` — one page of Карточки.
 *
 * Input: `{ section?, category?, demand?, sources?, q?, cursor?, limit? }`.
 * Upstream: `GET /v1/feed?...` built by `feedTarget`; the VPS feed JSON
 * (`cards`, `next_cursor`, `total`, `updated_at`) is returned unchanged.
 */

import { feedTarget, identity } from '../lib/resources.js';
import { forward, toEndpointError } from '../lib/runtime.js';

export default async function feed(input, ctx) {
  try {
    const user = identity(ctx, input);
    return await forward({
      userId: user.id,
      method: 'GET',
      target: feedTarget(input),
    });
  } catch (error) {
    throw toEndpointError(error);
  }
}
