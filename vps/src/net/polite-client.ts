/**
 * The polite HTTP transport shared by the collector tick, the backfill command,
 * and (later) the API's detail probe. It enforces the spec's politeness rules
 * in one place:
 *
 * - at most 2 requests in flight globally, at most 1 per source;
 * - at most 1 dispatch per second per source, plus bounded jitter;
 * - 429 and 5xx are retried with exponential backoff, honouring `Retry-After`;
 * - a per-source request budget and both kill switches short-circuit cleanly.
 *
 * Everything time-related and the transport itself are injected, so tests use
 * a virtual clock and a scripted transport and never sleep or touch the
 * network. A failed request is always a typed failure (`http_error`,
 * `network_error`, `timeout`, `disabled`, `budget_exhausted`), never an empty
 * page.
 */

import { setTimeout as delay } from 'node:timers/promises';

/** The parts of a `Response` the client needs; native `fetch` satisfies it. */
export interface FetchResponse {
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export interface FetchRequestInit {
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly signal: AbortSignal;
  readonly redirect: 'follow';
}

/** A `fetch`-shaped function: `fetch` itself or a scripted fake in tests. */
export type FetchLike = (url: string, init: FetchRequestInit) => Promise<FetchResponse>;

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms: number): Promise<void> => (ms <= 0 ? Promise.resolve() : delay(ms)),
};

export interface RatePolicy {
  /** Minimum gap between two dispatches to the same source, before jitter. */
  readonly minIntervalMs: number;
  /** Upper bound of the random gap added on top of `minIntervalMs`. */
  readonly maxJitterMs: number;
}

export const DEFAULT_RATE_POLICY: RatePolicy = {
  minIntervalMs: 1_000,
  maxJitterMs: 250,
};

export interface RetryPolicy {
  /** Total attempts including the first one. */
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  /** A `Retry-After` (or exponential delay) larger than this is capped. */
  readonly maxDelayMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 30_000,
};

export const DEFAULT_TIMEOUT_MS = 10_000;

export const DEFAULT_USER_AGENT =
  'TeleLenta/0.1 (+https://github.com/ValDagon/tele-lenta; collector)';

/**
 * Per-source budget for one tick (or one API request). The caller creates it,
 * hands the same object to every request for that source, and the client
 * consumes one unit per transport attempt. When it is spent the client returns
 * `budget_exhausted` without calling the transport.
 */
export interface RequestBudget {
  readonly limit: number;
  used: number;
}

export function createRequestBudget(limit: number): RequestBudget {
  if (!Number.isInteger(limit) || limit < 0) {
    throw new RangeError(`request budget must be a non-negative integer, got ${String(limit)}`);
  }
  return { limit, used: 0 };
}

export type PoliteFailureOutcome =
  | 'http_error'
  | 'network_error'
  | 'timeout'
  | 'disabled'
  | 'budget_exhausted';

export interface PoliteSuccess {
  readonly ok: true;
  readonly status: number;
  readonly html: string;
  readonly url: string;
  readonly attempts: number;
}

export interface PoliteFailure {
  readonly ok: false;
  readonly outcome: PoliteFailureOutcome;
  readonly url: string;
  readonly attempts: number;
  readonly status?: number;
  readonly detail?: string;
}

export type PoliteResult = PoliteSuccess | PoliteFailure;

export interface PoliteRequestOptions {
  /** Source id; the rate limiter keys its state on it. */
  readonly sourceId: number;
  /** Per-source kill switch, read by the caller from the source row. */
  readonly sourceEnabled: boolean;
  /** Global `INGEST_ENABLED` switch, read by the caller from `app_state`. */
  readonly ingestEnabled: boolean;
  /** Budget shared by every request for this source in this tick. */
  readonly budget?: RequestBudget;
  /** Overrides the client default; the detail probe passes 2_000. */
  readonly timeoutMs?: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly method?: string;
}

export interface PoliteClient {
  readonly limiter: PolitenessLimiter;
  request(url: string, options: PoliteRequestOptions): Promise<PoliteResult>;
}

export interface PoliteClientOptions {
  readonly transport: FetchLike;
  readonly clock?: Clock;
  /** Returns a unit fraction in [0, 1); inject a constant for deterministic tests. */
  readonly random?: () => number;
  /** Shared across clients in a process so the API probe and the tick pace together. */
  readonly limiter?: PolitenessLimiter;
  readonly rate?: Partial<RatePolicy>;
  readonly retry?: Partial<RetryPolicy>;
  readonly userAgent?: string;
  readonly timeoutMs?: number;
  /** Injected only so a timeout can be tested without waiting. */
  readonly createTimeoutSignal?: (ms: number) => AbortSignal;
}

interface SourceSlot {
  inFlight: number;
  /** Epoch ms of the last dispatch, or -Infinity before the first one. */
  lastDispatchAt: number;
  readonly waiters: Array<() => void>;
}

