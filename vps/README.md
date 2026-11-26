# VPS collector

The long-running side of Теле-Лента: the SQLite store, the API, and (from later
tickets) the collector tick. Node 22 + TypeScript, Fastify 5, `better-sqlite3`,
hand-written numbered SQL migrations, no ORM.

The product surface (Mini App, BFF, bot) lives on Telegram Serverless; this
workspace owns listings, clusters, sources, users, and saved searches
(ADR-0003).

## Layout

```
src/config.ts        environment loader, validated at boot
src/db.ts            SQLite connection with WAL, foreign keys, busy timeout
src/migrate.ts       numbered SQL migration runner
src/app.ts           Fastify app: /health and the /v1 read routes
src/api/             validated /v1 routes, cursor codec, wire card shapes
src/server.ts        API entry point
src/cli/migrate.ts   npm run migrate
src/cli/tick.ts      npm run tick (system cron, every minute)
src/cli/backfill.ts  npm run backfill (the manual add-a-source step)
src/backfill/        backfill boundary search and enumeration, no CLI
src/cli/admin.ts     npm run admin (local allowlist CLI)
src/admin/           admin command logic, testable without a process
src/parser/          pure Telegram HTML parser (no db, network, or fs)
src/ingest/          pure normalization, classification, and album collapse
src/net/             Telegram URL builders and the polite HTTP client (no db, no fs)
src/tick/            tick lock, channel and group scans, write path, orchestration
src/cluster/         pure cluster key, join rule, and bookkeeping (no db, network, or fs)
src/retention/       the retention pass: recompute, purge, sweep, prune
src/store/           typed SQLite operations; all SQL lives here
migrations/          NNNN_name.sql, applied in filename order
deploy/Caddyfile     TLS edge: only /v1/* and /health reach the API
test/fixtures/       sanitized real Telegram HTML, see its README
```

## Parser

`src/parser/telegram-html.ts` turns saved Telegram HTML into parsed messages.
It handles both public surfaces from ADR-0002 — the channel page
`https://t.me/s/<channel>` and the group embed
`https://t.me/<group>/<id>?embed=1` — because they share the same message
widget markup.

```ts
import { parseTelegramHtml } from './parser/telegram-html.js';

const result = parseTelegramHtml(html);
if (result.kind === 'messages') {
  for (const message of result.messages) {
    // message.id, message.text, message.datetime, message.edited,
    // message.photos (cdn*.telesco.pe only), message.hasVideo
  }
} else if (result.kind === 'not_found') {
  // an explicit "Post not found": mark the listing deleted / negative-cache it
} else {
  // result.kind === 'parse_error': alert-worthy HTML drift, not an empty feed
}
```

`parse_error` is deliberately distinct from `not_found`; only an explicit
not-found page may mark a listing deleted. Service messages are dropped before
the result reaches callers. A document with no message widget is an error
unless the caller passes `{ requireMessages: false }`.

The fixture tests read real sanitized pages from `test/fixtures/`; if Telegram
changes the markup, they fail instead of letting the feed go quiet. See
`test/fixtures/README.md` for each page's source and redactions.

## Clustering

`src/cluster/cluster.ts` is the feed's clustering seam (ADR-0001, spec
«Clustering»). It is a pure in/out transformation: no SQLite, no HTTP, no
filesystem, and no mutation of its inputs. Ingestion owns parsing, price and
city derivation, text normalization, and album collapse; the clusterer receives
those fields already resolved and never redoes them.

The key is a SHA-256 over normalized text, price key, and city key. The first
photo is deliberately absent: a cross-post may re-upload it, so photo equality
is a corroborating signal, not a gate. A listing joins an existing cluster only
when all three hold:

1. the key matches,
2. its publication is within 72 hours of the cluster's `earliest_published_at`
   (inclusive; the window is anchored on the earliest member, so a chain of
   reposts cannot stretch it),
3. the key is specific enough: a price, a city, or at least 60 characters of
   normalized text. Short generic lines stay singletons.

An edit keeps the listing in its current cluster while the key is unchanged
(including a `message_status` flip). When the key changes, the listing leaves
the old cluster; the old cluster is recomputed and reported as `dissolved` when
it empties. A same-source bump with a specific key collapses; under a single-key
model a cluster never splits.

```ts
import {
  clusterKey,
  reclusterListing,
  removeMembers,
} from './cluster/cluster.js';

// Query candidates with clusterKey(changedListing): WHERE cluster_key = ?.
const candidates = clusters.filter((cluster) => cluster.clusterKey === clusterKey(changedListing));

// The collector reads the current cluster and candidate clusters from SQLite,
// then asks for the assignment and the bookkeeping rows to persist.
const result = reclusterListing({
  listing: changedListing,
  currentClusterId, // null for a new post
  candidates, // ClusterState[]: current cluster plus clusters with the same key
  newClusterId, // allocated by the caller for outcome 'created'
});

result.assignment; // { listingId, clusterId, clusterKey, outcome }
result.upserts; // [{ id, bookkeeping }], target first, old cluster second
result.dissolved; // cluster ids to delete

// Retention: recompute over the survivors before deleting their rows.
const removal = removeMembers(clusterState, idsOlderThanThirtyDays);
```

Bookkeeping is recomputed from the members: `earliest_published_at` and the
counts include deleted members; `available_listing_count` and `hidden` track
availability; `section`, `category`, and `demand` come from the representative —
the available member with the lowest `published_at`, then the lowest `id`.
When every member is deleted the cluster is hidden and has no representative, so
the facets fall back to the earliest member to keep the row non-null. Display
strings never enter this layer; the feed joins the representative listing.

Re-running the reducer over the same listings yields the same assignment. The
tests apply every scenario twice and compare the resulting cluster state.

