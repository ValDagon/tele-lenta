/**
 * Decides what a `provision` call may write, without touching the platform.
 *
 * `lib/runtime.js` imports `sdk` and cannot load under Node, so the one-shot
 * provisioning rules live here as a pure plan: the runtime reads the existing
 * rows, calls `planProvision`, and executes the returned `write` list. That
 * keeps the one-shot semantics (`vps_url` + `shared_secret` are written once)
 * and the `miniapp_url` update path testable without a database.
 *
 * Rules:
 *
 * - a fresh database may write the core pair, with `miniapp_url` after it;
 * - an already provisioned pair refuses any call that carries it — rotation is
 *   a deliberate database rewrite, never a request;
 * - once the pair exists, a call with only `miniapp_url` updates that one key;
 * - `miniapp_url` must be an HTTPS URL, because Telegram requires it for a
 *   `web_app` button.
 */

import { MIN_SECRET_LENGTH } from './config.js';
import { isWebAppUrl } from './start.js';

const VPS_URL_PATTERN = /^https?:\/\/[^\s]+$/;

const CORE_KEYS = Object.freeze(['vps_url', 'shared_secret']);
const MINIAPP_KEY = 'miniapp_url';

function trimmed(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function refuse(reason) {
  return { ok: false, write: [], reason };
}

/**
 * @param {{
 *   present?: { vpsUrl?: boolean, sharedSecret?: boolean, miniappUrl?: boolean },
 *   input?: { vpsUrl?: unknown, sharedSecret?: unknown, miniappUrl?: unknown },
 * }} [options]
 * @returns {
 *   | { ok: true, write: string[], values: { vpsUrl?: string, sharedSecret?: string, miniappUrl?: string } }
 *   | { ok: false, write: [], reason: string }
 * }
 */
export function planProvision(options = {}) {
  const present = options.present ?? {};
  const input = options.input ?? {};

  const rawVpsUrl = trimmed(input.vpsUrl);
  const rawSecret = trimmed(input.sharedSecret);
  const rawMiniappUrl = trimmed(input.miniappUrl);

  const hasCore = rawVpsUrl !== '' || rawSecret !== '';
  // A blank but explicitly passed `miniapp_url` is a bad value, not an absent
  // one, so it is reported as `miniapp_url_invalid` rather than falling back to
  // the core-pair validation error.
  const hasMiniapp = input.miniappUrl !== undefined && input.miniappUrl !== null;

  if (!hasCore && !hasMiniapp) return refuse('vps_url_invalid');

  const pairPresent = Boolean(present.vpsUrl && present.sharedSecret);

  // `miniapp_url` alone: allowed only after the core pair exists, and it
  // overwrites the previous value.
  if (!hasCore) {
    if (!isWebAppUrl(rawMiniappUrl)) return refuse('miniapp_url_invalid');
    if (!pairPresent) return refuse('not_provisioned');
    return { ok: true, write: [MINIAPP_KEY], values: { miniappUrl: rawMiniappUrl } };
  }

  // The core pair is one-shot, whether or not `miniapp_url` is supplied.
  if (pairPresent) return refuse('already_provisioned');
  if (present.vpsUrl || present.sharedSecret) return refuse('partially_provisioned');

  const vpsUrl = rawVpsUrl.replace(/\/+$/, '');
  if (!VPS_URL_PATTERN.test(vpsUrl)) return refuse('vps_url_invalid');
  if (rawSecret.length < MIN_SECRET_LENGTH) return refuse('shared_secret_too_short');
  if (hasMiniapp && !isWebAppUrl(rawMiniappUrl)) return refuse('miniapp_url_invalid');

  const write = [...CORE_KEYS];
  const values = { vpsUrl, sharedSecret: rawSecret };
  if (hasMiniapp) {
    write.push(MINIAPP_KEY);
    values.miniappUrl = rawMiniappUrl;
  }

  return { ok: true, write, values };
}
