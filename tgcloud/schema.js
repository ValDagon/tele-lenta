/**
 * Telegram Serverless schema.
 *
 * Platform facts that shape this file:
 *
 * - the database is platform SQLite with foreign keys OFF, so no table here
 *   declares a foreign key;
 * - deploy (`npx tgcloud push`) and schema migration (`npx tgcloud migrate`)
 *   are separate commands;
 * - tables are named exports declared with the `sdk/db` DSL.
 *
 * `settings` is the only table. It holds owner-provisioned configuration, not
 * product state: `vps_url` and `shared_secret` (the 32+ character secret shared
 * with the VPS), plus `miniapp_url` (the HTTPS URL the bot's `/start` button
 * opens). The core pair is written once by the owner through the guarded
 * provisioning endpoint; `miniapp_url` can be updated on its own. No secret is
 * ever committed, logged, or returned to a client. See tgcloud/README.md.
 */

import { table, text, integer, sql } from 'sdk/db';

import { SETTINGS_TABLE, SETTINGS_KEYS } from './lib/settings-keys.js';

export { SETTINGS_TABLE, SETTINGS_KEYS };

export const settings = table(SETTINGS_TABLE, {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
});
