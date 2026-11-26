-- The v1 source list from docs/research/2026-11-source-inventory.md.
--
-- Every row starts disabled with a null cursor: a source is enabled only after
-- the manual backfill has set its cursor (spec «Backfill»). `montenegro_top_chat`
-- stays excluded; `montenegro_market` is goods only, so its section hint stays
-- classifieds and its category hint is goods.
--
-- Default intervals: a channel page yields up to 20 messages per request, so it
-- polls every 60 seconds; a group is scanned one message id at a time, so it
-- polls every 300 seconds. `interval_seconds` is per source and editable as data.
--
-- Titles are the public usernames until the owner supplies display names.
-- Category hints are set only where the inventory is unambiguous.

INSERT OR IGNORE INTO sources
  (username, title, kind, region, section_hint, category_hint, enabled, is_spam_source,
   interval_seconds, cursor_message_id, access_status)
VALUES
  -- Classifieds (groups)
  ('sale_me_com', 'sale_me_com', 'group', 'montenegro', 'classifieds', NULL, 0, 0, 300, NULL, 'public'),
  ('baraholka_Monte', 'baraholka_Monte', 'group', 'montenegro', 'classifieds', 'goods', 0, 0, 300, NULL, 'public'),
  ('montenegro_market', 'montenegro_market', 'group', 'montenegro', 'classifieds', 'goods', 0, 0, 300, NULL, 'public'),
  ('prodai_montenegro', 'prodai_montenegro', 'group', 'montenegro', 'classifieds', 'goods', 0, 0, 300, NULL, 'public'),
  ('nedviga_montenegro', 'nedviga_montenegro', 'group', 'montenegro', 'classifieds', 'real_estate', 0, 0, 300, NULL, 'public'),

  -- Jobs (one channel, three groups)
  ('montework', 'montework', 'channel', 'montenegro', 'jobs', NULL, 0, 0, 60, NULL, 'public'),
  ('jobmonte', 'jobmonte', 'group', 'montenegro', 'jobs', NULL, 0, 0, 300, NULL, 'public'),
  ('monte_Job', 'monte_Job', 'group', 'montenegro', 'jobs', NULL, 0, 0, 300, NULL, 'public'),
  ('saleme_job', 'saleme_job', 'group', 'montenegro', 'jobs', NULL, 0, 0, 300, NULL, 'public'),

  -- Events (one channel, one group)
  ('monteafisha', 'monteafisha', 'channel', 'montenegro', 'events', NULL, 0, 0, 60, NULL, 'public'),
  ('sutomoremontenegro', 'sutomoremontenegro', 'group', 'montenegro', 'events', NULL, 0, 0, 300, NULL, 'public');
