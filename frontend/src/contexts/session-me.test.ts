import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchMe } from './session.js';

/** R214 — a `/me` refused for being too quick is asked again, never read as «not signed in». */
describe('fetchMe', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  const status = (code: number) => new Response('{}', { status: code, headers: { 'Retry-After': '1' } });

  it('waits out a 429 and returns the real answer', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(status(429)).mockResolvedValueOnce(status(200));
    vi.stubGlobal('fetch', fetchMock);
    const pending = fetchMe('t');
    await vi.advanceTimersByTimeAsync(1000);
    expect((await pending).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('takes a 401 as the answer at once', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(status(401));
    vi.stubGlobal('fetch', fetchMock);
    expect((await fetchMe('t')).status).toBe(401);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
