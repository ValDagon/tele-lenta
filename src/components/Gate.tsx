import { config } from "../config";
import type { GateStatus } from "../state/gate";
import { Icon } from "./Icon";

interface GateProps {
  status: GateStatus;
  onRetry: () => void;
  onContact: (event: MouseEvent) => void;
}

export function Gate({ status, onRetry, onContact }: GateProps) {
  if (status.kind === "allowed") return null;

  return (
    <div class="flex min-h-dvh flex-col bg-canvas px-6 pt-[calc(2rem+var(--safe-top))] pb-[calc(2rem+var(--safe-bottom))]">
      <p class="text-h2 tracking-[-0.01em] text-ink-muted">
        {config.productName}
      </p>

      <main class="mt-auto w-full max-w-[28rem] pb-10">
        {status.kind === "checking" ? (
          <p role="status" class="text-body text-ink-muted">
            {config.gate.checking}
          </p>
        ) : null}

        {status.kind === "outside" ? (
          <>
            <h1 class="text-display tracking-[-0.02em] text-ink">
              {config.gate.outsideTitle}
            </h1>
            <p class="mt-3 text-body text-ink-secondary">
              {config.gate.outsideBody}
            </p>
          </>
        ) : null}

        {status.kind === "invited" ? (
          <>
            <h1 class="text-display tracking-[-0.02em] text-ink">
              {config.gate.inviteTitle}
            </h1>
            <p class="mt-3 text-body text-ink-secondary">
              {config.gate.inviteBody}
            </p>
            <a
              href={config.ownerContactUrl}
              target="_blank"
              rel="noreferrer"
              onClick={onContact}
              class="mt-6 inline-flex min-h-11 items-center justify-center rounded-button bg-accent px-5 text-button text-on-accent transition-colors duration-[120ms] hover:bg-accent-hover active:scale-[0.98]"
            >
              {config.gate.contactAction}
            </a>
          </>
        ) : null}

        {status.kind === "error" ? (
          <>
            <h1 class="text-display tracking-[-0.02em] text-ink">
              {config.gate.errorTitle}
            </h1>
            <p class="mt-3 text-body text-ink-secondary">
              {config.errors[status.code]}
            </p>
            <button
              type="button"
              onClick={onRetry}
              class="mt-6 inline-flex min-h-11 items-center justify-center gap-2 rounded-button bg-accent px-5 text-button text-on-accent transition-colors duration-[120ms] hover:bg-accent-hover active:scale-[0.98]"
            >
              <Icon name="refresh" size={18} />
              {config.gate.retry}
            </button>
          </>
        ) : null}
      </main>
    </div>
  );
}
