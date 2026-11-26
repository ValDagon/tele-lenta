import { useEffect, useRef, useState } from "preact/hooks";

import type { ApiClient } from "../api/client";
import type { Section, SourceListItem } from "../api/types";
import { config } from "../config";
import {
  createDraft,
  draftFilters,
  resetDraft,
  setDraftSection,
  toggleCategory,
  toggleDemand,
  toggleSource,
  type FilterDraft,
} from "../filters/draft";
import { useFilterCount } from "../filters/use-filter-count";
import {
  applyLabel,
  categoryOptions,
  countAnnouncement,
  demandOptions,
  type FeedFilters,
} from "../filters/model";
import { BottomSheet } from "./BottomSheet";
import { Icon } from "./Icon";

const SECTIONS: ReadonlyArray<Section> = ["classifieds", "jobs", "events"];

interface FilterSheetProps {
  open: boolean;
  onClose: () => void;
  /** The section the feed is showing when the sheet opens. */
  section: Section;
  /** The filters already applied to that section. */
  filters: FeedFilters;
  sources: SourceListItem[];
  sourcesState: "loading" | "ready" | "error";
  onRetrySources: () => void;
  onApply: (section: Section, filters: FeedFilters) => void;
  /** Opens the save sheet with this draft; it never applies the filters. */
  onSaveSearch?: (section: Section, filters: FeedFilters) => void;
  /** Selection haptic; optional so the sheet stays a pure UI component. */
  onSelectionChange?: () => void;
  client: ApiClient;
}

function toggleClass(pressed: boolean): string {
  return `min-h-11 shrink-0 rounded-chip border px-4 text-sm transition-colors duration-[120ms] ${
    pressed
      ? "border-accent bg-accent-soft text-ink"
      : "border-line text-ink-secondary hover:bg-surface-pressed"
  }`;
}

/**
 * The filter sheet edits a draft, never the applied filters. Dismissing it —
 * scrim, Escape, close button, back — throws the draft away, which is what
 * makes exploring a filter combination safe.
 */