## Ingestion

`src/ingest/` turns a parsed message into the derived columns the store and the
clusterer need. It is pure: no SQLite, HTTP, filesystem, LLM, or embeddings, and
the only clock is the caller's `fetchedAt`. Service messages never reach it —
the parser drops them first.

```ts
import { classifyMessage, collapseAlbums } from './ingest/index.js';

for (const group of collapseAlbums(messages)) {
  const result = classifyMessage(group.survivor, source, {
    sourceId: source.id,
    url: `https://t.me/${source.username}/${group.survivor.id}`,
    fetchedAt, // from the tick, not from this module
  });

  if (result.kind === 'listing') {
    const id = store.listings.insert(result.listing);
    // result.facets: textNormalized, priceKey, cityKey, section, category, demand
  } else if (result.kind === 'event_unparseable') {
    store.parserFailures.add({
      sourceId: source.id,
      messageId: result.messageId,
      url: result.url,
      error: result.error,
    });
  }
  // result.kind === 'dropped': empty text and no media, nothing to store
}
```

`ClassifiedListing` is `{ listing: NewListing; facets: ListingFacets }`.
`collapseAlbums(messages)` returns `AlbumGroup[]`, each
`{ survivor, collapsedIds, photos }`: the survivor is the lowest id with the
merged photo set, and absorbed ids appear only inside `collapsedIds`.

### Normalization

Two pipelines, deliberately separate. `normalizeText` is the clustering form:
Unicode NFC, lower case, `ё`→`е`, superscript digits folded, every non-letter
and non-digit character replaced with a space, whitespace collapsed. Emoji,
punctuation, quotes, dashes, and hashtag `#` disappear; the script is preserved.
`buildSearchText` and `normalizeSearchQuery` are the search form: lower case,
diacritics folded, Cyrillic transliterated with a Montenegrin-Latin map
(`ш`→`s`, `ч`→`c`, `ћ`→`c`, `љ`→`lj`, …), then restricted to `a-z0-9` and single
spaces. That is why «Подгорица»/`Podgorica` and «Никшић»/`Nikšić` meet on the
same string. `search_text` is title + normalized body + display city + hashtags
through that pipeline; queries go through the same one.

`titleFromText` takes the first line with content after leading emoji, hashtags,
and bullets, and caps it at 120 code points.

### Facets

Section is the source hint (`classifieds` | `jobs` | `events`); text never
overrides it. Categories are a conservative first-hit rule set with the ids
`real_estate`, `auto`, `services`, `goods`, and the canonical fallback
`other` («Другое»); the source `category_hint` is used only when no keyword
matches, and jobs/events fall back to their hint or `other`. Demand is `wanted`
for куплю, ищу, сниму, резюме (`#резюме` included after normalization) and
`offer` otherwise.

Price is parsed only from an explicit currency (`€`/`EUR`/`евро`, `$`/`USD`,
`RSD`/`дин`), with optional periods (`/мес`, `в месяц`, `за ночь`, `за сутки`,
…). `priceRaw` is always the source slice; `priceValue` is numeric only for one
unambiguous amount. A range (`500-700 €`, `от 500 до 700 €`) or several prices
keeps the raw string and leaves the numeric fields and `priceKey` null. A bare
number without a currency is not a price. `priceKey` is `eur:650` or
`eur:650/month` and feeds the clusterer; for jobs the same expression also fills
`salaryRaw`.

City matching uses a dictionary of Montenegrin names in Cyrillic, Latin, and
diacritic forms, matched on the search pipeline so all scripts collapse. It
returns a fixed display spelling (`Podgorica`, `Nikšić`, `Herceg Novi`) and a
`cityKey` (`podgorica`, `niksic`, `herceg-novi`); an unknown city stays null.

An events post must parse a start date and time (`5 ноября в 19:00`,
`05.11 19:00`, `05.11.2026 19:00`, ISO, Montenegrin month names) in
Europe/Podgorica. The year is inferred from the publication date and rolled
forward only when the result is more than 180 days in the past; an explicit year
is kept. A post that does not parse returns `event_unparseable` for
`parser_failures` and stays out of the feed.

Spam and ads are deterministic flags. `is_spam` is set by a spam source, a
link-only post, or a configurable marker; `is_ad` by a configurable ad marker or
an invite link (`t.me/+…`, `t.me/joinchat/…`). Short text alone is never spam.
Marker lists are plain lowercase substrings supplied through `spamRules`; see
`DEFAULT_SPAM_RULES`.

Albums collapse when normalized text, the first photo, and a publication gap of
at most two minutes all match. Ids need not be consecutive, the window is
anchored on the survivor (not chained), and the photo set is merged once.

## HTTP politeness

`src/net/` owns the two outbound surfaces from ADR-0002 and every politeness
rule the spec puts around them. URL building is pure; the client takes an
injected transport, clock, and jitter source, so its tests use a virtual clock
and a scripted transport and never sleep or touch the network.

```ts
import { channelPageUrl, messageEmbedUrl } from './net/urls.js';

channelPageUrl('montework');                      // https://t.me/s/montework
channelPageUrl('montework', { before: 1109995 }); // https://t.me/s/montework?before=1109995
messageEmbedUrl('montenegro_chat', 42);           // https://t.me/montenegro_chat/42?embed=1
```

The client returns a typed result. A failure is never an empty page: the
caller must branch on `ok` before parsing, and only a 2xx response carries
`html`.

