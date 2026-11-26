-- Product users and the allowlist (spec «Data model», «API and auth»).
--
-- The VPS `users` table is the source of truth for access. A row may be
-- created with `allowed = 0` when a signed session request carries the verified
-- Telegram profile of an unknown id, so `admin list` can show who tried to get
-- in and the owner can allow them later. The session itself still fails with
-- `not_invited` until the row is allowed; enforcement is per request on every
-- `/v1/*` route, never per session.
--
-- Saved searches and digest matches arrive with their own tickets and will
-- reference `telegram_user_id` in later numbered migrations. Nothing here
-- depends on them.

CREATE TABLE users (
  telegram_user_id INTEGER PRIMARY KEY CHECK (telegram_user_id > 0),
  username TEXT,
  first_name TEXT,
  allowed INTEGER NOT NULL DEFAULT 0 CHECK (allowed IN (0, 1)),
  digest_enabled INTEGER NOT NULL DEFAULT 1 CHECK (digest_enabled IN (0, 1)),
  -- Quiet hours are Europe/Podgorica wall-clock times, 'HH:MM'.
  quiet_start TEXT NOT NULL DEFAULT '23:00'
    CHECK (quiet_start GLOB '[0-2][0-9]:[0-5][0-9]'),
  quiet_end TEXT NOT NULL DEFAULT '08:00'
    CHECK (quiet_end GLOB '[0-2][0-9]:[0-5][0-9]'),
  -- Spam is hidden by default; ads are hidden only when the user opts in.
  spam_filter INTEGER NOT NULL DEFAULT 1 CHECK (spam_filter IN (0, 1)),
  ad_filter INTEGER NOT NULL DEFAULT 0 CHECK (ad_filter IN (0, 1)),
  -- Set by the digest worker when the bot cannot deliver; cleared by the next
  -- successful session upsert.
  digest_undeliverable_at TEXT,
  created_at TEXT NOT NULL,
  last_seen_at TEXT
);

CREATE INDEX users_allowed_idx ON users (allowed);
