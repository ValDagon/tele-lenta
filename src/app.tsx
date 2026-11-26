import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "preact/hooks";

import { createApiClient } from "./api/client";
import { createTelegramTransport } from "./api/transport";
import type {
  Card as CardData,
  Section,
  SourceListItem,
} from "./api/types";
import { AboutSheet } from "./components/AboutSheet";
import { FilterSheet } from "./components/FilterSheet";
import { Gate } from "./components/Gate";
import { OnboardingSheet } from "./components/OnboardingSheet";
import { SaveSearchSheet } from "./components/SaveSearchSheet";
import { config } from "./config";
import { parseStartParam } from "./deep-link/model";
import { useFeed } from "./feed/use-feed";
import {
  emptyFilters,
  removeChip,
  type FeedFilters,
  type FilterChipKey,
} from "./filters/model";
import { draftFromFilters, draftIsEmpty } from "./saved/model";
import type { SavedSearchDraft } from "./saved/model";
import { openOwnerContact } from "./lib/contact";
import { hasSeenOnboarding, markOnboardingSeen } from "./lib/prefs";
import { gateStatusForError, type GateStatus } from "./state/gate";
import {
  canGoBack,
  createViewState,
  currentSheet,
  feedScrollKey,
  formFor,
  scrollFor,
  viewReducer,
} from "./state/view";
import { onBackButton, setBackButton } from "./telegram/back-button";
import type { TelegramWebApp } from "./telegram/types";
import { hasTelegramSession } from "./telegram/webapp";
import {
  applyTheme,
  readThemeMode,
  writeThemeMode,
  type ThemeMode,
} from "./theme/apply";
import { DetailView } from "./views/DetailView";
import { FeedView } from "./views/FeedView";
import { SavedView } from "./views/SavedView";
import { SearchView } from "./views/SearchView";
import { SettingsView } from "./views/SettingsView";

interface AppProps {
  webapp?: TelegramWebApp;
}

interface SourcesState {
  status: "idle" | "loading" | "ready" | "error";
  items: SourceListItem[];
}

