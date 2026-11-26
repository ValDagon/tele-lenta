import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "preact/hooks";

import type { ApiClient } from "../api/client";
import { Icon } from "../components/Icon";
import { Switch } from "../components/Switch";
import { config } from "../config";
import { openOwnerContact } from "../lib/contact";
import {
  digestSummary,
  draftFromMe,
  patchFor,
  quietHoursError,
  quietSummary,
  settingsLoaded,
  timeOptions,
  type SettingsDraft,
} from "../settings/model";
import {
  createSettingsState,
  settingsReducer,
} from "../settings/state";
import type { TelegramWebApp } from "../telegram/types";
import type { ThemeMode } from "../theme/apply";

const MODES: ReadonlyArray<ThemeMode> = ["auto", "light", "dark"];

interface SettingsViewProps {
  mode: ThemeMode;
  onModeChange: (mode: ThemeMode) => void;
  onBack: () => void;
  client: ApiClient;
  webapp?: TelegramWebApp;
  onAbout: () => void;
}

interface SwitchRowProps {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  onChange: () => void;
}

function SwitchRow({
  id,
  label,
  hint,
  checked,
  disabled,
  onChange,
}: SwitchRowProps) {
  return (
    <div class="mt-3 flex items-start justify-between gap-4">
      <div class="min-w-0">
        <p id={id} class="text-body text-ink">
          {label}
        </p>
        <p class="mt-0.5 max-w-[40ch] text-sm text-ink-muted">{hint}</p>
      </div>
      <Switch
        checked={checked}
        labelledBy={id}
        disabled={disabled}
        onChange={onChange}
      />
    </div>
  );
}

/**
 * Settings: theme, the global digest switch, quiet hours, spam and ad filters,
 * the collection explanation, and the owner contact. Only the five settings
 * fields ever travel to the server; the response is the source of truth.
 */
