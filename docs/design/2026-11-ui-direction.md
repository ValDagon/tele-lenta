# UI direction: the stream, edited

Status: proposed. This is the design direction for the v1 Telegram Mini App, not
the product spec. It feeds `/to-spec`; the spec and tickets decide the API,
framework, and file layout.

Date: 2026-11-05

Inputs: `GLOSSARY.md`, ADR-0001 (the feed unit is a cluster), ADR-0002
(ingestion reads public embed pages), ADR-0003 (Serverless front, VPS
collector), `docs/research/2026-11-source-inventory.md`.

## The thesis

Теле-Лента takes a noisy stream from many chats and edits it into one calm
reading surface. The interface should feel like a careful local editor, not a
marketplace storefront.

The feed is the product. Chrome recedes; the card carries the meaning. The
signature is the cluster: a card visibly carries its duplicates as a paper stack
and its sources as a trail. A user can see why the card exists and where it came
from without opening it.

The primary job is to scan, judge, and leave for the source chat. The secondary
job is to save a search so the bot brings matches later. Everything that does
not serve those two jobs is cut.

## Brief and constraints

- Audience: 10–30 Russian-speaking expats in Montenegro, closed beta, daily
  Telegram users, mostly one-handed on a phone. Bright daylight and late night.
- Sources: 9 public groups and 2 public channels; groups are read one message at
  a time, so the feed updates every few minutes, not in real time.
- Unit: one card per cluster, with all sources and the earliest publication
  date. Contacts stay in the source chat.
- Sections: Объявления, Вакансии, Мероприятия. Categories inside Объявления:
  Недвижимость, Авто, Вещи, Услуги, Другое. «Куплю/Ищу» is a badge, not a
  section.
- Themes: follow Telegram `themeParams` by default, plus a manual
  «Как в Telegram / Светлая / Тёмная» override.
- Language: Russian in v1. The data is mixed Russian, Serbian Latin, and
  Montenegrin Latin with diacritics; the UI must render all of it cleanly.
- Media: hotlinked from `cdn*.telesco.pe`; endpoints return JSON only. No image
  proxy, no resize endpoint on Serverless.
- Retention: 30 days. Digest: every 30 minutes, quiet hours 23:00–08:00
  Europe/Podgorica.
- Serbia is out of v1. The region field exists in the data, but a region filter
  with one option is a dead control; hide it until Serbian sources exist.

## What this direction rejects

| Candidate | Where it came from | Why it is rejected | Replacement |
|---|---|---|---|
| Trust blue `#2563EB`, price green `#16A34A`, `#EFF6FF` canvas | Generated marketplace palette | Generic marketplace/SaaS template; the anti-slop matrix bans monotonous slate/indigo and trust-blue defaults; a local feed needs a local voice | Limestone canvas, verdigris accent, clay signal; price in ink |
| Atkinson Hyperlegible | Generated typography match | No Cyrillic subset; the UI is Russian and the data is Latin Extended | Onest, verified Cyrillic + Latin Extended |
| Hero search + category tiles + featured listings | Generated marketplace landing pattern | That is a storefront, not a chronological feed; the feed is the product | Section tabs + one calm list |
| Three identical rounded cards with soft shadows | Anti-slop banned matrix | Cookie-cutter card kit; every card looks equally important | A single-column list with hairline borders; the cluster stack is the only layered surface |
| Cream `#F4F1EA` + high-contrast serif + terracotta | The common generated-design cluster | Reads as the default "tasteful AI" page, not as this product | Cool limestone, one grotesque, verdigris; clay only as a demand signal |
| Uppercase eyebrows, `·` meta strings, `→` links, emoji icons | Anti-slop banned matrix | Decoration pretending to be structure; inconsistent across platforms | Sentence case, separate spans, no arrows, one SVG icon family |
| Bottom tab bar with five destinations | Generic mobile app pattern | Three sections plus two utility surfaces do not justify a permanent bar; it duplicates Telegram's bottom chrome and costs 56px of feed | Section tabs + full-height sheets |
| Region filter with only «Черногория» | Product decision, applied literally | A filter with one value teaches nothing and takes space | Hide the control in v1; keep the data and the `Регион` concept |

## Visual system

### Palette

The canvas is Adriatic limestone, the accent is oxidized copper (verdigris), and
the only warm signal is clay, reserved for demand and warnings. The palette is
deliberately not blue, not purple, and not cream.

