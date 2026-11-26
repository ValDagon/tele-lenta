import { useEffect, useLayoutEffect, useRef } from "preact/hooks";

import type {
  Card as CardData,
  Section,
  SourceListItem,
} from "../api/types";
import { Card, CardSkeleton } from "../components/Card";
import { FilterChips } from "../components/FilterChips";
import { Icon } from "../components/Icon";
import { SectionTabs } from "../components/SectionTabs";
import { config } from "../config";
import { buildFeedRows } from "../feed/card-model";
import type { SectionState } from "../feed/state";
import {
  activeFilterCount,
  isFiltered,
  type FeedFilters,
  type FilterChipKey,
} from "../filters/model";
import { freshnessLabel, staleLabel } from "../lib/time";
import { useNow } from "../lib/use-now";

interface FeedViewProps {
  section: Section;
  state: SectionState;
  initialScroll: number;
  filters: FeedFilters;
  sources: readonly SourceListItem[];
  onSectionChange: (section: Section) => void;
  onSearch: () => void;
  onSaved: () => void;
  onMore: () => void;
  onScroll: (y: number) => void;
  onRefresh: () => void;
  onLoadMore: () => void;
  onOpenCard: (card: CardData) => void;
  onOpenFilters: () => void;
  onRemoveFilter: (key: FilterChipKey) => void;
  onClearFilters: () => void;
  notice?: string | null;
  onDismissNotice?: () => void;
}

const SKELETONS = [0, 1, 2, 3];

/**
 * The feed root: header, freshness line, section tabs, and the card list. The
 * scroll container is the one the section-switch seam restores.
 */
