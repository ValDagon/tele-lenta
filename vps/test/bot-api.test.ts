import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createBotSender } from '../src/bot/index.js';

interface Call {
  url: string;
  body: unknown;
}

function transportFor(
  handler: (call: Call) => { status: number; body: string },
): { calls: Call[]; transport: typeof fetch } {
  const calls: Call[] = [];
  const transport = (async (url: string, init: { body: string }) => {
    const call = { url, body: JSON.parse(init.body) as unknown };
    calls.push(call);
    const response = handler(call);
    return {
      status: response.status,
      text: async () => response.body,
    };
  }) as unknown as typeof fetch;
  return { calls, transport };
}

const TOKEN = '123:secret';
const HTML = '<b>Привет</b> — <a href="https://t.me/bot">карточка</a>';

describe('bot api sender', () => {
  it('sends the digest payload with HTML and no preview', async () => {
    const { calls, transport } = transportFor(() => ({ status: 200, body: '{"ok":true}' }));
    const sender = createBotSender({ token: TOKEN, transport });

    const result = await sender.sendMessage(4242, HTML);

    assert.deepEqual(result, { status: 'sent' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, `https://api.telegram.org/bot${TOKEN}/sendMessage`);
    assert.deepEqual(calls[0]?.body, {
      chat_id: 4242,
      text: HTML,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
  });

  it('treats 403 as blocked', async () => {
    const { transport } = transportFor(() => ({
      status: 403,
      body: '{"ok":false,"description":"Forbidden: bot was blocked by the user"}',
    }));
    const result = await createBotSender({ token: TOKEN, transport }).sendMessage(1, HTML);
    assert.deepEqual(result, { status: 'blocked' });
  });

  it('treats 400 chat not found as blocked', async () => {
    const { transport } = transportFor(() => ({
      status: 400,
      body: '{"ok":false,"description":"Bad Request: chat not found"}',
    }));
    const result = await createBotSender({ token: TOKEN, transport }).sendMessage(1, HTML);
    assert.deepEqual(result, { status: 'blocked' });
  });

  it('treats other 400 answers as fatal', async () => {
    const { transport } = transportFor(() => ({
      status: 400,
      body: '{"ok":false,"description":"Bad Request: message is too long"}',
    }));
    const result = await createBotSender({ token: TOKEN, transport }).sendMessage(1, HTML);
    assert.deepEqual(result, { status: 'fatal', code: 400 });
  });

  it('reads retry_after seconds on 429', async () => {
    const { transport } = transportFor(() => ({
      status: 429,
      body: '{"ok":false,"error_code":429,"parameters":{"retry_after":7}}',
    }));
    const result = await createBotSender({ token: TOKEN, transport }).sendMessage(1, HTML);
    assert.deepEqual(result, { status: 'retry', retryAfterMs: 7000 });
  });

  it('returns retry without a delay when 429 has no retry_after', async () => {
    const { transport } = transportFor(() => ({ status: 429, body: '{}' }));
    const result = await createBotSender({ token: TOKEN, transport }).sendMessage(1, HTML);
    assert.deepEqual(result, { status: 'retry', retryAfterMs: null });
  });

  it('returns retry on 5xx', async () => {
    const { transport } = transportFor(() => ({ status: 502, body: 'bad gateway' }));
    const result = await createBotSender({ token: TOKEN, transport }).sendMessage(1, HTML);
    assert.deepEqual(result, { status: 'retry', retryAfterMs: null });
  });

  it('returns retry on a network failure', async () => {
    const transport = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    const result = await createBotSender({ token: TOKEN, transport }).sendMessage(1, HTML);
    assert.deepEqual(result, { status: 'retry', retryAfterMs: null });
  });

  it('paces consecutive sends without sleeping in tests', async () => {
    const { calls, transport } = transportFor(() => ({ status: 200, body: '{"ok":true}' }));
    let now = 0;
    const sleeps: number[] = [];
    const sender = createBotSender({
      token: TOKEN,
      transport,
      minIntervalMs: 34,
      now: () => now,
      sleep: async (ms) => {
        sleeps.push(ms);
        now += ms;
      },
    });

    await sender.sendMessage(1, HTML);
    await sender.sendMessage(2, HTML);

    assert.deepEqual(sleeps, [34]);
    assert.equal(calls.length, 2);
  });
});