```ts
import { createPoliteClient, createRequestBudget } from './net/polite-client.js';

const client = createPoliteClient({
  transport: fetch,
  userAgent: config.userAgent,
  timeoutMs: config.requestTimeoutMs,
});

const budget = createRequestBudget(40); // one object per source per tick
const result = await client.request(channelPageUrl(source.username), {
  sourceId: source.id,
  sourceEnabled: source.enabled,
  ingestEnabled: store.appState.get('INGEST_ENABLED') !== 'false',
  budget,
});

if (result.ok) {
  parseTelegramHtml(result.html);
} else {
  switch (result.outcome) {
    case 'http_error':        // result.status, e.g. 404 stays an HTTP failure
    case 'network_error':
    case 'timeout':
    case 'disabled':          // either kill switch is off
    case 'budget_exhausted':  // no transport call was made
  }
}
```

| Rule | Default | How it is set |
| --- | --- | --- |
| Global in-flight cap | 2 | `new PolitenessLimiter(2)`; clients share the process default |
| Per-source in-flight cap | 1 | fixed by the limiter |
| Per-source dispatch gap | 1000 ms | `rate.minIntervalMs` |
| Jitter on the gap | 0–250 ms | `rate.maxJitterMs`; `random` returns the unit fraction |
| Retried statuses | 429 and 5xx | 4xx, timeouts, and network errors are not retried |
| Attempt cap | 3 total | `retry.maxAttempts` |
| Backoff | 500 ms, doubling | `retry.baseDelayMs` |
| Retry cap | 30 s | `retry.maxDelayMs`; a larger `Retry-After` is capped here |
| Timeout | 10 s | `timeoutMs`, overridable per request (`timeoutMs` option) |

`Retry-After` accepts delay-seconds and an HTTP-date. Backoff waits for
`max(Retry-After, exponential)` and is capped at `maxDelayMs`, so a hostile
header cannot stall a tick. The per-source budget counts transport attempts,
including retries; the N+1th request returns `budget_exhausted` without calling
the transport. Both kill switches are checked again before every retry.

One `PolitenessLimiter` is shared by default across every client in a process,
which is what lets the API's detail probe pace against the same source as the
tick. It is memory, not a durable record: the API and the tick are separate
processes, so the detail probe also reads the source's most recent
`ingest_runs.started_at` and skips when that run started less than **one second**
ago (see «Card detail probe»). That is an approximation of the shared per-source
rate, not a lock: the tick writes the run row before its first fetch, and the
API treats a fresh `started_at` as "the tick owns this source right now". A tick
that is between sources, or an API probe that lands just after the one-second
window, can still produce two requests closer together than the ideal pace. No
schema column was added for this; the audit trail the tick already writes is the
durable signal.

## Tick lock

The worker is a short-lived cron process. It takes an exclusive file lock
before doing any work; an overlapping tick gets `null` and exits immediately.

```ts
import { acquireTickLock, tickLockPath } from './tick/lock.js';

const lock = acquireTickLock({ path: tickLockPath(config.databasePath) });
if (lock === null) {
  process.exit(0);
}
try {
  await runTick();
} finally {
  lock.release();
}
```

The lock file holds `{ pid, startedAt }`. It is stale when the PID is gone or
when it is older than `STALE_LOCK_MS` (ten minutes, covering PID reuse and a
lock left on another host). A stale lock is moved aside with an atomic rename
before deletion, so two contenders cannot both reclaim the same file; the loser
retries the exclusive create and then loses it normally. `release()` removes
the file only when it still carries this holder's PID and start time, so a lock
already reclaimed by someone else is left alone. The default path is
`collector.lock` beside the SQLite database.

## Collector tick

`src/tick/tick.ts` is the minute worker. It takes the lock, reads
`INGEST_ENABLED` from `app_state` (a stored `false` stops all fetching), lists
enabled sources, and runs them **sequentially**. Sources with a null cursor were
never backfilled and are skipped silently. Every other source gets one
`ingest_runs` row with status, counts, cursor before/after, and a short error
sample; a source that throws is recorded as failed and the loop continues, so a
broken chat never stalls the rest. At the end the global `last_ingest_at` is
written to `app_state`, then the same tick runs, in this order: **retention**
(housekeeping, before any match is sent), the **digest**, and the **operator
alerts**. A failure in any of the three is logged and left null in the result;
it never fails the collector run. The lock is released in `finally`.

The CLI prints one line per stage — `retention listings=… clusters=…
failures=…`, the digest counters, and `alerts sent=… throttled=… failed=…
degraded=… stale=…`. It never prints a token, `initData`, or a message body.

Run it from cron:

```cron
* * * * * cd /srv/tele-lenta && node vps/dist/cli/tick.js >> /var/log/tele-lenta/tick.log 2>&1
```

The lock lives beside the SQLite database (`TL_DATABASE_PATH` →
`collector.lock`) and holds `{ pid, startedAt }`; an overlapping tick exits
immediately after printing `tick skipped: another tick holds the lock`. The CLI
exits non-zero only for an infrastructure failure (bad config, unopenable
database, unexpected throw). A per-source failure is data, not an exit code.

### Дайджест

Once ingestion, `last_ingest_at`, and the retention pass are done, the same
tick runs the digest worker (`src/digest/worker.ts`). It sends at most one message per user through
the Bot API (`src/bot/api.ts`); ingestion never waits for it and a digest
failure is logged, not thrown, so a collector run that already wrote its rows
still succeeds.

A saved search is due when it is enabled, its user's digest switch is on, the
user is allowed and not marked undeliverable, and `last_checked_at` is at least
30 minutes old. Creating a search seeds `last_checked_at` from its creation
time, so the first digest contains only what appeared after saving. Each due
search is matched against clusters whose `earliest_published_at` falls after
the previous check, using the same section, category, demand, source, and
`search_text` predicate as `/v1/feed`; matches land in
`saved_search_matches` with `INSERT OR IGNORE`, and `last_checked_at` advances
in the same transaction.

