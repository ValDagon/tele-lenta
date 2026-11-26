/**
 * Russian pluralization. The caller supplies the three forms in dictionary
 * order: one, few, many.
 *
 *   1 объявление, 2 объявления, 5 объявлений
 */
export function plural(
  count: number,
  forms: readonly [string, string, string],
): string {
  const absolute = Math.abs(Math.trunc(count));
  const lastTwo = absolute % 100;
  const last = absolute % 10;

  if (lastTwo >= 11 && lastTwo <= 14) return forms[2];
  if (last === 1) return forms[0];
  if (last >= 2 && last <= 4) return forms[1];
  return forms[2];
}