| Role | Light | Dark | Use |
|---|---|---|---|
| `--canvas` | `#F2F3EE` | `#0E1512` | Page background, behind the feed |
| `--surface` | `#FFFFFF` | `#151E1A` | Cards, sheets, source rows |
| `--surface-sunken` | `#E9EBE5` | `#0A100D` | Skeletons, image placeholders, search field |
| `--surface-pressed` | `#E9ECE4` | `#1C2722` | Card and row pressed state |
| `--ink` | `#14201B` | `#E8EEE9` | Titles, body, prices |
| `--ink-secondary` | `#3F4B45` | `#B3BDB6` | Secondary body, source names |
| `--ink-muted` | `#5F6A64` | `#7E8A83` | Timestamps, counts, hints |
| `--line` | `#DCE0D8` | `#26332C` | 1px card and row borders |
| `--line-strong` | `#C3C9BF` | `#3A4A41` | Input borders, focused dividers |
| `--accent` | `#1F6F5C` | `#5FBFA5` | Active tab, links, primary button, source monogram |
| `--accent-hover` | `#185A4B` | `#7FD4BC` | Hover and pressed accent |
| `--accent-soft` | `#DDECE6` | `#17332B` | Active chip background, subtle selected state |
| `--on-accent` | `#FFFFFF` | `#0E1512` | Text on a filled accent |
| `--signal` | `#A8441F` | `#E58A62` | «Куплю/Ищу», stale-feed warning |
| `--signal-soft` | `#F6E3DA` | `#3A2118` | Demand badge background |
| `--danger` | `#B3261E` | `#F2B8B5` | Errors, destructive actions |
| `--overlay` | `rgba(10, 16, 13, 0.48)` | `rgba(0, 0, 0, 0.62)` | Sheet scrim |

Contrast, checked against the adjacent surface:

- `--ink` on `--canvas`: 15.0:1 light, 15.7:1 dark.
- `--ink-secondary` on `--canvas`: 8.2:1 light, 9.6:1 dark.
- `--ink-muted` on `--canvas`: 5.1:1 light, 5.2:1 dark.
- `--accent` on `--canvas`: 5.4:1 light; `--accent` on `--surface`: 6.0:1 light.
- `--on-accent` on `--accent`: 6.0:1 light, 8.4:1 dark.
- `--signal` on `--surface`: 6.0:1 light; `--signal` on `--signal-soft`: 4.8:1.
- `--danger` on `--canvas`: 5.9:1 light, 10.8:1 dark.

Rules:

- Price and salary are ink, never green. Green is success, not money.
- The demand badge is clay with the text «Куплю» or «Ищу». Color is never the
  only signal.
- Source status is text and icon, never a colored dot alone.
- No gradients, no radial glows, no colored shadows. The only shadow is the
  bottom sheet's lift over the scrim.

### Typography

One family: **Onest** (variable, Google Fonts). Verified subsets: Cyrillic,
Cyrillic Extended, Latin, Latin Extended. Latin Extended covers `č`, `ć`, `š`,
`ž`, `đ`, which the Serbian and Montenegrin listings need. One family keeps the
webview light and avoids the generated serif-plus-cream look.

Self-host the variable WOFF2 for the Cyrillic and Latin Extended subsets, preload
the 400 and 600 ranges used above the fold, and let `font-display: swap` fall
back to `system-ui, -apple-system, "Segoe UI", sans-serif`. Do not load the full
family from a third party at runtime.

| Token | Size / line | Weight | Use |
|---|---|---|---|
| `--text-display` | 28 / 1.1 | 650 | Access gate, onboarding title |
| `--text-h1` | 22 / 1.2 | 650 | Detail title |
| `--text-h2` | 17 / 1.35 | 600 | Card title |
| `--text-body` | 15 / 1.5 | 400 | Feed supporting text; detail body 16 / 1.55 |
| `--text-sm` | 13 / 1.4 | 450 | City, category, source names |
| `--text-xs` | 11.5 / 1.3 | 500 | Timestamps, counts, hint text |
| `--text-price` | 20 / 1.1 | 700 | Card price or salary; 24 / 1.1 on detail |
| `--text-button` | 15 / 1 | 600 | Buttons and chips |

Rules:

- `font-variant-numeric: tabular-nums` on prices, salaries, counts, times, and
  the result count.
- Card titles clamp to two lines; the full text lives on the detail screen.
- No uppercase labels. No letter-spaced eyebrows. Headings use `-0.01em` to
  `-0.02em`; body uses normal tracking.
- Detail body text is capped at `65ch`; feed cards are naturally narrow.
- Minimum text size is 11.5px, and only for metadata. Body text is 15px or more.

### Space, shape, borders

- 4px base grid: 4, 8, 12, 16, 20, 24, 32, 40, 48.
- Page gutter: 16px on phones, 24px from 600px up.
- Feed card gap: 12px; card padding: 16px; section gap: 24px.
- Touch targets: 44×44px minimum. Chips are visually 32–36px tall, with
  padding or a pseudo-element to reach 44px. Source rows are 56px.
- Radii: card 14px, thumbnail 8px, button 10px, chip 8px, badge 6px, bottom
  sheet 20px top corners. Monogram circles and switches are the only pills.
- Cards use 1px `--line`, not shadows. The cluster stack uses two offset
  surface layers with the same border, no blur.
- Focus ring: 2px `--accent`, 2px offset, always `:focus-visible`.

### Icons

