# Serverless BFF

The Telegram Serverless side of Теле-Лента: the bot handlers and the BFF the
Mini App calls. The BFF verifies `initData`, extracts the Telegram user, signs
one upstream request to the VPS, and returns the VPS JSON unchanged. It has no
product logic and no product storage (ADR-0003, ADR-0005).

This directory contains the pure core, the schema, the platform glue, the flat
endpoints (`session`, `feed`, `card`, `sources`, `saved-searches`, `me`), the
two owner-only setup routes (`provision`, `diagnose`), and the single bot
handler (`handlers/message.js`).

## Platform constraints

These are facts about the runtime, not preferences. Code that ignores them does
not run.

- Modules import only `sdk`, `sdk/*`, and relative modules ending in `.js`.
  No npm packages, no `node:*`, no filesystem.
- The pure modules in `lib/` import nothing at all except each other, so Node
  can load them in tests; they never import `sdk`.
- Handlers are flat (`handlers/<update_type>.js`); endpoints are flat and
  callable only from the Mini App with platform-verified `initData`.
- Endpoints return JSON only — never binary.
- The platform SQLite has foreign keys **off**; `.references()` throws.
- There is no cron and no long-running process: code runs on an update or a
  Mini App call.
- Deploy and migration are separate: `npx tgcloud push`, `npx tgcloud migrate`.
- `.tgcloud/`, the bot token, the shared secret, and `initData` are never
  committed or logged.

## Layout

```
schema.js            platform schema: the settings table
lib/sha256.js        pure-JS SHA-256 (FIPS 180-4), UTF-8, hex
lib/hmac.js          pure-JS HMAC-SHA256 (RFC 2104), constant-time compare
lib/initdata.js      initData verification and user extraction
lib/upstream.js      TL1 signed request builder and the typed VPS caller
lib/errors.js        { error: { code, message } } envelope and code list
lib/config.js        pure resolveConfig({ env, settings })
lib/hmac-probe.js    crypto.subtle diagnostic probe (not on the signing path)
lib/resources.js     pure Mini App input → VPS target/method mapping + identity
lib/start.js         pure `/start` text, command parsing, `web_app` reply, URL
lib/provision-plan.js pure one-shot provisioning decision (what may be written)
lib/runtime.js       platform glue: settings rows, fetch, owner guard, provision
handlers/message.js  bot `/start` → one message with the Mini App button
endpoints/*.js       flat Mini App endpoints (JSON only, default export)
test/                Node tests: no network, no platform, no database
```

`lib/` modules are plain ESM with no Node APIs, with one deliberate exception:
`runtime.js` imports `sdk` and is therefore platform-only. Everything else in
`lib/` loads under Node. `errors.js` exports the envelope builders; `upstream.js`
returns typed results and never throws for a network, timeout, or protocol
failure.

## How an endpoint is shaped

The platform contract (core.telegram.org/bots/serverless, checked 2026-11-05):

- an endpoint is `export default async function (input, ctx)`;
- whatever it returns is sent to the Mini App as JSON — there is no
  `{ status, headers, body }` envelope to return;
- to refuse a call it throws the **platform** `EndpointError` from `sdk`; the
  Mini App receives `err.message` and `err.parameters` (so the stable code is
  `err.parameters.code`);
- any other thrown exception becomes a generic internal error, with the real
  message only in the owner's logs.

Every endpoint in this directory therefore has the same shape:

```js
import { identity, feedTarget } from '../lib/resources.js';
import { forward, toEndpointError } from '../lib/runtime.js';

export default async function feed(input, ctx) {
  try {
    const user = identity(ctx, input);          // verified Telegram user
    return await forward({                      // plain VPS JSON
      userId: user.id,
      method: 'GET',
      target: feedTarget(input),                // exact upstream target
    });
  } catch (error) {
    throw toEndpointError(error);               // platform EndpointError
  }
}
```

`identity(ctx, input)` uses `ctx.initData.user` (already verified by the
platform) and re-verifies `input.initData` only when a bot token is configured.
The user id comes only from that verified user — never from `input.id`,
`input.user_id`, or any other body field.

`forward({ userId, method, target, body })` resolves configuration, calls
`callVps` with the platform `fetch` and a 10 s timeout, and throws the platform
error with the mapped stable code. `toEndpointError` converts the pure
`EndpointError` from `lib/errors.js` (used by `resources.js`) into a platform
error, so a validation failure also reaches the Mini App as
`parameters.code`.

