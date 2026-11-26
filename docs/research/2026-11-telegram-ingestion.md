# Telegram ingestion: what the sources actually do

Research note, 2026-11-05. Feeds the ingestion ADR; it is not itself a decision.

## Sources reviewed

- [NyanNyanovich/nyan](https://github.com/NyanNyanovich/nyan) — repository, `README.md`,
  `CLAUDE.md`, `crawler/spiders/telegram.py`, `crawler/pipelines.py`, `channels.json`,
  `docker-compose.yml`, `requirements.txt`. Active; last push 2026-11-05.
- [Habr 942490](https://habr.com/ru/companies/amvera/articles/942490/) — 2025-08-31,
  userbot + Qdrant + LLM, 25 comments.
- [Habr 838204](https://habr.com/ru/companies/amvera/articles/838204/) — 2024-08-24,
  Pyrogram userbot basics, 35 comments.
- Telegram Bot API and Serverless docs, checked separately on 2026-11-05.

## What nyan actually does

The crawler is **Scrapy over the public web preview**, not Telethon and not the Bot API.
`CLAUDE.md`: "scrapes the public web preview (`telegram.me/s/<channel>`) rather than the
Bot API, so it can read channels it isn't a member of." No Telegram account, no session
file, no ban surface.

- Pagination: `?before=<min_post_id>` until the oldest post falls out of the time window;
  per-channel cursor in `crawler/fetch_times.json`.
- Extracted per post: text, views, `background-image` URLs, `<video src>`, reply and
  forward links, canonical `?embed=1` URL.
- Drops posts without text (image-only) and posts without views (service messages or
  hidden view counters).
- Two processes joined only by MongoDB: crawler → `documents`; daemon → annotate →
  cluster → rank → render → send. The crawler never calls the daemon.
- Clustering: multilingual-e5 embeddings, agglomerative cosine distance, with penalties
  for same-channel pairs, time distance (sigmoid), and near-identical images. Rank by
  distinct channels, language, age, views-per-hour percentile.
- Ad removal: an LLM proposes a cleaned text, then a diff guard rejects answers that add
  more than `max_new_ratio` or strip below `min_kept_ratio`; fallback is the original text.
- Output: one post per cluster. A cluster similar to an already-posted one edits that
  message and appends new sources instead of posting again.

## What the Habr articles do

- 942490: Telethon userbot listens to chats, embeds messages, stores them in Qdrant, and
  answers questions through an LLM. It states plainly that a normal bot has no access to
  chat history and that a userbot is "you, as a program".
- 838204: Pyrogram userbot basics — separate account, warm-up, API ID/hash, session file,
  handlers for new, edited, and deleted messages.
- Both are stale in important places:
  - Pyrogram was archived on 2024-12-24; the article's stack is no longer maintained.
  - 942490 claims "almost no risk" for reading history. Its own 2026 comments contradict
    that.

## What the comments add

- 2026-06: a user fetched 10 posts from a public channel with a fresh client and received
  an "Abuse Notifications" message; active sessions were reset and some bots were frozen.
- Another fresh Telethon account was banned within a minute; a third got a permanent ban
  for `send_message('me', ...)` — a single write to Saved Messages.
- With more than ~500 dialogs, simple update polling lags; `getDialogs` in batches of
  100–200 is required.
- Community sentiment is hostile: at least one commenter refuses to use products built on
  userbots because they generate spam and scams.
- 942490's comments recommend nyan as the working aggregator example.

## The ingestion matrix

`t.me/s/<username>` works for public **channels** only. Verified: `durov` returns 20
messages; public groups `python` and `ru_python` redirect to `t.me/<username>` and return
0 messages.

| Source type | Web preview | Bot in chat | Userbot |
|---|---|---|---|
| Public channel | yes, no account, backfillable | yes, if admin | yes |
| Public group | no | yes, if added | yes |
| Private group | no | yes, if added | yes |

So the decision is not "bot vs userbot". It is a matrix driven by the source inventory.

## Media

For public channels, the preview exposes `cdn*.telesco.pe` URLs. They are stable across
fetches, return `200`, `Access-Control-Allow-Origin: *`, and `Cache-Control: max-age=10800`.
Hotlinking is viable for a closed beta. Bot and userbot sources still need rehosting,
because Bot API file URLs require the bot token and must never reach the client.

## What to copy, what not to copy

**Copy:**

- Crawler → store → daemon separation, joined only by the store.
- A per-source registry with alias, enabled flag, recrawl interval, region, and category
  hints (nyan's `channels.json`).
- `?before=<id>` pagination with a per-source cursor.
- Guarded LLM ad removal: diff against the original, reject over-edits, fall back.
- Cluster penalties for same source, time distance, and near-identical image; rank by
  distinct sources.
- Snapshot tests over a fixture of real messages.

**Do not copy:**

- MongoDB + Docker + Python + PyTorch + embeddings for tens of chats; the operational
  weight is larger than the product.
- Semantic clustering for classifieds. Cross-posts are near-identical, so normalized text,
  price, city, and photo hash are cheaper and more precise than embeddings. Add embeddings
  only if fuzzy matching proves insufficient.
- Qdrant and LLM semantic search in v1; SQL filters over normalized fields cover the feed.
- Amvera as a host; it is a 2024/2025 Russian-cloud tutorial, not a fit for a Montenegro
  service.
- Pyrogram; it is archived. Telethon is the maintained option if a userbot is ever needed.

## Correction: public groups are readable anonymously

The bulk `t.me/s/<group>` view does not exist for groups, but **individual messages of a
public group are readable without an account**:

`https://t.me/<group>/<id>?embed=1` returns the message HTML with text, author display
name, timestamp, photo URLs on `cdn*.telesco.pe`, and video URLs when present. Verified on
`sale_me_com`, `baraholka_Monte`, `jobmonte`, and `sutomoremontenegro`.

Examples:

- `sale_me_com/500000` — 2024-05-25, "Продам мерседес А170…", 5 photos.
- `baraholka_Monte/380000` — 2026-10-22, "Будва. Продам платье Макси, 80 евро…", 2 photos.
- `jobmonte/5000` — 2023-05-04, "Требуется АВТОМЕХАНИК…", 5 photos.
- `sutomoremontenegro/500` — 2023-11-23, "Маслиниада-2023…", 14 images.

This gives a path with **no Telegram account, no bot in the chat, and no admin consent**.

The cost:

- One HTTP request per message ID; there is no bulk endpoint for groups.
- IDs are sequential per group but sparse: deleted messages, service messages, and albums
  create gaps.
- Albums occupy several consecutive IDs with the same caption and photo set; deduplicate by
  text + first photo + timestamp.
- Image-only posts exist and must be kept. The first `background-image` is sometimes an
  emoji (`//telegram.org/img/emoji/...`); filter it out and take only `cdn*.telesco.pe`.

Observed ID ranges (sampled, not exact max):

| Source | Sample | Date | Estimated max |
|---|---|---|---|
| `sale_me_com` | 1,100,000 | 2026-10-09 | ~1.12M |
| `baraholka_Monte` | 380,000 | 2026-10-22 | ~385k |
| `jobmonte` | 5,000 | 2023-05-04 | ~7k |
| `saleme_job` | 100,000 | 2024-10-21 | ~110k |
| `sutomoremontenegro` | 4,000 | 2024-09-11 | ~5k |

A poller needs a per-group cursor, an adaptive ID window sized from the observed message
rate, a negative cache for "Post not found", and a time-based guard so a burst of deleted
messages does not stop the window early. Backfill is the expensive part: binary-search the
ID at the target date, then enumerate forward, politely.

No account means no account ban; the remaining risks are IP-level rate limits or blocks,
HTML drift, and Telegram's scraping terms. Record them in the ADR.

## Open decisions

1. Scraper host: a small VPS, or Cloudflare Worker + Queue.
2. Backfill depth: 3, 7, or 14 days.
3. Media: hotlink `cdn*.telesco.pe` or rehost.
4. Events: third section or a category inside Объявления.