One family, one stroke weight: 20px at 1.5px, 24px in empty states. Phosphor
regular or an equivalent inline SVG set; the spec picks the delivery. No emoji
as a structural icon. The set is small: search, bookmark, sliders, more,
chevron-left, refresh, x, check, external-link, clock, map-pin, briefcase,
calendar, image, alert-circle, wifi-off.

The Telegram paper plane is used only for the source action, never as
decoration.

## The signature: cluster stack and source trail

Two devices carry the product's identity, and both encode information:

1. **Cluster stack.** When a cluster has more than one source, the card sits on
   two offset layers, 3px and 6px below, with the same surface and 1px border.
   It reads as a small stack of notices, not as a drop shadow. The layers are
   decorative; the accessible name says «Источников: 3».
2. **Source trail.** At the bottom of the card, up to three 20px monogram
   circles: the earliest source is filled with `--accent` and `--on-accent`, the
   rest are outlined. After the circles, «ещё 2 источника» or «ещё 2». On the
   detail screen, the same trail becomes a list of source rows with names,
   status, and action.

The stack is the only layered surface in the feed. It is removed when there is
one source. This keeps the common case quiet and makes duplicates legible.

## Screens and flows

```
                    ┌──────────────┐
                    │  Access gate │
                    └──────┬───────┘
                           │ allowed
                    ┌──────▼───────┐
        ┌───────────│     Feed     │───────────┐
        │           └──┬────┬──────┘           │
        │              │    │                  │
   ┌────▼────┐   ┌─────▼─┐  ▼──────┐    ┌──────▼─────┐
   │ Search  │   │ Filter│  │ Card  │    │  Saved     │
   │ sheet   │   │ sheet │  │ detail│    │  searches  │
   └────┬────┘   └───┬───┘  └───────┘    └──────┬─────┘
        │            │                          │
        └────────────┴──────────► Save search ◄─┘

   Feed → Settings (more menu)
```

### Feed

The default screen. The Telegram header is native; the app does not repeat the
brand inside the feed.

```
┌────────────────────────────────────────────────────────┐
│ Обновлено 2 мин назад           [find] [saved] [more]  │  sticky
├────────────────────────────────────────────────────────┤
│ Объявления   Вакансии   Мероприятия          [filter]   │  sticky
│ [Недвижимость ×] [Подгорица ×]  Сбросить                │  only when filters
├────────────────────────────────────────────────────────┤
│ ┌────────────────────────────────────────────────────┐ │
│ │ Недвижимость                         2 ч назад     │ │
│ │ Продам двухкомнатную квартиру у моря               │ │
│ │ 850 €/мес                             ┌─────────┐  │ │
│ │ Подгорица, Словенска                  │  фото   │  │ │
│ │                                       └─────────┘  │ │
│ │ ● ○ ○  ещё 2 источника                             │ │
│ └────────────────────────────────────────────────────┘ │
│ ┌────────────────────────────────────────────────────┐ │
│ │ Вакансии                            45 мин назад   │ │
│ │ Автомеханик                                        │ │
│ │ 1 200 €                               ┌─────────┐  │ │
│ │ Будва                                 │  фото   │  │ │
│ │                                       └─────────┘  │ │
│ │ ● montework                                        │ │
│ └────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────┘
```

- The status line is the only freshness indicator. It is a low-emphasis text
  button: tapping refreshes the feed. When the feed is stale, it becomes
  «Нет связи, 14:20» in `--signal`.
- Both header rows are sticky; the feed scrolls under them. On screens narrower
  than 360px, the tab row scrolls horizontally and the filter button stays
  fixed.
- The top bar holds search, saved searches, and a more menu. The more menu
  holds «Настройки», «Как мы собираем объявления», and «Написать владельцу».
- Section tabs are a tablist: three tabs, active underline in `--accent`, arrow
  key navigation, `aria-selected`. The filter button is 44×44 with an active
  count badge when filters are on.
- Active filters appear as removable chips under the tabs. «Сбросить» clears all.
  With no active filters, the row is absent.
- The feed is chronological by earliest publication. Day dividers («Сегодня»,
  «Вчера», «5 ноября») are plain section labels, sentence case, 12px muted.
- Infinite scroll with a 20-card page. At the end: «Вы дошли до конца. Мы храним
  объявления 30 дней.» Pull-to-refresh is not used; the status line and tab
  changes are the refresh points.

### Card

One component with three content variants and two structural states.

```
listing                      job                        event
┌───────────────────────┐    ┌───────────────────────┐    ┌───────────────────────┐
│ Недвижимость  2 ч     │    │ Вакансии      45 мин  │    │ Мероприятия    1 ч    │
│ Продам квартиру       │    │ Автомеханик           │    │ Маслиниада-2026       │
│ 850 €/мес      [фото] │    │ 1 200 €        [фото] │    │ Сб, 15 ноя, 20:00     │
│ Подгорица      [фото] │    │ Будва          [фото] │    │ Сутоморе, набережная  │
│ ● ○ ○  ещё 2          │    │ ● montework           │    │ ● monteafisha         │
└───────────────────────┘    └───────────────────────┘    └───────────────────────┘
```

