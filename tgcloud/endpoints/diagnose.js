/**
 * `diagnose` — owner-only runtime probe, booleans only.
 *
 * Input: `{}`.
 * Output: `{ subtleAvailable, vectorOk, activePath, configPresent }`.
 *
 * `subtleAvailable` and `vectorOk` come from `probeHmac()` (RFC 4231 case 2);
 * `activePath` is always `pure-js`, because the signing path never depends on
 * `crypto.subtle`. `configPresent` is the settings-row presence check — a false
 * with a working BFF means the values come from `TL_VPS_URL` /
 * `TL_SHARED_SECRET` in the environment.
 *
 * No value, secret, or `initData` is ever returned or logged.
 */

import { identity } from '../lib/resources.js';
import { assertOwner, diagnose, toEndpointError } from '../lib/runtime.js';

export default async function diagnoseEndpoint(input, ctx) {
  try {
    const user = identity(ctx, input);
    assertOwner(user.id);
    return await diagnose();
  } catch (error) {
    throw toEndpointError(error);
  }
}
