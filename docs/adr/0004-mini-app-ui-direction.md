# The Mini App is a reading surface, not a marketplace

Status: proposed

The feed is the product, and the cluster is its unit. A marketplace template
would bury that: hero search, category tiles, a grid of equal cards, trust-blue
chrome. Теле-Лента needs to make a noisy multi-chat stream feel edited, show why
a card exists, and get the user back to the source chat quickly.

We use a single-column chronological feed with section tabs for Объявления,
Вакансии, and Мероприятия; full-height sheets for search, filters, and saved
searches; no bottom tab bar. The cluster is the signature: a card with more than
one source sits on a paper-like stack and carries a source trail, so duplicates
are visible without opening the card. The palette is limestone, verdigris, and a
clay signal reserved for demand and stale-feed warnings; the type is Onest in
one family, with Cyrillic and Latin Extended subsets. The native Telegram
MainButton carries the source action on the detail screen. Themes follow
Telegram `themeParams` with a manual auto/light/dark override and a contrast
guardrail.

## Consequences

- The spec carries the screen map, component states, themes, and UI contract;
  the detailed direction lives in `docs/design/2026-11-ui-direction.md`.
- The front end self-hosts the Onest subsets; no runtime Google Fonts request.
- The region filter is hidden in v1 because only Montenegro exists; the data
  field stays for the Serbian source list.
- Price ranges, maps, admin/takedown, and a bottom tab bar are out of v1.
- The final UI pass re-runs the design cascade on real components and `ui-test`
  in a browser; this ADR is the direction, not the finished interface.