Content rules:

- The meta row has at most two items: the category (or section) on the left and
  the relative time on the right.
- The title is the first meaningful line of the listing, clamped to two lines.
  It is not generated by an LLM in v1.
- The price slot is the parsed price or salary; for events it is the date and
  time. If there is no price, the slot is omitted, not filled with «Цена не
  указана».
- The city is one line. If the listing has no city, the line is omitted.
- The thumbnail is 96×96, 8px radius, `object-fit: cover`, right-aligned. It is
  omitted when there is no usable photo. A small counter «1/5» sits in the
  corner when there is more than one photo.
- The source trail is the only footer. No «Открыть» button: the whole card is the
  action. One primary action per card.
- The demand badge («Куплю» / «Ищу») sits next to the category, not on the
  title. It uses `--signal-soft` and `--signal` with text. For jobs the badge
  reads «Ищу работу»; events have no demand badge.
- A cluster with more than one source gets the stack. The stack is not a
  separate row; it is part of the card's silhouette.

States: default, pressed (`--surface-pressed`), focus-visible (2px accent ring),
loading skeleton (same dimensions, no stack), image error (sunken placeholder
with an image icon, no broken-image glyph). There is no hover lift and no
entrance animation.

### Detail

A full-screen view, not a modal, because the card is a destination and Telegram
provides the BackButton.

```
┌──────────────────────────────────────────────┐
│ ┌──────────────────────────────────────────┐ │
│ │              photo gallery               │ │  1 / 5
│ └──────────────────────────────────────────┘ │
│ Недвижимость                                 │
│ Продам двухкомнатную квартиру у моря         │
│ 850 €/мес                                    │
│ Подгорица, Словенска, 60 м², 2 комнаты       │
│                                              │
│ Текст объявления без обрезки. Сохраняем      │
│ абзацы, ссылки и #хештеги.                   │
│                                              │
│ Опубликовано в 3 источниках                  │
│ ┌──────────────────────────────────────────┐ │
│ │ ● baraholka_Monte   первым, 2 ч назад    │ │
│ │   Открыть сообщение                      │ │
│ │ ● sale_me_com       1 ч назад            │ │
│ │   Открыть сообщение                      │ │
│ │ ● nedviga_montenegro                     │ │
│ │   Вступить в чат                         │ │
│ └──────────────────────────────────────────┘ │
│                                              │
│           [ Открыть в Telegram ]             │  native MainButton
└──────────────────────────────────────────────┘
```

- Gallery: horizontal scroll-snap, 16:10, 14px radius, counter in the corner.
  No dots, no lightbox in v1. Images lazy-load; the first image is the LCP
  candidate and gets `fetchpriority="high"`.
- The title is the page's `<h1>`. The category is a small label above it.
- Body preserves line breaks; URLs, `@mentions`, and `#хештеги` are linkified.
  A hashtag tap opens search with that tag.
- The cluster line is plain language: «Опубликовано в 3 источниках». The first
  source row says «первым». This is the product's transparency.
- Source rows: monogram, name, relative time, status, action. Statuses:
  «Открыть сообщение» (public), «Вступить в чат» (invite), «Источник закрыт»
  (no action), «Сообщение удалено» (no action).
- The native MainButton is the only primary action. It opens the earliest
  actionable source. If no source is actionable, it is hidden and the source
  list explains why. The content has 96px bottom padding so the button never
  covers a source row.
- BackButton is shown on this screen and returns to the feed at the same scroll
  position.

### Filter sheet

A native `<dialog>` bottom sheet on phones, a centered dialog from 600px up.
`closedby="any"`, `overscroll-behavior: contain`, focus returns to the filter
button.

```
┌──────────────────────────────────────────────┐
│ Фильтры                                  [×] │
│ Что показывать                               │
│ [Объявления] [Вакансии] [Мероприятия]         │
│ Категория                                    │
│ [Все] [Недвижимость] [Авто] [Вещи] [Услуги]  │
│ Тип                                          │
│ [Все] [Предлагаю] [Куплю/Ищу]                │
│ Источники                              ▾     │
│ [ ] baraholka_Monte  [ ] sale_me_com …       │
│                                              │
│ [Сбросить]        [Показать 128 объявлений]  │
│ Сохранить этот поиск                         │
└──────────────────────────────────────────────┘
```

- The count in the primary button updates live and uses Russian pluralization.
  If the count query is too expensive, the button says «Показать» without a
  number; do not fake a count.
- Category chips are toggle buttons (`aria-pressed`), not tabs.
- The demand filter is section-aware: «Предлагаю / Куплю/Ищу» for Объявления,
  «Предлагаю работу / Ищу работу» for Вакансии, hidden for Мероприятия.