The pure helpers below remain the contract for `lib/` and its tests. The
`jsonResult` / `errorResult` / `toErrorResult` builders in `errors.js` are for
tests and local composition; endpoints do not return their envelope.

`verifyInitData(rawInitData, botToken, options?)`:

| Field | Type |
| --- | --- |
| `rawInitData` | URL-encoded `initData` string |
| `botToken` | bot token, server-side only |
| `options.now` | epoch **milliseconds**, injectable for tests |
| `options.maxAgeSeconds` | default `86400` |
| `options.maxFutureSeconds` | default `300` |

Success: `{ ok: true, user, authDate, startParam, raw }`, where `user.id` is a
number and `raw` is the parsed field map **without** `hash`. `user` exists only
on success. Failure: `{ ok: false, code, reason }` with `code`
`init_data_invalid` or `init_data_expired`; `reason` is a short non-secret
diagnostic for logs.

`buildSignedRequest({ secret, userId, method, target, body, timestamp, now })`
returns `{ headers, canonical, signature, body }`. `body` is the exact payload
to send: if you passed an object it was serialized once here, and re-serializing
it before sending would break the MAC. The per-request variant
`{ headers, canonical }` from the ticket design also carries
`signature` and `body`; use them.

`callVps({ fetchImpl, baseUrl, secret, userId, method, target, body, timeoutMs, now })`
returns `{ ok: true, status, json }` or `{ ok: false, code, status, reason }`.
`status` is `null` for a network failure or timeout. The default timeout is
10 s and uses `AbortController`.

`resolveConfig({ env, settings })` returns `{ ok: true, vpsUrl, sharedSecret,
sources }` or `{ ok: false, code: 'upstream_unavailable', reason, missing }`.
`env` defaults to `globalThis.process.env` when it exists; `settings` accepts
the platform's row array, a plain object, or a `Map`. A failure contains key
names, never values.

`errors.js` also exports `errorBody`, `statusForCode`, `messageForCode`,
`isErrorCode`, `EndpointError.toJSON()`, and `toErrorResult(error)`. Inside
`lib/` (and `resources.js`) throw `EndpointError(code)` from `lib/errors.js`;
the endpoint's `toEndpointError` wrapper turns it into the platform
`EndpointError` whose `parameters.code` the Mini App reads.

## Upstream error mapping

| Upstream | BFF code |
| --- | --- |
| 2xx JSON | passed through |
| 401/403 with a stable `error.code` | that code (`not_invited`) |
| 401 without a code | `init_data_invalid` |
| 403 without a code | `not_invited` |
| 404 | `not_found` |
| 429 | `rate_limited` |
| 5xx, network, timeout, non-JSON | `upstream_unavailable` |
| other 4xx | `invalid_request` |

A non-JSON body is `upstream_unavailable` at any status, because the BFF cannot
tell a VPS response from a proxy error page. A stable `error.code` in the body
wins over the status for every non-2xx response, so `not_found` and
`access_check_failed` reach the Mini App unchanged.

Every code above, plus the identity and validation failures produced in the
BFF itself, reaches the Mini App as the platform error's `parameters.code`
(`err.parameters.code` in `Serverless.call`). The English `message` is
developer-facing; the Mini App owns the Russian copy.

## Bot

`handlers/message.js` is the whole bot surface in v1. It is the Mini App entry
point only (ADR-0003): the bot is never added to a source chat, carries no
allowlist logic, and writes no product state.

- A `/start` message in a **private** chat gets one reply: the greeting plus a
  single `web_app` inline button opening `miniapp_url`. `/start@bot_username`
  and `/start <payload>` are accepted; the payload is parsed by the Mini App
  from `initData.start_param` (digest deep links, next ticket).
- Any other update is ignored. Groups and channels are ignored even if the bot
  is somehow present — it has no reason to be there.
- Access stays enforced by the Mini App's `/v1/session` check; the bot answers
  every `/start` for the same reason.
- It reads the `settings` rows (`miniapp_url`) through `readSettingsMap()` and
  sends through `api.sendMessage`. It imports only `sdk` and relative `.js`
  modules, and it never imports `../schema.js`, `db`, or `fetch`.
