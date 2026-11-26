/**
 * Maps store rows to the wire card shape. Slots that have no data are omitted
 * rather than filled with placeholders, and the price/salary/event choice
 * follows the section so a job card never shows a bare price.
 */

import { extractHashtags } from '../ingest/text.js';
import type { ClusterDetail, ClusterSource, FeedCardRow } from '../store/feed.js';

import { monogram } from './monogram.js';
import type {
  Card,
  CardDetail,
  CardPhoto,
  CardSourceSummary,
  DetailSourceRow,
  MoneySlot,
} from './types.js';

function moneySlot(
  raw: string | null,
  value: number | null,
  currency: string | null,
  period: string | null,
): MoneySlot | null {
  if (raw === null) return null;
  return { raw, value, currency, period };
}

function sourceSummary(source: ClusterSource): CardSourceSummary {
  const name = source.title ?? source.username;
  return {
    id: source.sourceId,
    username: source.username,
    name,
    monogram: monogram(name),
  };
}

type CardFields = Pick<
  FeedCardRow,
  | 'clusterId'
  | 'section'
  | 'category'
  | 'demand'
  | 'title'
  | 'city'
  | 'earliestPublishedAt'
  | 'priceRaw'
  | 'priceValue'
  | 'priceCurrency'
  | 'pricePeriod'
  | 'salaryRaw'
  | 'eventStartsAt'
  | 'photoUrl'
  | 'photoCount'
>;

/** Shared card body: everything except the source trail. */
function cardFields(row: CardFields): Omit<Card, 'sources' | 'source_count'> {
  const card: Omit<Card, 'sources' | 'source_count'> = {
    id: row.clusterId,
    section: row.section,
    category: row.category,
    demand: row.demand,
    title: row.title ?? '',
    earliest_published_at: row.earliestPublishedAt,
  };

  if (row.city !== null) card.city = row.city;

  const price = moneySlot(
    row.priceRaw,
    row.priceValue,
    row.priceCurrency,
    row.pricePeriod,
  );
  const salary = moneySlot(row.salaryRaw, row.priceValue, row.priceCurrency, row.pricePeriod);

  if (row.section === 'events' && row.eventStartsAt !== null) {
    card.event = { starts_at: row.eventStartsAt };
  } else if (row.section === 'jobs' && salary !== null) {
    card.salary = salary;
  } else if (price !== null) {
    card.price = price;
  }

  if (row.photoUrl !== null && row.photoCount > 0) {
    card.photo = { url: row.photoUrl, count: row.photoCount };
  }

  return card;
}

export function toCard(row: FeedCardRow): Card {
  return {
    ...cardFields(row),
    sources: row.sources.slice(0, 3).map(sourceSummary),
    source_count: row.sourceCount,
  };
}

export function toCardDetail(row: ClusterDetail): CardDetail {
  const photos: CardPhoto[] = row.photos.map((photo) => ({
    url: photo.url,
    width: photo.width,
    height: photo.height,
  }));

  const sources: DetailSourceRow[] = row.members.map((member, index) => {
    const name = member.sourceTitle ?? member.sourceUsername;
    return {
      listing_id: member.listingId,
      source_id: member.sourceId,
      username: member.sourceUsername,
      name,
      monogram: monogram(name),
      message_url: member.url,
      access: member.access,
      message_status: member.messageStatus,
      // The trail is ordered by published_at, then id, so the first row is the
      // absolute earliest member even when that message was deleted.
      is_first: index === 0,
      published_at: member.publishedAt,
    };
  });

  return {
    ...cardFields({
      ...row,
      photoUrl: photos[0]?.url ?? null,
      photoCount: photos.length,
      // The detail card's price/salary/event choice comes from the
      // representative, same as the feed card.
    }),
    body: row.textRaw,
    // The classifier's `text_normalized` strips `#`, so hashtags are derived
    // from the raw post text at read time and never stored.
    hashtags: extractHashtags(row.textRaw),
    photos,
    sources,
    source_count: row.sourceCount,
  };
}
