import { describe, expect, it } from 'vitest';

import { mapWithConcurrency } from './concurrency.js';

/** R177 §5 — a page of small reads stays under the edge's burst. */
describe('mapWithConcurrency', () => {
  it('never runs more than `limit` at once, and keeps the input order', async () => {
    let running = 0;
    let peak = 0;
    const out = await mapWithConcurrency([5, 1, 4, 2, 3, 6, 7], 3, async (n) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, n));
      running -= 1;
      return n * 10;
    });
    expect(peak).toBeLessThanOrEqual(3);
    expect(out).toEqual([50, 10, 40, 20, 30, 60, 70]);
  });

  it('a failed read fails the whole map — nothing is rendered as an empty answer', async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error('429');
        return n;
      }),
    ).rejects.toThrow('429');
  });

  it('an empty input resolves to an empty list', async () => {
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([]);
  });
});
