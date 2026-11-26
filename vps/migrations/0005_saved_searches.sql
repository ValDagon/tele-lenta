-- Saved searches and digest matches (spec «Data model (VPS SQLite)»).
--
-- `saved_searches` is the reader's stored query plus filters; the digest worker
-- (ticket #16) writes `last_checked_at` / `last_sent_at`. `saved_search_matches`
-- is the repeat-suppression ledger: the primary key on
-- `(saved_search_id, cluster_id)` is what makes `INSERT OR IGNORE` safe across
-- overlapping ticks, so the same cluster never reaches one search twice.
--
-- Both rows belong to a user, so `admin forget` erases them with the user:
-- `saved_searches` cascades from `users`, and `saved_search_matches` cascades
-- from both the saved search and the cluster (retention removes clusters).
-- The feature code that uses these tables arrives with tickets #15 and #16;
-- nothing in v1 reads them yet.

CREATE TABLE saved_searches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL
    REFERENCES users (telegram_user_id) ON DELETE CASCADE,
  -- Auto-generated on save unless the reader renames it.
  name TEXT NOT NULL,
  -- Empty string means "no text query"; filters alone still make a search.
  query TEXT NOT NULL DEFAULT '',
  -- Null means all sections (search is cross-section by default).
  section TEXT CHECK (section IS NULL OR section IN ('classifieds', 'jobs', 'events')),
  -- JSON arrays of category ids and source ids, written and read by #15.
  categories_json TEXT NOT NULL DEFAULT '[]',
  demand TEXT CHECK (demand IS NULL OR demand IN ('offer', 'wanted')),
  sources_json TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  -- Matching advances `last_checked_at`; send success advances `last_sent_at`.
  last_checked_at TEXT,
  last_sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX saved_searches_user_idx ON saved_searches (user_id);

CREATE TABLE saved_search_matches (
  saved_search_id INTEGER NOT NULL
    REFERENCES saved_searches (id) ON DELETE CASCADE,
  cluster_id INTEGER NOT NULL
    REFERENCES clusters (id) ON DELETE CASCADE,
  matched_at TEXT NOT NULL,
  -- Null until the digest message carrying this match is delivered.
  sent_at TEXT,
  PRIMARY KEY (saved_search_id, cluster_id)
);
