/**
 * The `settings` table contract, shared by `schema.js` and the pure config
 * module. This file imports nothing, so Node tests can read it while the
 * schema file itself imports `sdk/db` and only loads on the platform.
 */

/** Canonical table name. */
export const SETTINGS_TABLE = 'settings';

/** Canonical settings keys. Keep in sync with the VPS env names in the README. */
export const SETTINGS_KEYS = Object.freeze({
  VPS_URL: 'vps_url',
  SHARED_SECRET: 'shared_secret',
  MINIAPP_URL: 'miniapp_url',
});
