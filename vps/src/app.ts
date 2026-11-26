import Fastify, {
  type FastifyInstance,
  type FastifyServerOptions,
} from 'fastify';

import { registerApiRoutes } from './api/index.js';
import { createDetailProbe, type DetailProbe } from './api/detail-probe.js';
import { ApiError, sendError } from './api/errors.js';
import { registerAuth, type AuthOptions } from './auth/index.js';
import { DEFAULT_DETAIL_PROBE_TIMEOUT_MS, type Config } from './config.js';
import type { Db } from './db.js';
import {
  DEFAULT_USER_AGENT,
  createPoliteClient,
  type PoliteClient,
} from './net/polite-client.js';
import { createStore } from './store/index.js';

/** The injectable half of the detail probe: a client and an optional timeout. */
export interface AppDetailProbeOptions {
  client: PoliteClient;
  /** Overrides `TL_DETAIL_PROBE_TIMEOUT_MS`; tests pin the 2-second default. */
  timeoutMs?: number;
}

export interface AppOptions {
  db: Db;
  logger?: FastifyServerOptions['logger'];
  /** Auth is mandatory: there is no build of the API without a shared secret. */
  auth: AuthOptions;
  /**
   * Live detail probe. Omitted → the real polite client over global `fetch` with
   * the configured User-Agent (the server's behaviour). `null` → disabled, which
   * is what hermetic unit tests pass.
   */
  detailProbe?: AppDetailProbeOptions | null;
  /** Network settings for the default probe client; the server passes `loadConfig()`. */
  config?: Pick<Config, 'userAgent' | 'detailProbeTimeoutMs'>;
}

function resolveDetailProbe(
  options: AppOptions,
  now: () => number,
  store: ReturnType<typeof createStore>,
): DetailProbe | null {
  if (options.detailProbe === null) return null;

  const injected = options.detailProbe;
  const config = options.config;
  const timeoutMs =
    injected?.timeoutMs ??
    config?.detailProbeTimeoutMs ??
    DEFAULT_DETAIL_PROBE_TIMEOUT_MS;

  const client =
    injected?.client ??
    createPoliteClient({
      transport: (url, init) => fetch(url, init),
      userAgent: config?.userAgent ?? DEFAULT_USER_AGENT,
      // The probe is one attempt by contract; retries would delay the card.
      retry: { maxAttempts: 1 },
    });

  return createDetailProbe(store, { client, timeoutMs, now });
}

interface SourceFreshness {
  id: number;
  username: string;
  last_success_at: string | null;
  age_seconds: number | null;
}

interface HealthResponse {
  status: 'ok';
  checked_at: string;
  last_success_at: string | null;
  age_seconds: number | null;
  sources: SourceFreshness[];
}

function ageSeconds(iso: string | null, now: number): number | null {
  if (iso === null) return null;
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return null;
  return Math.max(0, Math.floor((now - parsed) / 1000));
}

function newest(rows: SourceFreshness[]): string | null {
  let latest: string | null = null;
  let latestAt = Number.NEGATIVE_INFINITY;
  for (const row of rows) {
    if (row.last_success_at === null) continue;
    const parsed = Date.parse(row.last_success_at);
    if (Number.isNaN(parsed) || parsed <= latestAt) continue;
    latest = row.last_success_at;
    latestAt = parsed;
  }
  return latest;
}

/**
 * Builds the HTTP surface. `/health` is the only unauthenticated route; every
 * `/v1/*` route sits behind the signed BFF contract, the allowlist, and the
 * rate limits installed by `registerAuth`.
 */
export function buildApp(options: AppOptions): FastifyInstance {
  const { db } = options;
  const app = Fastify({ logger: options.logger ?? false });
  const store = createStore(db);
  const now = options.auth.now ?? Date.now;

  // Every error leaves as JSON in the spec's envelope, including an unknown
  // route. `/health` keeps its own shape because it never throws.
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      return sendError(reply, error.code, error.message, error.statusCode);
    }
    request.log.error(error);
    return sendError(reply, 'internal_error', 'internal server error', 500);
  });

  app.setNotFoundHandler((_request, reply) =>
    sendError(reply, 'not_found', 'route not found', 404),
  );

  const selectSources = db.prepare(
    'SELECT id, username, last_success_at FROM sources WHERE enabled = 1 ORDER BY username',
  );

  app.get('/health', async (): Promise<HealthResponse> => {
    const now = Date.now();
    const rows = selectSources.all() as Array<{
      id: number;
      username: string;
      last_success_at: string | null;
    }>;

    const sources: SourceFreshness[] = rows.map((row) => ({
      id: row.id,
      username: row.username,
      last_success_at: row.last_success_at,
      age_seconds: ageSeconds(row.last_success_at, now),
    }));

    const lastSuccess = newest(sources);

    return {
      status: 'ok',
      checked_at: new Date(now).toISOString(),
      last_success_at: lastSuccess,
      age_seconds: ageSeconds(lastSuccess, now),
      sources,
    };
  });

  registerAuth(app, store, { ...options.auth, now });
  registerApiRoutes(app, store, {
    now,
    detailProbe: resolveDetailProbe(options, now, store),
  });

  return app;
}