- The sources list is a scrollable checkbox group, collapsed by default. If it
  costs too much for v1, cut it from the sheet without changing the rest.
- The region group is absent in v1; the data keeps the field.
- Price range is out of v1. It needs reliable price normalization before it is
  honest.
- «Сохранить этот поиск» opens the save flow with the current filters, not a
  second form.

### Search

A full-height sheet, because search is a mode with its own state.

```
┌──────────────────────────────────────────────┐
│ [Искать в ленте…]                            │
│ Все секции ▾                                 │
│                                              │
│ Недавние                                     │
│ «лодка»                                  [×] │
│ «Подгорица»                              [×] │
│                                              │
│ 12 результатов                               │
│ [cards]                                      │
└──────────────────────────────────────────────┘
```

- The input autofocuses; `inputmode="search"`, `enterkeyhint="search"`,
  `autocomplete="off"`, `spellcheck="false"`. A visually hidden label says
  «Поиск».
- The section selector defaults to all sections. Results show the section label
  on each card because the query crosses sections.
- Recent searches are local, max 5. «Очистить» appears after the first entry.
- Debounce 250ms. Keep previous results while loading; show a 2px accent
  progress bar under the input, not a spinner.
- Result count is a polite live region. Empty state: «Ничего не нашлось.
  Попробуйте другое слово или уберите фильтры.» with «Сбросить фильтры».
- Search normalizes Cyrillic and Latin; the hint under the input on first use is
  «Подгорица найдёт Podgorica». Keep it one line, muted.

### Saved searches

```
┌──────────────────────────────────────────────┐
│ Сохранённые поиски                  [+ Новый]│
│                                              │
│ ┌──────────────────────────────────────────┐ │
│ │ Недвижимость, Подгорица           [ on ] │ │
│ │ до 800 €, каждые 30 минут                │ │
│ │ Последний дайджест: сегодня, 14:30       │ │
│ │                                     [⋯]  │ │
│ └──────────────────────────────────────────┘ │
│                                              │
│ Настройки дайджеста                          │
│ Пусто: «Пока нет сохранённых поисков…»       │
└──────────────────────────────────────────────┘
```

- Each row: auto-generated name (editable), a compact filter summary, the
  digest state, the last digest time, a switch, and an overflow menu with
  «Изменить» and «Удалить». Tapping the row opens the editor.
- The name is generated from the query and filters, for example «Недвижимость,
  Подгорица» or «„лодка“ в Черногории». The user can rename it; do not force a
  name field on creation.
- The digest toggle is per search. Frequency and quiet hours are global and
  live in Settings; the footer link opens them.
- Empty state: «Пока нет сохранённых поисков. Сохраните поиск, и бот пришлёт
  подходящие объявления, даже если приложение закрыто.» + «Создать поиск».
- Saving from the filter sheet shows a toast: «Поиск сохранён. Дайджест придёт в
  этот чат.» The toast is also announced politely.

### Settings

```
┌──────────────────────────────────────────────┐
│ Настройки                                    │
│ Тема                                         │
│ [Как в Telegram] [Светлая] [Тёмная]          │
│ Фильтры                                      │
│ Скрывать спам                        [ on ]  │
│ Скрывать рекламу                     [ off ] │
│ Технические сообщения скрываются всегда      │
│ Дайджест                                     │
│ Присылать дайджест                   [ on ]  │
│ Тихие часы                        23:00–08:00│
│ О приложении                                 │
│ Версия 0.1. Источников: 11.                   │
│ Как мы собираем объявления                   │
│ Написать владельцу                           │
└──────────────────────────────────────────────┘
```

- Theme is a three-state radio group styled as a segmented control. Auto is the
  default. The override is stored locally and applied before first paint.
- Spam and ads are switches; technical messages are a note, not a switch. The
  defaults are spam on, ads off.
- Digest frequency is fixed at 30 minutes in v1; quiet hours use two native time
  inputs and default to 23:00–08:00 Europe/Podgorica.
- «Как мы собираем объявления» opens a short explanatory sheet: public chats,
  no account, links back to the source, 30-day retention, and how to report a
  problem. This is trust content, not marketing.
- Admin and takedown are not in this UI. The owner-only admin surface is a later
  ticket.

### Access gate and onboarding

- Access gate: the only screen with a large wordmark. «Закрытая бета. Доступ по
  приглашению.» + «Напишите владельцу, чтобы получить доступ.» + button
  «Написать владельцу». If `initData` is invalid: «Откройте приложение из
  Telegram.» If the allowlist check fails: «Не удалось проверить доступ.
  Проверьте связь.» + «Повторить».
- Onboarding: a one-time bottom sheet over the feed, not a carousel. Three
  lines: «Читаем объявления из открытых чатов Черногории», «Похожие
  объявления из разных чатов склеиваем в одну карточку», «Контакты — в
  исходном чате. Нажмите „Открыть в Telegram“.» One button: «Понятно». Store
  `onboarding_seen` locally.