The first eligible tick outside quiet hours sends one batched message per user,
grouped by saved search and capped at ten cards with «и ещё N». Quiet hours
default to 23:00–08:00 Europe/Podgorica and are wall-clock times, not a fixed
UTC offset. During quiet hours matching and `last_checked_at` still advance and
the rows stay unsent, so the first tick after the window delivers the backlog
as one message. No matches means no message.

`last_sent_at` advances for every due enabled search when the message is sent.
A 429, 5xx, timeout, or network error leaves the rows unsent and the next due
check sends those same rows instead of re-running the match; a 403, or a Bot
API answer that the chat is gone, records `digest_undeliverable_at` and the
worker skips that user until the next successful `/v1/session` clears it. The
sender paces requests below the Bot API's 30 messages per second and logs only
the outcome, never the token or the message text.

Both `TL_BOT_TOKEN` and `TL_BOT_USERNAME` are required for the digest. Without
either, the tick still ingests and prints `digest skipped: unconfigured`.

### Ретенция

`src/retention/index.ts` is the housekeeping pass: listings older than **30
days** and parser failures older than **7 days** leave the database. The order
matters, because a cluster must never reference a purged listing:

1. Every cluster holding a member with `published_at` older than the cutoff is
   recomputed over its survivors through `removeMembers`, then persisted with
   `applyRemoval`. The recompute commits per cluster; a cluster with no
   survivor is dissolved, and its `saved_search_matches` cascade with it.
2. `listings.deleteOlderThan(cutoff)` removes the old rows in one statement.
   `listing_photos` cascade from the listing.
3. `clusters.deleteEmptyClusters()` sweeps clusters no listing references any
   more — the orphans this purge or an interrupted earlier run leaves behind.
4. `parser_failures.pruneOlderThan` applies the seven-day window.

The cutoff is strict: a listing published exactly 30 days ago stays, and its
cluster is not recomputed. A crash between the recompute and the purge is safe,
because the next pass recomputes the same members again before deleting them.

```ts
import { runRetention } from './retention/index.js';

const result = runRetention({ store });
// { listingsDeleted, clustersRecomputed, clustersDeleted, parserFailuresPruned }
```

The pass runs inside the minute tick, after the source loop and before the
digest, so a digest can never reference a cluster that retention is about to
dissolve. `runTick({ retention: false })` skips it for a test or an ad-hoc
ingestion run; production always leaves it on.

### Алерты

`src/alert/index.ts` gives the owner two Bot API warnings and nothing else. It
takes the sender the CLI already built for the digest, so both stages share one
pacing budget.

- **Degraded source.** A source is degraded when its newest three `ingest_runs`
  rows are all failed (`status != 'ok'`) or zero-yield (`fetched = 0`). Message:
  «Источник @username не отдаёт объявления три тика подряд. Проверьте доступ и
  парсер.» With a title, the title leads and the username sits in parentheses.
  Edits and deletions without new messages are zero-yield too, by design.
- **Stale feed.** The newest `last_success_at` over **enabled** sources is
  older than 30 minutes. Message: «Лента не обновлялась N минут. Проверьте тик и
  источники.» When no source has ever succeeded, the feed is a fresh install and
  no alert is sent.

Each condition is throttled to one message per hour, keyed in `app_state`:
`alert:source:<id>` per source and `alert:feed_stale` globally. A successful
send stamps the key with `now`; a throttled condition is counted but not sent;
a `blocked`, `retry`, `fatal`, or thrown send counts as failed and leaves the
key alone, so the next tick retries immediately. One failing alert never blocks
the others, and the pass never throws.

Kill switches are honoured on both paths. A stored `INGEST_ENABLED = false`
skips the whole alert pass (`skipped: ingestion_disabled`), and a source disabled
by its per-source switch is excluded from the degraded query and from feed
freshness. `TL_BOT_TOKEN` and `TL_OWNER_TELEGRAM_ID` are both required; without
either the tick still ingests and prints `alerts skipped: unconfigured`.

### Channel path

`src/tick/channel.ts` fetches `t.me/s/<channel>`, then paginates backwards with
`?before=<lowest id on the page>` until a page's lowest id is at or below the
source cursor, a page has no messages, or the request budget is spent. Nothing
is written until pagination finishes, so a `parse_error` fails the run with no
half-written batch, and an album split across a page boundary still collapses.
The first page must contain widgets; later pages may be empty (the start of
history). The cursor advances to the highest id seen.

The fetched pages also detect edits and deletions for free. Every message id on
them is compared with the stored row: a changed `content_hash` is an edit that
is re-classified and re-clustered; a stored available listing whose id is inside
the contiguous fetched range but on no fetched page is marked `deleted`. Nothing
outside the range is inferred, so a page boundary is never a deletion.

### Group path

`src/tick/group.ts` scans one id at a time from `cursor_message_id + 1`. The
window comes from the traffic the previous run actually saw:

```
lastScanned = cursor_after - cursor_before + 1     (0 when there was no run)
window      = clamp(2 * max(lastScanned, 20), 20, 200)
```

so a quiet chat gets 40 ids of headroom, a busy chat grows, and the cap is 200.
The window is then capped by the request budget, minus a re-check reserve of at
most a quarter of the budget (capped at 10 requests), so the hot-window pass
always has budget left. The cursor advances to the highest id **scanned**, hit or
miss, so misses are never refetched.

Only an explicit not-found is a miss: HTTP 404, or a 2xx body with Telegram's
`Post not found` widget. It enters the 24-hour negative cache, marks a stored
listing `deleted`, and counts as skipped. A 5xx, timeout, or network error marks
nothing and enters no cache; the id is counted as an error and the scan
continues. All messages collected in the window are collapsed for albums before
anything is written.

