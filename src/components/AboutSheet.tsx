import { config } from "../config";
import { BottomSheet } from "./BottomSheet";
import { Icon } from "./Icon";

interface AboutSheetProps {
  open: boolean;
  onClose: () => void;
}

/** The collection explanation: facts, not marketing. */
export function AboutSheet({ open, onClose }: AboutSheetProps) {
  return (
    <BottomSheet open={open} onClose={onClose} labelledBy="about-title">
      <div class="flex items-center justify-between gap-2">
        <h2 id="about-title" class="text-h2 tracking-[-0.01em] text-ink">
          {config.settings.about.title}
        </h2>
        <button
          type="button"
          aria-label={config.actions.close}
          onClick={onClose}
          class="-mr-2 flex size-11 shrink-0 items-center justify-center rounded-full text-ink-secondary transition-colors duration-[120ms] hover:bg-surface-pressed active:scale-[0.97]"
        >
          <Icon name="x" size={20} />
        </button>
      </div>

      <div class="mt-3 space-y-3 border-t border-line pt-4">
        {config.settings.about.paragraphs.map((paragraph) => (
          <p key={paragraph} class="max-w-[40ch] text-body text-ink-secondary">
            {paragraph}
          </p>
        ))}
      </div>
    </BottomSheet>
  );
}
