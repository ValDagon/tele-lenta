/**
 * `sources` — enabled Источники for the filter sheet and the settings count.
 *
 * Input: `{}`.
 * Upstream: `GET /v1/sources`; the VPS `{ sources }` JSON is returned unchanged.
 */

import { identity, sourcesTarget } from '../lib/resources.js';
import { forward, toEndpointError } from '../lib/runtime.js';

export default async function sources(input, ctx) {
  try {
    const user = identity(ctx, input);
    return await forward({
      userId: user.id,
      method: 'GET',
      target: sourcesTarget(),
    });
  } catch (error) {
    throw toEndpointError(error);
  }
}