export function App({ webapp }: AppProps) {
  const [view, dispatch] = useReducer(viewReducer, createViewState());
  const [gate, setGate] = useState<GateStatus>({ kind: "checking" });
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => readThemeMode());
  const [toast, setToast] = useState<string | null>(null);
  const [filters, setFilters] = useState<Record<Section, FeedFilters>>(() => ({
    classifieds: emptyFilters(),
    jobs: emptyFilters(),
    events: emptyFilters(),
  }));
  const [sourcesState, setSourcesState] = useState<SourcesState>({
    status: "idle",
    items: [],
  });
  const viewRef = useRef(view);
  viewRef.current = view;
  // A `start_param` is read once, on the first successful access check. A
  // retry after a network error must not reopen the card or pull the reader
  // back out of detail, and a card link never opens onboarding.
  const deepLinkHandled = useRef(false);

  const client = useMemo(
    () => createApiClient(createTelegramTransport(webapp)),
    [webapp],
  );

  const sheet = currentSheet(view);
  const savedDraftForm = formFor<
    SavedSearchDraft & Record<string, unknown>
  >(view, "save-search");
  const savedDraft: SavedSearchDraft = {
    query: savedDraftForm.query ?? "",
    section: savedDraftForm.section ?? null,
    categories: savedDraftForm.categories ?? [],
    demand: savedDraftForm.demand ?? null,
    sources: savedDraftForm.sources ?? [],
  };

  const feed = useFeed({
    client,
    enabled: gate.kind === "allowed",
    section: view.section,
    filters,
  });
  const { refresh: refreshSection, loadMore: loadMoreSection } = feed;

  const checkAccess = useCallback(async () => {
    if (!hasTelegramSession(webapp)) {
      setGate({ kind: "outside" });
      return;
    }

    setGate({ kind: "checking" });

    try {
      const session = await client.session();
      if (!session.allowed) {
        setGate({ kind: "invited" });
        return;
      }

      setGate({ kind: "allowed", session });

      // Access is checked before the link is acted on: a card from a digest
      // must not leak past the gate, and an unknown payload is just the feed.
      if (deepLinkHandled.current) return;
      deepLinkHandled.current = true;

      const cardId = parseStartParam(webapp?.initDataUnsafe?.start_param);
      if (cardId !== null) {
        // From the gate, so the detail screen is the first entry and Back
        // falls through to the feed. Onboarding stays unseen for the next
        // ordinary open instead of covering the linked card.
        dispatch({ type: "open-card", cardId });
        return;
      }

      dispatch({ type: "go", view: "feed" });

      if (!hasSeenOnboarding()) {
        dispatch({ type: "open-sheet", sheet: "onboarding" });
      }
    } catch (error) {
      setGate(gateStatusForError(error));
    }
  }, [client, webapp]);

  useEffect(() => {
    void checkAccess();
  }, [checkAccess]);

  useEffect(() => {
    if (toast === null) return;
    const timer = setTimeout(() => setToast(null), 4_000);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    applyTheme(themeMode, webapp);
  }, [themeMode, webapp]);

  useEffect(() => {
    if (!webapp) return;
    const handle = () => applyTheme(themeMode, webapp);
    webapp.onEvent("themeChanged", handle);
    return () => webapp.offEvent("themeChanged", handle);
  }, [themeMode, webapp]);

  useEffect(() => {
    if (themeMode !== "auto" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handle = () => applyTheme("auto", webapp);
    media.addEventListener("change", handle);
    return () => media.removeEventListener("change", handle);
  }, [themeMode, webapp]);

  // Sources are only needed by the filter sheet, so the request waits for the
  // first open. A failure never blocks the other filter groups.
  const loadSources = useCallback(() => {
    setSourcesState((previous) => ({
      status: "loading",
      items: previous.items,
    }));
    client
      .sources()
      .then((response) => {
        setSourcesState({ status: "ready", items: response.sources });
      })
      .catch(() => {
        setSourcesState({ status: "error", items: [] });
      });
  }, [client]);

  // The filter sheet, the save sheet, and the saved list all need source
  // names. One request serves all three; a failure never blocks saving.
  useEffect(() => {
    const needsSources =
      sheet === "filters" ||
      sheet === "save-search" ||
      view.current === "saved";
    if (needsSources && sourcesState.status === "idle") loadSources();
  }, [sheet, view.current, sourcesState.status, loadSources]);

  // The native BackButton must dismiss the onboarding the same way the scrim
  // and Escape do: closing it without once is a dismissal, not a postpone.
  const goBack = useCallback(() => {
    if (currentSheet(viewRef.current) === "onboarding") markOnboardingSeen();
    dispatch({ type: "back" });
  }, []);

  useEffect(() => onBackButton(webapp, goBack), [webapp, goBack]);

  useEffect(() => {
    setBackButton(webapp, canGoBack(view));
  }, [webapp, view]);

  const changeTheme = (mode: ThemeMode) => {
    writeThemeMode(mode);
    setThemeMode(mode);
  };

  const changeSection = (section: Section) => {
    webapp?.HapticFeedback?.selectionChanged();
    dispatch({ type: "set-section", section });
  };

  const refreshFeed = useCallback(
    () => refreshSection(view.section),
    [refreshSection, view.section],
  );

  const loadMoreFeed = useCallback(
    () => loadMoreSection(view.section),
    [loadMoreSection, view.section],
  );

  const openCard = useCallback(
    (card: CardData) => dispatch({ type: "open-card", cardId: card.id }),
    [],
  );

  // A card that 404s (absent, hidden, or emptied by the detail probe) must
  // never render as a dead screen: land on the feed with one short notice.
  const cardUnavailable = useCallback(() => {
    dispatch({ type: "show-notice", message: config.detail.notFoundNotice });
    dispatch({ type: "go", view: "feed" });
  }, []);

  // The detail hashtag handoff is the shared `search` form key plus the view
  // change, so the query survives the screen opening.
  const searchTag = useCallback((query: string) => {
    dispatch({ type: "set-form", key: "search", values: { q: query } });
    dispatch({ type: "go", view: "search" });
  }, []);

  // Opening search from the feed starts clean; a leftover hashtag would be
  // surprising. The prefill path above deliberately does not go through this.
  const openSearch = useCallback(() => {
    dispatch({ type: "set-form", key: "search", values: { q: "" } });
    dispatch({ type: "go", view: "search" });
  }, []);

  const commitSearchQuery = useCallback((query: string) => {
    dispatch({ type: "set-form", key: "search", values: { q: query } });
  }, []);

  const closeOnboarding = useCallback(() => {
    markOnboardingSeen();
    dispatch({ type: "close-sheet" });
  }, []);

  const openFilters = useCallback(() => {
    dispatch({ type: "open-sheet", sheet: "filters" });
  }, []);

  const closeFilters = useCallback(() => {
    dispatch({ type: "close-sheet" });
  }, []);

  // The save sheet replaces the filter sheet rather than stacking on top of it:
  // closing the filter draft first keeps Back from landing on a discarded form.
  const openSaveSearch = useCallback((draft: SavedSearchDraft) => {
    if (draftIsEmpty(draft)) return;
    if (currentSheet(viewRef.current) === "filters") {
      dispatch({ type: "close-sheet" });
    }
    dispatch({
      type: "set-form",
      key: "save-search",
      values: { ...draft },
    });
    dispatch({ type: "open-sheet", sheet: "save-search" });
  }, []);

  const removeFilter = useCallback((key: FilterChipKey) => {
    const section = viewRef.current.section;
    setFilters((previous) => ({
      ...previous,
      [section]: removeChip(section, previous[section], key),
    }));
  }, []);

  const clearFilters = useCallback(() => {
    const section = viewRef.current.section;
    setFilters((previous) => ({ ...previous, [section]: emptyFilters() }));
  }, []);

  // Applying may also change the section; the feed effect notices the new
  // filter key and reloads the first page for that section.
  const applyFilters = useCallback(
    (nextSection: Section, nextFilters: FeedFilters) => {
      setFilters((previous) => ({
        ...previous,
        [nextSection]: nextFilters,
      }));
      dispatch({ type: "close-sheet" });
      dispatch({ type: "set-section", section: nextSection });
    },
    [],
  );

  const selectionHaptic = useCallback(() => {
    webapp?.HapticFeedback?.selectionChanged();
  }, [webapp]);

  // The gate and Settings share one contact path, so the Telegram `openLink`
  // check lives in one place.
  const handleContact = useCallback(
    (event: MouseEvent) => openOwnerContact(webapp, event),
    [webapp],
  );

  const openAbout = useCallback(() => {
    dispatch({ type: "open-sheet", sheet: "about" });
  }, []);

  const closeAbout = useCallback(() => {
    dispatch({ type: "close-sheet" });
  }, []);

  if (gate.kind !== "allowed") {
    return (
      <Gate
        status={gate}
        onRetry={() => void checkAccess()}
        onContact={handleContact}
      />
    );
  }

  const screen = (() => {
    switch (view.current) {
      case "settings":
        return (
          <SettingsView
            mode={themeMode}
            onModeChange={changeTheme}
            onBack={() => dispatch({ type: "back" })}
            client={client}
            webapp={webapp}
            onAbout={openAbout}
          />
        );

      case "detail":
        return (
          <DetailView
            client={client}
            cardId={view.selectedCardId}
            webapp={webapp}
            onBack={() => dispatch({ type: "back" })}
            onNotFound={cardUnavailable}
            onSearchTag={searchTag}
          />
        );

      case "search":
        return (
          <SearchView
            client={client}
            initialQuery={formFor<{ q: string }>(view, "search").q ?? ""}
            webapp={webapp}
            onBack={() => dispatch({ type: "back" })}
            onOpenCard={openCard}
            onQueryCommit={commitSearchQuery}
            onSave={openSaveSearch}
            notice={view.notice}
            onDismissNotice={() => dispatch({ type: "dismiss-notice" })}
          />
        );

      case "saved":
        return (
          <SavedView
            client={client}
            sources={sourcesState.items}
            webapp={webapp}
            onBack={() => dispatch({ type: "back" })}
            onSearch={openSearch}
          />
        );

      default:
        return (
          <FeedView
            section={view.section}
            state={feed.state[view.section]}
            initialScroll={scrollFor(view, feedScrollKey(view.section))}
            filters={filters[view.section]}
            sources={sourcesState.items}
            onSectionChange={changeSection}
            onSearch={openSearch}
            onSaved={() => dispatch({ type: "go", view: "saved" })}
            onMore={() => dispatch({ type: "go", view: "settings" })}
            onScroll={(y) =>
              dispatch({
                type: "remember-scroll",
                key: feedScrollKey(view.section),
                y,
              })
            }
            onRefresh={refreshFeed}
            onLoadMore={loadMoreFeed}
            onOpenCard={openCard}
            onOpenFilters={openFilters}
            onRemoveFilter={removeFilter}
            onClearFilters={clearFilters}
            notice={view.notice}
            onDismissNotice={() => dispatch({ type: "dismiss-notice" })}
          />
        );
    }
  })();

  return (
    <>
      {screen}
      <OnboardingSheet
        open={sheet === "onboarding"}
        onClose={closeOnboarding}
      />
      <AboutSheet open={sheet === "about"} onClose={closeAbout} />
      <FilterSheet
        open={sheet === "filters"}
        onClose={closeFilters}
        section={view.section}
        filters={filters[view.section]}
        sources={sourcesState.items}
        sourcesState={
          sourcesState.status === "ready"
            ? "ready"
            : sourcesState.status === "error"
              ? "error"
              : "loading"
        }
        onRetrySources={loadSources}
        onApply={applyFilters}
        onSaveSearch={(section, nextFilters) =>
          openSaveSearch(draftFromFilters(section, nextFilters))
        }
        onSelectionChange={selectionHaptic}
        client={client}
      />
      <SaveSearchSheet
        open={sheet === "save-search" && !draftIsEmpty(savedDraft)}
        onClose={closeFilters}
        draft={savedDraft}
        sources={sourcesState.items}
        client={client}
        onSaved={() => {
          dispatch({ type: "close-sheet" });
          setToast(config.saveSearch.savedToast);
          webapp?.HapticFeedback?.notificationOccurred?.("success");
        }}
        onError={() => {
          webapp?.HapticFeedback?.notificationOccurred?.("error");
        }}
      />
      {toast !== null ? (
        <p
          role="status"
          class="fixed inset-x-4 bottom-[calc(1rem+var(--safe-bottom))] z-50 rounded-card bg-ink px-4 py-3 text-sm text-canvas shadow-none"
        >
          {toast}
        </p>
      ) : null}
    </>
  );
}
