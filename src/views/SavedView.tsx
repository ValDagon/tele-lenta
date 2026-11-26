import { useCallback, useEffect, useReducer, useRef, useState } from "preact/hooks";

import type { ApiClient } from "../api/client";
import type { SavedSearch, SourceListItem } from "../api/types";
import { Icon } from "../components/Icon";
import { Switch } from "../components/Switch";
import { config } from "../config";
import {
  createSavedState,
  isBusy,
  savedReducer,
} from "../saved/state";
import {
  digestTimeLabel,
  MAX_SAVED_SEARCHES,
  summaryLine,
} from "../saved/model";
import { useNow } from "../lib/use-now";
import type { TelegramWebApp } from "../telegram/types";

interface SavedViewProps {
  client: ApiClient;
  /** Source names for the summary line; an empty list renders counts only. */
  sources: readonly SourceListItem[];
  onBack: () => void;
  onSearch: () => void;
  webapp?: TelegramWebApp;
}

/**
 * The saved-search list. Each row keeps its digest switch, rename, and delete
 * inline, so managing a search never leaves the screen. All mutations are
 * optimistic only for the switch; rename and delete wait for the response.
 */
export function SavedView({
  client,
  sources,
  onBack,
  onSearch,
  webapp,
}: SavedViewProps) {
  const [state, dispatch] = useReducer(savedReducer, createSavedState());
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const renameRef = useRef<HTMLInputElement>(null);
  const now = useNow();

  // `autoFocus` on a row that just replaced a button is unreliable in a
  // webview; put the caret in the name field explicitly.
  useEffect(() => {
    if (renamingId !== null) renameRef.current?.focus();
  }, [renamingId]);

  const load = useCallback(async () => {
    dispatch({ type: "load-start" });
    try {
      const items = await client.listSavedSearches();
      dispatch({ type: "load-success", items });
    } catch {
      dispatch({ type: "load-failure", error: config.saved.loadError });
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const success = () =>
    webapp?.HapticFeedback?.notificationOccurred?.("success");
  const failure = () => {
    webapp?.HapticFeedback?.notificationOccurred?.("error");
    dispatch({ type: "error-set", error: config.saved.error });
  };

  const toggleDigest = async (item: SavedSearch) => {
    if (isBusy(state, item.id)) return;

    const enabled = !item.enabled;
    webapp?.HapticFeedback?.selectionChanged();
    dispatch({ type: "busy-start", id: item.id, kind: "toggle" });
    dispatch({ type: "replace", item: { ...item, enabled } });

    try {
      const updated = await client.updateSavedSearch(item.id, { enabled });
      dispatch({ type: "replace", item: updated });
    } catch {
      dispatch({ type: "replace", item });
      failure();
    } finally {
      dispatch({ type: "busy-end", id: item.id });
    }
  };

  const startRename = (item: SavedSearch) => {
    if (isBusy(state, item.id)) return;
    setDeletingId(null);
    setRenamingId(item.id);
    setRenameValue(item.name);
  };

  const cancelRename = () => {
    setRenamingId(null);
    setRenameValue("");
  };

  const submitRename = async (item: SavedSearch) => {
    if (isBusy(state, item.id)) return;

    const name = renameValue.trim();
    if (name.length === 0 || name.length > 80) {
      dispatch({ type: "error-set", error: config.saveSearch.nameError });
      return;
    }

    dispatch({ type: "busy-start", id: item.id, kind: "rename" });
    try {
      const updated = await client.updateSavedSearch(item.id, { name });
      dispatch({ type: "replace", item: updated });
      setRenamingId(null);
      setRenameValue("");
      success();
    } catch {
      failure();
    } finally {
      dispatch({ type: "busy-end", id: item.id });
    }
  };

  const confirmDelete = async (item: SavedSearch) => {
    if (isBusy(state, item.id)) return;

    dispatch({ type: "busy-start", id: item.id, kind: "delete" });
    try {
      await client.deleteSavedSearch(item.id);
      dispatch({ type: "remove", id: item.id });
      setDeletingId(null);
      success();
    } catch {
      failure();
    } finally {
      dispatch({ type: "busy-end", id: item.id });
    }
  };

  const showEmpty =
    state.phase === "ready" && state.items.length === 0;
  const showLoading =
    state.phase === "loading" && state.items.length === 0;
  const showLoadError =
    state.phase === "error" && state.items.length === 0;

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
          {config.saved.title}
        </h1>
      </header>

      <main class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div class="px-4 pt-3 pb-10">
          {state.items.length >= MAX_SAVED_SEARCHES ? (
            <p class="pb-2 text-xs text-ink-muted">
              {config.saved.limitNote}
            </p>
          ) : null}

          {/* A failed mutation keeps the list on screen and adds one line,
              because the row itself is still the thing the user acts on. */}
          {state.error !== null && state.items.length > 0 ? (
            <p role="status" class="pb-2 text-sm text-signal">
              {state.error}
            </p>
          ) : null}

          {showLoading ? (
            <p role="status" class="text-sm text-ink-secondary">
              {config.saved.loading}
            </p>
          ) : null}

          {showLoadError ? (
            <div>
              <p class="max-w-[36ch] text-body text-ink-secondary">
                {config.saved.loadError}
              </p>
              <button
                type="button"
                onClick={() => void load()}
                class="mt-4 inline-flex min-h-11 items-center rounded-button border border-line-strong px-4 text-button text-ink transition-colors duration-[120ms] hover:bg-surface-pressed active:scale-[0.97]"
              >
                {config.saved.retry}
              </button>
            </div>
          ) : null}

          {showEmpty ? (
            <div>
              <p class="max-w-[36ch] text-body text-ink-secondary">
                {config.saved.empty}
              </p>
              <button
                type="button"
                onClick={onSearch}
                class="mt-4 inline-flex min-h-11 items-center rounded-button bg-accent px-4 text-button text-on-accent transition-colors duration-[120ms] hover:bg-accent-hover active:scale-[0.99]"
              >
                {config.saved.emptyAction}
              </button>
            </div>
          ) : null}

          {state.items.length > 0 ? (
            <ul>
              {state.items.map((item) => {
                const busy = isBusy(state, item.id);
                const renaming = renamingId === item.id;
                const deleting = deletingId === item.id;

                return (
                  <li key={item.id} class="border-b border-line py-3">
                    <div class="flex items-start gap-3">
                      <div class="min-w-0 flex-1">
                        {renaming ? (
                          <form
                            onSubmit={(event) => {
                              event.preventDefault();
                              void submitRename(item);
                            }}
                          >
                            <label
                              for={`saved-name-${item.id}`}
                              class="sr-only"
                            >
                              {config.saveSearch.name}
                            </label>
                            <input
                              id={`saved-name-${item.id}`}
                              type="text"
                              value={renameValue}
                              maxlength={80}
                              autocomplete="off"
                              ref={renameRef}
                              onInput={(event) =>
                                setRenameValue(event.currentTarget.value)
                              }
                              onKeyDown={(event) => {
                                if (event.key === "Escape") {
                                  event.preventDefault();
                                  cancelRename();
                                }
                              }}
                              class="h-11 w-full rounded-button border border-line bg-surface px-3 text-[1rem] text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                            />
                            <div class="mt-2 flex items-center gap-1">
                              <button
                                type="submit"
                                disabled={busy}
                                class="inline-flex min-h-11 items-center rounded-button bg-accent px-3 text-button text-on-accent transition-colors duration-[120ms] hover:bg-accent-hover disabled:opacity-60"
                              >
                                {busy
                                  ? config.saved.saving
                                  : config.saved.save}
                              </button>
                              <button
                                type="button"
                                onClick={cancelRename}
                                disabled={busy}
                                class="inline-flex min-h-11 items-center rounded-button px-3 text-button text-accent transition-colors duration-[120ms] hover:bg-surface-pressed disabled:opacity-60"
                              >
                                {config.saved.cancel}
                              </button>
                            </div>
                          </form>
                        ) : (
                          <>
                            <p class="text-body font-medium text-ink">
                              {item.name}
                            </p>
                            {summaryLine(item, sources) === item.name ||
                            summaryLine(item, sources) === `«${item.name}»` ? null : (
                              <p class="mt-0.5 text-sm text-ink-secondary">
                                {summaryLine(item, sources)}
                              </p>
                            )}
                            <p class="mt-0.5 text-xs text-ink-muted">
                              {digestTimeLabel(item.last_sent_at, now.getTime())}
                            </p>
                          </>
                        )}
                      </div>

                      <Switch
                        checked={item.enabled}
                        ariaLabel={`${config.saved.digestFor} «${item.name}»`}
                        disabled={busy}
                        onChange={() => void toggleDigest(item)}
                      />
                    </div>

                    {!renaming ? (
                      deleting ? (
                        <div class="mt-1 flex items-center gap-1">
                          <span class="text-sm text-ink-secondary">
                            {config.saved.deleteConfirm}
                          </span>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void confirmDelete(item)}
                            class="inline-flex min-h-11 items-center rounded-button px-3 text-button text-signal transition-colors duration-[120ms] hover:bg-surface-pressed disabled:opacity-60"
                          >
                            {busy ? config.saved.saving : config.saved.delete}
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => setDeletingId(null)}
                            class="inline-flex min-h-11 items-center rounded-button px-3 text-button text-accent transition-colors duration-[120ms] hover:bg-surface-pressed disabled:opacity-60"
                          >
                            {config.saved.cancel}
                          </button>
                        </div>
                      ) : (
                        <div class="-ml-2 mt-1 flex items-center gap-1">
                          <button
                            type="button"
                            aria-label={`${config.saved.rename}: ${item.name}`}
                            disabled={busy}
                            onClick={() => startRename(item)}
                            class="flex size-11 items-center justify-center rounded-full text-ink-secondary transition-colors duration-[120ms] hover:bg-surface-pressed active:scale-[0.97] disabled:opacity-60"
                          >
                            <Icon name="pencil" size={20} />
                          </button>
                          <button
                            type="button"
                            aria-label={`${config.saved.delete}: ${item.name}`}
                            disabled={busy}
                            onClick={() => {
                              setRenamingId(null);
                              setDeletingId(item.id);
                            }}
                            class="flex size-11 items-center justify-center rounded-full text-ink-secondary transition-colors duration-[120ms] hover:bg-surface-pressed active:scale-[0.97] disabled:opacity-60"
                          >
                            <Icon name="trash" size={20} />
                          </button>
                        </div>
                      )
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      </main>
    </div>
  );
}
