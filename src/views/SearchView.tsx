import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

import type { ApiClient } from "../api/client";
import type { Card as CardData } from "../api/types";
import { Card } from "../components/Card";
import { Icon } from "../components/Icon";
import { config } from "../config";
import { useNow } from "../lib/use-now";
import { draftFromSearch, type SavedSearchDraft } from "../saved/model";
import {
  isSearchable,
  normalizeQuery,
  resultCountLabel,
  searchAnnouncement,
  searchPhase,
} from "../search/model";
import { clearRecents, readRecents } from "../search/recents";
import {
  parseSectionFilter,
  sectionFilterLabel,
  SECTION_FILTERS,
} from "../search/section-filter";
import { useSearch } from "../search/use-search";
import type { TelegramWebApp } from "../telegram/types";

interface SearchViewProps {
  client: ApiClient;
  /** The hashtag handoff or the last query, read from the view form. */
  initialQuery: string;
  webapp?: TelegramWebApp;
  onBack: () => void;
  onOpenCard: (card: CardData) => void;
  /** Keeps the query in the view form so back from detail restores it. */
  onQueryCommit?: (query: string) => void;
  /** Opens the save sheet with the current query and section. */
  onSave?: (draft: SavedSearchDraft) => void;
  /** A short confirmation under the header, e.g. after saving. */
  notice?: string | null;
  onDismissNotice?: () => void;
}

const SEARCH_INPUT_ID = "search-input";

/**
 * Search is a full-height screen, not a sheet: it has its own scroll, its own
 * request lifecycle, and the native BackButton. Results reuse the feed's
 * Карточка and its cursor/IntersectionObserver paging, so a search page and a
 * feed page behave the same way.
 */
