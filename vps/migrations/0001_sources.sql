-- Minimal source registry: only what /health needs to report freshness.
-- Later tickets extend this table with their own numbered migrations.
CREATE TABLE sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  title TEXT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  last_success_at TEXT
);

CREATE INDEX sources_enabled_idx ON sources (enabled);
