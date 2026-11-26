# The Serverless BFF trusts platform-verified initData; the upstream secret lives in the settings table

Status: accepted

The smaller split of ticket #9: the BFF core has to authenticate the Mini App
caller and sign the VPS request, but the Serverless runtime exposes no
documented environment-secret mechanism, and its HMAC facility had not been
proven. Two decisions follow.

## Identity

The platform delivers `ctx.initData` to every endpoint already verified against
the configured bot token. The BFF trusts that identity and does **not** keep a
second copy of the bot token. It still re-derives the hash itself, so the check
is visible, testable, and independent of an undocumented platform guarantee:

- the data-check string is every field except `hash`, sorted by key, joined
  with `\n`;
- the secret is HMAC-SHA256 with key `WebAppData` and the bot token as message;
- the expected hash is HMAC-SHA256 of the data-check string under that secret;
- the comparison is constant time;
- `auth_date` older than 24 hours or more than 5 minutes in the future is
  rejected;
- the user id comes only from the verified payload, never from the request
  body.

The user id is placed inside the upstream MAC (`X-TL-User`), so a signature for
one user cannot be replayed against another.

## The upstream secret

The active signing path is a pure-JS SHA-256 and HMAC-SHA256
(`tgcloud/lib/sha256.js`, `tgcloud/lib/hmac.js`). It was built before the
endpoints, which is the pre-flight ticket #9 asked for. RFC 4231 cases 1, 2, 4,
6, and 7 pass, and one TL1 vector is pinned in both the VPS and BFF tests.

`crypto.subtle` is not assumed. `tgcloud/lib/hmac-probe.js` checks
`globalThis.crypto?.subtle` against RFC 4231 case 2 and reports
`{ subtleAvailable, vectorOk }`; it is diagnostics only and never on the
signing path.

Because no environment-secret mechanism is documented, the shared secret and
the VPS base URL live in the platform SQLite `settings` table:

| `settings.key` | Meaning |
| --- | --- |
| `vps_url` | VPS base URL |
| `shared_secret` | 32+ character secret shared with the VPS |

The owner writes them once through a guarded provisioning endpoint (next
session) or a direct seed on a non-production database. The values are never
committed, never logged, and never returned to a client. Environment variables
(`TL_VPS_URL`, `TL_SHARED_SECRET`) take precedence when the runtime provides
them, which keeps local tests and any future platform secret store working
without changing the read path.

A pure `resolveConfig({ env, settings })` performs the lookup and returns a
typed failure naming the missing keys (never the values). The endpoint maps that
failure to `upstream_unavailable` and logs the reason server-side.

## Rejected alternatives

- **Copy the bot token into the Serverless runtime and verify `initData`
  independently.** Correct in principle, but the bot token is a high-value
  secret with no documented Serverless secret store, and the platform already
  verifies the payload. Keeping a second copy adds a leak surface without
  adding a security property.
- **Hardcode the shared secret in the deployed bundle.** A bundle is readable
  by anyone with the deploy artifact, and rotation would need a redeploy. The
  `settings` row rotates without a deploy.
- **Use `crypto.subtle` as the signing path.** The runtime does not document it.
  A pre-flight probe proves it in one environment, not on every deploy target.
  The pure-JS implementation is small, vector-pinned, and runtime-independent.
- **Move the BFF to the VPS.** That reopens ADR-0003 and gives up the Mini App's
  same-origin Serverless deployment for no gain: the identity and signing
  problems are already solved here.
- **Return upstream error text to the Mini App.** Only stable codes cross the
  boundary; the Mini App owns the Russian copy.

## Consequences

- `settings` is owner configuration, not product state. It holds no listings,
  users, or saved searches, so ADR-0003's "the VPS owns product data" still
  holds.
- Provisioning is a manual, one-time owner action. Losing the row means the BFF
  answers `upstream_unavailable` until it is rewritten; the failure is logged
  and never exposes a value.
- Rotating the secret requires writing the `settings` row and updating
  `TL_SHARED_SECRET` on the VPS together. Requests in flight during the change
  fail closed with `init_data_invalid`.
- The pure-JS HMAC is more code to own than a platform primitive. The RFC 4231
  vectors and the shared TL1 vector make a regression a test failure rather
  than a silent authentication break.
- If the platform later documents a secret store, `resolveConfig` already
  prefers it through `env`; only the provisioning path changes.
- No endpoint, handler, or deployment is part of this decision; the flat
  endpoints land in the following ticket on top of these modules.

## Update 2026-11-05: the endpoints landed

The flat endpoints now exist in `tgcloud/endpoints/`, with the pure mapping in
`tgcloud/lib/resources.js` and the platform boundary in
`tgcloud/lib/runtime.js`. Two points refine the text above:

- The platform sends an endpoint's return value as JSON and expects the platform
  `EndpointError` from `sdk` to refuse a call; `err.parameters.code` is the
  stable code. The BFF's own `{ error: { code, message } }` envelope stays an
  internal vocabulary shared with the VPS and its tests, not the wire shape of an
  endpoint response.
- Provisioning is `endpoints/provision.js`. It writes `vps_url` and
  `shared_secret` once, refuses when either row already exists, and never
  returns or logs the secret. The one-shot refusal is the real protection:
  `TL_OWNER_TELEGRAM_ID` is checked only when the runtime happens to expose it,
  and the module is removed from the deployed set after setup. Rotation is a
  deliberate database rewrite documented in `tgcloud/README.md`, not a request.
