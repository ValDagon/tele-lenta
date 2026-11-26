import { toApiError } from "./errors";
import type { Transport } from "./transport";
import type {
  CardDetail,
  DeleteSavedSearchResponse,
  FeedInput,
  FeedResponse,
  MeAction,
  MeResponse,
  SavedSearch,
  SavedSearchInput,
  SessionResponse,
  SourcesResponse,
} from "./types";

/**
 * One client for the BFF. It never talks to the VPS directly: every call goes
 * through `Telegram.WebApp.Serverless`, which attaches the signed initData and
 * is same-origin with the Mini App.
 */
export interface ApiClient {
  session(): Promise<SessionResponse>;
  feed(input?: FeedInput): Promise<FeedResponse>;
  card(id: number): Promise<CardDetail>;
  sources(): Promise<SourcesResponse>;
  listSavedSearches(): Promise<SavedSearch[]>;
  createSavedSearch(data: SavedSearchInput): Promise<SavedSearch>;
  updateSavedSearch(id: number, data: SavedSearchInput): Promise<SavedSearch>;
  deleteSavedSearch(id: number): Promise<DeleteSavedSearchResponse>;
  me(action: MeAction, patch?: Record<string, unknown>): Promise<MeResponse>;
}

export function createApiClient(transport: Transport): ApiClient {
  async function call<T>(
    name: string,
    input: Record<string, unknown> = {},
  ): Promise<T> {
    try {
      return (await transport(name, input)) as T;
    } catch (error) {
      throw toApiError(error);
    }
  }

  return {
    session: () => call<SessionResponse>("session"),

    feed: (input = {}) => call<FeedResponse>("feed", { ...input }),

    card: (id) => call<CardDetail>("card", { id }),

    sources: () => call<SourcesResponse>("sources"),

    listSavedSearches: () =>
      call<SavedSearch[]>("saved-searches", { action: "list" }),

    createSavedSearch: (data) =>
      call<SavedSearch>("saved-searches", { action: "create", data }),

    updateSavedSearch: (id, data) =>
      call<SavedSearch>("saved-searches", { action: "update", id, data }),

    deleteSavedSearch: (id) =>
      call<DeleteSavedSearchResponse>("saved-searches", {
        action: "delete",
        id,
      }),

    me: (action, patch) =>
      call<MeResponse>("me", {
        action,
        ...(patch === undefined ? {} : { patch }),
      }),
  };
}
