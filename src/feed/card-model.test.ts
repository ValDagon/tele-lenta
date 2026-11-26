import { describe, expect, it } from "vitest";

import type { Card } from "../api/types";
import {
  buildFeedRows,
  cardAccessibleName,
  cardMetaLabel,
  cardPhotoUrl,
  cardPriceText,
  demandBadge,
  sourceOverflowLabel,
} from "./card-model";

const NOW = new Date("2026-11-05T11:00:00.000Z");

function card(overrides: Partial<Card> = {}): Card {
  return {
    id: 1,
    section: "classifieds",
    category: "real_estate",
    demand: "offer",
    title: "Продам двухкомнатную квартиру у моря",
    earliest_published_at: "2026-11-05T09:00:00.000Z",
    sources: [
      { id: 1, username: "baraholka_Monte", name: "Барахолка", monogram: "Б" },
    ],
    source_count: 1,
    ...overrides,
  };
}

describe("card meta", () => {
  it("shows the category inside Объявления and the section elsewhere", () => {
    expect(cardMetaLabel(card())).toBe("Недвижимость");
    expect(cardMetaLabel(card({ section: "jobs" }))).toBe("Вакансии");
    expect(cardMetaLabel(card({ section: "events" }))).toBe("Мероприятия");
  });

  it("falls back to the section for an unknown category id", () => {
    expect(cardMetaLabel(card({ category: "unknown" }))).toBe("Объявления");
  });
});

describe("demand badge", () => {
  it("is absent for an offer", () => {
    expect(demandBadge(card())).toBeNull();
  });

  it("reads «Куплю» and «Ищу» in words, never colour alone", () => {
    expect(demandBadge(card({ demand: "wanted", title: "Куплю гараж" }))).toBe(
      "Куплю",
    );
    expect(demandBadge(card({ demand: "wanted", title: "Ищу квартиру" }))).toBe(
      "Ищу",
    );
  });

  it("reads «Ищу работу» for jobs and is absent for events", () => {
    expect(demandBadge(card({ section: "jobs", demand: "wanted" }))).toBe(
      "Ищу работу",
    );
    expect(demandBadge(card({ section: "events", demand: "wanted" }))).toBeNull();
  });
});

describe("price slot", () => {
  it("uses the parsed raw price for classifieds", () => {
    expect(
      cardPriceText(
        card({
          price: { raw: "850 €/мес", value: 850, currency: "EUR", period: "month" },
        }),
      ),
    ).toBe("850 €/мес");
  });

  it("uses salary for jobs even when a price is present", () => {
    expect(
      cardPriceText(
        card({
          section: "jobs",
          price: { raw: "100 €", value: 100, currency: "EUR", period: null },
          salary: { raw: "1 200 €", value: 1200, currency: "EUR", period: null },
        }),
      ),
    ).toBe("1 200 €");
  });

  it("uses the event start for events", () => {
    expect(
      cardPriceText(
        card({ section: "events", event: { starts_at: "2026-11-14T19:00:00.000Z" } }),
        NOW,
      ),
    ).toBe("Сб, 14 ноя, 20:00");
  });

  it("omits an empty slot rather than filling a placeholder", () => {
    expect(cardPriceText(card({ price: { raw: "  ", value: null, currency: null, period: null } }))).toBeNull();
    expect(cardPriceText(card())).toBeNull();
  });
});

describe("accessible name", () => {
  it("carries title, price, city, and source count", () => {
    const name = cardAccessibleName(
      card({
        city: "Подгорица",
        price: { raw: "850 €/мес", value: 850, currency: "EUR", period: "month" },
        source_count: 3,
      }),
      NOW,
    );

    expect(name).toBe(
      "Продам двухкомнатную квартиру у моря, 850 €/мес, Подгорица, Источников: 3",
    );
  });

  it("omits absent price and city but keeps the source count", () => {
    expect(cardAccessibleName(card({ city: undefined }), NOW)).toBe(
      "Продам двухкомнатную квартиру у моря, Источников: 1",
    );
  });
});

describe("source trail", () => {
  it("pluralizes the overflow label", () => {
    expect(sourceOverflowLabel(1)).toBe("ещё 1 источник");
    expect(sourceOverflowLabel(2)).toBe("ещё 2 источника");
    expect(sourceOverflowLabel(5)).toBe("ещё 5 источников");
  });
});

describe("photo slot", () => {
  it("accepts only hotlinked Telegram CDN photos", () => {
    expect(
      cardPhotoUrl(
        card({ photo: { url: "https://cdn4.telesco.pe/file/a.jpg", count: 1 } }),
      ),
    ).toBe("https://cdn4.telesco.pe/file/a.jpg");

    expect(
      cardPhotoUrl(
        card({ photo: { url: "https://example.com/a.jpg", count: 1 } }),
      ),
    ).toBeNull();
    expect(
      cardPhotoUrl(
        card({ photo: { url: "http://cdn4.telesco.pe/a.jpg", count: 1 } }),
      ),
    ).toBeNull();
    expect(cardPhotoUrl(card())).toBeNull();
  });
});

describe("feed rows", () => {
  it("inserts one divider before each new day", () => {
    const rows = buildFeedRows(
      [
        card({ id: 1, earliest_published_at: "2026-11-05T09:00:00.000Z" }),
        card({ id: 2, earliest_published_at: "2026-11-05T08:00:00.000Z" }),
        card({ id: 3, earliest_published_at: "2026-11-04T20:00:00.000Z" }),
        card({ id: 4, earliest_published_at: "2026-10-20T10:00:00.000Z" }),
      ],
      NOW,
    );

    expect(rows).toEqual([
      { kind: "divider", key: "2026-11-05", label: "Сегодня" },
      { kind: "card", card: expect.objectContaining({ id: 1 }) },
      { kind: "card", card: expect.objectContaining({ id: 2 }) },
      { kind: "divider", key: "2026-11-04", label: "Вчера" },
      { kind: "card", card: expect.objectContaining({ id: 3 }) },
      { kind: "divider", key: "2026-10-20", label: "20 октября" },
      { kind: "card", card: expect.objectContaining({ id: 4 }) },
    ]);
  });
});