After the forward pass, known available listings from the last 48 hours whose
`fetched_at` is older than an hour are checked live with the remaining budget
(the negative cache is not consulted). An explicit not-found marks them deleted;
an HTTP error leaves the status alone.

### Write path

`src/tick/write.ts` is shared by both scans. It collapses albums, then for each
survivor classifies the message: `dropped` stores nothing, `event_unparseable`
writes `parser_failures` and stays out of the feed, and everything else is
inserted or, when the content hash changed, updated. A changed listing is sent
through `reclusterListing` with its current cluster id, so an edit can move it
between clusters. Marking a listing deleted is a bookkeeping recompute over the
cluster's members using the cluster's stored key (`available_listing_count`,
`hidden`), not a re-cluster.

## Backfill

Adding a Источник is two steps. First insert the `sources` row **disabled with a
null cursor** (migration `0003` already does this for the eleven v1 sources, and
a new chat is added as a row, not code). Then run the manual backfill:

```sh
npm -w vps run backfill -- montework              # channel or group username
npm -w vps run backfill -- montenegro_chat --budget 8000
npm -w vps run backfill -- montework --force      # re-run a source with a cursor
```

The minute tick **skips any source with a null cursor**, so a source is never
polled before its backfill, and a lost cursor never restarts a scan from the
beginning. The source is enabled only when the backfill commits.

### What the run does

1. **Look up the source.** An unknown username is refused. A source that already
   has `cursor_message_id` is refused unless `--force` is passed.
2. **Find the latest message id.**
   - *Channel:* fetch the first `t.me/s/<channel>` page and take the maximum
     parsed id.
   - *Group:* probe `t.me/<group>/<id>?embed=1` with an exponential search
     (1, 2, 4, 8 …). A parsed message is valid; an explicit 404 / «Post not
     found» is the end. If a probe lands on a deleted post, the search scans up
     to `LATEST_HOLE_SCAN` (64) ids upward before accepting it as the boundary,
     then binary-searches between the highest valid and the first invalid id.
     A deleted run longer than that can make the discovered latest id slightly
     conservative; the tick then continues forward from that cursor and loses
     nothing.
3. **Find the 7-day cut-off.** The cut-off is the lowest id whose parsed embed
   `datetime` is at or after `now - 7 days`. Because ids are monotonic in time,
   this is a binary search over `[1, latest]`. Deleted ids are expected: a
   not-found probe steps outward (`mid`, `mid-1`, `mid+1`, `mid-2`, `mid+2`, …
   up to 16 ids) and uses the first real message it finds; that id is a sound
   bound. If a whole neighbourhood is deleted the run aborts rather than
   guessing. A 5xx, timeout, network error, or parse error aborts immediately.
   If the latest message is already older than seven days, the source is
   inactive: the cursor is set to its latest id and no enumeration happens.
4. **Enumerate forward** from the cut-off to the latest, one embed request per
   id, through the same `createPoliteClient` as the tick: 1 request/second per
   source plus jitter, at most 2 in flight globally, the same User-Agent and
   retry rules. Explicit not-found ids are skipped (and cached on success, so a
   later tick does not refetch them). A 5xx/timeout counts as an error and aborts
   the run; it never marks a listing deleted, because a backfill is not a
   re-check.
5. **Commit once.** After enumeration the parsed messages go through the same
   `ingestBatch` as the tick, so classification, album collapse, and clustering
   are identical. Then the cursor is set to the latest id, the source is enabled,
   `recordSuccess` runs, and one `ingest_runs` row records status, counts, and
   cursor before/after.

### Budget, rate, and resuming

`--budget N` caps transport attempts for the whole run (boundary probes,
enumeration, and retries); `1..50000`, default `TL_BACKFILL_BUDGET` (`5000`).
Seven days across the eight group sources is on the order of 10,000–20,000
requests — several hours at one request per second per source — and that is
expected, not an exception. Raise a source's interval rather than the global
concurrency if it cannot be kept current.

**Nothing is written until the run succeeds**: no listings, no negative-cache
entries, no cursor, no run row. A budget exhaustion reports how many ids remain
and exits 2; running the same command again restarts the same deterministic
boundary search and enumeration. Because the aborted attempt wrote nothing, the
retry cannot duplicate a listing. Re-running a completed source with `--force`
is safe too: `ingestBatch` compares content hashes and skips unchanged ids.

| Exit | Meaning |
| --- | --- |
| `0` | Backfill committed (including an inactive source older than 7 days) |
| `1` | Refused before fetching: bad usage, unknown source, already backfilled, unreadable config |
| `2` | Aborted mid-run: budget, HTTP/network failure, or parse error; nothing was written |

The testable logic is `runBackfill` in `src/backfill/index.ts`; `src/cli/backfill.ts`
only parses flags, opens the database, and maps the result to an exit code.
Tests drive it with a scripted transport, a virtual clock, and a real temporary
SQLite database; no test touches the network.

## Store

`src/store/` is the only place that writes SQL. Callers get typed functions,
never statement handles; timestamps are ISO-8601 UTC strings and booleans cross
the boundary as `boolean`.