/**
 * Process-level politeness state: the global in-flight cap and, per source, the
 * in-flight count and the last dispatch time. `createPoliteClient` uses one
 * shared instance by default, so every caller in the process that does not
 * inject its own limiter shares the same pacing.
 *
 * This is memory, not a cross-process lock: the tick and the API are separate
 * processes on the VPS, so sharing the per-source rate across them still needs
 * a durable record (see `vps/README.md`).
 */
export class PolitenessLimiter {
  private readonly sources = new Map<number, SourceSlot>();
  private globalInFlight = 0;
  private readonly globalWaiters: Array<() => void> = [];

  constructor(private readonly maxGlobalConcurrency: number = 2) {
    if (!Number.isInteger(maxGlobalConcurrency) || maxGlobalConcurrency < 1) {
      throw new RangeError(
        `global concurrency must be a positive integer, got ${String(maxGlobalConcurrency)}`,
      );
    }
  }

  async acquireSource(sourceId: number): Promise<() => void> {
    const slot = this.sourceSlot(sourceId);
    if (slot.inFlight === 0) {
      slot.inFlight = 1;
      return this.sourceReleaser(slot);
    }
    await new Promise<void>((resolve) => {
      slot.waiters.push(resolve);
    });
    return this.sourceReleaser(slot);
  }

  async acquireGlobal(): Promise<() => void> {
    if (this.globalInFlight < this.maxGlobalConcurrency) {
      this.globalInFlight += 1;
      return this.globalReleaser();
    }
    await new Promise<void>((resolve) => {
      this.globalWaiters.push(resolve);
    });
    return this.globalReleaser();
  }

  /** Milliseconds to wait before this source may dispatch again. */
  rateDelay(sourceId: number, gapMs: number, now: number): number {
    const slot = this.sourceSlot(sourceId);
    if (!Number.isFinite(slot.lastDispatchAt)) {
      return 0;
    }
    return Math.max(0, slot.lastDispatchAt + gapMs - now);
  }

  /** Record a dispatch at `at`; called immediately before the transport runs. */
  noteDispatch(sourceId: number, at: number): void {
    this.sourceSlot(sourceId).lastDispatchAt = at;
  }

  lastDispatchAt(sourceId: number): number | null {
    const slot = this.sources.get(sourceId);
    if (slot === undefined || !Number.isFinite(slot.lastDispatchAt)) {
      return null;
    }
    return slot.lastDispatchAt;
  }

  sourceInFlight(sourceId: number): number {
    return this.sources.get(sourceId)?.inFlight ?? 0;
  }

  get globalRequestsInFlight(): number {
    return this.globalInFlight;
  }

  private sourceSlot(sourceId: number): SourceSlot {
    let slot = this.sources.get(sourceId);
    if (slot === undefined) {
      slot = { inFlight: 0, lastDispatchAt: Number.NEGATIVE_INFINITY, waiters: [] };
      this.sources.set(sourceId, slot);
    }
    return slot;
  }

  private sourceReleaser(slot: SourceSlot): () => void {
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      const next = slot.waiters.shift();
      if (next !== undefined) {
        // Transfer the slot: inFlight stays 1 for the next holder.
        next();
        return;
      }
      slot.inFlight -= 1;
    };
  }

  private globalReleaser(): () => void {
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      const next = this.globalWaiters.shift();
      if (next !== undefined) {
        // Transfer the slot: globalInFlight stays the same.
        next();
        return;
      }
      this.globalInFlight -= 1;
    };
  }
}

const sharedLimiter = new PolitenessLimiter(2);

/** The process-wide limiter used by clients that do not inject one. */
export function getSharedPolitenessLimiter(): PolitenessLimiter {
  return sharedLimiter;
}

type AttemptOutcome =
  | { readonly kind: 'success'; readonly status: number; readonly html: string }
  | {
      readonly kind: 'http';
      readonly status: number;
      readonly retryAfter: string | null;
    }
  | { readonly kind: 'timeout'; readonly detail: string }
  | { readonly kind: 'network'; readonly detail: string }
  | { readonly kind: 'budget' };

/**
 * Parse a `Retry-After` header into milliseconds. Accepts delay-seconds
 * (`2`, `0.5`) and an HTTP-date. Returns null when absent or unparseable.
 */
export function parseRetryAfter(value: string | null, nowMs: number): number | null {
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed === '') {
    return null;
  }
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    return Math.max(0, Math.round(Number(trimmed) * 1_000));
  }
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) {
    return null;
  }
  return Math.max(0, date - nowMs);
}

function failure(
  outcome: Exclude<PoliteFailureOutcome, 'http_error'>,
  url: string,
  attempts: number,
  detail?: string,
): PoliteFailure {
  return detail === undefined
    ? { ok: false, outcome, url, attempts }
    : { ok: false, outcome, url, attempts, detail };
}

function httpFailure(url: string, attempts: number, status: number): PoliteFailure {
  return { ok: false, outcome: 'http_error', url, attempts, status };
}

function transportFailure(error: unknown): AttemptOutcome {
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error);
  if (name === 'TimeoutError' || name === 'AbortError') {
    return { kind: 'timeout', detail: message };
  }
  return { kind: 'network', detail: message };
}