## Components and states

| Component | Variants | Required states |
|---|---|---|
| Card | listing, job, event; with/without photo; cluster/single | default, pressed, focus-visible, skeleton, image error |
| Cluster stack | 2+ sources | static, reduced-motion safe |
| Source trail | 1–3 monograms + overflow | default, focus-visible (as part of the card link) |
| Section tabs | 3 | default, hover, focus-visible, selected, disabled (empty section) |
| Filter button | idle, active count | default, hover, focus-visible, pressed, active |
| Filter chip | removable | default, hover, focus-visible, pressed |
| Primary button | default, loading, disabled | 8-state feedback system |
| Icon button | 44×44 | default, hover, focus-visible, pressed, disabled |
| Source row | public, invite, closed, deleted | default, pressed, focus-visible, disabled |
| Switch | on, off | default, focus-visible, disabled |
| Search field | empty, filled, loading, error | default, focus-visible, invalid, disabled |
| Toast | success, error | entering, visible, exiting; polite live region |
| Skeleton | card, detail, source row | static or 1.4s pulse, disabled under reduced motion |

Interaction rules:

- Feed scroll is never animated. Card press changes the surface tint; the card
  does not move, scale, or lift.
- Buttons and chips use the 8-state system; `:active` scales to 0.97 on small
  controls only, never on cards.
- Every icon-only control has an `aria-label`. Every switch has a visible label
  and a state that is announced.
- One primary action per screen zone. The detail screen has the native
  MainButton; the filter sheet has «Показать N»; the search sheet has no primary
  button because typing is the action.

## Quality gate

Scored against the anti-slop 7-axis gate. Every axis is at least 4; the final
implementation must re-check on real components.

| Axis | Score | Why |
|---|---|---|
| Anti-slop purity | 5 | No purple glows, emoji icons, fake stats, card kit, or tracked-out eyebrows. The generated blue palette was rejected. |
| UX speed and 1-to-3 rule | 4 | One primary action per zone; the feed card has no duplicate button; search, saved searches, and the more menu are three utility actions, not a bottom bar. The status line is low-emphasis metadata. |
| Typographic discipline | 5 | One family, two weights plus a display weight, tabular numerals, sentence case, 65ch body measure. |
| Spacing and geometry | 5 | 4px grid, 16px card padding, 12px card gap, a declared radius scale. |
| Micro-interactions | 4 | 0/120/160/220ms tokens, no scroll animation, 0.97 press only on small controls, reduced motion. Needs implementation testing. |
| Accessibility and keyboard flow | 4 | Semantic landmarks, native dialog, focus-visible, 44px targets, contrast-checked tokens. Real screen-reader and 200% zoom testing is still pending. |
| Mobile and responsive linearity | 4 | Single column, sticky two-row header, tab row scrolls under 360px, no horizontal overflow. Needs 320/375/430px device testing. |

## Themes and Telegram integration

The theme is a token layer, not a per-screen decision.

- Default: follow `Telegram.WebApp.colorScheme` and `themeParams` for the
  neutral layer. Map `bg_color` to `--canvas`, `secondary_bg_color` or
  `section_bg_color` to `--surface`, `text_color` to `--ink`, `hint_color` to
  `--ink-muted`. The accent stays the brand verdigris; if it fails 4.5:1 on the
  theme background, use the light or dark accent variant, not an arbitrary
  `link_color`.
- Manual override: a three-state control in Settings. The override sets
  `color-scheme` on `:root` and is stored locally. It must be applied by an
  inline script before first paint to avoid a flash.
- Contrast guardrail: Telegram custom themes can produce low-contrast pairs. If
  `text_color` on `bg_color` is below 4.5:1, use the brand ink token. If
  `link_color` on `bg_color` is below 4.5:1, use the brand accent. The design
  system wins over an unreadable theme.
- `color-scheme: light dark` on `:root` and `<meta name="color-scheme">` in the
  head. Use `light-dark()` for token pairs where it simplifies the layer;
  otherwise use `[data-theme]` tokens. Do not hardcode a single scheme.
- Sync the Telegram chrome with `setHeaderColor`, `setBackgroundColor`, and
  `setBottomBarColor`. In auto mode, use the Telegram colors; in manual mode,
  use the matching token. Re-sync on `themeChanged`.
- The native MainButton carries the detail action. Set its text from the source
  action and its colors from the theme tokens with a contrast check; show it
  only when a source is actionable; hide it on every other screen. Add 96px
  bottom padding on detail.
- The native BackButton is shown on detail, search, saved searches, and
  settings, and while a sheet is open. It closes the top sheet first, then
  returns to the previous surface with scroll and form state preserved. The
  feed is the root and hides it.
- Call `ready()` and `expand()` early. Choose deliberately whether to disable
  vertical swipes: the feed has no horizontal gesture, so native swipes can
  stay; if accidental closes appear in testing, disable them and keep the
  header close.
