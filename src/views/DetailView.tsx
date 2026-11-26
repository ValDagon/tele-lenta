import { Fragment } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

import type { ApiClient } from "../api/client";
import { ApiError } from "../api/errors";
import type { CardDetail, CardPhoto, DetailSourceRow } from "../api/types";
import { Icon } from "../components/Icon";
import { config } from "../config";
import {
  detailMetaLabel,
  detailPhotoUrl,
  detailPriceText,
  earliestActionableSource,
  galleryIndex,
  galleryLabel,
  galleryPhotos,
  hashtagQuery,
  publishedInLabel,
  sourceAction,
  sourceMetaLabel,
  splitParagraphs,
  tokenizeText,
  type TextToken,
} from "../detail/detail-model";
import { useNow } from "../lib/use-now";
import { bindMainButton } from "../telegram/main-button";
import type { TelegramWebApp } from "../telegram/types";

interface DetailViewProps {
  client: ApiClient;
  cardId: number | null;
  webapp?: TelegramWebApp;
  onBack: () => void;
  /** A 404 (absent or hidden cluster) sends the reader back to the feed. */
  onNotFound: () => void;
  /** A hashtag tap opens search with that tag. */
  onSearchTag: (query: string) => void;
}

type DetailState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "missing" }
  | { kind: "ready"; detail: CardDetail };

/**
 * One Карточка, opened from the feed. The screen owns one scroll container;
 * the feed keeps its offset because its view remounts with the remembered
 * value. Everything renders exactly the body the API returned: a probe that
 * deleted a source only changes the source rows.
 */
export function DetailView({
  client,
  cardId,
  webapp,
  onBack,
  onNotFound,
  onSearchTag,
}: DetailViewProps) {
  const [state, setState] = useState<DetailState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const now = useNow();

  useEffect(() => {
    if (cardId === null) {
      setState({ kind: "missing" });
      onNotFound();
      return;
    }

    let active = true;
    setState({ kind: "loading" });

    client
      .card(cardId)
      .then((detail) => {
        if (active) setState({ kind: "ready", detail });
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof ApiError && error.code === "not_found") {
          setState({ kind: "missing" });
          onNotFound();
          return;
        }
        setState({ kind: "error" });
      });

    return () => {
      active = false;
    };
  }, [client, cardId, attempt, onNotFound]);

  const target =
    state.kind === "ready"
      ? (earliestActionableSource(state.detail.sources)?.message_url ?? null)
      : null;

  // The MainButton lives outside the view tree, so it is bound from the
  // fetched body and detached on unmount. A source that is deleted by the
  // probe therefore removes the button in the same render.
  useEffect(() => {
    if (target === null) return bindMainButton(webapp, null);

    return bindMainButton(webapp, {
      text: config.detail.mainButton,
      onClick: () => {
        try {
          webapp?.openLink?.(target);
        } catch {
          /* the client rejected the call; the link stays in the source rows */
        }
      },
    });
  }, [webapp, target]);

  const openLink = (event: Event, url: string) => {
    if (!webapp?.openLink) return;
    event.preventDefault();
    webapp.openLink(url);
  };

  return (
    <div class="flex h-dvh flex-col bg-canvas">
      <header class="flex min-h-14 shrink-0 items-center gap-1 border-b border-line px-2 pt-[var(--safe-top)]">
        <button
          type="button"
          onClick={onBack}
          aria-label="Назад"
          class="flex size-11 items-center justify-center rounded-full text-ink-secondary transition-colors duration-[120ms] hover:bg-surface-pressed active:scale-[0.97]"
        >
          <Icon name="chevron-left" size={22} />
        </button>
      </header>

      <main class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div class="px-4 pt-1 pb-[calc(6rem+var(--safe-bottom))]">
          {state.kind === "loading" ? <DetailSkeleton /> : null}

          {state.kind === "error" ? (
            <div class="pt-2">
              <p class="max-w-[34ch] text-body text-ink-secondary">
                {config.detail.loadError}
              </p>
              <button
                type="button"
                onClick={() => setAttempt((value) => value + 1)}
                class="mt-4 inline-flex min-h-11 items-center rounded-button border border-line-strong px-4 text-button text-ink transition-colors duration-[120ms] hover:bg-surface-pressed active:scale-[0.97]"
              >
                {config.detail.retry}
              </button>
            </div>
          ) : null}

          {state.kind === "ready" ? (
            <DetailContent
              detail={state.detail}
              now={now}
              onOpenLink={openLink}
              onSearchTag={(tag) => {
                const query = hashtagQuery(tag);
                if (query !== null) onSearchTag(query);
              }}
            />
          ) : null}
        </div>
      </main>
    </div>
  );
}