export function FilterSheet({
  open,
  onClose,
  section,
  filters,
  sources,
  sourcesState,
  onRetrySources,
  onApply,
  onSaveSearch,
  onSelectionChange,
  client,
}: FilterSheetProps) {
  const [draft, setDraft] = useState<FilterDraft>(() =>
    createDraft(section, filters),
  );
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const wasOpen = useRef(open);

  // Reopening always starts from the applied filters, not from the last
  // abandoned draft.
  useEffect(() => {
    if (open && !wasOpen.current) {
      setDraft(createDraft(section, filters));
      setSourcesOpen(false);
    }
    wasOpen.current = open;
  }, [open, section, filters]);

  const count = useFilterCount({
    client,
    enabled: open,
    section: draft.section,
    filters: draftFilters(draft),
  });

  const change = (next: (current: FilterDraft) => FilterDraft) => {
    setDraft((current) => next(current));
    onSelectionChange?.();
  };

  const categories = categoryOptions(draft.section);
  const demand = demandOptions(draft.section);
  const sectionSources = sources.filter(
    (source) => source.section === draft.section,
  );
  const showSources =
    sourcesState !== "ready" || sectionSources.length > 0;

  const announcement = count.failed
    ? config.filters.countFailed
    : count.loading
      ? config.filters.counting
      : countAnnouncement(count.total, draft.section);

  const applyText =
    count.failed || count.total === null
      ? config.filters.apply
      : applyLabel(count.total, draft.section);

  return (
    <BottomSheet open={open} onClose={onClose} labelledBy="filters-title">
      <div class="flex items-center justify-between gap-2">
        <h2
          id="filters-title"
          class="text-h2 tracking-[-0.01em] text-ink"
        >
          {config.filters.title}
        </h2>
        <button
          type="button"
          aria-label={config.filters.close}
          onClick={onClose}
          class="-mr-2 flex size-11 shrink-0 items-center justify-center rounded-full text-ink-secondary transition-colors duration-[120ms] hover:bg-surface-pressed active:scale-[0.97]"
        >
          <Icon name="x" size={20} />
        </button>
      </div>

      <fieldset class="mt-4">
        <legend class="text-xs text-ink-muted">
          {config.filters.sectionGroup}
        </legend>
        <div class="mt-2 grid grid-cols-3 gap-2">
          {SECTIONS.map((option) => (
            <label
              key={option}
              class="flex min-h-11 cursor-pointer items-center justify-center rounded-button border border-line px-2 text-center text-sm text-ink-secondary transition-colors duration-[120ms] has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:checked]:text-ink has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent"
            >
              <input
                type="radio"
                name="filter-section"
                value={option}
                checked={draft.section === option}
                onChange={() =>
                  change((current) =>
                    setDraftSection(current, option, sources),
                  )
                }
                class="sr-only"
              />
              {config.feed.sections[option]}
            </label>
          ))}
        </div>
      </fieldset>

      {categories.length > 0 ? (
        <fieldset class="mt-5">
          <legend class="text-xs text-ink-muted">
            {config.filters.categoryGroup}
          </legend>
          <div class="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              aria-pressed={draft.filters.category === null}
              onClick={() =>
                change((current) =>
                  current.filters.category === null
                    ? current
                    : toggleCategory(current, current.filters.category),
                )
              }
              class={toggleClass(draft.filters.category === null)}
            >
              {config.filters.all}
            </button>
            {categories.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={draft.filters.category === option.value}
                onClick={() =>
                  change((current) => toggleCategory(current, option.value))
                }
                class={toggleClass(draft.filters.category === option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </fieldset>
      ) : null}

      {demand.length > 0 ? (
        <fieldset class="mt-5">
          <legend class="text-xs text-ink-muted">
            {config.filters.demandGroup}
          </legend>
          <div class="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              aria-pressed={draft.filters.demand === null}
              onClick={() =>
                change((current) =>
                  current.filters.demand === null
                    ? current
                    : toggleDemand(current, current.filters.demand),
                )
              }
              class={toggleClass(draft.filters.demand === null)}
            >
              {config.filters.all}
            </button>
            {demand.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={draft.filters.demand === option.value}
                onClick={() =>
                  change((current) => toggleDemand(current, option.value))
                }
                class={toggleClass(draft.filters.demand === option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </fieldset>
      ) : null}

      {showSources ? (
        <div class="mt-5 border-t border-line pt-1">
          <button
            type="button"
            aria-expanded={sourcesOpen}
            aria-controls="filter-sources"
            aria-label={`${config.filters.sourcesGroup}: ${
              sourcesOpen
                ? config.filters.collapseSources
                : config.filters.openSources
            }`}
            onClick={() => setSourcesOpen((value) => !value)}
            class="flex min-h-11 w-full items-center justify-between gap-2 text-left text-sm text-ink"
          >
            <span aria-hidden="true">{config.filters.sourcesGroup}</span>
            <Icon
              name="chevron-down"
              size={20}
              class={`text-ink-muted transition-transform duration-[120ms] ${
                sourcesOpen ? "rotate-180" : ""
              }`}
            />
          </button>

          <div id="filter-sources">
            {sourcesState === "loading" ? (
              <p class="pb-2 text-sm text-ink-muted">
                {config.filters.sourcesLoading}
              </p>
            ) : null}

            {sourcesState === "error" ? (
              <div class="pb-2">
                <p class="text-sm text-ink-secondary">
                  {config.filters.sourcesError}
                </p>
                <button
                  type="button"
                  onClick={onRetrySources}
                  class="mt-1 inline-flex min-h-11 items-center text-sm text-accent"
                >
                  {config.filters.sourcesRetry}
                </button>
              </div>
            ) : null}

            {sourcesOpen && sourcesState === "ready" ? (
              <div class="pb-1">
                {sectionSources.map((source) => (
                  <label
                    key={source.id}
                    class="flex min-h-11 cursor-pointer items-center gap-3"
                  >
                    <input
                      type="checkbox"
                      checked={draft.filters.sources.includes(source.id)}
                      onChange={() =>
                        change((current) => toggleSource(current, source.id))
                      }
                      class="size-5 shrink-0"
                    />
                    <span class="min-w-0 flex-1 truncate text-sm text-ink-secondary">
                      {source.name}
                    </span>
                  </label>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <p class="sr-only" role="status">
        {announcement}
      </p>

      {/* The panel is the scroller, so the primary action has to stick to its
          bottom: on a short phone the source list would otherwise push
          «Показать» under the fold. */}
      <div class="sticky bottom-0 -mx-4 mt-5 flex items-center justify-between gap-3 border-t border-line bg-surface px-4 pt-4 pb-1">
        <button
          type="button"
          onClick={() => change(resetDraft)}
          class="inline-flex min-h-11 shrink-0 items-center rounded-button px-2 text-button text-accent transition-colors duration-[120ms] hover:bg-surface-pressed"
        >
          {config.filters.reset}
        </button>
        <button
          type="button"
          onClick={() => {
            onSelectionChange?.();
            onApply(draft.section, draftFilters(draft));
          }}
          class="inline-flex min-h-11 min-w-0 flex-1 items-center justify-center rounded-button bg-accent px-4 text-button text-on-accent transition-colors duration-[120ms] hover:bg-accent-hover active:scale-[0.99]"
        >
          <span class="truncate">{applyText}</span>
        </button>
      </div>

      {onSaveSearch !== undefined ? (
        <button
          type="button"
          onClick={() => {
            onSelectionChange?.();
            onSaveSearch(draft.section, draftFilters(draft));
          }}
          class="mt-2 flex min-h-11 w-full items-center justify-center rounded-button px-3 text-button text-accent transition-colors duration-[120ms] hover:bg-surface-pressed active:scale-[0.99]"
        >
          {config.filters.saveSearch}
        </button>
      ) : null}
    </BottomSheet>
  );
}
