/**
 * `provision` — owner-only, one-time configuration of the BFF → VPS link.
 *
 * Input: `{ vps_url | vpsUrl, shared_secret | sharedSecret, miniapp_url |
 * miniappUrl? }`.
 * Output: `{ ok: true, written: ['vps_url', 'shared_secret'] }` (plus
 * `miniapp_url` when supplied) — key names only. The secret is never returned,
 * echoed, or logged.
 *
 * Safety:
 *
 * - refuses when both core `settings` rows already exist, and when only one
 *   does, so this route cannot overwrite or rotate a secret by accident;
 * - once the core pair exists, a call carrying only `miniapp_url` updates that
 *   one key, which is how the `/start` button gets its URL;
 * - validates the `http(s)` pair URL, the 32-character secret minimum, and the
 *   HTTPS `miniapp_url` Telegram requires;
 * - when the runtime exposes `TL_OWNER_TELEGRAM_ID`, the caller must match it.
 *
 * The real protection is the one-shot refusal, not the id check: the caller id
 * is platform-verified, but this endpoint exists before the allowlist is
 * populated. Remove the module (or leave both rows written) after setup; the
 * runbook in tgcloud/README.md covers provisioning and deliberate rotation.
 */

import { ERROR_CODES } from '../lib/errors.js';
import { identity } from '../lib/resources.js';
import { assertOwner, fail, provisionSettings, toEndpointError } from '../lib/runtime.js';

const MESSAGES = Object.freeze({
  vps_url_invalid: 'vps_url must be an http(s) URL',
  shared_secret_too_short: 'shared_secret must be at least 32 characters',
  miniapp_url_invalid: 'miniapp_url must be an https URL with a host',
  not_provisioned: 'provision vps_url and shared_secret before setting miniapp_url',
  already_provisioned: 'configuration is already provisioned; rotate it deliberately',
  partially_provisioned: 'configuration is partially provisioned; finish or reset it by hand',
});

export default async function provision(input, ctx) {
  try {
    const user = identity(ctx, input);
    assertOwner(user.id);

    const body = input && typeof input === 'object' ? input : {};
    const result = await provisionSettings({
      vpsUrl: body.vps_url ?? body.vpsUrl,
      sharedSecret: body.shared_secret ?? body.sharedSecret,
      miniappUrl: body.miniapp_url ?? body.miniappUrl,
    });

    if (!result.ok) {
      throw fail(ERROR_CODES.INVALID_REQUEST, MESSAGES[result.reason] ?? 'provisioning refused');
    }

    return { ok: true, written: result.written };
  } catch (error) {
    throw toEndpointError(error);
  }
}
