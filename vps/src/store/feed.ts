/**
 * Read-only queries for the feed, the card detail, and the source filter.
 *
 * Two rules drive every query here and are never recomputed in this module:
 *
 * - a Кластер renders one Карточка; the display fields come from the
 *   representative listing, the available member with the lowest
 *   `published_at`, then the lowest `id`;
 * - a hidden cluster (no available member) is absent from both the feed and
 *   the detail.
 *
 * Timestamps are ISO-8601 UTC strings, so keyset comparisons work on the text
 * form. `search_text` is already normalized by ingestion; the caller passes an
 * already-normalized query. All SQL stays in this directory.
 */

import type { Db } from '../db.js';

import { toPhoto, type ListingPhotoRow } from './rows.js';
import type {
  AccessStatus,
  ListingPhoto,
  MessageStatus,
  Section,
  SourceKind,
} from './types.js';

/** A keyset position: the last row of the previous page. */
export interface FeedCursor {
  earliestPublishedAt: string;
  clusterId: number;
}

export interface FeedFilters {
  section: Section | null;
  category: string | null;
  demand: string | null;
  /** Source ids; a cluster matches when any member belongs to one of them. */
  sourceIds: readonly number[] | null;
  /** Already run through `normalizeSearchQuery`, at least two characters. */
  search: string | null;
}

export interface FeedQuery extends FeedFilters {
  cursor: FeedCursor | null;
  /** 1..50; `0` means count only and is handled by the caller. */
  limit: number;
}

/** One member source of a cluster, for the card's monogram stack. */
export interface ClusterSource {
  sourceId: number;
  username: string;
  title: string | null;
  kind: SourceKind;
  access: AccessStatus;
  firstPublishedAt: string;
}

/** A cluster plus the representative's display fields. */
export interface FeedCardRow {
  clusterId: number;
  section: Section;
  category: string;
  demand: string;
  earliestPublishedAt: string;
  sourceCount: number;
  listingId: number;
  title: string | null;
  priceRaw: string | null;
  priceValue: number | null;
  priceCurrency: string | null;
  pricePeriod: string | null;
  salaryRaw: string | null;
  eventStartsAt: string | null;
  city: string | null;
  photoUrl: string | null;
  photoCount: number;
  sources: ClusterSource[];
}

export interface FeedPage {
  cards: FeedCardRow[];
  total: number;
  updatedAt: string | null;
  nextCursor: FeedCursor | null;
}

/** One member of a cluster, joined with its source row. */
export interface ClusterMember {
  listingId: number;
  sourceId: number;
  url: string;
  messageStatus: MessageStatus;
  publishedAt: string;
  title: string | null;
  sourceUsername: string;
  sourceTitle: string | null;
  sourceKind: SourceKind;
  access: AccessStatus;
}

export interface ClusterDetail {
  clusterId: number;
  section: Section;
  category: string;
  demand: string;
  earliestPublishedAt: string;
  sourceCount: number;
  listingId: number;
  title: string | null;
  textRaw: string;
  city: string | null;
  priceRaw: string | null;
  priceValue: number | null;
  priceCurrency: string | null;
  pricePeriod: string | null;
  salaryRaw: string | null;
  eventStartsAt: string | null;
  publishedAt: string;
  photos: ListingPhoto[];
  members: ClusterMember[];
}

export interface FeedStore {
  feed(query: FeedQuery): FeedPage;
  /** A visible cluster's detail, or null when absent or hidden. */
  detail(clusterId: number): ClusterDetail | null;
  /** Newest `last_success_at` over enabled sources. */
  updatedAt(): string | null;
}

/** The representative join: available member, lowest publication, then lowest id. */
const REPRESENTATIVE_JOIN = `
  JOIN listings rep ON rep.id = (
    SELECT l.id FROM listings l
    WHERE l.cluster_id = c.id AND l.message_status = 'available'
    ORDER BY l.published_at, l.id
    LIMIT 1
  )
`;

const FILTER_COLUMNS = `
  c.id AS cluster_id, c.section, c.category, c.demand, c.earliest_published_at,
  c.source_count,
  rep.id AS listing_id, rep.title, rep.price_raw, rep.price_value,
  rep.price_currency, rep.price_period, rep.salary_raw, rep.event_starts_at,
  rep.city, rep.photo_count
`;