- Bot API errors are not swallowed: `BotApiError` propagates so the platform
  logs it. The one non-fatal case is a missing URL, which logs
  `start: miniapp_url is not configured` and answers with the fallback text
  «Приложение ещё не настроено. Напишите владельцу.» instead of a dead button.

`lib/start.js` holds the pure half (`isStartCommand`, `startCommandPayload`,
`isWebAppUrl`, `startReply`, `miniAppUrl`) and is covered by
`test/start.test.js`, so the handler stays a thin platform seam.

## Endpoints

The Mini App calls an endpoint by name (`Serverless.call('feed', input)`); the
platform attaches and verifies `initData` before the code runs. All inputs are
plain JSON objects; `initData` may be passed in the body but the platform's
`ctx.initData.user` is authoritative unless a bot token is configured for the
optional local re-check. Every endpoint returns the VPS JSON unchanged.

| Endpoint | Input | Upstream |
| --- | --- | --- |
| `session` | `{}` | `POST /v1/session` |
| `feed` | `{ section?, category?, demand?, sources?, q?, cursor?, limit? }` | `GET /v1/feed?…` |
| `card` | `{ id }` | `GET /v1/cards/{id}` |
| `sources` | `{}` | `GET /v1/sources` |
| `saved-searches` | `{ action, id?, data? }` | see below |
| `me` | `{ action, patch? }` | see below |
| `provision` | `{ vps_url, shared_secret, miniapp_url? }` | none — owner setup |
| `diagnose` | `{}` | none — owner diagnostic |

### `session`

Input `{}`. Upstream `POST /v1/session` with the verified profile only:
`{ id, username, first_name }` (`username` and `first_name` are omitted when
blank). Returns the VPS session JSON (`allowed`, `settings`,
`enabled_source_count`, `retention_days`, `digest_interval_seconds`).

Errors: `init_data_invalid` / `init_data_expired` (identity), `not_invited`
(allowlist), `rate_limited`, `access_check_failed`, `upstream_unavailable`
(VPS down, timeout, non-JSON, missing configuration).

### `feed`

Input: `{ section?, category?, demand?, sources?, q?, cursor?, limit? }`.
`sources` is an array (or one scalar) and becomes a repeated `sources=` query
parameter. Upstream `GET /v1/feed` with parameters in the fixed order
`section`, `category`, `demand`, `sources`, `q`, `cursor`, `limit`; absent
values are omitted and every value is percent-encoded. `limit` defaults to 20,
is capped at 50 by the VPS, and `limit=0` asks for the count only
(`cards: []`, `total`). Returns `{ cards, next_cursor, total, updated_at }`.

Errors: `invalid_request` for a value the VPS rejects (unknown section,
non-numeric source id, query shorter than two characters, bad cursor),
`not_invited`, `rate_limited`, `upstream_unavailable`.

### `card`

Input `{ id }`, a cluster id. Upstream `GET /v1/cards/{id}` with the id
percent-encoded as one path segment. Returns the card detail (`body`, `photos`,
`hashtags`, full `sources` trail). A missing or empty `id` is refused locally as
`invalid_request`; an unknown or hidden cluster is `not_found`.

### `sources`

Input `{}`. Upstream `GET /v1/sources`. Returns `{ sources }` with id, username,
name, monogram, kind, and section for every enabled source — the filter sheet
and the settings count.

### `saved-searches`

Input `{ action, id?, data? }`:

| `action` | Upstream | Body |
| --- | --- | --- |
| `list` | `GET /v1/saved-searches` | — |
| `create` | `POST /v1/saved-searches` | `data` |
| `update` | `PATCH /v1/saved-searches/{id}` | `data` |
| `delete` | `DELETE /v1/saved-searches/{id}` | — |

`id` is required for `update` and `delete`. An unknown action or a missing id is
`invalid_request`. The VPS has no saved-search routes until ticket #15, so every
action currently answers `not_found`; the mapping is final.

### `me`

Input `{ action, patch? }`: `get` → `GET /v1/me`, `update` → `PATCH /v1/me` with
`patch` as the body. Any other action is `invalid_request`. The VPS has no
`/v1/me` route until ticket #15, so both actions currently answer `not_found`.

### `provision`

