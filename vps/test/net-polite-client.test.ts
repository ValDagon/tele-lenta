import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  PolitenessLimiter,
  createPoliteClient,
  createRequestBudget,
  parseRetryAfter,
  type Clock,
  type FetchLike,
  type FetchResponse,
  type PoliteClientOptions,
  type PoliteRequestOptions,
} from '../src/net/polite-client.js';

/** Virtual clock: sleeping advances time instantly and never waits. */
class FakeClock implements Clock {
  time = 0;

  now(): number {
    return this.time;
  }

  sleep(ms: number): Promise<void> {
    this.time += ms;
    return Promise.resolve();
  }
}

interface RecordedCall {
  readonly url: string;
  readonly at: number;
  readonly headers: Record<string, string>;
  readonly signal: AbortSignal;
}

function response(
  status: number,
  body = '',
  headers: Readonly<Record<string, string>> = {},
): FetchResponse {
  const lowered = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    status,
    headers: { get: (name: string) => lowered.get(name.toLowerCase()) ?? null },
    text: async () => body,
  };
}

interface Recorder {
  readonly transport: FetchLike;
  readonly calls: RecordedCall[];
}

function recording(clock: FakeClock, handler: (call: RecordedCall) => FetchResponse): Recorder {
  const calls: RecordedCall[] = [];
  const transport: FetchLike = async (url, init) => {
    const call: RecordedCall = {
      url,
      at: clock.now(),
      headers: init.headers,
      signal: init.signal,
    };
    calls.push(call);
    return handler(call);
  };
  return { transport, calls };
}

function scripted(clock: FakeClock, results: readonly FetchResponse[]): Recorder {
  let index = 0;
  return recording(clock, () => {
    const result = results[index];
    index += 1;
    if (result === undefined) {
      throw new Error(`scripted transport ran out of responses at call ${index}`);
    }
    return result;
  });
}

interface BlockingTransport {
  readonly transport: FetchLike;
  readonly calls: RecordedCall[];
  readonly maxGlobal: number;
  readonly maxPerSource: Map<string, number>;
  releaseOne(): boolean;
}

/** A transport that holds every request until the test releases it. */
function blocking(clock: FakeClock): BlockingTransport {
  const calls: RecordedCall[] = [];
  const pending: Array<() => void> = [];
  const perSource = new Map<string, number>();
  let inFlight = 0;
  let maxGlobal = 0;
  const maxPerSource = new Map<string, number>();

  const transport: FetchLike = async (url, init) => {
    calls.push({ url, at: clock.now(), headers: init.headers, signal: init.signal });
    inFlight += 1;
    maxGlobal = Math.max(maxGlobal, inFlight);
    const source = new URL(url).pathname;
    const current = (perSource.get(source) ?? 0) + 1;
    perSource.set(source, current);
    maxPerSource.set(source, Math.max(maxPerSource.get(source) ?? 0, current));

    await new Promise<void>((resolve) => {
      pending.push(resolve);
    });

    inFlight -= 1;
    perSource.set(source, (perSource.get(source) ?? 1) - 1);
    return response(200, '<html>ok</html>');
  };

  return {
    transport,
    calls,
    get maxGlobal() {
      return maxGlobal;
    },
    maxPerSource,
    releaseOne(): boolean {
      const next = pending.shift();
      if (next === undefined) {
        return false;
      }
      next();
      return true;
    },
  };
}

