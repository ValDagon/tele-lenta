/**
 * One row per source message. Membership is `listings.cluster_id`; there is no
 * separate membership table. The store owns the SQL and returns typed rows; it
 * never parses, classifies, or clusters.
 */

import type { Db } from '../db.js';

import {
  LISTING_COLUMNS,
  toListing,
  toPhoto,
  type ListingPhotoRow,
  type ListingRow,
} from './rows.js';
import type {
  Listing,
  ListingPhoto,
  ListingPhotoInput,
  ListingRecheck,
  MessageStatus,
  NewListing,
} from './types.js';

export interface HotWindowQuery {
  /** Only listings published at or after this ISO timestamp. */
  since: string;
  /** Optional upper bound, inclusive. */
  until?: string;
  /** Optional row cap; the tick's request budget sets it. */
  limit?: number;
}

export interface ListingStore {
  find(sourceId: number, messageId: number): Listing | null;
  getById(id: number): Listing | null;
  /** Inserts the listing and its photos in one transaction; returns the new id. */
  insert(input: NewListing): number;
  /** Applies an edit re-check; photos are replaced only when `photos` is provided. */
  updateFromRecheck(id: number, input: ListingRecheck): void;
  setMessageStatus(id: number, status: MessageStatus): void;
  /** Used by the cluster store when an assignment is applied. */
  setCluster(id: number, clusterId: number | null): void;
  /** Available listings inside the 48-hour hot window, oldest first. */
  listHotWindow(query: HotWindowQuery): Listing[];
  listPhotos(listingId: number): ListingPhoto[];
  /** 30-day retention; photo rows cascade. Returns the number of deleted listings. */
  deleteOlderThan(cutoff: string): number;
}

