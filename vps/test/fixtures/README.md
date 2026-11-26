# Parser fixtures

Real Telegram HTML saved on **2026-11-05** with a descriptive User-Agent, then
sanitized. The structure that the parser depends on is intact: message widget
classes, `data-post` / `data-post-id`, `<time datetime>`, photo wrappers,
grouped-media markup, video players, footer metadata, the explicit
`Post not found` error, and service-message labels.

| Fixture | Fetched from | What it covers |
| --- | --- | --- |
| `channel-montework.html` | `https://t.me/s/montework` | 20-message channel page, several posts, one photo post, emoji images |
| `group-text-photos.html` | `https://t.me/sale_me_com/1110000?embed=1` | group message with text and four photos |
| `album-1109995.html` | `https://t.me/sale_me_com/1109995?embed=1` | album member with caption and seven photos |
| `album-1109996.html` | `https://t.me/sale_me_com/1109996?embed=1` | next album member, same caption and photo set |
| `album-1109997.html` | `https://t.me/sale_me_com/1109997?embed=1` | next album member, same caption and photo set |
| `group-image-only.html` | `https://t.me/baraholka_Monte/384013?embed=1` | image-only post (seven photos, no caption) |
| `group-video.html` | `https://t.me/sale_me_com/1110022?embed=1` | video presence without treating thumbnails as photos |
| `emoji-image-set.html` | `https://t.me/montework/1244?embed=1` | emoji images from `telegram.org/img/emoji` next to a real photo |
| `not-found.html` | `https://t.me/sale_me_com/99999999?embed=1` | explicit `Post not found` page |
| `edited-post.html` | `https://t.me/durov/535?embed=1` | edited post marker and timestamp |
| `service-message.html` | `https://t.me/sale_me_com/1?embed=1` | service message that must be dropped |

`corrupted-message-class.html` and `corrupted-truncated.html` are deliberately
broken copies of `group-text-photos.html`, not fetched pages. They exist to prove
that markup drift surfaces as `parse_error` instead of an empty feed.

## Redactions

- Post and caption text is replaced with synthetic Russian text that keeps
  `<br>` line breaks, an `<a>` link, and (in the emoji fixture) the real emoji
  markup. No original listing text is committed.
- Author, owner, forwarded-from, link-preview, and inline-button labels are
  replaced with neutral placeholders. The channel sidebar description was
  removed.
- `t.me` links inside widgets point at `https://t.me/example`. Public source
  links in widget footers (`t.me/montework`, `t.me/sale_me_com`, ...) are kept
  because they identify the public source, not a person.
- All `cdn*.telesco.pe` URLs have their opaque file ids replaced with stable
  synthetic ids. Album members share the same synthetic photo ids so the
  "same photo set" assertion is meaningful.
- Telegram document/photo ids in the photo-wrapper class list were dropped.
  Emoji URLs on `telegram.org/img/emoji` were kept on purpose.
- Timestamps, message ids, and widget classes were not changed.