Owner-only; see the runbook below. Input
`{ vps_url, shared_secret, miniapp_url? }` (camelCase also accepted). Output
`{ ok: true, written: [...] }` — key names only, in the order written. A fresh
provision writes `['vps_url', 'shared_secret']`, plus `miniapp_url` when it was
supplied. The secret is never returned or logged.

The core pair is one-shot: the endpoint refuses to overwrite either row, so it
cannot rotate a secret by accident. `miniapp_url` is different — once the pair
exists, a call carrying only `miniapp_url` updates that one key and returns
`{ ok: true, written: ['miniapp_url'] }`. It must be an HTTPS URL with a host,
because Telegram requires HTTPS for a `web_app` button.

Errors: `init_data_invalid` / `init_data_expired`, `not_invited` (owner
mismatch), `invalid_request` for a bad URL, a secret shorter than 32 characters,
a non-HTTPS `miniapp_url`, an `miniapp_url` sent before the core pair
(`not_provisioned`), an already provisioned database, or a partially
provisioned one.

The decision itself is the pure `planProvision({ present, input })` in
`lib/provision-plan.js`, which returns
`{ ok: true, write: string[], values }` or
`{ ok: false, write: [], reason }`. `runtime.js` only writes what the plan asks
for; the rules are covered by `test/provision-plan.test.js` without a database.

### `diagnose`

Owner-only. Output
`{ subtleAvailable, vectorOk, activePath, configPresent }`, booleans and the
fixed string `pure-js` only. `configPresent` is the settings-row presence check;
an environment override (`TL_VPS_URL`, `TL_SHARED_SECRET`) is not counted, so a
false value with a working BFF means the values come from the environment.
Errors as for `provision`.

## Configuration and secret provisioning

Two values, both stored in the `settings` table and optionally overridden by
environment variables (environment wins):

| Value | Environment | `settings.key` |
| --- | --- | --- |
| VPS base URL | `TL_VPS_URL` | `vps_url` |
| Shared secret | `TL_SHARED_SECRET` | `shared_secret` |
| Mini App URL for the bot | `MINI_APP_URL` | `miniapp_url` |

The first two resolve through `resolveConfig` (environment wins) and are read on
every BFF call. `miniapp_url` is read by the bot handler only: the
`settings` row wins, `MINI_APP_URL` is the fallback, and an invalid value in
either place is treated as absent — the bot then answers with the fallback text
instead of a dead `web_app` button. It must be the **HTTPS** URL BotFather
serves the Mini App from.

The secret is at least 32 characters, the same value the VPS reads as
`TL_SHARED_SECRET`. It is generated once with a CSPRNG, for example:

```sh
openssl rand -hex 32
```

Provisioning is a one-time owner action, not a deploy step and not a product
route. It is deliberately manual because the values are secrets.

### Provisioning runbook

1. Generate the secret and put the two values in a local JSON file (never in the
   repository, never in a commit):

   ```sh
   openssl rand -hex 32
   ```

2. Run the provisioning module on the platform. `npx tgcloud run` executes your
   **local** files against the bot's real database, so you do not need to
   `push` first; it prints the handler's return value and its logs. The `--ctx`
   payload stands in for the platform-verified `initData`, so the caller id is
   the owner.

   ```sh
   npx tgcloud run endpoints/provision \
     '{ vps_url: "https://api.tele-lenta.example", shared_secret: "<new secret>" }' \
     --ctx '{ initData: { user: { id: <owner Telegram id> } } }'
   ```

   Expected return: `{ ok: true, written: ['vps_url', 'shared_secret'] }`. The
   response and the logs never contain the secret. The input line does appear in
   your shell history and in the CLI output, so paste from a file or clear the
   history afterwards, and use a test bot for a dry run.

3. Verify with the diagnostic (next runbook). `configPresent` must be `true`.

4. Put the same secret on the VPS as `TL_SHARED_SECRET` and restart its API.
   `TL_VPS_URL` is a BFF-side environment override only; it is not a VPS
   variable. No restart of the Serverless module is needed: the endpoint reads
   the rows on every call through `resolveConfig`.

5. Disable the setup surface: delete `tgcloud/endpoints/provision.js` (or leave
   it and stop calling it) and `npx tgcloud push`. It already refuses every call
   that carries the core pair once both rows exist; removing it removes an
   unused owner route.

### Setting the Mini App URL