async function settle(rounds = 3): Promise<void> {
  for (let round = 0; round < rounds; round += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

function options(overrides: Partial<PoliteClientOptions> & Pick<PoliteClientOptions, 'transport'>): PoliteClientOptions {
  return {
    clock: new FakeClock(),
    random: () => 0,
    ...overrides,
  };
}

function requestFor(sourceId: number, overrides: Partial<PoliteRequestOptions> = {}): PoliteRequestOptions {
  return {
    sourceId,
    sourceEnabled: true,
    ingestEnabled: true,
    ...overrides,
  };
}

function freshLimiter(): PolitenessLimiter {
  return new PolitenessLimiter(2);
}

describe('polite HTTP client', () => {
  it('returns html and a descriptive User-Agent on success', async () => {
    const clock = new FakeClock();
    const recorder = recording(clock, () => response(200, '<html>page</html>'));
    const client = createPoliteClient(
      options({
        transport: recorder.transport,
        clock,
        limiter: freshLimiter(),
        userAgent: 'TeleLenta-test/1.0 (+example)',
      }),
    );

    const result = await client.request('https://t.me/s/montework', requestFor(1));

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.status, 200);
      assert.equal(result.html, '<html>page</html>');
      assert.equal(result.attempts, 1);
    }
    assert.equal(recorder.calls[0]?.headers['User-Agent'], 'TeleLenta-test/1.0 (+example)');
  });

  it('holds at most 2 requests globally and 1 per source under a burst', async () => {
    const clock = new FakeClock();
    const fake = blocking(clock);
    const limiter = freshLimiter();
    const client = createPoliteClient(options({ transport: fake.transport, clock, limiter }));

    const urls = ['a', 'b', 'c', 'd', 'e'].map((name) => `https://t.me/s/${name}`);
    const pending = urls.map((url, index) => client.request(url, requestFor(index + 1)));

    await settle();
    assert.equal(fake.calls.length, 2);
    assert.equal(limiter.globalRequestsInFlight, 2);

    let released = 0;
    while (released < urls.length) {
      assert.equal(fake.releaseOne(), true);
      released += 1;
      await settle();
    }

    const results = await Promise.all(pending);
    assert.equal(results.every((result) => result.ok), true);
    assert.equal(fake.calls.length, 5);
    assert.equal(fake.maxGlobal, 2);
    for (const max of fake.maxPerSource.values()) {
      assert.equal(max, 1);
    }
  });

  it('never runs two requests for one source at the same time', async () => {
    const clock = new FakeClock();
    const fake = blocking(clock);
    const limiter = freshLimiter();
    const client = createPoliteClient(options({ transport: fake.transport, clock, limiter }));

    const pending = [0, 1, 2].map(() =>
      client.request('https://t.me/s/montework', requestFor(7)),
    );

    await settle();
    assert.equal(fake.calls.length, 1);
    assert.equal(limiter.sourceInFlight(7), 1);

    let released = 0;
    while (released < 3) {
      assert.equal(fake.releaseOne(), true);
      released += 1;
      await settle();
    }
    await Promise.all(pending);
    assert.equal(fake.maxPerSource.get('/s/montework'), 1);
  });

  it('spaces consecutive requests for one source by at least 1s, plus bounded jitter', async () => {
    const clock = new FakeClock();
    const recorder = recording(clock, () => response(200, 'ok'));
    const limiter = freshLimiter();
    const client = createPoliteClient(
      options({
        transport: recorder.transport,
        clock,
        limiter,
        random: () => 1,
        rate: { minIntervalMs: 1_000, maxJitterMs: 250 },
      }),
    );

    await client.request('https://t.me/s/montework', requestFor(1));
    await client.request('https://t.me/s/montework', requestFor(1));
    await client.request('https://t.me/s/montework', requestFor(1));

    const times = recorder.calls.map((call) => call.at);
    assert.deepEqual(times, [0, 1_250, 2_500]);
    for (let index = 1; index < times.length; index += 1) {
      const gap = (times[index] as number) - (times[index - 1] as number);
      assert.ok(gap >= 1_000 && gap <= 1_250, `gap ${gap}ms outside [1000, 1250]`);
    }
  });

  it('does not serialize different sources beyond the global cap', async () => {
    const clock = new FakeClock();
    const recorder = recording(clock, () => response(200, 'ok'));
    const client = createPoliteClient(
      options({ transport: recorder.transport, clock, limiter: freshLimiter() }),
    );

    await Promise.all([
      client.request('https://t.me/s/a', requestFor(1)),
      client.request('https://t.me/s/b', requestFor(2)),
    ]);

    assert.deepEqual(
      recorder.calls.map((call) => call.at),
      [0, 0],
    );
  });

  it('refuses the request after the per-source budget is spent', async () => {
    const clock = new FakeClock();
    const recorder = recording(clock, () => response(200, 'ok'));
    const client = createPoliteClient(
      options({ transport: recorder.transport, clock, limiter: freshLimiter() }),
    );
    const budget = createRequestBudget(2);

    const first = await client.request('https://t.me/s/a', requestFor(1, { budget }));
    const second = await client.request('https://t.me/s/a', requestFor(1, { budget }));
    const third = await client.request('https://t.me/s/a', requestFor(1, { budget }));

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(third.ok, false);
    if (!third.ok) {
      assert.equal(third.outcome, 'budget_exhausted');
      assert.equal(third.attempts, 0);
    }
    assert.equal(recorder.calls.length, 2);
    assert.equal(budget.used, 2);
  });

  it('counts retries against the budget', async () => {
    const clock = new FakeClock();
    const recorder = scripted(clock, [response(500, 'boom'), response(200, 'ok')]);
    const client = createPoliteClient(
      options({ transport: recorder.transport, clock, limiter: freshLimiter() }),
    );
    const budget = createRequestBudget(1);

    const result = await client.request('https://t.me/s/a', requestFor(1, { budget }));

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.outcome, 'budget_exhausted');
      assert.equal(result.attempts, 1);
    }
    assert.equal(recorder.calls.length, 1);
  });

  it('does not overspend a shared budget under concurrent requests', async () => {
    const clock = new FakeClock();
    const fake = blocking(clock);
    const client = createPoliteClient(
      options({ transport: fake.transport, clock, limiter: freshLimiter() }),
    );
    const budget = createRequestBudget(1);

    const first = client.request('https://t.me/s/a', requestFor(1, { budget }));
    const second = client.request('https://t.me/s/a', requestFor(1, { budget }));

    await settle();
    assert.equal(fake.calls.length, 1);
    fake.releaseOne();

    const results = await Promise.all([first, second]);
    assert.equal(results[0]?.ok, true);
    assert.equal(results[1]?.ok, false);
    if (results[1] !== undefined && !results[1].ok) {
      assert.equal(results[1].outcome, 'budget_exhausted');
    }
    assert.equal(fake.calls.length, 1);
    assert.equal(budget.used, 1);
  });

  it('retries 429 after honouring Retry-After', async () => {
    const clock = new FakeClock();
    const recorder = scripted(clock, [
      response(429, 'slow down', { 'retry-after': '2' }),
      response(200, 'ok'),
    ]);
    const limiter = freshLimiter();
    const client = createPoliteClient(
      options({
        transport: recorder.transport,
        clock,
        limiter,
        retry: { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 30_000 },
      }),
    );

    const result = await client.request('https://t.me/s/a', requestFor(1));

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.attempts, 2);
    }
    assert.deepEqual(
      recorder.calls.map((call) => call.at),
      [0, 2_000],
    );
  });

  it('backs off exponentially over 5xx and then succeeds', async () => {
    const clock = new FakeClock();
    const recorder = scripted(clock, [
      response(500, 'boom'),
      response(503, 'busy'),
      response(200, 'ok'),
    ]);
    const client = createPoliteClient(
      options({
        transport: recorder.transport,
        clock,
        limiter: freshLimiter(),
        retry: { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 30_000 },
      }),
    );

    const result = await client.request('https://t.me/s/a', requestFor(1));

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.attempts, 3);
    }
    const times = recorder.calls.map((call) => call.at);
    assert.deepEqual(times, [0, 1_000, 2_000]);
  });

  it('stops at the attempt cap and reports the last status', async () => {
    const clock = new FakeClock();
    const recorder = scripted(clock, [
      response(500, 'boom'),
      response(500, 'boom'),
      response(500, 'boom'),
      response(200, 'unreachable'),
    ]);
    const client = createPoliteClient(
      options({
        transport: recorder.transport,
        clock,
        limiter: freshLimiter(),
        retry: { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 30_000 },
      }),
    );

    const result = await client.request('https://t.me/s/a', requestFor(1));

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.outcome, 'http_error');
      assert.equal(result.status, 500);
      assert.equal(result.attempts, 3);
    }
    assert.equal(recorder.calls.length, 3);
  });

  it('does not retry a 404 or any other 4xx', async () => {
    const clock = new FakeClock();
    const recorder = scripted(clock, [response(404, 'not found'), response(200, 'unreachable')]);
    const client = createPoliteClient(
      options({ transport: recorder.transport, clock, limiter: freshLimiter() }),
    );

    const result = await client.request('https://t.me/a/1?embed=1', requestFor(1));

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.outcome, 'http_error');
      assert.equal(result.status, 404);
      assert.equal(result.attempts, 1);
    }
    assert.equal(recorder.calls.length, 1);
  });

  it('reports a timeout as a typed failure, never as success', async () => {
    const clock = new FakeClock();
    const transport: FetchLike = async () => {
      const error = new Error('The operation was aborted due to timeout');
      error.name = 'TimeoutError';
      throw error;
    };
    const client = createPoliteClient(
      options({ transport, clock, limiter: freshLimiter() }),
    );

    const result = await client.request('https://t.me/a/1?embed=1', requestFor(1, { timeoutMs: 2_000 }));

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.outcome, 'timeout');
      assert.equal(result.attempts, 1);
      assert.match(result.detail ?? '', /timeout/);
    }
  });

  it('reports a network error as a typed failure, never as success', async () => {
    const clock = new FakeClock();
    const transport: FetchLike = async () => {
      throw new TypeError('fetch failed');
    };
    const client = createPoliteClient(
      options({ transport, clock, limiter: freshLimiter() }),
    );

    const result = await client.request('https://t.me/s/a', requestFor(1));

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.outcome, 'network_error');
      assert.equal(result.detail, 'fetch failed');
    }
  });

  it('short-circuits both kill switches without touching the transport', async () => {
    const clock = new FakeClock();
    const recorder = recording(clock, () => response(200, 'ok'));
    const client = createPoliteClient(
      options({ transport: recorder.transport, clock, limiter: freshLimiter() }),
    );
    const budget = createRequestBudget(5);

    const ingestOff = await client.request(
      'https://t.me/s/a',
      requestFor(1, { ingestEnabled: false, budget }),
    );
    const sourceOff = await client.request(
      'https://t.me/s/a',
      requestFor(1, { sourceEnabled: false, budget }),
    );

    assert.equal(ingestOff.ok, false);
    assert.equal(sourceOff.ok, false);
    if (!ingestOff.ok) {
      assert.equal(ingestOff.outcome, 'disabled');
      assert.equal(ingestOff.attempts, 0);
    }
    if (!sourceOff.ok) {
      assert.equal(sourceOff.outcome, 'disabled');
      assert.match(sourceOff.detail ?? '', /disabled/);
    }
    assert.equal(recorder.calls.length, 0);
    assert.equal(budget.used, 0);
  });

  it('passes the per-call timeout to the signal factory', async () => {
    const clock = new FakeClock();
    const recorder = recording(clock, () => response(200, 'ok'));
    const timeouts: number[] = [];
    const client = createPoliteClient(
      options({
        transport: recorder.transport,
        clock,
        limiter: freshLimiter(),
        timeoutMs: 10_000,
        createTimeoutSignal: (ms: number): AbortSignal => {
          timeouts.push(ms);
          return AbortSignal.abort();
        },
      }),
    );

    await client.request('https://t.me/a/1?embed=1', requestFor(1, { timeoutMs: 2_000 }));
    await client.request('https://t.me/s/a', requestFor(1));

    assert.deepEqual(timeouts, [2_000, 10_000]);
  });
});

describe('Retry-After parsing', () => {
  it('reads delay-seconds and HTTP dates', () => {
    assert.equal(parseRetryAfter('2', 0), 2_000);
    assert.equal(parseRetryAfter('0.5', 0), 500);
    assert.equal(parseRetryAfter('0', 0), 0);
    const date = new Date(10_000).toUTCString();
    assert.equal(parseRetryAfter(date, 1_000), 9_000);
  });

  it('returns null for a missing or unparseable header', () => {
    assert.equal(parseRetryAfter(null, 0), null);
    assert.equal(parseRetryAfter('', 0), null);
    assert.equal(parseRetryAfter('soon', 0), null);
  });
});
