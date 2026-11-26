/** Public surface of the HTTP layer: URL builders and the polite client. */

export {
  channelPageUrl,
  messageEmbedUrl,
  normalizeSourceUsername,
  type ChannelPageOptions,
} from './urls.js';

export {
  DEFAULT_RATE_POLICY,
  DEFAULT_RETRY_POLICY,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_USER_AGENT,
  PolitenessLimiter,
  createPoliteClient,
  createRequestBudget,
  getSharedPolitenessLimiter,
  parseRetryAfter,
  systemClock,
  type Clock,
  type FetchLike,
  type FetchRequestInit,
  type FetchResponse,
  type PoliteClient,
  type PoliteClientOptions,
  type PoliteFailure,
  type PoliteFailureOutcome,
  type PoliteRequestOptions,
  type PoliteResult,
  type PoliteSuccess,
  type RatePolicy,
  type RequestBudget,
  type RetryPolicy,
} from './polite-client.js';