export function createListingStore(db: Db): ListingStore {
  const insertListing = db.prepare(`
    INSERT INTO listings (
      source_id, message_id, url, published_at, edited_at, fetched_at,
      text_raw, text_normalized, search_text, content_hash, title, section,
      category, demand, city, price_raw, price_value, price_currency,
      price_period, salary_raw, event_starts_at, has_photos, photo_count,
      has_video, is_ad, is_spam, cluster_id, message_status, parser_version
    ) VALUES (
      @source_id, @message_id, @url, @published_at, @edited_at, @fetched_at,
      @text_raw, @text_normalized, @search_text, @content_hash, @title, @section,
      @category, @demand, @city, @price_raw, @price_value, @price_currency,
      @price_period, @salary_raw, @event_starts_at, @has_photos, @photo_count,
      @has_video, @is_ad, @is_spam, @cluster_id, @message_status, @parser_version
    )
  `);

  const insertPhoto = db.prepare(
    'INSERT INTO listing_photos (listing_id, position, url, width, height) VALUES (?, ?, ?, ?, ?)',
  );
  const deletePhotos = db.prepare('DELETE FROM listing_photos WHERE listing_id = ?');
  const selectPhotos = db.prepare(
    'SELECT listing_id, position, url, width, height FROM listing_photos WHERE listing_id = ? ORDER BY position',
  );

  const insertWithPhotos = db.transaction(
    (input: NewListing): number => {
      const photos = input.photos ?? [];
      const photoCount = photos.length;
      const result = insertListing.run({
        source_id: input.sourceId,
        message_id: input.messageId,
        url: input.url,
        published_at: input.publishedAt,
        edited_at: input.editedAt ?? null,
        fetched_at: input.fetchedAt,
        text_raw: input.textRaw ?? '',
        text_normalized: input.textNormalized ?? '',
        search_text: input.searchText ?? '',
        content_hash: input.contentHash,
        title: input.title ?? null,
        section: input.section,
        category: input.category,
        demand: input.demand,
        city: input.city ?? null,
        price_raw: input.priceRaw ?? null,
        price_value: input.priceValue ?? null,
        price_currency: input.priceCurrency ?? null,
        price_period: input.pricePeriod ?? null,
        salary_raw: input.salaryRaw ?? null,
        event_starts_at: input.eventStartsAt ?? null,
        has_photos: (input.hasPhotos ?? photoCount > 0) ? 1 : 0,
        photo_count: photoCount,
        has_video: (input.hasVideo ?? false) ? 1 : 0,
        is_ad: (input.isAd ?? false) ? 1 : 0,
        is_spam: (input.isSpam ?? false) ? 1 : 0,
        cluster_id: input.clusterId ?? null,
        message_status: input.messageStatus ?? 'available',
        parser_version: input.parserVersion,
      });

      const listingId = Number(result.lastInsertRowid);
      insertPhotos(listingId, photos);
      return listingId;
    },
  );

  const updateRecheck = db.prepare(`
    UPDATE listings SET
      text_raw = @text_raw,
      text_normalized = @text_normalized,
      search_text = @search_text,
      content_hash = @content_hash,
      edited_at = @edited_at,
      title = @title,
      section = @section,
      category = @category,
      demand = @demand,
      city = @city,
      price_raw = @price_raw,
      price_value = @price_value,
      price_currency = @price_currency,
      price_period = @price_period,
      salary_raw = @salary_raw,
      event_starts_at = @event_starts_at,
      has_photos = @has_photos,
      has_video = @has_video,
      is_ad = @is_ad,
      is_spam = @is_spam,
      fetched_at = @fetched_at
    WHERE id = @id
  `);

  const updateWithPhotos = db.transaction((id: number, input: ListingRecheck): void => {
    updateRecheck.run({
      id,
      text_raw: input.textRaw,
      text_normalized: input.textNormalized,
      search_text: input.searchText,
      content_hash: input.contentHash,
      edited_at: input.editedAt,
      title: input.title,
      section: input.section,
      category: input.category,
      demand: input.demand,
      city: input.city,
      price_raw: input.priceRaw,
      price_value: input.priceValue,
      price_currency: input.priceCurrency,
      price_period: input.pricePeriod,
      salary_raw: input.salaryRaw,
      event_starts_at: input.eventStartsAt,
      has_photos: input.hasPhotos ? 1 : 0,
      has_video: input.hasVideo ? 1 : 0,
      is_ad: input.isAd ? 1 : 0,
      is_spam: input.isSpam ? 1 : 0,
      fetched_at: input.fetchedAt,
    });

    if (input.photos !== undefined) {
      deletePhotos.run(id);
      insertPhotos(id, input.photos);
      db.prepare('UPDATE listings SET photo_count = ? WHERE id = ?').run(input.photos.length, id);
    }
  });

  const updateStatus = db.prepare('UPDATE listings SET message_status = ? WHERE id = ?');
  const updateCluster = db.prepare('UPDATE listings SET cluster_id = ? WHERE id = ?');
  const selectById = db.prepare(`SELECT ${LISTING_COLUMNS} FROM listings WHERE id = ?`);
  const selectBySourceMessage = db.prepare(
    `SELECT ${LISTING_COLUMNS} FROM listings WHERE source_id = ? AND message_id = ?`,
  );
  const deleteOlder = db.prepare('DELETE FROM listings WHERE published_at < ?');

  function insertPhotos(listingId: number, photos: readonly ListingPhotoInput[]): void {
    photos.forEach((photo, position) => {
      insertPhoto.run(listingId, position, photo.url, photo.width ?? null, photo.height ?? null);
    });
  }

  return {
    find(sourceId: number, messageId: number): Listing | null {
      const row = selectBySourceMessage.get(sourceId, messageId) as ListingRow | undefined;
      return row === undefined ? null : toListing(row);
    },
    getById(id: number): Listing | null {
      const row = selectById.get(id) as ListingRow | undefined;
      return row === undefined ? null : toListing(row);
    },
    insert(input: NewListing): number {
      return insertWithPhotos(input);
    },
    updateFromRecheck(id: number, input: ListingRecheck): void {
      updateWithPhotos(id, input);
    },
    setMessageStatus(id: number, status: MessageStatus): void {
      updateStatus.run(status, id);
    },
    setCluster(id: number, clusterId: number | null): void {
      updateCluster.run(clusterId, id);
    },
    listHotWindow({ since, until, limit }: HotWindowQuery): Listing[] {
      const conditions = ['message_status = ?', 'published_at >= ?'];
      const parameters: Array<string | number> = ['available', since];
      if (until !== undefined) {
        conditions.push('published_at <= ?');
        parameters.push(until);
      }

      let sql = `SELECT ${LISTING_COLUMNS} FROM listings WHERE ${conditions.join(' AND ')} ORDER BY published_at, id`;
      if (limit !== undefined) {
        sql += ' LIMIT ?';
        parameters.push(limit);
      }

      return (db.prepare(sql).all(...parameters) as ListingRow[]).map(toListing);
    },
    listPhotos(listingId: number): ListingPhoto[] {
      return (selectPhotos.all(listingId) as ListingPhotoRow[]).map(toPhoto);
    },
    deleteOlderThan(cutoff: string): number {
      return deleteOlder.run(cutoff).changes;
    },
  };
}
