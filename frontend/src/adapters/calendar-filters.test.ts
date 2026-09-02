import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

/**
 * **الجدول الزمني's النوع and المادة controls did nothing** (UAT, 2026-09-02).
 *
 * Not a failing request — the parameters never left the browser. `/calendar`'s
 * builder set three filters and dropped `type` and `subject_id`, which the page
 * computed and the server accepts. A filter that is neither sent nor refused is
 * indistinguishable from one that matches everything, which is exactly how it
 * was reported: the control moves and the results do not.
 *
 * Asserted on the URL, because the URL is the thing that was wrong.
 */
const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ data: [], prefilled_filters: null }),
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const urlOf = (): string => String(fetchMock.mock.calls[0]?.[0] ?? '');

const RANGE = { from: '2026-09-01', to: '2026-09-30', token: null };

describe('the public calendar read sends every filter it is given', () => {
  it('carries النوع as `type` and المادة as `subject_id`', async () => {
    const { fetchOccurrences } = await import('./calendar.js');
    await fetchOccurrences({ ...RANGE, kind: 'exam', subjectId: 'subject-1' });
    const url = urlOf();
    expect(url).toContain('type=exam');
    expect(url).toContain('subject_id=subject-1');
  });

  it('still carries the three that already worked', async () => {
    const { fetchOccurrences } = await import('./calendar.js');
    await fetchOccurrences({
      ...RANGE,
      branchId: 'b1',
      categoryId: 'c1',
      levelId: 'l1',
    });
    const url = urlOf();
    expect(url).toContain('branch_id=b1');
    expect(url).toContain('category_id=c1');
    expect(url).toContain('level_id=l1');
  });

  it('OMITS a cleared filter rather than sending it empty', async () => {
    // Clearing must widen the result set, not narrow it to rows whose subject
    // is the empty string — TD-10's rule that an unanswered filter narrows
    // nothing.
    const { fetchOccurrences } = await import('./calendar.js');
    await fetchOccurrences({ ...RANGE, subjectId: null, kind: null });
    const url = urlOf();
    expect(url).not.toContain('subject_id');
    expect(url).not.toContain('type=');
  });

  it('the personal read sends the same set, each parameter exactly once', async () => {
    // Its builder set four parameters twice — harmless only because `set` is
    // idempotent, and a sign the two lists were maintained by hand.
    const { fetchMyOccurrences } = await import('./calendar.js');
    await fetchMyOccurrences({
      ...RANGE,
      subjectId: 's1',
      groupId: 'g1',
      circleId: 'tg1',
      kind: 'session',
    });
    const url = urlOf();
    for (const key of ['subject_id', 'administrative_group_id', 'teaching_group_id', 'type']) {
      expect(url.split(`${key}=`).length - 1, `${key} appears once`).toBe(1);
    }
  });
});
