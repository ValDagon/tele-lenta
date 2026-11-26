/**
 * `session` — the Mini App's first call.
 *
 * Input: `{}` (the platform supplies `ctx.initData`).
 * Upstream: `POST /v1/session` with `{ id, username, first_name }` from the
 * verified Telegram user. The VPS upserts the profile and enforces the
 * allowlist; its session JSON is returned unchanged.
 */

import { identity, sessionBody, sessionTarget } from '../lib/resources.js';
import { forward, toEndpointError } from '../lib/runtime.js';

export default async function session(input, ctx) {
  try {
    const user = identity(ctx, input);
    return await forward({
      userId: user.id,
      method: 'POST',
      target: sessionTarget(),
      body: sessionBody(user),
    });
  } catch (error) {
    throw toEndpointError(error);
  }
}