interface FeedRow {
  cluster_id: number;
  section: Section;
  category: string;
  demand: string;
  earliest_published_at: string;
  source_count: number;
  listing_id: number;
  title: string | null;
  price_raw: string | null;
  price_value: number | null;
  price_currency: string | null;
  price_period: string | null;
  salary_raw: string | null;
  event_starts_at: string | null;
  city: string | null;
  photo_count: number;
  photo_url: string | null;
}

interface SourceRow {
  cluster_id: number;
  source_id: number;
  username: string;
  title: string | null;
  kind: SourceKind;
  access_status: AccessStatus;
  first_published_at: string;
}

interface MemberRow {
  listing_id: number;
  source_id: number;
  url: string;
  message_status: MessageStatus;
  published_at: string;
  title: string | null;
  username: string;
  source_title: string | null;
  kind: SourceKind;
  access_status: AccessStatus;
}

interface DetailRow extends FeedRow {
  text_raw: string;
}

interface FilterSql {
  where: string;
  params: Array<string | number>;
}

function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function buildFilters(filters: FeedFilters): FilterSql {
  const conditions = ['c.hidden = 0'];
  const params: Array<string | number> = [];

  if (filters.section !== null) {
    conditions.push('c.section = ?');
    params.push(filters.section);
  }
  if (filters.category !== null) {
    conditions.push('c.category = ?');
    params.push(filters.category);
  }
  if (filters.demand !== null) {
    conditions.push('c.demand = ?');
    params.push(filters.demand);
  }
  if (filters.sourceIds !== null) {
    if (filters.sourceIds.length === 0) {
      // A source filter with no values matches nothing, never everything.
      conditions.push('1 = 0');
    } else {
      const placeholders = filters.sourceIds.map(() => '?').join(', ');
      conditions.push(
        `EXISTS (SELECT 1 FROM listings filter_member
                 WHERE filter_member.cluster_id = c.id
                   AND filter_member.source_id IN (${placeholders}))`,
      );
      params.push(...filters.sourceIds);
    }
  }
  if (filters.search !== null) {
    conditions.push("rep.search_text LIKE ? ESCAPE '\\'");
    params.push(`%${escapeLike(filters.search)}%`);
  }

  return { where: conditions.join(' AND '), params };
}

function toCardSources(rows: SourceRow[]): ClusterSource[] {
  return rows.map((row) => ({
    sourceId: row.source_id,
    username: row.username,
    title: row.title,
    kind: row.kind,
    access: row.access_status,
    firstPublishedAt: row.first_published_at,
  }));
}

