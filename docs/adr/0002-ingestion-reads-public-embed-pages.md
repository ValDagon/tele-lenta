# Ingestion reads public embed pages, not a Telegram account

Status: accepted

The source chats are public groups and channels, and the owner will not ask admins to add a
bot or run a userbot. Telegram exposes regular messages of a public group at
`https://t.me/<group>/<id>?embed=1` and public channels at `https://t.me/s/<channel>`, both
without authentication. The collector therefore runs outside Telegram and reads those
pages: no account, no bot in the source chats, no admin consent.

## Consequences

- One HTTP request per group message; there is no bulk endpoint. Polling uses a per-group
  cursor and an adaptive ID window, with a negative cache for "Post not found".
- The channel path fetches 20 messages per page; the group path cannot.
- No account to ban. The remaining risks are IP-level rate limiting, HTML drift, and
  Telegram's scraping terms.
- Albums repeat the same caption and photo set across several IDs; deduplicate by text,
  first photo, and timestamp.
- A parser fixture test is mandatory; a silent parser break stops the feed.
