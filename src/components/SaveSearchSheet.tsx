import { useEffect, useRef, useState } from "preact/hooks";

import type { ApiClient } from "../api/client";
import type { SavedSearch, SourceListItem } from "../api/types";
import { config } from "../config";
import {
  draftSummary,
  generateName,
  MAX_SAVED_SEARCHES,
  saveErrorFor,
  type SavedSearchDraft,
  type SaveError,
} from "../saved/model";
import { BottomSheet } from "./BottomSheet";
import { Switch } from "./Switch";
import { Icon } from "./Icon";

interface SaveSearchSheetProps {
  open: boolean;
  onClose: () => void;
  draft: SavedSearchDraft;
  sources: readonly SourceListItem[];
  client: ApiClient;
  onSaved: (saved: SavedSearch) => void;
  onError: (error: SaveError) => void;
  onHaptic?: (kind: "success" | "error") => void;
}

const NAME_ID = "save-search-name";
const NAME_ERROR_ID = "save-search-name-error";
const DIGEST_ID = "save-search-digest";

/**
 * Saving is one tap: the name is generated from the draft, the digest switch
 * is on, and the only edit most users make is the name. The sheet never closes
 * itself; the parent owns that after a successful save.
 */
export function SaveSearchSheet({
  open,
  onClose,
  draft,
  sources,
  client,
  onSaved,
  onError,
  onHaptic,
}: SaveSearchSheetProps) {
  const [name, setName] = useState(() => generateName(draft, sources));
  const [digest, setDigest] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [nameInvalid, setNameInvalid] = useState(false);
  const [error, setError] = useState<SaveError | null>(null);
  const wasOpen = useRef(open);

  // Reopening regenerates the name from the current draft; a re-render while
  // the sheet is open never overwrites what the user typed.
  useEffect(() => {
    if (open && !wasOpen.current) {
      setName(generateName(draft, sources));
      setDigest(true);
      setSubmitting(false);
      setNameInvalid(false);
      setError(null);
    }
    wasOpen.current = open;
  }, [open, draft, sources]);

  const errorCopy =
    error === null
      ? null
      : error === "limit"
        ? config.saveSearch.limit
        : error === "invalid"
          ? config.saveSearch.invalid
          : config.saveSearch.network;

  const submit = async (event: Event) => {
    event.preventDefault();
    if (submitting) return;

    const trimmed = name.trim();
    if (trimmed.length === 0 || trimmed.length > 80) {
      setNameInvalid(true);
      return;
    }

    setNameInvalid(false);
    setError(null);
    setSubmitting(true);

    try {
      const saved = await client.createSavedSearch({
        name: trimmed,
        query: draft.query,
        section: draft.section,
        categories: [...draft.categories],
        demand: draft.demand,
        sources: [...draft.sources],
        enabled: digest,
      });
      onHaptic?.("success");
      onSaved(saved);
    } catch (failure) {
      // Name, query, and enum values are validated here already, so a
      // remaining `invalid_request` is the per-user limit in practice.
      const kind = saveErrorFor(failure, MAX_SAVED_SEARCHES);
      setError(kind);
      onHaptic?.("error");
      onError(kind);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <BottomSheet open={open} onClose={onClose} labelledBy="save-search-title">
      <form onSubmit={(event) => void submit(event)} noValidate>
        <div class="flex items-center justify-between gap-2">
          <h2
            id="save-search-title"
            class="text-h2 tracking-[-0.01em] text-ink"
          >
            {config.saveSearch.title}
          </h2>
          <button
            type="button"
            aria-label={config.saveSearch.close}
            onClick={onClose}
            class="-mr-2 flex size-11 shrink-0 items-center justify-center rounded-full text-ink-secondary transition-colors duration-[120ms] hover:bg-surface-pressed active:scale-[0.97]"
          >
            <Icon name="x" size={20} />
          </button>
        </div>

        <div class="mt-4">
          <p class="text-xs text-ink-muted">
            {config.saveSearch.summaryLabel}
          </p>
          <p class="mt-1 text-sm text-ink-secondary">
            {draftSummary(draft, sources)}
          </p>
        </div>

        <div class="mt-5">
          <label
            for={NAME_ID}
            class="block text-xs text-ink-muted"
          >
            {config.saveSearch.name}
          </label>
          <input
            id={NAME_ID}
            type="text"
            value={name}
            maxlength={80}
            autocomplete="off"
            aria-invalid={nameInvalid ? "true" : undefined}
            aria-describedby={nameInvalid ? NAME_ERROR_ID : undefined}
            onInput={(event) => {
              setName(event.currentTarget.value);
              if (nameInvalid) setNameInvalid(false);
            }}
            class="mt-1 h-11 w-full rounded-button border border-line bg-surface px-3 text-[1rem] text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          />
          {nameInvalid ? (
            <p id={NAME_ERROR_ID} role="alert" class="mt-1 text-sm text-signal">
              {config.saveSearch.nameError}
            </p>
          ) : null}
        </div>

        <div class="mt-4 flex items-center justify-between gap-3">
          <span id={`${DIGEST_ID}-label`} class="text-sm text-ink">
            {config.saveSearch.digestSwitch}
          </span>
          <Switch
            checked={digest}
            labelledBy={`${DIGEST_ID}-label`}
            onChange={() => setDigest((value) => !value)}
          />
        </div>

        {errorCopy !== null ? (
          <p role="alert" class="mt-3 text-sm text-signal">
            {errorCopy}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={submitting}
          class="mt-5 flex min-h-11 w-full items-center justify-center rounded-button bg-accent px-4 text-button text-on-accent transition-colors duration-[120ms] hover:bg-accent-hover active:scale-[0.99] disabled:opacity-60"
        >
          {submitting ? config.saveSearch.submitting : config.saveSearch.submit}
        </button>
      </form>
    </BottomSheet>
  );
}