export function SettingsView({
  mode,
  onModeChange,
  onBack,
  client,
  webapp,
  onAbout,
}: SettingsViewProps) {
  const [state, dispatch] = useReducer(
    settingsReducer,
    createSettingsState(),
  );
  const inFlight = useRef(false);

  const draft = state.draft;
  const quietStart = draft?.quiet_start ?? "";
  const quietEnd = draft?.quiet_end ?? "";
  const timeStart = quietStart;
  const timeEnd = quietEnd;

  const load = useCallback(async () => {
    dispatch({ type: "load-start" });
    try {
      const me = await client.me("get");
      if (!settingsLoaded(me)) {
        dispatch({ type: "load-failure" });
        return;
      }
      dispatch({ type: "load-success", draft: draftFromMe(me) });
    } catch {
      dispatch({ type: "load-failure" });
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const commit = useCallback(
    async (next: SettingsDraft) => {
      const current = draft;
      if (current === null || inFlight.current) return;

      const { patch } = patchFor(current, next);
      if (Object.keys(patch).length === 0) return;

      inFlight.current = true;
      dispatch({ type: "save-start", draft: next });

      try {
        const me = await client.me("update", patch);
        if (!settingsLoaded(me)) throw new Error("settings not loaded");
        dispatch({
          type: "save-success",
          draft: draftFromMe(me),
          savedAt: Date.now(),
        });
        webapp?.HapticFeedback?.selectionChanged();
      } catch {
        // The optimistic value never becomes the screen's truth: put the
        // previous draft back and say why.
        dispatch({
          type: "save-failure",
          previous: current,
          error: config.settings.saveError,
        });
        webapp?.HapticFeedback?.notificationOccurred?.("error");
      } finally {
        inFlight.current = false;
      }
    },
    [client, draft, webapp],
  );

  const toggle = (field: "digest_enabled" | "spam_filter" | "ad_filter") => {
    if (draft === null) return;
    void commit({ ...draft, [field]: !draft[field] });
  };

  // The selects mirror the draft, so an invalid pick cannot stay in the
  // control. Its explanation has to live here, or the value would just snap
  // back with no reason.
  const [timeError, setTimeError] = useState<string | null>(null);

  const commitTime = (field: "quiet_start" | "quiet_end", value: string) => {
    if (draft === null) return;
    const next: SettingsDraft = {
      ...draft,
      quiet_start: field === "quiet_start" ? value : timeStart,
      quiet_end: field === "quiet_end" ? value : timeEnd,
    };
    const error = quietHoursError(next);
    if (error !== null) {
      setTimeError(error);
      return;
    }
    setTimeError(null);
    void commit(next);
  };

  const quietErrorId = timeError === null ? "" : " quiet-error";

  return (
    <div class="flex h-dvh flex-col bg-canvas">
      <header class="flex min-h-14 shrink-0 items-center gap-1 border-b border-line px-2 pt-[var(--safe-top)]">
        <button
          type="button"
          onClick={onBack}
          aria-label={config.actions.back}
          class="flex size-11 items-center justify-center rounded-full text-ink-secondary transition-colors duration-[120ms] hover:bg-surface-pressed active:scale-[0.97]"
        >
          <Icon name="chevron-left" size={22} />
        </button>
        <h1 class="text-h2 tracking-[-0.01em] text-ink">
          {config.settings.title}
        </h1>
      </header>

      <main class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div class="px-4 py-5">
          {state.phase === "loading" ? (
            <p role="status" class="mb-4 text-sm text-ink-secondary">
              {config.settings.loading}
            </p>
          ) : null}

          {state.phase === "error" ? (
            <div class="mb-4">
              <p class="max-w-[40ch] text-body text-ink-secondary">
                {config.settings.loadError}
              </p>
              <button
                type="button"
                onClick={() => void load()}
                class="mt-3 inline-flex min-h-11 items-center rounded-button border border-line-strong px-4 text-button text-ink transition-colors duration-[120ms] hover:bg-surface-pressed active:scale-[0.97]"
              >
                {config.settings.retry}
              </button>
            </div>
          ) : null}

          {state.error !== null && state.phase !== "error" ? (
            <p role="alert" class="mb-4 max-w-[40ch] text-sm text-signal">
              {state.error}
            </p>
          ) : null}

          <p role="status" class="mb-4 min-h-4 text-xs text-ink-muted">
            {state.saving
              ? config.settings.saving
              : state.error === null && state.savedAt !== null
                ? config.settings.savedAt
                : ""}
          </p>

          <fieldset>
            <legend class="text-sm font-medium text-ink-muted">
              {config.settings.theme}
            </legend>

            <div class="mt-2 grid grid-cols-3 gap-1 rounded-button bg-surface-sunken p-1">
              {MODES.map((option) => (
                <label
                  key={option}
                  class={`flex min-h-11 cursor-pointer items-center justify-center rounded-[6px] border border-transparent px-2 text-center text-sm transition-colors duration-[120ms] has-[:checked]:border-line has-[:checked]:bg-surface has-[:checked]:text-ink has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent has-[:focus-visible]:outline-offset-2 ${
                    option === mode ? "text-ink" : "text-ink-secondary"
                  }`}
                >
                  <input
                    type="radio"
                    name="theme"
                    value={option}
                    checked={option === mode}
                    onChange={() => onModeChange(option)}
                    class="sr-only"
                  />
                  <span>{config.settings.themeOptions[option]}</span>
                </label>
              ))}
            </div>
          </fieldset>

          {draft !== null ? (
            <>
              <fieldset class="mt-6 border-t border-line pt-4">
                <legend class="pr-2 text-sm font-medium text-ink-muted">
                  {config.settings.digest.title}
                </legend>
                <SwitchRow
                  id="digest-switch"
                  label={config.settings.digest.switch}
                  hint={config.settings.digest.hint}
                  checked={draft.digest_enabled}
                  disabled={state.saving}
                  onChange={() => toggle("digest_enabled")}
                />
                <p class="mt-2 text-sm text-ink-secondary">
                  {digestSummary(draft.digest_enabled)}
                </p>
              </fieldset>

              <fieldset class="mt-6 border-t border-line pt-4">
                <legend class="pr-2 text-sm font-medium text-ink-muted">
                  {config.settings.quiet.title}
                </legend>

                <p
                  id="quiet-hint"
                  class="mt-1 max-w-[40ch] text-sm text-ink-muted"
                >
                  {config.settings.quiet.zone}
                </p>

                <div class="mt-3 flex items-end gap-3">
                  <div>
                    <label
                      for="quiet-start"
                      class="block text-sm text-ink-secondary"
                    >
                      {config.settings.quiet.from}
                    </label>
                    <select
                      id="quiet-start"
                      value={timeStart}
                      disabled={state.saving}
                      aria-describedby={`quiet-hint quiet-summary${quietErrorId}`}
                      aria-invalid={timeError !== null}
                      onChange={(event) =>
                        commitTime("quiet_start", event.currentTarget.value)
                      }
                      class="mt-1 h-11 w-32 rounded-button border border-line bg-surface px-3 text-[1rem] text-ink tabular-nums focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60"
                    >
                      {timeOptions(timeStart).map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </div>

                  <span aria-hidden="true" class="pb-3 text-ink-muted">
                    –
                  </span>

                  <div>
                    <label
                      for="quiet-end"
                      class="block text-sm text-ink-secondary"
                    >
                      {config.settings.quiet.to}
                    </label>
                    <select
                      id="quiet-end"
                      value={timeEnd}
                      disabled={state.saving}
                      aria-describedby={`quiet-hint quiet-summary${quietErrorId}`}
                      aria-invalid={timeError !== null}
                      onChange={(event) =>
                        commitTime("quiet_end", event.currentTarget.value)
                      }
                      class="mt-1 h-11 w-32 rounded-button border border-line bg-surface px-3 text-[1rem] text-ink tabular-nums focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60"
                    >
                      {timeOptions(timeEnd).map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {timeError !== null ? (
                  <p
                    id="quiet-error"
                    role="alert"
                    class="mt-2 max-w-[40ch] text-sm text-signal"
                  >
                    {timeError}
                  </p>
                ) : null}

                <p
                  id="quiet-summary"
                  class="mt-2 max-w-[40ch] text-sm text-ink-secondary"
                >
                  {quietSummary(timeStart, timeEnd)}
                </p>
                <p class="mt-0.5 max-w-[40ch] text-sm text-ink-muted">
                  {config.settings.quiet.hint}
                </p>
              </fieldset>

              <fieldset class="mt-6 border-t border-line pt-4">
                <legend class="pr-2 text-sm font-medium text-ink-muted">
                  {config.settings.filters.title}
                </legend>
                <SwitchRow
                  id="spam-switch"
                  label={config.settings.filters.spam}
                  hint={config.settings.filters.spamHint}
                  checked={draft.spam_filter}
                  disabled={state.saving}
                  onChange={() => toggle("spam_filter")}
                />
                <SwitchRow
                  id="ad-switch"
                  label={config.settings.filters.ad}
                  hint={config.settings.filters.adHint}
                  checked={draft.ad_filter}
                  disabled={state.saving}
                  onChange={() => toggle("ad_filter")}
                />
                <p class="mt-3 max-w-[40ch] text-sm text-ink-muted">
                  {config.settings.filters.note}
                </p>
              </fieldset>
            </>
          ) : null}

          <fieldset class="mt-6 border-t border-line pt-4">
            <legend class="pr-2 text-sm font-medium text-ink-muted">
              {config.settings.aboutSection}
            </legend>

            <button
              type="button"
              onClick={onAbout}
              class="mt-1 flex min-h-11 w-full items-center text-left text-body text-accent transition-colors duration-[120ms] hover:text-accent-hover"
            >
              {config.settings.aboutRow}
            </button>

            <a
              href={config.ownerContactUrl}
              target="_blank"
              rel="noopener"
              onClick={(event) => openOwnerContact(webapp, event)}
              class="flex min-h-11 w-full items-center text-left text-body text-accent transition-colors duration-[120ms] hover:text-accent-hover"
            >
              {config.settings.contact}
            </a>
            <p class="max-w-[40ch] text-sm text-ink-muted">
              {config.settings.contactHint}
            </p>
          </fieldset>
        </div>
      </main>
    </div>
  );
}
