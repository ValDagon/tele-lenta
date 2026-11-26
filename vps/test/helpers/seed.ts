/**
 * Fixture builders for the read-API tests. They write real rows through the
 * store: a cluster row is computed from its member seeds exactly as the
 * clusterer would (earliest over all members, representative over available
 * ones), then the listings are inserted with their photos.
 */

import type { Db } from '../../src/db.js';
import type {
  AccessStatus,
  MessageStatus,
  Section,
  SourceKind,
  Store,
} from '../../src/store/index.js';

export interface SeedSourceOptions {
  username: string;
  title?: string | null;
  kind?: SourceKind;
  sectionHint?: Section;
  categoryHint?: string | null;
  enabled?: boolean;
  accessStatus?: AccessStatus;
  lastSuccessAt?: string | null;
}

export function seedSource(db: Db, options: SeedSourceOptions): number {
  const result = db
    .prepare(
      `INSERT INTO sources
         (username, title, kind, section_hint, category_hint, enabled,
          access_status, last_success_at, cursor_message_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    )
    .run(
      options.username,
      options.title ?? null,
      options.kind ?? 'group',
      options.sectionHint ?? 'classifieds',
      options.categoryHint ?? null,
      (options.enabled ?? true) ? 1 : 0,
      options.accessStatus ?? 'public',
      options.lastSuccessAt ?? null,
    );
  return Number(result.lastInsertRowid);
}

export interface SeedMemberOptions {
  sourceId: number;
  messageId: number;
  publishedAt: string;
  messageStatus?: MessageStatus;
  title?: string | null;
  textRaw?: string;
  textNormalized?: string;
  searchText?: string;
  section?: Section;
  category?: string;
  demand?: string;
  city?: string | null;
  priceRaw?: string | null;
  priceValue?: number | null;
  priceCurrency?: string | null;
  pricePeriod?: string | null;
  salaryRaw?: string | null;
  eventStartsAt?: string | null;
  photos?: ReadonlyArray<{ url: string; width?: number | null; height?: number | null }>;
}

/**
 * Inserts one cluster. Member order is insertion order, which is also the id
 * order used to break ties in the representative rule.
 */
export function seedCluster(
  db: Db,
  store: Store,
  members: readonly SeedMemberOptions[],
): number {
  if (members.length === 0) throw new Error('a seeded cluster needs at least one member');

  const indexed = members.map((member, index) => ({ member, index }));
  const byPublication = [...indexed].sort((a, b) => {
    const difference = Date.parse(a.member.publishedAt) - Date.parse(b.member.publishedAt);
    return difference !== 0 ? difference : a.index - b.index;
  });

  const earliest = byPublication[0];
  if (earliest === undefined) throw new Error('a seeded cluster needs at least one member');

  const available = byPublication.filter(
    ({ member }) => (member.messageStatus ?? 'available') === 'available',
  );
  const representative = available[0] ?? earliest;
  const hidden = available.length === 0;
  const facetSource = representative.member;

  const sourceCount = new Set(members.map((member) => member.sourceId)).size;

  const result = db
    .prepare(
      `INSERT INTO clusters
         (cluster_key, section, category, demand, earliest_published_at,
          first_seen_at, listing_count, source_count, available_listing_count, hidden)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      `key-${earliest.member.messageId}`,
      facetSource.section ?? 'classifieds',
      facetSource.category ?? 'other',
      facetSource.demand ?? 'offer',
      earliest.member.publishedAt,
      earliest.member.publishedAt,
      members.length,
      sourceCount,
      available.length,
      hidden ? 1 : 0,
    );

  const clusterId = Number(result.lastInsertRowid);

  for (const member of members) {
    store.listings.insert({
      sourceId: member.sourceId,
      messageId: member.messageId,
      url: `https://t.me/source/${member.messageId}`,
      publishedAt: member.publishedAt,
      fetchedAt: member.publishedAt,
      textRaw: member.textRaw ?? 'Текст объявления',
      textNormalized: member.textNormalized ?? 'текст объявления',
      searchText: member.searchText ?? 'текст объявления',
      contentHash: `hash-${member.sourceId}-${member.messageId}`,
      title: member.title ?? 'Объявление',
      section: member.section ?? 'classifieds',
      category: member.category ?? 'other',
      demand: member.demand ?? 'offer',
      city: member.city ?? null,
      priceRaw: member.priceRaw ?? null,
      priceValue: member.priceValue ?? null,
      priceCurrency: member.priceCurrency ?? null,
      pricePeriod: member.pricePeriod ?? null,
      salaryRaw: member.salaryRaw ?? null,
      eventStartsAt: member.eventStartsAt ?? null,
      clusterId,
      messageStatus: member.messageStatus ?? 'available',
      parserVersion: 'test-1',
      photos: member.photos ?? [],
    });
  }

  return clusterId;
}
