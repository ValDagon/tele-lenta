/**
 * `me` — the user's digest, quiet hours, and filter settings.
 *
 * Input: `{ action: 'get' | 'update', patch? }`; `patch` is the settings body
 * for `update`.
 *
 * Upstream:
 *   get     GET   /v1/me
 *   update  PATCH /v1/me    body = patch
 *
 * The VPS has no `/v1/me` route yet (ticket #15), so both actions currently
 * answer `not_found`.
 */

import { identity, meMethod, meTarget } from '../lib/resources.js';
import { forward, toEndpointError } from '../lib/runtime.js';

export default async function me(input, ctx) {
  try {
    const user = identity(ctx, input);
    const method = meMethod(input);
    const target = meTarget(input);
    const body = method === 'PATCH' ? input.patch : undefined;

    return await forward({ userId: user.id, method, target, body });
  } catch (error) {
    throw toEndpointError(error);
  }
}