The bot's `/start` button needs the HTTPS URL the Mini App is served from.
Enable Serverless in BotFather first (your bot → Serverless); the app URL is
then printed by a successful `npx tgcloud push`. With the core pair already
provisioned, set it on its own — this is the only update `provision` still
accepts after setup:

```sh
npx tgcloud run endpoints/provision \
  '{ miniapp_url: "https://<app>.telegram.app" }' \
  --ctx '{ initData: { user: { id: <owner Telegram id> } } }'
```

Expected return: `{ ok: true, written: ['miniapp_url'] }`. Re-running it with a
new URL overwrites the row, which is safe: the bot reads the row on every
`/start`, so no redeploy is needed.

`MINI_APP_URL` in the runtime environment is a fallback when the row is absent
(the row wins). Use it for local runs; in production prefer the row so the URL
lives with the rest of the configuration. Until either is set, `/start` answers
with «Приложение ещё не настроено. Напишите владельцу.» and logs
`start: miniapp_url is not configured`.

Notes:

- The only guard against a stray first caller is the one-shot refusal, not the
  caller id: `TL_OWNER_TELEGRAM_ID` is checked **when the runtime exposes it**,
  but the platform documents no environment variables, so expect it to be
  absent. Provision immediately after the first deploy and then remove the
  module.
- A partially written database (one row present) is refused rather than
  completed. Inspect the rows and finish it by hand or drop both and re-run.
- Local or staging databases may be seeded with the same two rows directly.
- Never commit the values; `.tgcloud/` and `.env*` stay ignored.

### Diagnose runbook

```sh
npx tgcloud run endpoints/diagnose '{}' \
  --ctx '{ initData: { user: { id: <owner Telegram id> } } }'
```

Expected on the current runtime:

```json
{ "subtleAvailable": false, "vectorOk": false, "activePath": "pure-js", "configPresent": true }
```

`subtleAvailable: false` is not an error: the signing path is always the pure-JS
implementation. `vectorOk` is only meaningful when `subtleAvailable` is true.
Record the observed result in ticket #9. If `configPresent` is false while the
BFF works, the values come from `TL_VPS_URL` / `TL_SHARED_SECRET` in the
environment.

### Rotation

Rotation is a deliberate database rewrite, never a request to `provision`:

1. Generate a new secret with `openssl rand -hex 32`.
2. Rewrite the `shared_secret` row in the platform database: BotFather → your
   bot → Serverless → Database, or a reviewed one-off module you delete after
   use. `UPDATE settings SET value = '<new>', updated_at = unixepoch() WHERE key = 'shared_secret';`
   Do not put a real secret into a chat message if you can avoid it.
3. Update `TL_SHARED_SECRET` on the VPS and restart the API.

Between steps 2 and 3 every call fails closed with `init_data_invalid`; no data
leaks. A short maintenance window is expected. Do not "rotate" by deleting both
rows while the VPS still has the old value — the BFF would answer
`upstream_unavailable` until provisioning runs again.

If either value is missing, malformed, or shorter than 32 characters,
`resolveConfig` fails, the endpoint logs `reason` and `missing` (key names
only), and the Mini App receives `upstream_unavailable`.

## Pinned vectors

These are the contracts. Each is asserted by a test and must not change without
changing the VPS and the spec together.

### TL1 request signature

The same vector as `vps/test/auth-signature.test.ts`.

```
secret      tele-lenta-test-shared-secret-0123456789
user        42
timestamp   1700000000
method      POST
target      /v1/session?x=1
body        {"id":42}

canonical   TL1
            1700000000
            POST
            /v1/session?x=1
            17b4db064e17f4878e391177e6ca623b798911f34014bc9e78920993d7dd27ad
            42

signature   e31c66f79672f1a78e863622d7ebabdee59d58cebd36faee148b97a0b6a5cec4
```

