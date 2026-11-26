-- Ingestion schema (spec «Data model (VPS SQLite)»): the source registry gains
-- the columns the collector needs, plus listings, photos, clusters, runs,
-- parser failures, app state, and the negative cache.
--
-- 0001 shipped a minimal `sources` table with `enabled` defaulting to 1. The
-- registry contract is "a row is inserted disabled" (spec «Backfill»), so the
-- table is rebuilt here with `enabled DEFAULT 0` and the remaining columns.
-- Nothing references `sources` yet at this point, so the rebuild is safe.

CREATE TABLE sources_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  title TEXT,
  kind TEXT NOT NULL DEFAULT 'group' CHECK (kind IN ('group', 'channel')),
  region TEXT NOT NULL DEFAULT 'montenegro',
  section_hint TEXT NOT NULL DEFAULT 'classifieds'
    CHECK (section_hint IN ('classifieds', 'jobs', 'events')),
  category_hint TEXT,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  is_spam_source INTEGER NOT NULL DEFAULT 0 CHECK (is_spam_source IN (0, 1)),
  interval_seconds INTEGER NOT NULL DEFAULT 300 CHECK (interval_seconds > 0),
  cursor_message_id INTEGER,
  last_success_at TEXT,
  last_error_at TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  access_status TEXT NOT NULL DEFAULT 'public'
    CHECK (access_status IN ('public', 'invite', 'closed')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO sources_new (id, username, title, enabled, last_success_at)
  SELECT id, username, title, enabled, last_success_at FROM sources;

DROP TABLE sources;
ALTER TABLE sources_new RENAME TO sources;

CREATE INDEX sources_enabled_idx ON sources (enabled);

-- One row per cluster, bookkeeping only. The clusterer is the sole writer and
-- recomputes every column from the member listings. Display strings live on the
-- representative listing and are joined at read time.
CREATE TABLE clusters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Deliberately not unique: the same key may open a later cluster once the
  -- 72-hour window has closed.
  cluster_key TEXT NOT NULL,
  section TEXT NOT NULL,
  category TEXT NOT NULL,
  demand TEXT NOT NULL,
  earliest_published_at TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  listing_count INTEGER NOT NULL DEFAULT 0 CHECK (listing_count >= 0),
  source_count INTEGER NOT NULL DEFAULT 0 CHECK (source_count >= 0),
  available_listing_count INTEGER NOT NULL DEFAULT 0 CHECK (available_listing_count >= 0),
  hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1))
);

CREATE INDEX clusters_earliest_idx ON clusters (earliest_published_at, id);
CREATE INDEX clusters_key_earliest_idx ON clusters (cluster_key, earliest_published_at);
CREATE INDEX clusters_first_seen_idx ON clusters (first_seen_at);

-- One row per source message. `cluster_id` is membership: the index below
-- serves the feed join, the source trail, and the representative lookup.
CREATE TABLE listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER NOT NULL REFERENCES sources (id),
  message_id INTEGER NOT NULL,
  url TEXT NOT NULL,
  published_at TEXT NOT NULL,
  edited_at TEXT,
  fetched_at TEXT NOT NULL,
  text_raw TEXT NOT NULL DEFAULT '',
  text_normalized TEXT NOT NULL DEFAULT '',
  search_text TEXT NOT NULL DEFAULT '',
  content_hash TEXT NOT NULL,
  title TEXT,
  section TEXT NOT NULL CHECK (section IN ('classifieds', 'jobs', 'events')),
  category TEXT NOT NULL,
  demand TEXT NOT NULL,
  city TEXT,
  price_raw TEXT,
  price_value REAL,
  price_currency TEXT,
  price_period TEXT,
  salary_raw TEXT,
  event_starts_at TEXT,
  has_photos INTEGER NOT NULL DEFAULT 0 CHECK (has_photos IN (0, 1)),
  photo_count INTEGER NOT NULL DEFAULT 0 CHECK (photo_count >= 0),
  has_video INTEGER NOT NULL DEFAULT 0 CHECK (has_video IN (0, 1)),
  is_ad INTEGER NOT NULL DEFAULT 0 CHECK (is_ad IN (0, 1)),
  is_spam INTEGER NOT NULL DEFAULT 0 CHECK (is_spam IN (0, 1)),
  cluster_id INTEGER REFERENCES clusters (id) ON DELETE SET NULL,
  message_status TEXT NOT NULL DEFAULT 'available'
    CHECK (message_status IN ('available', 'deleted')),
  parser_version TEXT NOT NULL,
  UNIQUE (source_id, message_id)
);

CREATE INDEX listings_cluster_published_idx ON listings (cluster_id, published_at, id);

CREATE TABLE listing_photos (
  listing_id INTEGER NOT NULL REFERENCES listings (id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  url TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  PRIMARY KEY (listing_id, position)
);

-- `status` carries the lifecycle the tick writes: 'running', then 'ok',
-- 'failed', or 'skipped'. It is intentionally unconstrained: the spec names the
-- column but not its vocabulary, and the tick owns it.
CREATE TABLE ingest_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER NOT NULL REFERENCES sources (id),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  fetched INTEGER NOT NULL DEFAULT 0 CHECK (fetched >= 0),
  inserted INTEGER NOT NULL DEFAULT 0 CHECK (inserted >= 0),
  updated INTEGER NOT NULL DEFAULT 0 CHECK (updated >= 0),
  skipped INTEGER NOT NULL DEFAULT 0 CHECK (skipped >= 0),
  errors INTEGER NOT NULL DEFAULT 0 CHECK (errors >= 0),
  cursor_before INTEGER,
  cursor_after INTEGER,
  error_sample TEXT
);

CREATE INDEX ingest_runs_source_started_idx ON ingest_runs (source_id, started_at);

CREATE TABLE parser_failures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER NOT NULL REFERENCES sources (id),
  message_id INTEGER,
  url TEXT NOT NULL,
  error TEXT NOT NULL,
  html_excerpt TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX parser_failures_created_idx ON parser_failures (created_at);

-- Key/value for kill switches, the last global ingest time, and alert
-- throttling.
CREATE TABLE app_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- The spec requires a 24-hour negative cache for explicit not-found responses
-- but does not name a table; this is its storage. Only the group path's forward
-- scan consults it — a re-check of a known listing always issues a live request.
CREATE TABLE negative_cache (
  source_id INTEGER NOT NULL REFERENCES sources (id),
  message_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (source_id, message_id)
);

CREATE INDEX negative_cache_expires_idx ON negative_cache (expires_at);