- Haptics: selection on tab and chip changes; success on saved search; error on
  a failed save. No haptic on every card tap.

## Motion

| Token | Value | Use |
|---|---|---|
| `--motion-instant` | 0ms | Feed scroll, card press, high-frequency actions |
| `--motion-fast` | 120ms | Chips, toggles, small state changes |
| `--motion-base` | 160ms | Tab underline, focus and hover transitions |
| `--motion-sheet` | 220ms | Bottom sheets, dialogs |
| `--ease-out` | `cubic-bezier(0.23, 1, 0.32, 1)` | All UI motion |

- No scroll reveal, no parallax, no page-load choreography. The feed is a
  reading surface.
- Sheets enter from the bottom with a 180ms scrim fade; the scrim is not
  blurred. `prefers-reduced-motion: reduce` sets all durations to 0.01ms and
  stops the skeleton pulse.
- The tab underline moves with a transform, not a layout change.

## Accessibility

- Landmarks: `<header>` for the status/search/saved bar, `<nav
  aria-label="Секции">` for the tablist, `<main>` for the feed or detail. One
  `<main>` per view.
- One `<h1>` per view: the active section on the feed (visually hidden if the
  tab already says it), the listing title on detail. Card titles are `<h2>`.
- Cards: an `<article>` with one full-card link overlay, not a second title
  link. The link's accessible name is the title plus the price, city, and source
  count; the source trail has a visually hidden text alternative. The title is
  an `<h2>` inside the article.
- Tabs: `role="tablist"`, `aria-selected`, roving `tabindex`, arrow keys, and a
  `tabpanel` for the feed. Chips are `aria-pressed`, not tabs.
- Images: card thumbnails are decorative (`alt=""`) because the card text is the
  content; detail images use «Фото N из M» or the listing title. Every image box
  has an aspect ratio and a placeholder.
- Forms: visible labels, `aria-describedby` for hints and errors, inline error
  text, no placeholder-only labels. The search input has a visually hidden
  label.
- Live regions: one polite region for search result counts, save confirmations,
  and refresh failures. No assertive announcements except a session-expired
  access error.
- Focus: native `<dialog>` focus management; no manual traps. `:focus-visible`
  rings on every interactive element. Do not use `outline: none` without a
  replacement.
- Touch targets: 44×44px minimum; 8px between adjacent targets. Source rows are
  56px. The filter icon and tab labels are full-height targets.
- Contrast: tokens meet 4.5:1 for text and 3:1 for UI boundaries in both
  schemes. Forced colors: depend on borders and text, not background images or
  shadows.
- Text scaling: use `rem` for text and spacing, avoid fixed heights on text
  containers, and test at 200% zoom and the largest OS text size.

## Performance

- Feed images: `loading="lazy"` below the fold, `decoding="async"`, explicit
  `width`/`height` or `aspect-ratio`, `object-fit: cover`. The first card's
  image may use `fetchpriority="high"` if it is the LCP candidate. No image
  proxy; the CDN URL is used directly, and the card box caps its display size.
- `content-visibility: auto` on cards below the first viewport, paired with
  `contain-intrinsic-size: auto 132px`. Do not apply it to the first two cards.
  Verify keyboard reachability across off-screen cards; if it breaks, remove it.
- Fonts: self-hosted variable WOFF2, Cyrillic and Latin Extended subsets,
  preloaded for the weights used above the fold. No runtime Google Fonts
  request.
- List growth: 20 cards per page; refresh on open, on visibility change, and
  every 5 minutes while active. The collector updates every few minutes, so a
  faster client poll is wasted work. Cap the live DOM if a session grows past a
  few hundred cards; the spec decides between trimming and virtualization.
- No layout shift: skeletons match card dimensions; the thumbnail and source
  trail have fixed boxes; the status line does not wrap. Use `100dvh` for the
  app shell and full-height sheets, not `100vh`, and `aspect-ratio` for image
  boxes.
- Target: 60fps scrolling on a mid-range Android device, no long tasks over
  50ms during scroll.

## Copy deck

| Context | String |
|---|---|
| Feed status | «Обновлено 2 мин назад» |
| Feed stale | «Нет связи, 14:20» |
| Feed empty | «Пока пусто. Новые объявления появятся после следующего обновления.» |
| Feed end | «Вы дошли до конца. Мы храним объявления 30 дней.» |
| Cluster count | «ещё 2 источника» / «Опубликовано в 3 источниках» |
| Source public | «Открыть сообщение» |
| Source invite | «Вступить в чат» |
| Source closed | «Источник закрыт» |
| Source deleted | «Сообщение удалено» |
| Demand badge | «Куплю» / «Ищу»; для вакансий «Ищу работу» |
| Search placeholder | «Искать в ленте» |
| Search hint | «Подгорица найдёт Podgorica» |
| Search empty | «Ничего не нашлось. Попробуйте другое слово или уберите фильтры.» |
| Search results | «12 результатов» |
| Filters | «Фильтры» |
| Filter primary | «Показать 128 объявлений» |
| Filter reset | «Сбросить» |
| Save search | «Сохранить этот поиск» |
| Save toast | «Поиск сохранён. Дайджест придёт в этот чат.» |
| Saved empty | «Пока нет сохранённых поисков. Сохраните поиск, и бот пришлёт подходящие объявления, даже если приложение закрыто.» |
| Digest | «Дайджест приходит каждые 30 минут. Ночью с 23:00 до 08:00 мы молчим.» |
| Access gate | «Закрытая бета. Доступ по приглашению.» |
| Access action | «Написать владельцу» |
| Error | «Не удалось загрузить ленту. Проверьте связь и попробуйте ещё раз.» |
| Retry | «Повторить» |