interface DetailContentProps {
  detail: CardDetail;
  now: Date;
  onOpenLink: (event: Event, url: string) => void;
  onSearchTag: (tag: string) => void;
}

function DetailContent({
  detail,
  now,
  onOpenLink,
  onSearchTag,
}: DetailContentProps) {
  const photos = galleryPhotos(detail.photos);
  const meta = detailMetaLabel(detail);
  const price = detailPriceText(detail, now);
  const title = detail.title.trim();
  const city = detail.city?.trim() ?? "";
  const actionable = earliestActionableSource(detail.sources);
  const paragraphs = splitParagraphs(detail.body);

  return (
    <article>
      {photos.length > 0 ? (
        <Gallery key={detail.id} photos={photos} />
      ) : null}

      <div class="mt-4">
        <p class="text-sm text-ink-secondary">{meta}</p>

        {title !== "" ? (
          <h1 class="mt-1 text-h1 tracking-[-0.02em] text-ink">{title}</h1>
        ) : null}

        {price !== null ? (
          <p class="mt-2 text-[1.5rem] leading-[1.1] font-bold text-ink tabular-nums">
            {price}
          </p>
        ) : null}

        {city !== "" ? (
          <p class="mt-1 text-sm text-ink-secondary">{city}</p>
        ) : null}
      </div>

      {paragraphs.length > 0 ? (
        <BodyText
          paragraphs={paragraphs}
          onOpenLink={onOpenLink}
          onSearchTag={onSearchTag}
        />
      ) : null}

      {detail.sources.length > 0 ? (
        <section class="mt-8" aria-labelledby="detail-sources-heading">
          <h2
            id="detail-sources-heading"
            class="text-h2 tracking-[-0.01em] text-ink"
          >
            {publishedInLabel(detail.sources.length)}
          </h2>

          {actionable === null ? (
            <p class="mt-2 max-w-[34ch] text-sm text-ink-secondary">
              {config.detail.noActionable}
            </p>
          ) : null}

          <ul class="mt-3 overflow-hidden rounded-card border border-line bg-surface px-4">
            {detail.sources.map((source) => (
              <SourceRow
                key={source.listing_id}
                source={source}
                now={now}
                onOpenLink={onOpenLink}
              />
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  );
}

interface GalleryProps {
  photos: CardPhoto[];
}

function Gallery({ photos }: GalleryProps) {
  const [index, setIndex] = useState(0);
  const stripRef = useRef<HTMLDivElement>(null);

  const handleScroll = () => {
    const strip = stripRef.current;
    if (!strip) return;
    const next = galleryIndex(
      strip.scrollLeft,
      strip.clientWidth,
      photos.length,
    );
    setIndex((current) => (current === next ? current : next));
  };

  return (
    <div class="relative overflow-hidden rounded-card bg-surface-sunken">
      <div
        ref={stripRef}
        role="group"
        aria-label={config.detail.galleryLabel}
        tabIndex={0}
        onScroll={handleScroll}
        class="flex aspect-[16/10] snap-x snap-mandatory overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {photos.map((photo, position) => (
          <GallerySlide
            key={`${photo.url}-${position}`}
            photo={photo}
            index={position}
            total={photos.length}
          />
        ))}
      </div>

      <span
        aria-hidden="true"
        class="pointer-events-none absolute top-2 right-2 rounded-badge border border-line bg-surface px-1.5 py-0.5 text-xs text-ink-secondary tabular-nums"
      >
        {galleryLabel(index, photos.length)}
      </span>
    </div>
  );
}

interface GallerySlideProps {
  photo: CardPhoto;
  index: number;
  total: number;
}

function GallerySlide({ photo, index, total }: GallerySlideProps) {
  const [failed, setFailed] = useState(false);
  const url = detailPhotoUrl(photo.url);

  return (
    <div class="h-full w-full shrink-0 snap-center">
      {url !== null && !failed ? (
        <img
          src={url}
          alt={`${config.detail.photoAlt} ${index + 1} ${config.detail.photoAltOf} ${total}`}
          width={photo.width ?? undefined}
          height={photo.height ?? undefined}
          loading={index === 0 ? "eager" : "lazy"}
          decoding="async"
          {...(index === 0 ? { fetchpriority: "high" } : {})}
          onError={() => setFailed(true)}
          class="h-full w-full object-cover"
        />
      ) : (
        <div class="flex h-full w-full items-center justify-center bg-surface-sunken text-ink-muted">
          <Icon name="image" size={24} />
        </div>
      )}
    </div>
  );
}

interface BodyTextProps {
  paragraphs: string[];
  onOpenLink: (event: Event, url: string) => void;
  onSearchTag: (tag: string) => void;
}

/**
 * The full post as React/Preact nodes. `dangerouslySetInnerHTML` is never used:
 * the text is data, and every link is built from a token.
 */
function BodyText({ paragraphs, onOpenLink, onSearchTag }: BodyTextProps) {
  return (
    <div class="mt-5 max-w-[65ch] text-[1rem] leading-[1.55] text-ink">
      {paragraphs.map((paragraph, paragraphIndex) => (
        <p
          key={paragraphIndex}
          class="mt-4 first:mt-0 break-words whitespace-pre-wrap"
        >
          {paragraph.split("\n").map((line, lineIndex) => (
            <Fragment key={lineIndex}>
              {lineIndex > 0 ? <br /> : null}
              {tokenizeText(line).map((token, tokenIndex) => (
                <Token
                  key={tokenIndex}
                  token={token}
                  onOpenLink={onOpenLink}
                  onSearchTag={onSearchTag}
                />
              ))}
            </Fragment>
          ))}
        </p>
      ))}
    </div>
  );
}

interface TokenProps {
  token: TextToken;
  onOpenLink: (event: Event, url: string) => void;
  onSearchTag: (tag: string) => void;
}

function Token({ token, onOpenLink, onSearchTag }: TokenProps) {
  if (token.kind === "text") return <>{token.text}</>;

  if (token.kind === "hashtag") {
    return (
      <button
        type="button"
        onClick={() => onSearchTag(token.tag)}
        class="inline rounded-[3px] text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        {token.text}
      </button>
    );
  }

  return (
    <a
      href={token.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(event) => onOpenLink(event, token.url)}
      class="break-words text-accent underline underline-offset-2 hover:text-accent-hover"
    >
      {token.text}
    </a>
  );
}

interface SourceRowProps {
  source: DetailSourceRow;
  now: Date;
  onOpenLink: (event: Event, url: string) => void;
}

function SourceRow({ source, now, onOpenLink }: SourceRowProps) {
  const action = sourceAction(source);
  const meta = sourceMetaLabel(source, now);

  return (
    <li class="flex min-h-14 items-center gap-3 border-t border-line py-2 first:border-t-0">
      <span
        aria-hidden="true"
        class={`flex size-8 shrink-0 items-center justify-center rounded-full border text-xs font-medium uppercase ${
          source.is_first
            ? "border-accent bg-accent text-on-accent"
            : "border-line-strong bg-surface text-ink-secondary"
        }`}
      >
        {source.monogram.slice(0, 2)}
      </span>

      <div class="min-w-0 flex-1">
        <p class="truncate text-sm text-ink">{source.name}</p>
        {meta !== "" ? (
          <p class="text-xs text-ink-muted tabular-nums">{meta}</p>
        ) : null}
      </div>

      {action.actionable ? (
        <a
          href={source.message_url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${action.label}: ${source.name}`}
          onClick={(event) => onOpenLink(event, source.message_url)}
          class="flex min-h-11 shrink-0 items-center rounded-button px-2 text-sm text-accent transition-colors duration-[120ms] hover:bg-surface-pressed hover:text-accent-hover"
        >
          {action.label}
        </a>
      ) : (
        <span class="shrink-0 text-xs text-ink-muted">{action.label}</span>
      )}
    </li>
  );
}

/** The final detail geometry at loading time, so nothing jumps when data lands. */
function DetailSkeleton() {
  return (
    <div aria-busy="true">
      <p class="sr-only" role="status">
        {config.detail.loading}
      </p>
      <span class="block aspect-[16/10] w-full rounded-card bg-surface-sunken motion-safe:animate-pulse" />
      <div class="mt-4 space-y-2">
        <span class="block h-3 w-20 rounded bg-surface-sunken motion-safe:animate-pulse" />
        <span class="block h-5 w-3/4 rounded bg-surface-sunken motion-safe:animate-pulse" />
        <span class="block h-5 w-1/2 rounded bg-surface-sunken motion-safe:animate-pulse" />
        <span class="block h-6 w-24 rounded bg-surface-sunken motion-safe:animate-pulse" />
      </div>
      <div class="mt-6 space-y-2">
        <span class="block h-4 w-full rounded bg-surface-sunken motion-safe:animate-pulse" />
        <span class="block h-4 w-full rounded bg-surface-sunken motion-safe:animate-pulse" />
        <span class="block h-4 w-2/3 rounded bg-surface-sunken motion-safe:animate-pulse" />
      </div>
      <div class="mt-8 space-y-2">
        <span class="block h-4 w-48 rounded bg-surface-sunken motion-safe:animate-pulse" />
        <span class="block h-14 w-full rounded-card bg-surface-sunken motion-safe:animate-pulse" />
      </div>
    </div>
  );
}
