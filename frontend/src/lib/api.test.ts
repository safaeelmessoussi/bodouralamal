import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from './api.js';
import { onAccessTokenRefreshed, resetTokenRefreshForTests } from './token-refresh.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('refresh-cookie authenticated requests (R101)', () => {
  it('adds the CSRF custom header without exposing a credential to JavaScript', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(null, { status: 204 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await api('/auth/logout', { method: 'POST', refreshCookieAuth: true });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/v1/auth/logout');
    expect(init?.credentials).toBe('same-origin');
    expect(init?.headers).toMatchObject({
      'X-Requested-With': 'XMLHttpRequest',
    });
    expect(JSON.stringify(init)).not.toContain('bodour_refresh');
  });

  it('does not add the header to ordinary bearer requests', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(null, { status: 204 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await api('/ordinary', { method: 'POST', token: 'access-token' });

    const init = fetchMock.mock.calls[0]![1];
    expect(init?.headers).not.toHaveProperty('X-Requested-With');
  });
});

describe('R172 §5 — an expired access token is renewed and the request made once more', () => {
  afterEach(() => {
    resetTokenRefreshForTests();
    vi.unstubAllGlobals();
  });

  it('retries a 401 to a bearer request once, with the refreshed token, and tells subscribers', async () => {
    const seen: string[] = [];
    onAccessTokenRefreshed((token) => seen.push(token));
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/auth/refresh')) {
        return new Response(JSON.stringify({ access_token: 'fresh', active_role: null }), { status: 200 });
      }
      const auth = new Headers(init?.headers).get('Authorization');
      if (auth === 'Bearer stale') {
        return new Response(JSON.stringify({ error: { code: 'UNAUTHENTICATED' } }), { status: 401 });
      }
      return new Response(JSON.stringify({ data: 'ok' }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await api<{ data: string }>('/things', { token: 'stale' });
    expect(result).toEqual({ data: 'ok' });
    expect(seen).toEqual(['fresh']);
    const urls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(urls).toEqual(['/api/v1/things', '/api/v1/auth/refresh', '/api/v1/things']);
    expect(new Headers(fetchMock.mock.calls[2]![1]?.headers).get('Authorization')).toBe('Bearer fresh');
  });

  it('a session that is genuinely over keeps its 401 — no token, no retry', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      if (String(input).endsWith('/auth/refresh')) return new Response('', { status: 401 });
      return new Response(JSON.stringify({ error: { code: 'UNAUTHENTICATED' } }), { status: 401 });
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(api('/things', { token: 'stale' })).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never renews for a request that carried no bearer (the anonymous surfaces)', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ error: { code: 'UNAUTHENTICATED' } }), { status: 401 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(api('/things')).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

describe('R178 §3; R214 — a rate-limited READ is retried twice after the edge’s pause', () => {
  const limited = () =>
    new Response(JSON.stringify({ error: { code: 'RATE_LIMITED', message_key: 'errors.rate_limited', message: '', details: {}, request_id: 'r1' } }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': '1' },
    });

  it('waits Retry-After, then succeeds on the second attempt', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(limited())
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: 'ok' }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const promise = api<{ data: string }>('/library', { token: 't' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(await promise).toEqual({ data: 'ok' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('never repeats a refused WRITE, and a third refusal on a read is answered', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(limited());
    vi.stubGlobal('fetch', fetchMock);
    const write = api('/events', { token: 't', method: 'POST', body: {} });
    await expect(write).rejects.toMatchObject({ status: 429 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const read = api('/library', { token: 't' });
    // Attached before the clock moves, so the rejection is awaited, never unhandled.
    const refused = expect(read).rejects.toMatchObject({ status: 429 });
    // R214 — 1 s, then 2 s: the second wait is longer.
    await vi.advanceTimersByTimeAsync(3000);
    await refused;
    expect(fetchMock).toHaveBeenCalledTimes(4);
    vi.useRealTimers();
  });
});