Rules: sentence case; no exclamation marks; no «пожалуйста»; no arrows in link
text; use the glossary terms. Russian pluralization is a helper, not a string
concatenation: 1 объявление, 2 объявления, 5 объявлений; 1 результат,
2 результата, 5 результатов.

## UI contract needs

The spec and data model decide the schema. The UI needs these fields to render
the direction without faking content:

- Card: stable id, section, category, title, price or salary, city, earliest
  publication time, photo URL and dimensions, photo count, demand flag,
  hashtags, source list.
- Source: name, username, access status (public/invite/closed), message URL,
  message status (available/deleted), publication time, first-in-cluster flag.
- Feed: cursor, total count for the active filters, `updated_at`, and a
  server-side filter contract for section, category, demand, source, and query.
- Search: normalized query support for Cyrillic/Latin and diacritics; result
  count; section-scoped or cross-section search.
- Saved search: id, name, query, filters, enabled flag, last digest time, and
  the digest settings that are global.
- Media: a thumbnail variant if the CDN offers one; otherwise the original URL
  plus its aspect ratio. No binary through Serverless.

## Defaults for the spec

These are reversible. Reply only if you disagree.

1. No bottom tab bar. Section tabs plus full-height sheets. The feed stays the
   only root screen.
2. Region filter hidden in v1 because only Montenegro exists. The data field
   stays; the filter returns with Serbian sources.
3. Card thumbnail on the right at 96px; the detail screen has the gallery. No
   masonry, no two-column feed.
4. Native MainButton on detail, opening the earliest actionable source. Hidden
   when no source is actionable.
5. Search across all sections by default, with a section selector in the search
   sheet. Results show the section label.
6. Digest frequency fixed at 30 minutes in v1; quiet hours global, 23:00–08:00
   Europe/Podgorica; per-search enable switch.
7. Source filter in the filter sheet if it is cheap; otherwise cut it without
   changing the rest of the sheet.
8. Price range filter out of v1; it needs honest price normalization first.
9. Cache the last 50 cards locally and show a stale banner when offline. The
   feed is useful on a weak connection.
10. One-time onboarding sheet over the feed, not a carousel or a separate
    screen.

## Out of scope

Admin and takedown UI, billing, Serbia, price-range filter, map view, image
lightbox, sharing a card, push-permission prompts, English or Serbian UI,
desktop multi-column layout, and any real-time websocket. The feed refreshes on
open, on visibility change, every five minutes, and by tap.

## Handoff

This document is the design input to `/to-spec`. The spec is published as issue
#1; it carries the screen map, component states, theme strategy, and UI contract
needs. The tickets should include a final design pass on real components, not
just this document. The final pass re-runs the design cascade on the implemented
UI and `ui-test` in a browser.

Skills loaded for this direction and what each contributed:

- `modern-web-guidance`: `dialog` and `light-dismiss` for the sheets,
  `prevent-page-scroll-under-modal-dialog`, `dark-mode` and `dark-mode-toggle`
  for the theme layer, `color` for contrast, `responsive-design` for container
  and viewport behavior, `defer-rendering-heavy-content` for the long feed,
  `optimize-image-priority`, and `accessibility` for landmarks, focus, target
  sizes, and live regions.
- `ui-ux-pro-max`: the classifieds product pattern, filter/search guidelines,
  and a candidate palette and typography set. The palette and Atkinson
  Hyperlegible were rejected; the filter and mobile-navigation guidance was
  kept.
- `anti-slop-design`: the banned matrix, the 1-to-3 rule, the 8-state
  interaction system, spacing and radius math, and the 7-axis quality gate.
  The palette and card treatment follow its "no generic blue, no card kit, no
  emoji, no fake stats" rules.
- `frontend-design`: the "stream, edited" thesis, the rejection of the
  cream/serif/terracotta cluster, the single-family type choice, and the rule
  that one device (the cluster stack) carries the identity.
- `tma-react-tailwind-shadcn`: Telegram viewport, theme params, safe areas,
  haptics, and the native MainButton/BackButton behavior. The front-end stack
  itself remains a spec decision.