export function createFeedStore(db: Db): FeedStore {
  const selectUpdatedAt = db.prepare(
    'SELECT MAX(last_success_at) AS updated_at FROM sources WHERE enabled = 1',
  );

  function sourcesForClusters(clusterIds: readonly number[]): Map<number, ClusterSource[]> {
    const byCluster = new Map<number, ClusterSource[]>();
    if (clusterIds.length === 0) return byCluster;

    const placeholders = clusterIds.map(() => '?').join(', ');
    const rows = db
      .prepare(
        `SELECT l.cluster_id AS cluster_id, s.id AS source_id, s.username, s.title,
                s.kind, s.access_status, MIN(l.published_at) AS first_published_at
         FROM listings l
         JOIN sources s ON s.id = l.source_id
         WHERE l.cluster_id IN (${placeholders})
         GROUP BY l.cluster_id, s.id
         ORDER BY l.cluster_id, first_published_at, s.id`,
      )
      .all(...clusterIds) as SourceRow[];

    for (const row of rows) {
      const list = byCluster.get(row.cluster_id) ?? [];
      list.push(...toCardSources([row]));
      byCluster.set(row.cluster_id, list);
    }
    return byCluster;
  }

  return {
    feed(query: FeedQuery): FeedPage {
      const filters = buildFilters(query);
      const total = (
        db
          .prepare(
            `SELECT COUNT(*) AS total FROM clusters c ${REPRESENTATIVE_JOIN} WHERE ${filters.where}`,
          )
          .get(...filters.params) as { total: number }
      ).total;

      const updatedAt = (
        selectUpdatedAt.get() as { updated_at: string | null }
      ).updated_at;

      if (query.limit <= 0) {
        return { cards: [], total, updatedAt, nextCursor: null };
      }

      const conditions = [filters.where];
      const params: Array<string | number> = [...filters.params];
      if (query.cursor !== null) {
        conditions.push(
          '(c.earliest_published_at < ? OR (c.earliest_published_at = ? AND c.id < ?))',
        );
        params.push(
          query.cursor.earliestPublishedAt,
          query.cursor.earliestPublishedAt,
          query.cursor.clusterId,
        );
      }

      // One extra row tells whether a next page exists without a second count.
      const rows = db
        .prepare(
          `SELECT ${FILTER_COLUMNS}, p.url AS photo_url
           FROM clusters c
           ${REPRESENTATIVE_JOIN}
           LEFT JOIN listing_photos p ON p.listing_id = rep.id AND p.position = 0
           WHERE ${conditions.join(' AND ')}
           ORDER BY c.earliest_published_at DESC, c.id DESC
           LIMIT ?`,
        )
        .all(...params, query.limit + 1) as FeedRow[];

      const hasMore = rows.length > query.limit;
      const page = hasMore ? rows.slice(0, query.limit) : rows;
      const last = page[page.length - 1];
      const nextCursor =
        hasMore && last !== undefined
          ? {
              earliestPublishedAt: last.earliest_published_at,
              clusterId: last.cluster_id,
            }
          : null;

      const sources = sourcesForClusters(page.map((row) => row.cluster_id));

      return {
        cards: page.map((row) => ({
          clusterId: row.cluster_id,
          section: row.section,
          category: row.category,
          demand: row.demand,
          earliestPublishedAt: row.earliest_published_at,
          sourceCount: row.source_count,
          listingId: row.listing_id,
          title: row.title,
          priceRaw: row.price_raw,
          priceValue: row.price_value,
          priceCurrency: row.price_currency,
          pricePeriod: row.price_period,
          salaryRaw: row.salary_raw,
          eventStartsAt: row.event_starts_at,
          city: row.city,
          photoUrl: row.photo_url,
          photoCount: row.photo_count,
          sources: sources.get(row.cluster_id) ?? [],
        })),
        total,
        updatedAt,
        nextCursor,
      };
    },

    detail(clusterId: number): ClusterDetail | null {
      const row = db
        .prepare(
          `SELECT ${FILTER_COLUMNS}, rep.text_raw
           FROM clusters c
           ${REPRESENTATIVE_JOIN}
           WHERE c.id = ? AND c.hidden = 0`,
        )
        .get(clusterId) as DetailRow | undefined;
      if (row === undefined) return null;

      const photos = (
        db
          .prepare(
            `SELECT listing_id, position, url, width, height
             FROM listing_photos WHERE listing_id = ? ORDER BY position`,
          )
          .all(row.listing_id) as ListingPhotoRow[]
      ).map(toPhoto);

      const members = (
        db
          .prepare(
            `SELECT l.id AS listing_id, l.source_id, l.url, l.message_status,
                    l.published_at, l.title, s.username, s.title AS source_title,
                    s.kind, s.access_status
             FROM listings l
             JOIN sources s ON s.id = l.source_id
             WHERE l.cluster_id = ?
             ORDER BY l.published_at, l.id`,
          )
          .all(clusterId) as MemberRow[]
      ).map((member) => ({
        listingId: member.listing_id,
        sourceId: member.source_id,
        url: member.url,
        messageStatus: member.message_status,
        publishedAt: member.published_at,
        title: member.title,
        sourceUsername: member.username,
        sourceTitle: member.source_title,
        sourceKind: member.kind,
        access: member.access_status,
      }));

      return {
        clusterId: row.cluster_id,
        section: row.section,
        category: row.category,
        demand: row.demand,
        earliestPublishedAt: row.earliest_published_at,
        sourceCount: row.source_count,
        listingId: row.listing_id,
        title: row.title,
        textRaw: row.text_raw,
        city: row.city,
        priceRaw: row.price_raw,
        priceValue: row.price_value,
        priceCurrency: row.price_currency,
        pricePeriod: row.price_period,
        salaryRaw: row.salary_raw,
        eventStartsAt: row.event_starts_at,
        publishedAt: row.earliest_published_at,
        photos,
        members,
      };
    },

    updatedAt(): string | null {
      return (selectUpdatedAt.get() as { updated_at: string | null }).updated_at;
    },
  };
}
