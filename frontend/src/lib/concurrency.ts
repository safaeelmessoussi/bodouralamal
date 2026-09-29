/**
 * **Runs `work` over `items` at most `limit` at a time, keeping order.**
 *
 * R177 §5 (Owner-reported, 2026-09-29): «مقرر الحفظ» read one syllabus per
 * Level with `Promise.all` — every request in the same instant. Past twenty
 * Levels that exceeds the edge's burst (TD-13: 120 r/m, burst 20), so the
 * last reads were answered `429 RATE_LIMITED` and, caught into `[]`, rendered
 * as Levels with no Surahs — a silent wrong answer. A bounded fan-out keeps a
 * page of small reads under the burst without serialising it entirely.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index]!, index);
    }
  });
  await Promise.all(lanes);
  return results;
}