The body hash is the SHA-256 of the bytes sent. The empty body hashes to
`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.

### Mini App `initData`

Test bot token only, never a real one. Computed outside these modules and
hardcoded in `test/initdata.test.js` with `now = 1700000000000` (ms):

```
bot token   424242:TEST-BOT-TOKEN-tele-lenta-000000000
auth_date   1700000000
user        {"id":1002003004,"first_name":"Тест","last_name":"Пользователь","username":"beta_tester","language_code":"ru"}
hash        632179ce939c90b1d54ed4550482749274fd31fec3eafb4bda5b18faed00fac5
```

### HMAC probe

RFC 4231 test case 2: key `Jefe`, message `what do ya want for nothing?`,
digest `5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843`.

## Runtime HMAC capability

Ticket #9 asked for a pre-flight before any endpoint exists. The active signing
path is the pure-JS implementation (`lib/sha256.js`, `lib/hmac.js`), because the
Serverless runtime documents no `crypto.subtle` guarantee. `probeHmac()` checks
`globalThis.crypto?.subtle` against RFC 4231 case 2 and returns
`{ subtleAvailable, vectorOk, activePath: 'pure-js' }`; it is diagnostic only.
The `diagnose` endpoint wraps it for the owner. Run it once after a deploy and
record the result in the ticket. A missing `crypto.subtle` does not affect the
BFF.

The signing path also uses `AbortController` and `setTimeout` through
`callVps`'s 10-second timeout. They are standard ECMAScript/Web APIs, but the
Serverless documentation does not name them explicitly: the first deployed
`npx tgcloud run endpoints/session` is the proof. If they are absent, the call
fails closed as `upstream_unavailable`; it never hangs or leaks.

## Tests

```sh
npm run test:tgcloud     # node --test tgcloud/test/*.test.js
```

No network, no platform, no database. SHA-256/HMAC are checked against RFC 4231
cases 1, 2, 4, 6, 7 and against `node:crypto` for random inputs. `initData`
fixtures are generated with `node:crypto` from a test bot token plus the pinned
vector above. The upstream `fetch` is stubbed and its received headers are
asserted against the signed request. CI runs this alongside the VPS job.

The endpoint layer's pure half is covered:

- `test/resources.test.js` — feed query encoding (fixed order, repeated
  `sources`, percent-encoding, omission of empty values, `limit=0`), card id
  encoding, the saved-search and me action/method mapping, and
  `invalid_request` for unknown actions or missing ids;
- `test/identity.test.js` — the platform-user path, the manual `initData` path,
  a tampered manual payload winning over `ctx` instead of falling back, an
  expired payload, a missing user, and the guarantee that `input.id` /
  `input.user_id` are never read;
- `test/start.test.js` — `/start`, `/start@bot`, and `/start <payload>`; group,
  channel, and missing-text rejection; payload extraction and trimming; HTTPS
  URL validation; the reply with and without a `web_app` keyboard; and the
  `miniapp_url` → `MINI_APP_URL` fallback with trimming;
- `test/provision-plan.test.js` — the one-shot core pair (`already_provisioned`,
  `partially_provisioned`, the unchanged validation reasons), the
  `miniapp_url`-only update once the pair exists, `not_provisioned` before it,
  and `miniapp_url_invalid` for a non-HTTPS value;
- `test/module-contract.test.js` — a static check that every file in
  `endpoints/` and `handlers/` has a default export and imports only `sdk`,
  `sdk/*`, and relative `.js` modules, that the expected endpoint and handler
  files exist, and that `handlers/message.js` imports no schema and calls no
  `db.` or `fetch`.

The endpoint files themselves are not unit-tested: they import `sdk`, which
exists only on the platform. Their behaviour is the pure mapping above plus the
`forward` call, and the deploy-time check is `npx tgcloud run` (see the
provisioning and diagnose runbooks). `lib/runtime.js` is platform-only for the
same reason. `handlers/message.js` is that kind of seam too: its pure half is
`lib/start.js`, and the only platform call left is `api.sendMessage`.

## Rules for later changes

- Do not change `lib/sha256.js`, `lib/hmac.js`, `lib/initdata.js`,
  `lib/upstream.js`, `lib/errors.js`, `lib/config.js`, or the `settings` table
  shape without re-pinning the vectors here and in the VPS test together.
- The user id comes from the platform-verified `ctx.initData.user` (or
  `verifyInitData(...).user`), never from the body.
- Never log `ctx.initData`, the bot token, the shared secret, the signature
  headers, or post content.
- Keep `target` byte-identical to what is sent, including the query string.
- Do not import `sdk` from any `lib/` module except `runtime.js`, which is the
  documented platform boundary.
- A new endpoint needs a target/method builder in `resources.js` and a test,
  not URL construction inside the endpoint file.
