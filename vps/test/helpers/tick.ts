/**
 * Tick test harness: a scripted transport and a virtual clock for the polite
 * client, plus small Telegram HTML builders. No test here sleeps or touches the
 * network; the database is a real temporary SQLite file.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Config } from '../../src/config.js';
import type { Db } from '../../src/db.js';
import {
  PolitenessLimiter,
  createPoliteClient,
  type Clock,
  type FetchLike,
  type FetchResponse,
  type PoliteClient,
} from '../../src/net/polite-client.js';
import type { Section, SourceKind } from '../../src/store/types.js';

export const fixturesDir = fileURLToPath(new URL('../fixtures/', import.meta.url));

export function fixture(name: string): string {
  return readFileSync(join(fixturesDir, name), 'utf8');
}

/** Sleeping advances virtual time and resolves immediately. */
export class FakeClock implements Clock {
  time = 0;

  now(): number {
    return this.time;
  }

  sleep(ms: number): Promise<void> {
    this.time += ms;
    return Promise.resolve();
  }
}

export interface ResponseSpec {
  status: number;
  body: string;
  headers?: Readonly<Record<string, string>>;
}

export function response(status: number, body = '', headers: Record<string, string> = {}): FetchResponse {
  const lowered = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    status,
    headers: { get: (name: string) => lowered.get(name.toLowerCase()) ?? null },
    text: async () => body,
  };
}

export function html(body: string, status = 200): ResponseSpec {
  return { status, body };
}

export function statusOnly(status: number): ResponseSpec {
  return { status, body: '' };
}

/**
 * Routes by exact URL; a missing route throws, so a scan cannot silently fetch
 * something the test did not script.
 */
export class ScriptedServer {
  readonly calls: string[] = [];
  private readonly routes = new Map<string, ResponseSpec | (() => ResponseSpec)>();

  on(url: string, responseSpec: ResponseSpec | (() => ResponseSpec)): this {
    this.routes.set(url, responseSpec);
    return this;
  }

  get transport(): FetchLike {
    return async (url) => {
      this.calls.push(url);
      const route = this.routes.get(url);
      if (route === undefined) {
        throw new Error(`unscripted request: ${url}`);
      }
      const spec = typeof route === 'function' ? route() : route;
      return response(spec.status, spec.body, spec.headers ?? {});
    };
  }

  callsTo(url: string): number {
    return this.calls.filter((call) => call === url).length;
  }
}

/** A client with no pacing, no jitter, and no retries, so tests stay fast. */
export function testClient(server: ScriptedServer, clock: Clock = new FakeClock()): PoliteClient {
  return createPoliteClient({
    transport: server.transport,
    clock,
    random: () => 0,
    limiter: new PolitenessLimiter(2),
    rate: { minIntervalMs: 0, maxJitterMs: 0 },
    retry: { maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0 },
  });
}

export interface SeedSourceInput {
  username: string;
  kind?: SourceKind;
  sectionHint?: Section;
  cursor?: number | null;
  enabled?: boolean;
  intervalSeconds?: number;
}

/**
 * Configures one source row. The migrations already seed the eleven v1
 * usernames, so this updates in place and inserts only a test-only username.
 */
export function seedSource(db: Db, input: SeedSourceInput): number {
  db.prepare(
    `INSERT INTO sources
      (username, title, kind, region, section_hint, enabled, interval_seconds, cursor_message_id)
     VALUES (?, ?, ?, 'montenegro', ?, ?, ?, ?)
     ON CONFLICT (username) DO UPDATE SET
       title = excluded.title,
       kind = excluded.kind,
       section_hint = excluded.section_hint,
       enabled = excluded.enabled,
       interval_seconds = excluded.interval_seconds,
       cursor_message_id = excluded.cursor_message_id`,
  ).run(
    input.username,
    input.username,
    input.kind ?? 'group',
    input.sectionHint ?? 'classifieds',
    input.enabled === false ? 0 : 1,
    input.intervalSeconds ?? 300,
    input.cursor ?? null,
  );
  const row = db.prepare('SELECT id FROM sources WHERE username = ?').get(input.username) as {
    id: number;
  };
  return row.id;
}

export function testConfig(databasePath: string, overrides: Partial<Config> = {}): Config {
  return {
    host: '127.0.0.1',
    port: 8787,
    databasePath,
    logLevel: 'silent',
    userAgent: 'TeleLenta/test',
    requestTimeoutMs: 1_000,
    detailProbeTimeoutMs: 2_000,
    tickRequestBudget: 40,
    backfillBudget: 5_000,
    sharedSecret: null,
    ownerTelegramId: null,
    botToken: null,
    botUsername: null,
    ...overrides,
  };
}

export interface WidgetInput {
  id: number;
  text?: string;
  datetime?: string;
  photos?: readonly string[];
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** One message widget in the shape the parser reads. */
export function widget(input: WidgetInput): string {
  const text = escapeHtml(input.text ?? '').replace(/\n/g, '<br>');
  const photos = (input.photos ?? [])
    .map(
      (url) =>
        `<a class="tgme_widget_message_photo_wrap" style="background-image:url('${escapeHtml(url)}')"><div></div></a>`,
    )
    .join('');
  return (
    `<div class="tgme_widget_message" data-post="test/${input.id}">` +
    `<div class="tgme_widget_message_text">${text}</div>` +
    photos +
    `<div class="tgme_widget_message_footer"><time datetime="${input.datetime ?? '2026-11-05T10:00:00+00:00'}"></time></div>` +
    `</div>`
  );
}

export function page(widgets: readonly WidgetInput[]): string {
  return `<html><body><section class="tgme_channel_history">${widgets.map(widget).join('')}</section></body></html>`;
}

/** A valid document with no message widgets, used to stop pagination. */
export const EMPTY_PAGE = '<html><body><div class="tgme_channel_history"></div></body></html>';

export function embed(input: WidgetInput): string {
  return `<html><body>${widget(input)}</body></html>`;
}

export function photo(id: string): string {
  return `https://cdn4.telesco.pe/file/${id}`;
}