export function SearchView({
  client,
  initialQuery,
  webapp,
  onBack,
  onOpenCard,
  onQueryCommit,
  onSave,
  notice = null,
  onDismissNotice,
}: SearchViewProps) {
  const search = useSearch({ client, initialQuery });
  const { state } = search;
  const now = useNow();

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [recents, setRecents] = useState<string[]>(() => readRecents());

  const phase = searchPhase(search.input, state);
  const announcement = searchAnnouncement(search.input, state);
  const hasCards = state.cards.length > 0;

  // The keyboard on open is the whole point of the screen. The attribute covers
  // first paint; the effect covers webviews that ignore autofocus.
  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  // A new query replaces the list, so it starts from the top. Paging does not
  // change the result key, which is what preserves the reader's position.
  const resultKey = `${state.activeQuery}\u0000${state.activeSection}`;
  const previousResultKey = useRef(resultKey);
  useLayoutEffect(() => {
    if (previousResultKey.current === resultKey) return;
    previousResultKey.current = resultKey;
    const element = scrollRef.current;
    if (element) element.scrollTop = 0;
  }, [resultKey]);

  useEffect(() => {
    if (state.activeQuery === "" || onQueryCommit === undefined) return;
    onQueryCommit(state.activeQuery);
  }, [state.activeQuery, onQueryCommit]);

  // A submitted or opened query is written to storage, not to this component's
  // copy. Re-read when the input empties so the chips include it right away.
  useEffect(() => {
    if (normalizeQuery(search.input) === "") setRecents(readRecents());
  }, [search.input]);

  // Same paging seam as the feed: the sentinel is re-observed after each page,
  // and the controller drops an overlapping «more» call.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    const root = scrollRef.current;
    if (!sentinel || !root || !state.hasMore) return;
    if (typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) search.loadMore();
      },
      { root, rootMargin: "600px 0px" },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [state.hasMore, state.loadingMore, state.cards.length, search.loadMore]);

  const focusInput = () => {
    inputRef.current?.focus({ preventScroll: true });
  };

  const clearInput = () => {
    search.clear();
    focusInput();
  };

  const resetAll = () => {
    search.reset();
    focusInput();
  };

  const chooseRecent = (query: string) => {
    search.applyRecent(query);
    focusInput();
  };

  const clearRecentList = () => {
    clearRecents();
    setRecents([]);
  };

  const changeSection = (value: string) => {
    const next = parseSectionFilter(value);
    if (next === search.section) return;
    webapp?.HapticFeedback?.selectionChanged();
    search.setSection(next);
  };

  const openCard = (card: CardData) => {
    search.rememberCurrent();
    onOpenCard(card);
  };

  return (
    <div class="flex h-dvh flex-col bg-canvas">
      <header class="shrink-0 border-b border-line px-4 pt-[calc(0.25rem+var(--safe-top))] pb-2">
        <div class="flex items-center gap-1">
          <button
            type="button"
            onClick={onBack}
            aria-label={config.actions.back}
            class="-ml-2 flex size-11 shrink-0 items-center justify-center rounded-full text-ink-secondary transition-colors duration-[120ms] hover:bg-surface-pressed active:scale-[0.97]"
          >
            <Icon name="chevron-left" size={22} />
          </button>

          <form
            role="search"
            class="min-w-0 flex-1"
            onSubmit={(event) => {
              event.preventDefault();
              search.submit();
            }}
          >
            <label for={SEARCH_INPUT_ID} class="sr-only">
              {config.search.label}
            </label>
            <div class="relative flex items-center">
              <Icon
                name="search"
                size={20}
                class="pointer-events-none absolute left-3 text-ink-muted"
              />
              {/* 16px is the iOS threshold below which focusing zooms the page. */}
              <input
                ref={inputRef}
                id={SEARCH_INPUT_ID}
                name="q"
                type="search"
                value={search.input}
                autoFocus
                autocomplete="off"
                autocorrect="off"
                autocapitalize="off"
                spellcheck={false}
                enterkeyhint="search"
                maxlength={100}
                placeholder={config.search.placeholder}
                onInput={(event) => search.setInput(event.currentTarget.value)}
                class="h-11 w-full min-w-0 rounded-button bg-surface-sunken pr-12 pl-10 text-[1rem] text-ink placeholder:text-ink-muted"
              />
              {search.input !== "" ? (
                <button
                  type="button"
                  onClick={clearInput}
                  aria-label={config.search.clearInput}
                  class="absolute right-0.5 flex size-11 items-center justify-center rounded-full text-ink-muted transition-colors duration-[120ms] hover:bg-surface-pressed active:scale-[0.97]"
                >
                  <Icon name="x" size={18} />
                </button>
              ) : null}
            </div>
          </form>

          {onSave !== undefined ? (
            <button
              type="button"
              aria-label={config.actions.saveSearch}
              disabled={!isSearchable(search.input)}
              onClick={() =>
                onSave(draftFromSearch(search.input, search.section))
              }
              class="flex size-11 shrink-0 items-center justify-center rounded-full text-ink-secondary transition-colors duration-[120ms] hover:bg-surface-pressed active:scale-[0.97] disabled:opacity-40"
            >
              <Icon name="bookmark" size={22} />
            </button>
          ) : null}
        </div>

        {/* The track keeps its 2px whether or not a request is running, so the
            header never shifts when the bar appears. */}
        <div
          class="relative mt-1 h-0.5 overflow-hidden"
          aria-hidden={state.loading ? undefined : "true"}
        >
          {state.loading ? (
            <span
              role="progressbar"
              aria-label={config.search.loading}
              class="search-progress absolute inset-y-0 left-0 w-1/3 rounded-full bg-accent"
            />
          ) : null}
        </div>

        <div class="mt-2 flex items-center justify-between gap-2">
          <div class="relative inline-flex items-center">
            <select
              aria-label={config.search.sectionLabel}
              value={search.section}
              onChange={(event) => changeSection(event.currentTarget.value)}
              class="h-11 appearance-none rounded-button border border-line bg-surface py-0 pr-9 pl-3 text-[1rem] font-semibold text-ink"
            >
              {SECTION_FILTERS.map((filter) => (
                <option key={filter} value={filter}>
                  {sectionFilterLabel(filter)}
                </option>
              ))}
            </select>
            <Icon
              name="chevron-down"
              size={18}
              class="pointer-events-none absolute right-2.5 text-ink-muted"
            />
          </div>

          {phase === "results" && search.section !== "all" ? (
            <button
              type="button"
              onClick={resetAll}
              class="flex min-h-11 items-center rounded-button px-3 text-button text-accent transition-colors duration-[120ms] hover:bg-surface-pressed"
            >
              {config.search.reset}
            </button>
          ) : null}
        </div>
      </header>

      {notice !== null ? (
        <div class="shrink-0 px-4 pt-3">
          <div
            role="status"
            class="flex items-start gap-2 rounded-card border border-line bg-surface py-1 pr-1 pl-3"
          >
            <p class="min-w-0 flex-1 self-center text-sm text-ink-secondary">
              {notice}
            </p>
            {onDismissNotice !== undefined ? (
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
        <p class="sr-only" role="status">
          {announcement}
        </p>

        <div ref={scrollRef} class="h-full overflow-y-auto overscroll-contain">
          <h1 class="sr-only">{config.search.title}</h1>

          <div class="px-4 pt-3 pb-10">
            {phase === "idle" ? (
              <div>
                {recents.length > 0 ? (
                  <section aria-labelledby="search-recents-heading">
                    <div class="flex items-center justify-between gap-2">
                      <h2
                        id="search-recents-heading"
                        class="text-sm text-ink-secondary"
                      >
                        {config.search.recents}
                      </h2>
                      <button
                        type="button"
                        onClick={clearRecentList}
                        class="flex min-h-11 items-center rounded-button px-2 text-sm text-accent transition-colors duration-[120ms] hover:bg-surface-pressed"
                      >
                        {config.search.clearRecents}
                      </button>
                    </div>

                    <ul class="mt-1 flex flex-wrap gap-2">
                      {recents.map((query) => (
                        <li key={query} class="max-w-full">
                          <button
                            type="button"
                            onClick={() => chooseRecent(query)}
                            class="flex min-h-11 max-w-full items-center truncate rounded-chip border border-line bg-surface px-3 text-button text-ink-secondary transition-colors duration-[120ms] hover:bg-surface-pressed active:scale-[0.97]"
                          >
                            {query}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                <p class="mt-6 max-w-[36ch] text-sm text-ink-muted">
                  {config.search.hint}
                </p>
              </div>
            ) : null}

            {phase === "tooShort" ? (
              <p class="max-w-[36ch] text-body text-ink-secondary">
                {config.search.tooShort}
              </p>
            ) : null}

            {phase === "error" ? (
              <div class="pt-2">
                <p class="max-w-[36ch] text-body text-ink-secondary">
                  {config.search.loadError}
                </p>
                <button
                  type="button"
                  onClick={search.retry}
                  class="mt-4 inline-flex min-h-11 items-center rounded-button border border-line-strong px-4 text-button text-ink transition-colors duration-[120ms] hover:bg-surface-pressed active:scale-[0.97]"
                >
                  {config.search.retry}
                </button>
              </div>
            ) : null}

            {phase === "empty" ? (
              <div class="pt-2">
                <p class="max-w-[36ch] text-body text-ink-secondary">
                  {config.search.empty}
                </p>
                <button
                  type="button"
                  onClick={resetAll}
                  class="mt-4 inline-flex min-h-11 items-center rounded-button border border-line-strong px-4 text-button text-ink transition-colors duration-[120ms] hover:bg-surface-pressed active:scale-[0.97]"
                >
                  {config.search.reset}
                </button>
              </div>
            ) : null}

            {hasCards ? (
              <div>
                <p class="text-sm text-ink-secondary tabular-nums">
                  {resultCountLabel(state.total)}
                </p>

                {state.error ? (
                  <div class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <p class="text-sm text-signal">{config.search.loadError}</p>
                    <button
                      type="button"
                      onClick={search.retry}
                      class="flex min-h-11 items-center rounded-button px-2 text-button text-accent transition-colors duration-[120ms] hover:bg-surface-pressed"
                    >
                      {config.search.retry}
                    </button>
                  </div>
                ) : null}

                <ul class="mt-3">
                  {state.cards.map((card) => (
                    <li key={card.id} class="mt-3 first:mt-0">
                      <Card
                        card={card}
                        now={now}
                        onOpen={openCard}
                        showSection
                      />
                    </li>
                  ))}
                </ul>

                {state.hasMore ? (
                  <div
                    ref={sentinelRef}
                    aria-hidden="true"
                    class="flex min-h-11 items-center justify-center"
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
                    onClick={search.loadMore}
                    class="mx-auto mt-3 flex min-h-11 items-center rounded-button px-4 text-button text-accent transition-colors duration-[120ms] hover:bg-surface-pressed"
                  >
                    {config.search.retry}
                  </button>
                ) : null}

                {!state.hasMore && !state.loadingMore ? (
                  <p class="mt-6 text-center text-xs text-ink-muted">
                    {config.search.end}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </main>
    </div>
  );
}
