/**
 * A source monogram for the card's paper stack: the first letter of the first
 * two words of the display name, uppercased. `montework` → `M`,
 * `Montenegro Market` → `MM`. Works for Cyrillic because the split is by
 * Unicode letters and digits, not ASCII.
 */
export function monogram(name: string, fallback = '?'): string {
  const words = name
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter((word) => word !== '');

  const first = words[0];
  if (first === undefined) return fallback;

  const firstLetter = [...first][0] ?? fallback;
  const second = words[1];
  const secondLetter = second === undefined ? '' : ([...second][0] ?? '');
  return `${firstLetter}${secondLetter}`.toUpperCase();
}
