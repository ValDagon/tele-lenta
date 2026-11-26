interface SwitchProps {
  checked: boolean;
  onChange: () => void;
  /** Visible label id; use this or `ariaLabel`, never neither. */
  labelledBy?: string;
  ariaLabel?: string;
  disabled?: boolean;
}

/**
 * One switch for the digest controls. The knob is pinned with an explicit
 * `left`; without it the static position plus `translate` let the knob escape
 * the 48px track and the row edge in a narrow webview.
 */
export function Switch({
  checked,
  onChange,
  labelledBy,
  ariaLabel,
  disabled = false,
}: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onChange}
      class="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60"
    >
      <span
        aria-hidden="true"
        class={`relative h-7 w-12 rounded-full transition-colors duration-[120ms] ${
          checked ? "bg-accent" : "border border-line bg-surface-sunken"
        }`}
      >
        <span
          class={`absolute top-0.5 left-0.5 size-6 rounded-full bg-surface transition-transform duration-[120ms] ${
            checked ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </span>
    </button>
  );
}