export function createPoliteClient(options: PoliteClientOptions): PoliteClient {
  const transport = options.transport;
  const clock = options.clock ?? systemClock;
  const random = options.random ?? Math.random;
  const limiter = options.limiter ?? sharedLimiter;
  const rate: RatePolicy = { ...DEFAULT_RATE_POLICY, ...options.rate };
  const retry: RetryPolicy = { ...DEFAULT_RETRY_POLICY, ...options.retry };
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
  const defaultTimeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const createTimeoutSignal =
    options.createTimeoutSignal ?? ((ms: number): AbortSignal => AbortSignal.timeout(ms));

  if (!Number.isFinite(rate.minIntervalMs) || rate.minIntervalMs < 0) {
    throw new RangeError(`minIntervalMs must be >= 0, got ${String(rate.minIntervalMs)}`);
  }
  if (!Number.isFinite(rate.maxJitterMs) || rate.maxJitterMs < 0) {
    throw new RangeError(`maxJitterMs must be >= 0, got ${String(rate.maxJitterMs)}`);
  }
  if (!Number.isInteger(retry.maxAttempts) || retry.maxAttempts < 1) {
    throw new RangeError(`maxAttempts must be >= 1, got ${String(retry.maxAttempts)}`);
  }

  const jitter = (): number => {
    const unit = Math.min(Math.max(random(), 0), 1);
    return unit * rate.maxJitterMs;
  };

  const delayBeforeRetry = (retryAfter: string | null, attempts: number): number => {
    const exponential = Math.min(
      retry.baseDelayMs * 2 ** (attempts - 1),
      retry.maxDelayMs,
    );
    const header = parseRetryAfter(retryAfter, clock.now());
    const wanted = header === null ? exponential : Math.max(header, exponential);
    return Math.min(wanted, retry.maxDelayMs);
  };

  async function attempt(
    url: string,
    requestOptions: PoliteRequestOptions,
    beforeDispatch: () => void,
  ): Promise<AttemptOutcome> {
    const sourceId = requestOptions.sourceId;
    const budget = requestOptions.budget;
    const releaseSource = await limiter.acquireSource(sourceId);
    try {
      // Authoritative budget check: it runs while this request holds the
      // per-source slot, so concurrent requests cannot both pass the check.
      if (budget !== undefined && budget.used >= budget.limit) {
        return { kind: 'budget' };
      }

      const wait = limiter.rateDelay(sourceId, rate.minIntervalMs + jitter(), clock.now());
      if (wait > 0) {
        await clock.sleep(wait);
      }

      const releaseGlobal = await limiter.acquireGlobal();
      try {
        beforeDispatch();
        limiter.noteDispatch(sourceId, clock.now());
        const timeoutMs = requestOptions.timeoutMs ?? defaultTimeoutMs;
        const signal = createTimeoutSignal(timeoutMs);
        const headers: Record<string, string> = {
          'User-Agent': userAgent,
          Accept: 'text/html,application/xhtml+xml',
          ...requestOptions.headers,
        };

        let response: FetchResponse;
        try {
          response = await transport(url, {
            method: requestOptions.method ?? 'GET',
            headers,
            signal,
            redirect: 'follow',
          });
        } catch (error) {
          return transportFailure(error);
        }

        if (response.status < 200 || response.status >= 300) {
          return {
            kind: 'http',
            status: response.status,
            retryAfter: response.headers.get('retry-after'),
          };
        }

        try {
          const html = await response.text();
          return { kind: 'success', status: response.status, html };
        } catch (error) {
          return transportFailure(error);
        }
      } finally {
        releaseGlobal();
      }
    } finally {
      releaseSource();
    }
  }

  return {
    limiter,

    async request(url: string, requestOptions: PoliteRequestOptions): Promise<PoliteResult> {
      const budget = requestOptions.budget;
      let attempts = 0;

      for (;;) {
        if (!requestOptions.ingestEnabled) {
          return failure('disabled', url, attempts, 'INGEST_ENABLED is off');
        }
        if (!requestOptions.sourceEnabled) {
          return failure('disabled', url, attempts, `source ${requestOptions.sourceId} is disabled`);
        }
        const outcome = await attempt(url, requestOptions, () => {
          attempts += 1;
          if (budget !== undefined) {
            budget.used += 1;
          }
        });

        if (outcome.kind === 'success') {
          return {
            ok: true,
            status: outcome.status,
            html: outcome.html,
            url,
            attempts,
          };
        }
        if (outcome.kind === 'timeout') {
          return failure('timeout', url, attempts, outcome.detail);
        }
        if (outcome.kind === 'network') {
          return failure('network_error', url, attempts, outcome.detail);
        }
        if (outcome.kind === 'budget') {
          return failure('budget_exhausted', url, attempts);
        }

        const retryable = outcome.status === 429 || outcome.status >= 500;
        if (!retryable || attempts >= retry.maxAttempts) {
          return httpFailure(url, attempts, outcome.status);
        }
        await clock.sleep(delayBeforeRetry(outcome.retryAfter, attempts));
      }
    },
  };
}
