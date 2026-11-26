# The feed unit is a cluster, not a message

Status: accepted

Amended 2026-11-05: the first photo is a corroborating signal, not a required
match. A cross-post may re-upload its photo, so equal `cdn*.telesco.pe` URLs are
not guaranteed; requiring them would suppress the merges this decision exists to
create. The cluster key is normalized text, price, and city, with a specificity
guard that keeps short generic lines as singletons. The pilot measures how often
forwarded photos keep identical URLs.

Cross-posting is the norm in Montenegrin and Serbian classifieds: the same offer
appears in several source chats, often with identical text and photos. One card
per message would fill the feed with duplicates and make saved-search digests
repeat themselves. We store every listing as its own row, but group listings into
a cluster when normalized text, price, city, and the first photo match within a
short window, and the feed renders one card per cluster with all sources and the
earliest publication date.

## Consequences

- Ingest computes and persists a cluster key; edits and deletions can split or
  merge clusters.
- Notifications match clusters, not raw listings, so a cross-post does not trigger
  a second push.
- A wrong merge hides a genuinely different offer, so the card shows its sources
  and the user can open each one.
