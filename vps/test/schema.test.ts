import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { migrate } from '../src/migrate.js';

import {
  closeTestDatabase,
  createTestDatabase,
  type TestDatabase,
} from './helpers/database.js';

let current: TestDatabase | null = null;

afterEach(async () => {
  if (current !== null) {
    await closeTestDatabase(current);
    current = null;
  }
});

async function database(prefix: string): Promise<TestDatabase> {
  current = await createTestDatabase(prefix);
  return current;
}

function columns(db: TestDatabase['db'], table: string): string[] {
  const rows = db.pragma(`table_info(${table})`) as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

function assertColumns(table: string, expected: readonly string[], db: TestDatabase['db']): void {
  assert.deepEqual(columns(db, table).sort(), [...expected].sort(), `columns of ${table}`);
}

function indexColumns(indexName: string, db: TestDatabase['db']): string[] {
  const rows = db.pragma(`index_info(${indexName})`) as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

function tableNames(db: TestDatabase['db']): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

describe('ingestion schema', () => {
  it('creates every table the spec names', async () => {
    const { db } = await database('tele-lenta-schema-tables-');

    assert.deepEqual(tableNames(db), [
      'app_state',
      'clusters',
      'ingest_runs',
      'listing_photos',
      'listings',
      'migrations',
      'negative_cache',
      'parser_failures',
      'saved_search_matches',
      'saved_searches',
      'sources',
      'users',
    ]);
  });

  it('extends the source registry with every column from the spec', async () => {
    const { db } = await database('tele-lenta-schema-sources-');

    assertColumns(
      'sources',
      [
        'id',
        'username',
        'title',
        'kind',
        'region',
        'section_hint',
        'category_hint',
        'enabled',
        'is_spam_source',
        'interval_seconds',
        'cursor_message_id',
        'last_success_at',
        'last_error_at',
        'consecutive_failures',
        'access_status',
        'created_at',
      ],
      db,
    );

    const unique = (db.pragma('index_list(sources)') as Array<{ name: string; unique: number }>).filter(
      (index) => index.unique === 1,
    );
    assert.ok(
      unique.some((index) => indexColumns(index.name, db).join(',') === 'username'),
      'username must be unique',
    );
    assert.deepEqual(indexColumns('sources_enabled_idx', db), ['enabled']);
  });

  it('creates listings with the spec columns, unique message key, and feed index', async () => {
    const { db } = await database('tele-lenta-schema-listings-');

    assertColumns(
      'listings',
      [
        'id',
        'source_id',
        'message_id',
        'url',
        'published_at',
        'edited_at',
        'fetched_at',
        'text_raw',
        'text_normalized',
        'search_text',
        'content_hash',
        'title',
        'section',
        'category',
        'demand',
        'city',
        'price_raw',
        'price_value',
        'price_currency',
        'price_period',
        'salary_raw',
        'event_starts_at',
        'has_photos',
        'photo_count',
        'has_video',
        'is_ad',
        'is_spam',
        'cluster_id',
        'message_status',
        'parser_version',
      ],
      db,
    );

    const unique = (db.pragma('index_list(listings)') as Array<{ name: string; unique: number }>).filter(
      (index) => index.unique === 1,
    );
    assert.ok(
      unique.some(
        (index) => indexColumns(index.name, db).join(',') === 'source_id,message_id',
      ),
      'listings must be unique on (source_id, message_id)',
    );
    assert.deepEqual(indexColumns('listings_cluster_published_idx', db), [
      'cluster_id',
      'published_at',
      'id',
    ]);
  });

  it('creates photos keyed by listing and position with a cascade', async () => {
    const { db } = await database('tele-lenta-schema-photos-');

    assertColumns('listing_photos', ['listing_id', 'position', 'url', 'width', 'height'], db);

    const foreignKeys = db.pragma('foreign_key_list(listing_photos)') as Array<{
      table: string;
      on_delete: string;
    }>;
    const listingKey = foreignKeys.find((key) => key.table === 'listings');
    assert.ok(listingKey, 'listing_photos must reference listings');
    assert.equal(listingKey.on_delete, 'CASCADE');

    const primaryKey = (db.pragma('table_info(listing_photos)') as Array<{ name: string; pk: number }>)
      .filter((column) => column.pk > 0)
      .sort((a, b) => a.pk - b.pk)
      .map((column) => column.name);
    assert.deepEqual(primaryKey, ['listing_id', 'position']);
  });

  it('creates clusters with bookkeeping columns and the three indices', async () => {
    const { db } = await database('tele-lenta-schema-clusters-');

    assertColumns(
      'clusters',
      [
        'id',
        'cluster_key',
        'section',
        'category',
        'demand',
        'earliest_published_at',
        'first_seen_at',
        'listing_count',
        'source_count',
        'available_listing_count',
        'hidden',
      ],
      db,
    );

    assert.deepEqual(indexColumns('clusters_earliest_idx', db), ['earliest_published_at', 'id']);
    assert.deepEqual(indexColumns('clusters_key_earliest_idx', db), [
      'cluster_key',
      'earliest_published_at',
    ]);
    assert.deepEqual(indexColumns('clusters_first_seen_idx', db), ['first_seen_at']);

    const unique = (db.pragma('index_list(clusters)') as Array<{ unique: number }>).filter(
      (index) => index.unique === 1,
    );
    assert.deepEqual(unique, [], 'cluster_key is deliberately not unique');
  });

  it('creates ingest runs, parser failures, app state, and the negative cache', async () => {
    const { db } = await database('tele-lenta-schema-ops-');

    assertColumns(
      'ingest_runs',
      [
        'id',
        'source_id',
        'started_at',
        'finished_at',
        'status',
        'fetched',
        'inserted',
        'updated',
        'skipped',
        'errors',
        'cursor_before',
        'cursor_after',
        'error_sample',
      ],
      db,
    );

    assertColumns(
      'parser_failures',
      ['id', 'source_id', 'message_id', 'url', 'error', 'html_excerpt', 'created_at'],
      db,
    );

    assertColumns('app_state', ['key', 'value'], db);
    assertColumns('negative_cache', ['source_id', 'message_id', 'expires_at'], db);

    assert.deepEqual(indexColumns('negative_cache_expires_idx', db), ['expires_at']);
    assert.deepEqual(indexColumns('parser_failures_created_idx', db), ['created_at']);
  });

  it('creates saved searches and digest matches with cascades and the user index', async () => {
    const { db } = await database('tele-lenta-schema-saved-searches-');

    assertColumns(
      'saved_searches',
      [
        'id',
        'user_id',
        'name',
        'query',
        'section',
        'categories_json',
        'demand',
        'sources_json',
        'enabled',
        'last_checked_at',
        'last_sent_at',
        'created_at',
      ],
      db,
    );

    assertColumns(
      'saved_search_matches',
      ['saved_search_id', 'cluster_id', 'matched_at', 'sent_at'],
      db,
    );

    assert.deepEqual(indexColumns('saved_searches_user_idx', db), ['user_id']);

    const searchKeys = db.pragma('foreign_key_list(saved_searches)') as Array<{
      table: string;
      from: string;
      on_delete: string;
    }>;
    const userKey = searchKeys.find((key) => key.table === 'users');
    assert.ok(userKey, 'saved_searches must reference users');
    assert.equal(userKey.from, 'user_id');
    assert.equal(userKey.on_delete, 'CASCADE');

    const matchKeys = db.pragma('foreign_key_list(saved_search_matches)') as Array<{
      table: string;
      from: string;
      on_delete: string;
    }>;
    const searchRef = matchKeys.find((key) => key.table === 'saved_searches');
    assert.ok(searchRef, 'saved_search_matches must reference saved_searches');
    assert.equal(searchRef.on_delete, 'CASCADE');
    const clusterRef = matchKeys.find((key) => key.table === 'clusters');
    assert.ok(clusterRef, 'saved_search_matches must reference clusters');
    assert.equal(clusterRef.on_delete, 'CASCADE');

    const primaryKey = (
      db.pragma('table_info(saved_search_matches)') as Array<{ name: string; pk: number }>
    )
      .filter((column) => column.pk > 0)
      .sort((a, b) => a.pk - b.pk)
      .map((column) => column.name);
    assert.deepEqual(primaryKey, ['saved_search_id', 'cluster_id']);
  });

  it('applies every migration twice without changing the schema', async () => {
    const { db } = await database('tele-lenta-schema-idempotent-');

    const snapshot = (): unknown[] =>
      db
        .prepare(
          "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name",
        )
        .all();

    const before = snapshot();
    const second = migrate(db);
    assert.deepEqual(second.applied, []);
    assert.deepEqual(snapshot(), before);
  });
});
