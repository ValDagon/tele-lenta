import type { Section } from "../api/types";
import { config } from "../config";
import { Icon } from "./Icon";

const ORDER: ReadonlyArray<Section> = ["classifieds", "jobs", "events"];

interface SectionTabsProps {
  value: Section;
  onChange: (section: Section) => void;
  /** Number of active chips in the current section. */
  filterCount: number;
  onFilters: () => void;
}

/**
 * A real tablist: arrow keys move between tabs, Home/End jump to the edges,
 * and only the selected tab is in the tab order. The filter button sits
 * outside the tablist so it never becomes a tab stop inside the roving group.
 */
export function SectionTabs({
  value,
  onChange,
  filterCount,
  onFilters,
}: SectionTabsProps) {
  const tabs = new Map<Section, HTMLButtonElement | null>();

  const focusTab = (section: Section) => {
    requestAnimationFrame(() => tabs.get(section)?.focus());
  };

  const onKeyDown = (event: KeyboardEvent, index: number) => {
    let next: number | null = null;

    if (event.key === "ArrowRight") next = (index + 1) % ORDER.length;
    else if (event.key === "ArrowLeft")
      next = (index - 1 + ORDER.length) % ORDER.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = ORDER.length - 1;

    if (next === null) return;
    event.preventDefault();

    const section = ORDER[next];
    if (!section) return;
    onChange(section);
    focusTab(section);
  };

  const filterLabel =
    filterCount > 0
      ? `${config.filters.filterButton}, активно ${filterCount}`
      : config.filters.filterButton;

  return (
    <div class="shrink-0 border-b border-line bg-canvas px-2">
      <div class="flex items-center gap-1">
        <div
          role="tablist"
          aria-label="Секции"
          class="flex min-w-0 flex-1 gap-1 overflow-x-auto"
        >
          {ORDER.map((section, index) => {
            const selected = section === value;
            return (
              <button
                key={section}
                ref={(element) => {
                  tabs.set(section, element);
                }}
                id={`section-tab-${section}`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls="feed-panel"
                tabIndex={selected ? 0 : -1}
                onClick={() => onChange(section)}
                onKeyDown={(event) => onKeyDown(event, index)}
                class={`relative flex min-h-11 shrink-0 items-center px-2 text-[0.9375rem] font-medium tracking-[-0.01em] transition-colors duration-[120ms] ${
                  selected ? "text-ink" : "text-ink-muted hover:text-ink-secondary"
                }`}
              >
                {config.feed.sections[section]}
                <span
                  aria-hidden="true"
                  class={`absolute inset-x-2 bottom-0 h-0.5 origin-left rounded-full bg-accent transition-transform duration-[160ms] ${
                    selected ? "scale-x-100" : "scale-x-0"
                  }`}
                />
              </button>
            );
          })}
        </div>

        <button
          type="button"
          aria-label={filterLabel}
          aria-haspopup="dialog"
          onClick={onFilters}
          class={`relative flex size-11 shrink-0 items-center justify-center rounded-full transition-colors duration-[120ms] hover:bg-surface-pressed active:scale-[0.97] ${
            filterCount > 0 ? "text-accent" : "text-ink-secondary"
          }`}
        >
          <Icon name="filter" size={22} />
          {filterCount > 0 ? (
            <span
              aria-hidden="true"
              class="absolute top-1 right-1 flex h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-full bg-accent px-1 text-[0.625rem] leading-none font-semibold text-on-accent"
            >
              {filterCount}
            </span>
          ) : null}
        </button>
      </div>
    </div>
  );
}
