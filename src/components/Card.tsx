import { useState } from "preact/hooks";

import type { Card as CardData, CardSourceSummary } from "../api/types";
import {
  cardAccessibleName,
  cardMetaLabel,
  cardPhotoUrl,
  cardPriceText,
  cardRelativeTime,
  demandBadge,
  isMultiSource,
  sourceOverflowLabel,
} from "../feed/card-model";

interface CardProps {
  card: CardData;
  now: Date;
  onOpen: (card: CardData) => void;
  /** Search results cross sections, so the card names its own section. */
  showSection?: boolean;
}

/**
 * One Карточка for one Кластер. The whole card is the only tap target: an
 * overlay link carries the full accessible name and there is no second
 * «Открыть» control.
 */
export function Card({ card, now, onOpen, showSection = false }: CardProps) {
  const [photoFailed, setPhotoFailed] = useState(false);

  const photo = cardPhotoUrl(card);
  const thumbUrl = photo !== null && !photoFailed ? photo : null;
  const meta = cardMetaLabel(card, showSection);
  const badge = demandBadge(card);
  const price = cardPriceText(card, now);
  const time = cardRelativeTime(card, now);
  const title = card.title.trim();
  const city = card.city?.trim() ?? "";

  const open = (event: Event) => {
    // The card is a view change, never a browser navigation.
    event.preventDefault();
    onOpen(card);
  };

  return (
    <div class={isMultiSource(card) ? "relative pb-1.5" : ""}>
      {isMultiSource(card) ? (
        <>
          <span
            aria-hidden="true"
            class="absolute inset-x-3 bottom-0 h-8 rounded-b-card border border-line bg-surface"
          />
          <span
            aria-hidden="true"
            class="absolute inset-x-3 bottom-[3px] h-8 rounded-b-card border border-line bg-surface"
          />
        </>
      ) : null}

      <article class="relative z-10 rounded-card border border-line bg-surface transition-colors duration-[120ms] active:bg-surface-pressed">
        <a
          href={`#card-${card.id}`}
          aria-label={cardAccessibleName(card, now, showSection)}
          onClick={open}
          class="absolute inset-0 z-20 rounded-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        />

        <div class="p-4">
          <div class="flex items-start justify-between gap-3">
            <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <span class="text-sm text-ink-secondary">{meta}</span>
              {badge !== null ? (
                <span class="rounded-badge bg-signal-soft px-1.5 py-0.5 text-xs text-signal">
                  {badge}
                </span>
              ) : null}
            </div>
            {time !== "" ? (
              <span class="shrink-0 text-xs text-ink-muted tabular-nums">
                {time}
              </span>
            ) : null}
          </div>

          <div class="mt-1.5 flex gap-3">
            <div class="min-w-0 flex-1">
              {title !== "" ? (
                <h2 class="line-clamp-2 text-h2 tracking-[-0.01em] text-ink">
                  {title}
                </h2>
              ) : null}

              {price !== null ? (
                <p class="mt-1.5 text-price tracking-[-0.01em] text-ink tabular-nums">
                  {price}
                </p>
              ) : null}

              {city !== "" ? (
                <p class="mt-1 text-sm text-ink-secondary">{city}</p>
              ) : null}
            </div>

            {thumbUrl !== null ? (
              <div class="relative size-24 shrink-0 overflow-hidden rounded-thumb bg-surface-sunken">
                <img
                  src={thumbUrl}
                  alt=""
                  width={96}
                  height={96}
                  loading="lazy"
                  decoding="async"
                  class="size-full object-cover"
                  onError={() => setPhotoFailed(true)}
                />
                {card.photo !== undefined && card.photo.count > 1 ? (
                  <span class="absolute right-1 bottom-1 rounded-badge border border-line bg-surface px-1 py-0.5 text-[0.6875rem] leading-none text-ink-secondary tabular-nums">
                    1/{card.photo.count}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>

          <SourceTrail card={card} />
        </div>
      </article>
    </div>
  );
}

interface SourceTrailProps {
  card: CardData;
}

/**
 * Source monograms at the card's foot: the earliest source is filled, the rest
 * are outlined. Decorative — the link name already says how many sources there
 * are.
 */
function SourceTrail({ card }: SourceTrailProps) {
  if (card.source_count <= 0 || card.sources.length === 0) return null;

  const shown = card.sources.slice(0, 3);
  const extra = Math.max(0, card.source_count - shown.length);

  if (card.source_count === 1 && shown[0] !== undefined) {
    const source = shown[0];
    return (
      <div aria-hidden="true" class="mt-3 flex items-center gap-2">
        <Monogram source={source} filled />
        <span class="truncate text-xs text-ink-secondary">{source.name}</span>
      </div>
    );
  }

  return (
    <div aria-hidden="true" class="mt-3 flex items-center gap-1.5">
      {shown.map((source, index) => (
        <Monogram key={source.id} source={source} filled={index === 0} />
      ))}
      {extra > 0 ? (
        <span class="ml-0.5 text-xs text-ink-muted">
          {sourceOverflowLabel(extra)}
        </span>
      ) : null}
    </div>
  );
}

interface MonogramProps {
  source: CardSourceSummary;
  filled: boolean;
}

function Monogram({ source, filled }: MonogramProps) {
  return (
    <span
      class={`flex size-5 shrink-0 items-center justify-center rounded-full border text-[0.6875rem] leading-none font-medium uppercase ${
        filled
          ? "border-accent bg-accent text-on-accent"
          : "border-line-strong bg-surface text-ink-secondary"
      }`}
    >
      {source.monogram.slice(0, 2)}
    </span>
  );
}

/** Same silhouette as a real card, so the feed does not shift when data lands. */
export function CardSkeleton() {
  return (
    <div
      aria-hidden="true"
      class="rounded-card border border-line bg-surface p-4"
    >
      <div class="flex items-start justify-between gap-3">
        <span class="h-3 w-24 rounded bg-surface-sunken motion-safe:animate-pulse" />
        <span class="h-3 w-10 rounded bg-surface-sunken motion-safe:animate-pulse" />
      </div>
      <div class="mt-3 flex gap-3">
        <div class="min-w-0 flex-1 space-y-2">
          <span class="block h-4 w-3/4 rounded bg-surface-sunken motion-safe:animate-pulse" />
          <span class="block h-5 w-20 rounded bg-surface-sunken motion-safe:animate-pulse" />
          <span class="block h-3 w-16 rounded bg-surface-sunken motion-safe:animate-pulse" />
        </div>
        <span class="size-24 shrink-0 rounded-thumb bg-surface-sunken motion-safe:animate-pulse" />
      </div>
      <span class="mt-3 block h-5 w-24 rounded-full bg-surface-sunken motion-safe:animate-pulse" />
    </div>
  );
}
