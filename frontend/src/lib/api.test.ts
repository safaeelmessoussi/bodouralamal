import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from './api.js';

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
