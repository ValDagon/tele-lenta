/**
 * `message` handler — the bot's only job: answer `/start` with the Mini App.
 *
 * The bot is the entry point, not a product surface. Access is enforced by the
 * Mini App's own session check, so this handler carries no allowlist logic, and
 * it writes no product state: it reads the `miniapp_url` settings row and sends
 * one message. Bot API failures are left to propagate so the platform logs them
 * instead of the handler swallowing them.
 */

import { api } from 'sdk';

import { isStartCommand, miniAppUrl, startReply } from '../lib/start.js';
import { readSettingsMap } from '../lib/runtime.js';

export default async function messageHandler(message) {
  if (!isStartCommand(message)) return;

  const settings = await readSettingsMap();
  const url = miniAppUrl({ settings, env: globalThis.process?.env ?? {} });

  if (url === null) console.warn('start: miniapp_url is not configured');

  await api.sendMessage({ chat_id: message.chat.id, ...startReply({ miniappUrl: url }) });
}