```ts
import { createStore } from './store/index.js';

const store = createStore(db);

store.sources.listEnabled();                    // tick + filter sheet
store.sources.getByUsername('montework');
store.sources.setCursor(source.id, 12_345);     // highest id scanned, hit or miss
store.sources.recordSuccess(source.id);
store.sources.recordFailure(source.id);
store.sources.setEnabled(source.id, false);     // per-source kill switch

store.listings.find(source.id, messageId);
store.listings.insert(newListing);              // listing + photos, one transaction
store.listings.updateFromRecheck(id, recheck);  // photos replaced only if provided
store.listings.setMessageStatus(id, 'deleted');
store.listings.listHotWindow({ since, limit }); // available, oldest first
store.listings.deleteOlderThan(cutoff);         // photos cascade

const candidates = store.clusters.loadCandidates(key, currentClusterId);
const result = reclusterListing({ listing, currentClusterId, candidates, newClusterId: store.clusters.nextId() });
store.clusters.applyRecluster(result);          // membership + bookkeeping + dissolves

const page = store.feed.feed({ section: 'classifieds', category: null, demand: null,
  sourceIds: null, search: null, cursor: null, limit: 20 });
store.feed.detail(clusterId);                   // visible cluster or null
store.feed.updatedAt();                         // newest enabled-source success

store.ingestRuns.start(source.id);
store.ingestRuns.finish(runId, counts);
store.negativeCache.has(source.id, messageId);
store.negativeCache.add(source.id, messageId);  // 24 hours
store.parserFailures.add(failure);
store.appState.set('INGEST_ENABLED', 'false');
```

`clusters.applyRecluster` writes the reducer's `upserts` verbatim, moves the
listing's `cluster_id`, and deletes `dissolved` rows in one transaction. The
store never decides an assignment or recomputes counts. Retention calls
`loadState` → `removeMembers` → `applyRemoval`, then deletes the purged rows.

## Admin CLI

`src/admin/` and `npm -w vps run admin -- …` manage the allowlist from the VPS
shell. This is a local operator command, **never** a Serverless bot handler, and
it is the only management surface for access: there is no admin route in the
API. The whole admin path refuses to run unless `TL_OWNER_TELEGRAM_ID` is
configured; the owner check is that one local comparison, not a network call.

| Command | Effect |
| --- | --- |
| `list` | Prints the allowlist: Telegram id, username, first name, allowed, created at. No secrets and no session data. |
| `allow <id> [--username <name>] [--first-name <name>]` | Allows an id, creating the row when it does not exist. Display flags update only the fields they name. |
| `deny <id>` | Keeps the row and sets `allowed = 0`; a missing row is an error. |
| `forget <id>` | Erases the user and reports what was removed. |

```sh
npm -w vps run admin -- list
npm -w vps run admin -- allow 1002003004 --username beta_tester --first-name Тест
npm -w vps run admin -- deny 1002003004
npm -w vps run admin -- forget 1002003004
# forgot 1002003004 users=1 saved_searches=2 saved_search_matches=7
```

`list` is tab-separated, one row per user sorted by Telegram id, with a header
line, so it pipes cleanly into `column -t` or `cut`:

```
telegram_id	username	first_name	allowed	created_at
1002003004	beta_tester	Тест	yes	2026-11-05T09:00:00.000Z
```

`forget` deletes, in one transaction: the `users` row, every `saved_searches`
row for that user, and every `saved_search_matches` row belonging to those
searches. The next digest has nothing to match and nothing to send, and a
returning id starts as an unknown stranger. Other users are untouched.
`deny` is different: it keeps the row and its settings, blocks every `/v1/*`
route with `not_invited`, and is reversible with `allow`.

Commands parse and validate fully before writing, so a malformed id, an unknown
flag, or a missing flag value exits non-zero with no partial change. Exit code 0
means the command ran; 1 covers usage errors, a missing target row, an
unconfigured owner id, unreadable config, or an unopenable database.

The testable logic is `runAdmin(argv, { store, config, stdout, stderr })` in
`src/admin/index.ts`; the CLI entry point only loads config, opens the database,
and maps the returned exit code. Tests call the runner directly and never spawn
a process.

## Schema

Migration `0001` is the minimal registry that `/health` needed and is never
edited. `0002_ingestion.sql` rebuilds `sources` (so `enabled` defaults to 0) and
creates the collector tables; `0003_seed_sources.sql` inserts the eleven v1
sources disabled with a null cursor, so a source is polled only after its manual
backfill; `0004_users.sql` creates the allowlist and session settings;
`0005_saved_searches.sql` creates the saved-search tables used by tickets #15
and #16.

| Table | Purpose |
| --- | --- |
| `sources` | Источник registry: kind, region, section/category hint, interval, cursor, failure streak, kill switch |
| `listings` | One row per source message, unique `(source_id, message_id)` |
| `listing_photos` | Photo set per listing, PK `(listing_id, position)`, cascade |
| `clusters` | Bookkeeping only, written by the clusterer; `cluster_key` is not unique |
| `ingest_runs` | One run per source poll with counts and cursor before/after |
| `parser_failures` | Diagnostics, pruned after 7 days by the caller |
| `app_state` | Kill switches, last global ingest time, alert throttling |
| `negative_cache` | 24-hour storage for explicit not-found responses (the spec names the requirement, not the table) |
| `users` | Allowlist bit plus per-user session settings; source of truth for access |
| `saved_searches` | A reader's stored query and filters; cascades from `users` |
| `saved_search_matches` | Repeat-suppression ledger, PK `(saved_search_id, cluster_id)`, cascades from the search and the cluster |

