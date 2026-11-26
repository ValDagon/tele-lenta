import { beforeEach, describe, expect, it } from "vitest";

import type { Card } from "../api/types";
import {
  FEED_CACHE_KEY,
  FEED_CACHE_LIMIT,
  FEED_CACHE_VERSION,
  cacheAgeMs,
  isFeedCacheFresh,
  readFeedCache,
  writeFeedCache,
} from "./cache";

function card(id: number): Card {
  return {
    id,
    section: "classifieds",
    category: "goods",
    demand: "offer",
    title: `Объявление ${id}`,
    earliest_published_at: "2026-11-05T09:00:00.000Z",
    sources: [{ id: 1, username: "chat", name: "Чат", monogram: "Ч" }],
    source_count: 1,
  };
}

const NOW = Date.parse("2026-11-05T11:00:00.000Z");

describe("feed cache", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("writes and reads the last viewed section", () => {
    const cards = [card(3), card(2), card(1)];
    writeFeedCache("jobs", cards, "2026-11-05T10:50:00.000Z", NOW);

    const cache = readFeedCache();
    expect(cache).not.toBeNull();
    expect(cache?.version).toBe(FEED_CACHE_VERSION);
    expect(cache?.section).toBe("jobs");
    expect(cache?.cards.map((item) => item.id)).toEqual([3, 2, 1]);
    expect(cache?.updated_at).toBe("2026-11-05T10:50:00.000Z");
    expect(cache?.saved_at).toBe("2026-11-05T11:00:00.000Z");
  });

  it("keeps at most 50 cards", () => {
    const cards = Array.from({ length: 60 }, (_, index) => card(index));
    writeFeedCache("classifieds", cards, null, NOW);

    expect(readFeedCache()?.cards).toHaveLength(FEED_CACHE_LIMIT);
  });

  it("returns null for another version or broken JSON", () => {
    window.localStorage.setItem(
      FEED_CACHE_KEY,
      JSON.stringify({ version: 0, section: "classifieds", cards: [] }),
    );
    expect(readFeedCache()).toBeNull();

    window.localStorage.setItem(FEED_CACHE_KEY, "{not json");
    expect(readFeedCache()).toBeNull();
  });

  it("returns null when a cached card is malformed", () => {
    window.localStorage.setItem(
      FEED_CACHE_KEY,
      JSON.stringify({
        version: FEED_CACHE_VERSION,
        section: "classifieds",
        cards: [{ id: "one" }],
        updated_at: null,
        saved_at: "2026-11-05T11:00:00.000Z",
      }),
    );
    expect(readFeedCache()).toBeNull();
  });

  it("measures age and treats five minutes as the fresh boundary", () => {
    const cache = writeFeedCache("classifieds", [card(1)], null, NOW);

    expect(cacheAgeMs(cache, NOW)).toBe(0);
    expect(isFeedCacheFresh(cache, NOW)).toBe(true);
    expect(isFeedCacheFresh(cache, NOW + 4 * 60 * 1000)).toBe(true);
    expect(isFeedCacheFresh(cache, NOW + 5 * 60 * 1000)).toBe(false);
  });
});
