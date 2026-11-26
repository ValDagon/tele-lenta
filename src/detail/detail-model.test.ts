import { describe, expect, it } from "vitest";

import type { DetailSourceRow } from "../api/types";
import {
  detailPhotoUrl,
  earliestActionableSource,
  galleryIndex,
  galleryLabel,
  galleryPhotos,
  hashtagQuery,
  publishedInLabel,
  sourceAction,
  sourceMetaLabel,
  splitParagraphs,
  tokenizeText,
} from "./detail-model";

const NOW = new Date("2026-11-05T11:00:00.000Z");

function source(overrides: Partial<DetailSourceRow> = {}): DetailSourceRow {
  return {
    listing_id: 1,
    source_id: 1,
    username: "baraholka_Monte",
    name: "Барахолка",
    monogram: "Б",
    message_url: "https://t.me/baraholka_Monte/1",
    access: "public",
    message_status: "available",
    is_first: false,
    published_at: "2026-11-05T09:00:00.000Z",
    ...overrides,
  };
}

describe("paragraphs", () => {
  it("splits on blank lines and keeps single line breaks", () => {
    expect(
      splitParagraphs(
        "Первый абзац.\r\n\r\nВторой\r\nс переносом\r\n\r\n\r\nТретий",
      ),
    ).toEqual(["Первый абзац.", "Второй\nс переносом", "Третий"]);
  });

  it("drops empty paragraphs and trailing spaces", () => {
    expect(splitParagraphs("  \n\nТекст   \nещё  \n\n")).toEqual([
      "Текст\nещё",
    ]);
    expect(splitParagraphs("")).toEqual([]);
  });
});

describe("text tokens", () => {
  it("keeps plain text as one token", () => {
    expect(tokenizeText("Просто строка")).toEqual([
      { kind: "text", text: "Просто строка" },
    ]);
  });

  it("linkifies https and t.me links, and leaves punctuation as text", () => {
    const tokens = tokenizeText("Смотри https://example.com/a, потом t.me/chat/2.");

    expect(tokens).toEqual([
      { kind: "text", text: "Смотри " },
      { kind: "link", text: "https://example.com/a", url: "https://example.com/a" },
      { kind: "text", text: ", потом " },
      { kind: "link", text: "t.me/chat/2", url: "https://t.me/chat/2" },
      { kind: "text", text: "." },
    ]);
  });

  it("turns mentions into t.me links", () => {
    expect(tokenizeText("пиши @user_name")).toEqual([
      { kind: "text", text: "пиши " },
      {
        kind: "mention",
        text: "@user_name",
        url: "https://t.me/user_name",
      },
    ]);
  });

  it("turns hashtags into buttons, including Cyrillic ones", () => {
    expect(tokenizeText("#Недвижимость и #Жильё")).toEqual([
      { kind: "hashtag", text: "#Недвижимость", tag: "#Недвижимость" },
      { kind: "text", text: " и " },
      { kind: "hashtag", text: "#Жильё", tag: "#Жильё" },
    ]);
  });
});

describe("hashtag search handoff", () => {
  it("keeps exactly one leading hash", () => {
    expect(hashtagQuery("#тег")).toBe("#тег");
    expect(hashtagQuery("тег")).toBe("#тег");
    expect(hashtagQuery("  #Тег ")).toBe("#Тег");
    expect(hashtagQuery("###")).toBeNull();
  });
});

describe("gallery", () => {
  it("derives the counter from the snapped scroll offset", () => {
    expect(galleryIndex(0, 300, 5)).toBe(0);
    expect(galleryIndex(310, 300, 5)).toBe(1);
    expect(galleryIndex(9_999, 300, 5)).toBe(4);
    expect(galleryIndex(120, 0, 5)).toBe(0);
  });

  it("labels the counter «1 / N»", () => {
    expect(galleryLabel(0, 5)).toBe("1 / 5");
    expect(galleryLabel(4, 5)).toBe("5 / 5");
  });

  it("keeps only hotlinked Telegram CDN photos", () => {
    expect(detailPhotoUrl("https://cdn4.telesco.pe/file/a.jpg")).toBe(
      "https://cdn4.telesco.pe/file/a.jpg",
    );
    expect(detailPhotoUrl("http://cdn4.telesco.pe/a.jpg")).toBeNull();
    expect(detailPhotoUrl("https://example.com/a.jpg")).toBeNull();

    expect(
      galleryPhotos([
        { url: "https://cdn1.telesco.pe/a.jpg", width: null, height: null },
        { url: "https://example.com/b.jpg", width: 10, height: 10 },
      ]),
    ).toEqual([
      { url: "https://cdn1.telesco.pe/a.jpg", width: null, height: null },
    ]);
  });
});

describe("source status", () => {
  it("maps access and message status to the trail copy", () => {
    expect(sourceAction(source())).toEqual({
      label: "Открыть сообщение",
      actionable: true,
    });
    expect(sourceAction(source({ access: "invite" }))).toEqual({
      label: "Вступить в чат",
      actionable: true,
    });
    expect(sourceAction(source({ access: "closed" }))).toEqual({
      label: "Источник закрыт",
      actionable: false,
    });
    expect(
      sourceAction(source({ message_status: "deleted", access: "invite" })),
    ).toEqual({ label: "Сообщение удалено", actionable: false });
  });

  it("picks the earliest actionable source for the MainButton", () => {
    const sources = [
      source({ listing_id: 1, message_status: "deleted", is_first: true }),
      source({ listing_id: 2, access: "closed" }),
      source({ listing_id: 3, access: "invite" }),
      source({ listing_id: 4 }),
    ];

    expect(earliestActionableSource(sources)?.listing_id).toBe(3);
    expect(
      earliestActionableSource([
        source({ message_status: "deleted" }),
        source({ access: "closed" }),
      ]),
    ).toBeNull();
    expect(earliestActionableSource([])).toBeNull();
  });

  it("marks the absolute earliest source «первым», even when deleted", () => {
    expect(sourceMetaLabel(source({ is_first: true }), NOW)).toBe("первым, 2 ч");
    expect(
      sourceMetaLabel(
        source({ is_first: true, message_status: "deleted" }),
        NOW,
      ),
    ).toBe("первым, 2 ч");
    expect(sourceMetaLabel(source(), NOW)).toBe("2 ч");
  });

  it("pluralizes the cluster line", () => {
    expect(publishedInLabel(1)).toBe("Опубликовано в 1 источнике");
    expect(publishedInLabel(3)).toBe("Опубликовано в 3 источниках");
    expect(publishedInLabel(5)).toBe("Опубликовано в 5 источниках");
  });
});
