import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ParsedMessage } from '../src/parser/telegram-html.js';
import { collapseAlbums } from '../src/ingest/albums.js';

const T0 = Date.parse('2026-11-05T10:00:00.000Z');
const iso = (offsetMs: number): string => new Date(T0 + offsetMs).toISOString();

function message(
  id: number,
  offsetMs: number,
  text = 'Альбомное объявление',
  photos: string[] = ['https://cdn4.telesco.pe/file/a.jpg'],
): ParsedMessage {
  return {
    id,
    text,
    datetime: iso(offsetMs),
    edited: false,
    photos,
    hasVideo: false,
  };
}

describe('collapseAlbums', () => {
  it('collapses same caption and first photo within two minutes onto the lowest id', () => {
    const groups = collapseAlbums([
      message(7, 90_000, 'Альбомное объявление', [
        'https://cdn4.telesco.pe/file/a.jpg',
        'https://cdn4.telesco.pe/file/c.jpg',
      ]),
      message(1, 0, 'Альбомное объявление', [
        'https://cdn4.telesco.pe/file/a.jpg',
        'https://cdn4.telesco.pe/file/b.jpg',
      ]),
      message(3, 45_000, 'альбомное   ОБЪЯВЛЕНИЕ!', [
        'https://cdn4.telesco.pe/file/a.jpg',
      ]),
    ]);

    assert.equal(groups.length, 1);
    const group = groups[0];
    assert.ok(group !== undefined);
    assert.equal(group.survivor.id, 1);
    assert.deepEqual(group.collapsedIds, [3, 7]);
    assert.deepEqual(group.photos, [
      'https://cdn4.telesco.pe/file/a.jpg',
      'https://cdn4.telesco.pe/file/b.jpg',
      'https://cdn4.telesco.pe/file/c.jpg',
    ]);
    assert.deepEqual(group.survivor.photos, group.photos);
  });

  it('collapses image-only album members with the same photo set', () => {
    const photos = ['https://cdn4.telesco.pe/file/a.jpg', 'https://cdn4.telesco.pe/file/b.jpg'];
    const groups = collapseAlbums([message(10, 0, '', photos), message(12, 10_000, '', photos)]);

    assert.equal(groups.length, 1);
    assert.equal(groups[0]?.survivor.id, 10);
    assert.deepEqual(groups[0]?.collapsedIds, [12]);
  });

  it('keeps members outside the two-minute window separate', () => {
    const groups = collapseAlbums([message(1, 0), message(2, 120_001)]);

    assert.equal(groups.length, 2);
    assert.deepEqual(groups.map((group) => group.survivor.id), [1, 2]);
  });

  it('anchors the window on the survivor, not on the previous member', () => {
    // 1 and 3 are two minutes apart, 3 and 5 are also two minutes apart, but 1
    // and 5 are four minutes apart; a chain must not stretch the album.
    const groups = collapseAlbums([message(1, 0), message(3, 120_000), message(5, 240_000)]);

    assert.deepEqual(
      groups.map((group) => [group.survivor.id, group.collapsedIds]),
      [
        [1, [3]],
        [5, []],
      ],
    );
  });

  it('keeps a different first photo separate', () => {
    const groups = collapseAlbums([
      message(1, 0, 'Объявление', ['https://cdn4.telesco.pe/file/a.jpg']),
      message(2, 10_000, 'Объявление', ['https://cdn4.telesco.pe/file/z.jpg']),
    ]);

    assert.equal(groups.length, 2);
  });

  it('keeps different text separate', () => {
    const groups = collapseAlbums([
      message(1, 0, 'Продам диван'),
      message(2, 10_000, 'Продам шкаф'),
    ]);

    assert.equal(groups.length, 2);
  });

  it('never collapses posts without a photo', () => {
    const groups = collapseAlbums([message(1, 0, 'Продам гараж', []), message(2, 0, 'Продам гараж', [])]);

    assert.equal(groups.length, 2);
  });

  it('is order-independent and does not mutate its input', () => {
    const input = [message(3, 30_000), message(1, 0), message(2, 15_000)];
    const snapshot = input.map((item) => ({ ...item, photos: [...item.photos] }));
    Object.freeze(input);

    const forward = collapseAlbums(input);
    const reversed = collapseAlbums([...input].reverse());

    assert.deepEqual(forward, reversed);
    assert.deepEqual(input, snapshot);
    assert.deepEqual(forward[0]?.collapsedIds, [2, 3]);
  });
});
