/**
 * BFF configuration resolution.
 *
 * The Serverless runtime documents no environment-secret mechanism, so the
 * owner chose two sources, in this order:
 *
 *   1. environment variables, when the runtime provides them
 *   2. rows in the platform SQLite `settings` table, provisioned once
 *
 * Both values live in the same table (`vps_url`, `shared_secret`) and are
 * written by the owner — never committed and never returned to a client.
 *
 * This module is pure: it takes the environment object and the settings rows.
 * Reading SQLite is the endpoint layer's job, so this code runs under Node
 * tests unchanged.
 */

import { SETTINGS_KEYS } from './settings-keys.js';

/** Environment variable names (the same names the VPS deploy uses where shared). */
export const ENV_KEYS = Object.freeze({
  VPS_URL: 'TL_VPS_URL',
  SHARED_SECRET: 'TL_SHARED_SECRET',
});

/** `settings` table keys, shared with the schema module. */
export { SETTINGS_KEYS };

/** The VPS rejects a shared secret shorter than this; fail closed here too. */
export const MIN_SECRET_LENGTH = 32;

/**
 * Normalizes the settings input. Accepts the array of rows the platform query
 * returns (`[{ key, value }]`), a plain object, or a `Map`. Missing rows are
 * simply absent.
 */
function settingsToMap(settings) {
  const map = new Map();
  if (!settings) return map;

  if (Array.isArray(settings)) {
    for (const row of settings) {
      if (!row || typeof row !== 'object') continue;
      const key = row.key ?? row.name;
      if (typeof key === 'string' && row.value !== undefined && row.value !== null) {
        map.set(key, String(row.value));
      }
    }
    return map;
  }

  if (typeof settings.entries === 'function' && typeof settings.get === 'function') {
    for (const [key, value] of settings.entries()) {
      if (value !== undefined && value !== null) map.set(String(key), String(value));
    }
    return map;
  }

  if (typeof settings === 'object') {
    for (const [key, value] of Object.entries(settings)) {
      if (value !== undefined && value !== null) map.set(key, String(value));
    }
  }
  return map;
}

function firstNonEmpty(envMap, envKey, settingsMap, settingsKey) {
  const fromEnv = envMap ? envMap[envKey] : undefined;
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') {
    return { value: fromEnv.trim(), source: 'env' };
  }
  const fromSettings = settingsMap.get(settingsKey);
  if (typeof fromSettings === 'string' && fromSettings.trim() !== '') {
    return { value: fromSettings.trim(), source: 'settings' };
  }
  return null;
}

/**
 * Resolves `{ vpsUrl, sharedSecret }`.
 *
 * @param {{
 *   env?: Record<string, string | undefined>,
 *   settings?: Array<{ key: string, value: string }> | Record<string, string> | Map<string, string>,
 * }} [input]
 *   `env` defaults to `globalThis.process.env` when it exists. An explicitly
 *   passed object is used as-is (tests, and the platform when it exposes
 *   configuration another way).
 * @returns {
 *   | { ok: true, vpsUrl: string, sharedSecret: string, sources: { vpsUrl: 'env' | 'settings', sharedSecret: 'env' | 'settings' } }
 *   | { ok: false, code: 'upstream_unavailable', reason: string, missing: string[] }
 * }
 *   The failure carries key names only, never values.
 */
export function resolveConfig(input = {}) {
  const envMap =
    input.env === undefined ? (globalThis.process && globalThis.process.env) || {} : input.env;
  const settingsMap = settingsToMap(input.settings);

  const vpsUrl = firstNonEmpty(envMap, ENV_KEYS.VPS_URL, settingsMap, SETTINGS_KEYS.VPS_URL);
  const sharedSecret = firstNonEmpty(
    envMap,
    ENV_KEYS.SHARED_SECRET,
    settingsMap,
    SETTINGS_KEYS.SHARED_SECRET,
  );

  const missing = [];
  if (!vpsUrl) missing.push(ENV_KEYS.VPS_URL);
  if (!sharedSecret) missing.push(ENV_KEYS.SHARED_SECRET);
  if (missing.length > 0) {
    return configurationFailure('configuration_missing', missing);
  }

  if (!/^https?:\/\/[^\s]+$/.test(vpsUrl.value)) {
    return configurationFailure('vps_url_invalid', [ENV_KEYS.VPS_URL]);
  }
  if (sharedSecret.value.length < MIN_SECRET_LENGTH) {
    return configurationFailure('shared_secret_too_short', [ENV_KEYS.SHARED_SECRET]);
  }

  return {
    ok: true,
    vpsUrl: vpsUrl.value.replace(/\/+$/, ''),
    sharedSecret: sharedSecret.value,
    sources: { vpsUrl: vpsUrl.source, sharedSecret: sharedSecret.source },
  };
}

function configurationFailure(reason, missing) {
  // The edge maps a configuration problem to `upstream_unavailable` and logs
  // the reason. No value ever appears in the result.
  return { ok: false, code: 'upstream_unavailable', reason, missing };
}
