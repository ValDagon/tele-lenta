/** The Bot API surface. Only the digest worker sends messages in v1. */

export {
  DEFAULT_BOT_BASE_URL,
  DEFAULT_BOT_MIN_INTERVAL_MS,
  DEFAULT_BOT_TIMEOUT_MS,
  createBotSender,
  type BotLogger,
  type BotSendResult,
  type BotSender,
  type BotSenderOptions,
  type BotTransport,
} from './api.js';
