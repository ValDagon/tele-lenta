import { config } from "../config";
import { BottomSheet } from "./BottomSheet";

interface OnboardingSheetProps {
  open: boolean;
  onClose: () => void;
}

export function OnboardingSheet({ open, onClose }: OnboardingSheetProps) {
  return (
    <BottomSheet open={open} onClose={onClose} labelledBy="onboarding-title">
      <h2
        id="onboarding-title"
        class="text-display tracking-[-0.02em] text-ink"
      >
        {config.onboarding.title}
      </h2>

      <ul class="mt-4 divide-y divide-line border-y border-line">
        {config.onboarding.lines.map((line) => (
          <li key={line} class="py-3.5 text-body text-ink-secondary">
            {line}
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={onClose}
        class="mt-5 min-h-11 w-full rounded-button bg-accent px-4 text-button text-on-accent transition-colors duration-[120ms] hover:bg-accent-hover active:scale-[0.99]"
      >
        {config.onboarding.dismiss}
      </button>
    </BottomSheet>
  );
}
