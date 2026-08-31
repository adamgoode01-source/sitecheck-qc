/**
 * Collapsing repeated findings into one readable line.
 *
 * A mat where every bar is short of cover used to produce one near-identical
 * paragraph per bar. Forty paragraphs saying the same thing is not a more
 * thorough report — it is an unreadable one, and the reader skims past the
 * single line that mattered.
 *
 * What consolidation must NOT lose:
 *
 *   - WHICH items failed. "Some bars are short" is useless to the person who
 *     has to go fix them, so the indices are preserved and printed compactly.
 *   - HOW MANY failed. The report tally counts occurrences, not findings, so
 *     merging five deficiencies into one line still reads "5 deficiencies".
 *   - The WORST case, which is what decides whether this is a snag or a stop.
 */

/** Below this, individual findings are still perfectly readable — leave them alone. */
export const CONSOLIDATE_THRESHOLD = 3;

/**
 * Compact 1-based range list: `[0,1,2,3,6,11,12,13]` becomes `"1-4, 7, 12-14"`.
 *
 * Runs are collapsed because failures on site cluster — a whole bad section of
 * wall reads as "bays 4-11", which is a thing someone can walk to, whereas
 * eight separate numbers is a thing they have to reconstruct.
 */
export function formatIndexRanges(indices: readonly number[], maxGroups = 8): string {
  const sorted = [...new Set(indices)].sort((a, b) => a - b);
  if (sorted.length === 0) return '';

  const groups: string[] = [];
  let start = sorted[0] as number;
  let previous = start;

  const flush = () => {
    groups.push(start === previous ? `${start + 1}` : `${start + 1}-${previous + 1}`);
  };

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i] as number;
    if (current === previous + 1) {
      previous = current;
      continue;
    }
    flush();
    start = current;
    previous = current;
  }
  flush();

  if (groups.length <= maxGroups) return joinWithAnd(groups);

  const shown = groups.slice(0, maxGroups);
  return `${shown.join(', ')} and ${groups.length - shown.length} more`;
}

/**
 * Names the affected items in the way a person would say it out loud:
 * "every bar", "bars 1-4 and 7", "bar 3".
 */
export function describeAffected(
  indices: readonly number[],
  total: number,
  singular: string,
  plural: string,
): string {
  const unique = new Set(indices).size;

  if (unique === 0) return `no ${plural}`;
  if (unique === 1) return `${singular} ${formatIndexRanges(indices)}`;
  // Calling it "every" is worth the special case: a systemic failure is a
  // different conversation from a handful of bad spots.
  if (unique >= total && total > 0) return `every ${singular}`;

  return `${plural} ${formatIndexRanges(indices)}`;
}

function joinWithAnd(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

export interface Extreme<T> {
  item: T;
  index: number;
}

/**
 * The single worst entry by absolute deviation — the one the report leads
 * with, because it decides the severity of the whole group.
 */
export function worstBy<T>(items: readonly T[], magnitude: (item: T) => number): Extreme<T> | null {
  let best: Extreme<T> | null = null;

  items.forEach((item, index) => {
    const value = Math.abs(magnitude(item));
    if (!best || value > Math.abs(magnitude(best.item))) best = { item, index };
  });

  return best;
}

/** Inclusive min/max of a measured set, for "measured X to Y" phrasing. */
export function rangeOf(values: readonly number[]): { min: number; max: number } | null {
  if (values.length === 0) return null;
  return { min: Math.min(...values), max: Math.max(...values) };
}
