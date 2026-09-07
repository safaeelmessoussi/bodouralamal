import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchContentUrl } from './content.js';

afterEach(() => vi.unstubAllGlobals());
describe('the shared content reader', () => {
  it('requests anonymous public files without inventing a credential', async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ url: '/storage/public/current.pdf', expires_in: 600 })));
    vi.stubGlobal('fetch', request);
    expect(await fetchContentUrl('item')).toBe('/storage/public/current.pdf');
    expect(request.mock.calls[0]![1].headers).toEqual({});
  });
  it('preserves both authenticated and guardian request authority', async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ url: '/storage/private/file' })));
    vi.stubGlobal('fetch', request);
    await fetchContentUrl('item', 'token', 'child');
    expect(request.mock.calls[0]![1].headers).toEqual({ Authorization: 'Bearer token', 'X-Active-Child-ID': 'child' });
  });
  it('does not turn an outage into a false unavailable/empty answer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 503 })));
    await expect(fetchContentUrl('item')).rejects.toMatchObject({ status: 503 });
  });
  it('keeps missing and forbidden indistinguishable in the viewer', async () => {
    for (const status of [401, 403, 404]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status })));
      expect(await fetchContentUrl('item')).toBeNull();
    }
  });
});