export function FeedView({
  section,
  state,
  initialScroll,
  filters,
  sources,
  onSectionChange,
  onSearch,
  onSaved,
  onMore,
  onScroll,
  onRefresh,
  onLoadMore,
  onOpenCard,
  onOpenFilters,
  onRemoveFilter,
  onClearFilters,
  notice = null,
  onDismissNotice,
}: FeedViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const now = useNow();

  // Restore the saved offset when the section changes. `initialScroll` is read
  // from this render's closure on purpose: the parent re-renders on every
  // scroll event, and reacting to that would fight the user's scrolling.
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = initialScroll;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section]);

  // Infinite scroll. Re-observing after each page is what keeps filling the
  // viewport when the sentinel is still visible; the controller drops an
  // overlapping call, so a fast observer cannot double-fetch.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    const root = scrollRef.current;
    if (!sentinel || !root || !state.hasMore) return;
    if (typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onLoadMore();
      },
      { root, rootMargin: "600px 0px" },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [state.hasMore, state.loadingMore, state.cards.length, onLoadMore]);

  const hasCards = state.cards.length > 0;
  const showSkeleton = state.loading && !hasCards;
  const showError = state.error && !hasCards;
  const filtered = isFiltered(filters);
  const showEmpty =
    state.initialized && !state.loading && !state.error && !hasCards && !filtered;
  const showFilteredEmpty =
    state.initialized && !state.loading && !state.error && !hasCards && filtered;

  const staleAt = state.updatedAt ?? state.staleAt;
  const freshness = state.stale
    ? staleAt === null
      ? config.feed.status.stale
      : staleLabel(staleAt)
    : state.updatedAt !== null
      ? freshnessLabel(state.updatedAt)
      : state.loading
        ? config.feed.status.loading
        : config.feed.status.refresh;

  const rows = buildFeedRows(state.cards, now);
  const refreshLabel =
    freshness === config.feed.status.refresh
      ? freshness
      : `${freshness}. ${config.feed.status.refresh}`;

  return (
    <div class="flex h-dvh flex-col bg-canvas">
      <header class="flex min-h-14 shrink-0 items-center justify-between border-b border-line px-4 pt-[calc(0.25rem+var(--safe-top))] pb-1">
        <p class="text-h2 tracking-[-0.01em] text-ink">{config.productName}</p>
        <div class="-mr-2 flex items-center">
          <button
            type="button"
            aria-label={config.actions.search}
            onClick={onSearch}
            class="flex size-11 items-center justify-center rounded-full text-ink-secondary transition-colors duration-[120ms] hover:bg-surface-pressed active:scale-[0.97]"
          >
            <Icon name="search" size={22} />
          </button>
          <button
            type="button"
            aria-label={config.actions.saved}
            onClick={onSaved}
            class="flex size-11 items-center justify-center rounded-full text-ink-secondary transition-colors duration-[120ms] hover:bg-surface-pressed active:scale-[0.97]"
          >
            <Icon name="bookmark" size={22} />
          </button>
          <button
            type="button"
            aria-label={config.actions.more}
            onClick={onMore}
            class="flex size-11 items-center justify-center rounded-full text-ink-secondary transition-colors duration-[120ms] hover:bg-surface-pressed active:scale-[0.97]"
          >
            <Icon name="more" size={22} />
          </button>
        </div>
      </header>

      <div class="shrink-0 px-4">
        <button
          type="button"
          onClick={onRefresh}
          aria-label={refreshLabel}
          class={`flex min-h-11 max-w-full items-center truncate text-left text-xs ${
            state.stale ? "text-signal" : "text-ink-muted"
          }`}
        >
          {freshness}
        </button>
      </div>

      <SectionTabs
        value={section}
        onChange={onSectionChange}
        filterCount={activeFilterCount(filters)}
        onFilters={onOpenFilters}
      />

      <FilterChips
        section={section}
        filters={filters}
        sources={sources}
        onRemove={onRemoveFilter}
        onClear={onClearFilters}
      />

      {notice !== null ? (
        <div class="shrink-0 px-4 pt-3">
          <div
            role="status"
            class="flex items-start gap-2 rounded-card border border-line bg-surface py-1 pr-1 pl-3"
          >
            <p class="min-w-0 flex-1 self-center text-sm text-ink-secondary">
              {notice}
            </p>
            {onDismissNotice ? (
              <button
                type="button"
                onClick={onDismissNotice}
                aria-label={config.actions.close}
                class="flex size-11 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors duration-[120ms] hover:bg-surface-pressed active:scale-[0.97]"
              >
                <Icon name="x" size={18} />
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <main class="min-h-0 flex-1">
        <div
          ref={scrollRef}
          id="feed-panel"
          role="tabpanel"
          aria-labelledby={`section-tab-${section}`}
          tabIndex={-1}
          onScroll={(event) => onScroll(event.currentTarget.scrollTop)}
          class="h-full overflow-y-auto overscroll-contain"
        >
          <h1 class="sr-only">{config.feed.sections[section]}</h1>

          <p class="sr-only" role="status">
            {state.stale ? freshness : ""}
          </p>

          <div class="px-4 pt-3 pb-10">
            {showSkeleton ? (
              <div aria-busy="true" class="space-y-3">
                <p class="sr-only" role="status">
                  {config.feed.loading}
                </p>
                {SKELETONS.map((index) => (
                  <CardSkeleton key={index} />
                ))}
              </div>
            ) : null}

            {showError ? (
              <div class="pt-2">
                <p class="max-w-[34ch] text-body text-ink-secondary">
                  {config.feed.loadError}
                </p>
                <button
                  type="button"
                  onClick={onRefresh}
                  class="mt-4 inline-flex min-h-11 items-center rounded-button border border-line-strong px-4 text-button text-ink transition-colors duration-[120ms] hover:bg-surface-pressed active:scale-[0.97]"
                >
                  {config.feed.retry}
                </button>
              </div>
            ) : null}

            {showEmpty ? (
              <p class="max-w-[34ch] pt-2 text-body text-ink-secondary">
                {config.feed.empty}
              </p>
            ) : null}

            {showFilteredEmpty ? (
              <div class="pt-2">
                <p class="max-w-[34ch] text-body text-ink-secondary">
                  {config.filters.empty}
                </p>
                <button
                  type="button"
                  onClick={onClearFilters}
                  class="mt-4 inline-flex min-h-11 items-center rounded-button border border-line-strong px-4 text-button text-ink transition-colors duration-[120ms] hover:bg-surface-pressed active:scale-[0.97]"
                >
                  {config.filters.emptyReset}
                </button>
              </div>
            ) : null}

            {hasCards ? (
              <div>
                {rows.map((row) =>
                  row.kind === "divider" ? (
                    <p
                      key={`day-${row.key}`}
                      class="pt-2 pb-1 text-xs text-ink-muted first:pt-0"
                    >
                      {row.label}
                    </p>
                  ) : (
                    <div key={row.card.id} class="mt-3 first:mt-0">
                      <Card card={row.card} now={now} onOpen={onOpenCard} />
                    </div>
                  ),
                )}
              </div>
            ) : null}

            {state.hasMore ? (
              <div
                ref={sentinelRef}
                class="flex min-h-11 items-center justify-center"
                aria-hidden="true"
              >
                {state.loadingMore ? (
                  <span class="text-xs text-ink-muted">
                    {config.feed.loadingMore}
                  </span>
                ) : null}
              </div>
            ) : null}

            {state.moreError ? (
              <button
                type="button"
                onClick={onLoadMore}
                class="mx-auto mt-3 flex min-h-11 items-center rounded-button px-4 text-button text-accent transition-colors duration-[120ms] hover:bg-surface-pressed"
              >
                {config.feed.retry}
              </button>
            ) : null}

            {state.initialized &&
            hasCards &&
            !state.hasMore &&
            !state.loadingMore ? (
              <p class="mt-6 text-center text-xs text-ink-muted">
                {config.feed.end}
              </p>
            ) : null}
          </div>
        </div>
      </main>
    </div>
  );
}
