/**
 * Platform glue for the flat endpoints.
 *
 * Everything here touches the Telegram Serverless runtime: `db` for the
 * `settings` rows, `fetch` for the one upstream call, and the platform's
 * `EndpointError` so a stable code reaches the Mini App as
 * `error.parameters.code`. The pure logic stays in `resources.js`, `config.js`,
 * `upstream.js`, and `errors.js`; this module is deliberately not unit-tested
 * because Node has no `sdk` (the same convention as `schema.js`).
 *
 * Platform facts this file relies on (core.telegram.org/bots/serverless, read
 * 2026-11-05):
 *
 * - `db` is a Drizzle-like async query builder; every terminal returns a
 *   Promise.
 * - `fetch` is a fetch-like client with no credentials.
 * - an endpoint returns JSON, and `throw new EndpointError(message,
 *   parameters)` is how it refuses a call.
 */

import { db, fetch, EndpointError as SdkEndpointError } from 'sdk';

import { settings } from '../schema.js';
import { SETTINGS_KEYS, resolveConfig } from './config.js';
import { ERROR_CODES, isErrorCode, messageForCode } from './errors.js';
import { probeHmac } from './hmac-probe.js';
import { planProvision } from './provision-plan.js';
import { DEFAULT_TIMEOUT_MS, callVps } from './upstream.js';

/** Reads the two environment values the runtime may provide. Never logged. */
function envValue(name) {
  const env = globalThis.process && globalThis.process.env;
  if (!env) return undefined;
  const value = env[name];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/**
 * A bot token, only when the runtime happens to expose one. ADR-0005 does not
 * require it: the platform verifies `initData`, and this value is used solely
 * for the optional local re-check in `identity`.
 */
export function botTokenFromEnv() {
  return envValue('TL_BOT_TOKEN');
}

/** Builds the platform error the Mini App receives (`parameters.code`). */
export function fail(code, message) {
  return new SdkEndpointError(message ?? messageForCode(code), { code });
}

/**
 * Converts anything an endpoint throws into a platform `EndpointError`.
 * A plain `EndpointError` from `lib/errors.js` keeps its stable code; an
 * unknown failure becomes `upstream_unavailable`, so no internals leak.
 */
export function toEndpointError(error) {
  if (error instanceof SdkEndpointError) return error;
  if (error && typeof error.code === 'string' && isErrorCode(error.code)) {
    return fail(error.code, error.message);
  }
  return fail(ERROR_CODES.UPSTREAM_UNAVAILABLE);
}

/** All `settings` rows as `{ key, value, updatedAt }`. */
export async function readSettingsRows() {
  return db.select().from(settings).all();
}

/** `settings` as a `Map<string, string>`; a missing table row is simply absent. */
export async function readSettingsMap() {
  const rows = await readSettingsRows();
  const map = new Map();
  for (const row of rows) {
    if (typeof row.key === 'string' && row.value !== null && row.value !== undefined) {
      map.set(row.key, String(row.value));
    }
  }
  return map;
}

/**
 * Which configuration rows exist. Booleans only: no value ever leaves here.
 *
 * @returns {Promise<{ vpsUrl: boolean, sharedSecret: boolean }>}
 */
export async function settingsPresence() {
  const map = await readSettingsMap();
  return {
    vpsUrl: map.has(SETTINGS_KEYS.VPS_URL),
    sharedSecret: map.has(SETTINGS_KEYS.SHARED_SECRET),
  };
}

/** Resolves `{ vpsUrl, sharedSecret }` from environment + settings rows. */
export async function loadConfig() {
  const rows = await readSettingsRows();
  return resolveConfig({ settings: rows });
}

/**
 * One signed upstream call on behalf of `userId`. Throws a platform
 * `EndpointError` carrying the stable code when the VPS call fails.
 */
export async function forward({ userId, method = 'GET', target, body }) {
  const config = await loadConfig();
  if (!config.ok) {
    // Key names only — never a value.
    console.log('bff configuration error', config.reason, config.missing);
    throw fail(config.code);
  }

  const result = await callVps({
    fetchImpl: fetch,
    baseUrl: config.vpsUrl,
    secret: config.sharedSecret,
    userId,
    method,
    target,
    body,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  });

  if (!result.ok) throw fail(result.code);
  return result.json;
}

/**
 * Refuses a non-owner. The environment value is optional and only an extra
 * check when the runtime exposes it; the real protection on `provision` is the
 * one-shot refusal in `provisionSettings` (see tgcloud/README.md).
 */
export function assertOwner(userId) {
  const configured = envValue('TL_OWNER_TELEGRAM_ID');
  if (configured === undefined) return;
  if (!/^\d+$/.test(configured) || Number(configured) !== userId) {
    throw fail(ERROR_CODES.NOT_INVITED);
  }
}

async function writeSetting(key, value) {
  await db
    .insert(settings)
    .values({ key, value, updatedAt: new Date() })
    .run();
}

const VALUE_BY_KEY = Object.freeze({
  [SETTINGS_KEYS.VPS_URL]: 'vpsUrl',
  [SETTINGS_KEYS.SHARED_SECRET]: 'sharedSecret',
  [SETTINGS_KEYS.MINIAPP_URL]: 'miniappUrl',
});

/**
 * One-time owner provisioning of `vps_url` and `shared_secret`, plus the
 * optional `miniapp_url` the bot's `/start` button opens.
 *
 * The decision lives in the pure `planProvision`; this function only reads the
 * existing rows and writes what the plan asks for. The core pair is written
 * once: rotation is a deliberate database rewrite, documented in the README,
 * not a request. `miniapp_url` can be set or updated on its own once the pair
 * exists. Returns key names only and never a value or the secret length.
 *
 * @param {{ vpsUrl?: unknown, sharedSecret?: unknown, miniappUrl?: unknown }} input
 * @returns {Promise<
 *   | { ok: true, written: string[] }
 *   | { ok: false, reason: 'vps_url_invalid' | 'shared_secret_too_short' | 'miniapp_url_invalid' | 'not_provisioned' | 'already_provisioned' | 'partially_provisioned' }
 * >}
 */
export async function provisionSettings(input = {}) {
  const present = await settingsPresence();
  const plan = planProvision({
    present,
    input: {
      vpsUrl: input.vpsUrl,
      sharedSecret: input.sharedSecret,
      miniappUrl: input.miniappUrl,
    },
  });
  if (!plan.ok) return { ok: false, reason: plan.reason };

  for (const key of plan.write) {
    const value = plan.values[VALUE_BY_KEY[key]];
    if (typeof value === 'string') await writeSetting(key, value);
  }

  return { ok: true, written: plan.write };
}

/**
 * Read-only runtime diagnostic for the owner. Booleans only, no values.
 *
 * `configPresent` is the settings-row presence check; environment overrides
 * (`TL_VPS_URL`, `TL_SHARED_SECRET`) are deliberately not counted, so a false
 * here with a working BFF means the values come from the environment.
 */
export async function diagnose() {
  const [probe, present] = await Promise.all([probeHmac(), settingsPresence()]);
  return {
    subtleAvailable: probe.subtleAvailable,
    vectorOk: probe.vectorOk,
    activePath: probe.activePath,
    configPresent: present.vpsUrl && present.sharedSecret,
  };
}