The saved-search CRUD (#15) and the digest worker (#16) read and write these
tables; `admin forget` and retention own their lifecycle. `saved_search_matches` is what makes
`INSERT OR IGNORE` safe across overlapping digest ticks, and its primary key is
the reason the same cluster cannot reach one saved search twice.

## Commands

Run from the repository root:

```sh
npm install
npm -w vps run typecheck
npm -w vps test
npm -w vps run migrate      # applies pending migrations
npm -w vps run tick         # one collector tick (tests use tsx; cron uses dist)
npm -w vps run backfill -- <username> [--budget N] [--force]
                            # manual backfill; must precede a source's first poll
npm -w vps run admin -- list # allowlist management (needs TL_OWNER_TELEGRAM_ID)
npm -w vps run dev          # API with reload
npm -w vps run build        # compile to vps/dist
```

## Configuration

Copy `.env.example` to `.env` and fill it in, or export the same variables from
the service manager. The loader reads `process.env` only; it does not read
`.env` itself.

| Variable | Default | Meaning |
| --- | --- | --- |
| `TL_HOST` | `127.0.0.1` | API bind address; keep it on loopback |
| `TL_PORT` | `8787` | API port |
| `TL_DATABASE_PATH` | `./data/tele-lenta.db` | SQLite file; WAL creates `-wal`/`-shm` beside it |
| `TL_LOG_LEVEL` | `info` | pino level, or `silent` |
| `TL_USER_AGENT` | `TeleLenta/0.1 (+https://github.com/ValDagon/tele-lenta; collector)` | descriptive User-Agent on every collector request |
| `TL_REQUEST_TIMEOUT_MS` | `10000` | default HTTP timeout; the detail probe overrides it |
| `TL_DETAIL_PROBE_TIMEOUT_MS` | `2000` | timeout for the card detail's one live probe (`1..30000`) |
| `TL_TICK_REQUEST_BUDGET` | `40` | per-source transport attempts in one tick (pages, message embeds, and re-checks) |
| `TL_BACKFILL_BUDGET` | `5000` | per-source transport attempts in one manual backfill (`1..50000`; `--budget` overrides it) |
| `TL_SHARED_SECRET` | none | 32-byte secret shared with the BFF; required by the API (`>= 32` chars) |
| `TL_OWNER_TELEGRAM_ID` | none | owner Telegram id for the VPS admin CLI; never shipped to clients |
| `TL_BOT_TOKEN` | none | Bot API token for the digest; without it the tick sends no digest |
| `TL_BOT_USERNAME` | none | bot username without `@` (4-32 letters, digits, underscores); builds card links and is required with the token |

## Migrations

Each file is `NNNN_snake_name.sql` and runs inside a transaction. Applied
versions land in the `migrations` (version, applied_at) table, so a second run
applies nothing. Migrations are never edited after they ship; changes arrive as
a new numbered file.

Deploy order: `npm -w vps run migrate`, then restart the API. The API does not
migrate on boot.

## API

`GET /health` is the only unauthenticated route. It reports freshness numbers
only — global newest `last_success_at`, its age in seconds, and the same per
enabled source. It never returns ingest internals, error samples, or post
content. On an empty migrated database it answers `200` with nulls and an empty
`sources` array.

```json
{
  "status": "ok",
  "checked_at": "2026-11-05T12:00:00.000Z",
  "last_success_at": null,
  "age_seconds": null,
  "sources": []
}
```

### Authentication and the allowlist

Every `/v1/*` request is signed by the BFF and allowlisted per request; only
`GET /health` stays public. Three headers carry the MAC:

| Header | Value |
| --- | --- |
| `X-TL-User` | Telegram user id, decimal, no sign, no leading zero |
| `X-TL-Timestamp` | Unix epoch **seconds** |
| `X-TL-Signature` | HMAC-SHA256 hex, 64 characters |

The canonical string is `\n`-joined with no trailing newline:

```
TL1
<timestamp exactly as sent>
<METHOD uppercase>
<raw request target: path plus ?query, percent-encoding untouched>
<lowercase hex SHA-256 of the raw body bytes; the empty body hashes sha256("")>
<user id exactly as sent>
```

The user id sits inside the MAC, so a signature made for one user cannot be
replayed as another. The request target includes the query string, so feed
filters and cursors are covered. The body hash is over the wire bytes before
JSON parsing. A missing header, a bad signature, or a clock difference over 60
seconds is rejected; the 60-second window is also the v1 replay window, and no
nonce cache is kept because the MAC authenticates the BFF origin. The pinned
vector in `test/auth-signature.test.ts` is the contract for the BFF.

`POST /v1/session` is the one route that runs before the allowlist step, so it
can record the verified profile of an unknown id for the owner's `admin allow`.
It still answers `not_invited` to an uninvited user. Every other route loads the
MAC-bound `users` row and returns `not_invited` when `allowed` is false.

| Rejection | Status | Code |
| --- | --- | --- |
| Missing/malformed header, bad JSON, body id mismatch | 400 | `invalid_request` |
| Bad signature | 401 | `init_data_invalid` |
| Clock skew over 60 s | 401 | `init_data_expired` |
| Missing user row or `allowed = 0` | 403 | `not_invited` |
| Over 60/min per user or 600/min globally | 429 | `rate_limited` |
| Allowlist lookup failed | 503 | `access_check_failed` |

Rate limits are in-memory and per process. Denials are logged with the Telegram
id, display name, code, method, and path only — never headers, bodies,
`initData`, or the shared secret. The order is signature → skew → user row →
rate limit → allowlist.

`POST /v1/session` body:

```json
{ "id": 1002003004, "username": "beta_tester", "first_name": "Тест" }
```

The body `id`, when present, must equal the signed `X-TL-User`. The response:

```json
{
  "allowed": true,
  "settings": {
    "digest_enabled": true,
    "quiet_start": "23:00",
    "quiet_end": "08:00",
    "spam_filter": true,
    "ad_filter": false
  },
  "enabled_source_count": 11,
  "retention_days": 30,
  "digest_interval_seconds": 1800
}
```

A successful upsert refreshes `last_seen_at`, stores the profile, clears
`digest_undeliverable_at`, and never changes `allowed`.

### Read routes

Every response is JSON. Errors use one envelope:

```json
{ "error": { "code": "invalid_request", "message": "limit must be a non-negative integer" } }
```

An unknown route and an unknown card both answer `not_found` with status 404; a
malformed parameter answers `invalid_request` with status 400.

#### `GET /v1/feed`

One Карточка per visible Кластер (a cluster with at least one available
member), newest first by `(earliest_published_at DESC, id DESC)`.

| Parameter | Meaning |
| --- | --- |
| `section` | `classifieds`, `jobs`, or `events` |
| `category` | category id, e.g. `real_estate`, `goods` |
| `demand` | `offer` or `wanted` |
| `sources` | repeated positive source ids; a cluster matches when **any** member belongs to one |
| `q` | substring over the representative's `search_text`; normalized first, minimum 2 characters, capped at 100 |
| `cursor` | opaque base64url keyset from `next_cursor` |
| `limit` | default 20, values above 50 clamp to 50, `0` = count only |

The display fields come from the representative — the **available** member with
the lowest `published_at`, then the lowest `id` — while
`earliest_published_at` and `source_count` describe the whole cluster, deleted
members included. Missing price/city/photo slots are omitted.

```json
{
  "cards": [
    {
      "id": 42,
      "section": "classifieds",
      "category": "real_estate",
      "demand": "offer",
      "title": "Сдам квартиру",
      "price": { "raw": "650 €", "value": 650, "currency": "EUR", "period": "/мес" },
      "city": "Podgorica",
      "earliest_published_at": "2026-11-01T08:00:00.000Z",
      "photo": { "url": "https://cdn1.telesco.pe/file/a.jpg", "count": 2 },
      "sources": [
        { "id": 3, "username": "sale_me_com", "name": "Sale Me", "monogram": "SM" }
      ],
      "source_count": 1
    }
  ],
  "next_cursor": "WyIyMDI2LTExLTAxVDA4OjAwOjAwLjAwMFoiLDQyXQ",
  "total": 1,
  "updated_at": "2026-11-05T11:59:00.000Z"
}
```

A jobs card carries `salary` instead of `price`; an events card carries
`event: { starts_at }`. `sources` holds up to three monogram summaries while
`source_count` is the true distinct source count. `total` is the count for the
same filters, and `updated_at` is the newest `last_success_at` over enabled
sources (null when none), independent of filters. `limit=0` returns
`cards: []` and `next_cursor: null` beside `total` and `updated_at`.

The cursor is `base64url(JSON.stringify([earliest_published_at, cluster_id]))`.
An invalid or truncated cursor is `invalid_request`, never a silent restart.

#### `GET /v1/cards/{id}`

The same card fields plus:

- `body` — the representative's raw post text, paragraphs preserved;
- `photos[]` — `{ url, width, height }` in order (the representative's);
- `hashtags[]` — lowercased, deduplicated, derived from `text_raw` at read time
  (the classifier's `text_normalized` strips `#`, so it cannot be the source);
- `sources[]` — **every** member, publication order, each with `listing_id`,
  `source_id`, `username`, `name`, `monogram`, `message_url`, `access`
  (`public | invite | closed`), `message_status`, `is_first`, `published_at`.

`is_first` marks the absolute earliest member even when that message is deleted.
A hidden or absent cluster answers `404 not_found`, so the Mini App cannot land
on a card with no live source.

#### Card detail probe

Group messages older than 48 hours are outside the tick's hot window, so a
source row can stay `available` after its message is gone. Before rendering a
detail response, the route probes **one** row: the representative (the available
member with the lowest `published_at`, then the lowest `id`), which is also the
«Открыть в Telegram» target. The probe is skipped when:

- the representative was published within the last 48 hours (the tick re-checks
  that window itself);
- the representative is no longer available, its source is disabled, or
  `INGEST_ENABLED` is stored as `false`;
- the source's newest `ingest_runs.started_at` is less than one second old.

Otherwise it makes one `GET https://t.me/<username>/<message_id>?embed=1`
through the polite client with a request budget of 1 and
`TL_DETAIL_PROBE_TIMEOUT_MS` (default 2000). The budget means a retry cannot
reach the network, and the API's default client is also built with one attempt.

| Probe result | Effect on the response |
| --- | --- |
| HTTP 404, or 2xx with Telegram's «Post not found» | Listing flips to `deleted`; the cluster's `available_listing_count` and `hidden` are recomputed exactly as the tick does, then the detail is re-read |
| Cluster has no available member left | `404 not_found` (the Mini App falls back to the feed) |
| Timeout, 5xx, network error, or parse error | Status unchanged; the card answers as it did |
| Probe skipped | Status unchanged; no request is made |

A probe never fails the request: every non-not-found outcome, including an
unexpected exception in the probe path, leaves the detail intact. The wire shape
does not change; a successful probe only changes `message_status` values in
`sources[]` and, when the representative moved, the display fields read from it.

#### `GET /v1/sources`

Enabled sources for the filter sheet and the settings count:

```json
{
  "sources": [
    {
      "id": 3,
      "username": "sale_me_com",
      "name": "Sale Me",
      "monogram": "SM",
      "kind": "group",
      "section": "classifieds"
    }
  ]
}
```

## Caddy

`deploy/Caddyfile` terminates TLS and proxies only `/health` and `/v1/*` to
`127.0.0.1:$TL_API_PORT`. Everything else returns 404. It is a deployment
artifact: tests do not start Caddy or open a public port.

On the VPS:

```sh
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Set `TL_API_DOMAIN`, `TL_API_PORT`, and `TL_ACME_EMAIL` in Caddy's environment
file (`/etc/caddy/caddy.env` with systemd's `EnvironmentFile=`).
