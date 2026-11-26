import type { Section, SourceListItem } from "../api/types";
import { config } from "../config";
import {
  activeChips,
  isFiltered,
  type FeedFilters,
  type FilterChipKey,
} from "../filters/model";
import { Icon } from "./Icon";

interface FilterChipsProps {
  section: Section;
  filters: FeedFilters;
  sources: readonly SourceListItem[];
  onRemove: (key: FilterChipKey) => void;
  onClear: () => void;
}

/**
 * The always-visible narrowing under the tabs. Each chip is one button that
 * removes its filter, so the whole chip is a 44px target and a screen reader
 * hears «Убрать фильтр: Недвижимость» instead of two nested controls.
 */
export function FilterChips({
  section,
  filters,
  sources,
  onRemove,
  onClear,
}: FilterChipsProps) {
  if (!isFiltered(filters)) return null;

  const chips = activeChips(section, filters, sources);

  return (
    <div class="flex shrink-0 items-center gap-2 px-4 pt-2">
      {/* Chips scroll; the reset stays outside the scroller so it is always
          reachable, even when a long source name fills a 320px row. */}
      <div
        role="group"
        aria-label={config.filters.chipsLabel}
        class="min-w-0 flex-1 overflow-x-auto"
      >
        <div class="flex w-max items-center gap-2">
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              aria-label={`${config.filters.removeChipLabel}: ${chip.label}`}
              onClick={() => onRemove(chip.key)}
              class="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-chip bg-accent-soft pr-1 pl-3 text-sm text-ink transition-colors duration-[120ms] hover:bg-surface-pressed active:scale-[0.98]"
            >
              <span class="whitespace-nowrap">{chip.label}</span>
              <span
                aria-hidden="true"
                class="flex size-8 items-center justify-center text-ink-secondary"
              >
                <Icon name="x" size={16} />
              </span>
            </button>
          ))}
        </div>
      </div>

      <button
        type="button"
        onClick={onClear}
        class="inline-flex min-h-11 shrink-0 items-center px-2 text-sm text-accent transition-colors duration-[120ms] hover:bg-surface-pressed"
      >
        {config.filters.reset}
      </button>
    </div>
  );
}
