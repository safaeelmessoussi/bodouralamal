import { describe, expect, it } from 'vitest';
import { Readable } from 'node:stream';

import type { AppConfig } from './config.js';
import { createStorageClients, presignPutUrl } from './storage.js';

describe('browser-body presigning', () => {
  it('does not sign an empty-body checksum for an unknown future PUT body', async () => {
    const clients = createStorageClients({
      MINIO_ENDPOINT: 'http://storage.invalid:9000',
      STORAGE_BASE_URL: 'https://platform.invalid:8443/storage',
      MINIO_ACCESS_KEY: 'fixture-access', MINIO_SECRET_KEY: 'fixture-secret',
    } as AppConfig);
    try {
      const url = new URL(await presignPutUrl(clients, 'public', 'staging/content/fixture.pdf'));
      expect(url.origin).toBe('https://platform.invalid:8443');
      expect(url.pathname).toBe('/storage/public/staging/content/fixture.pdf');
      expect(url.searchParams.has('X-Amz-Signature')).toBe(true);
      expect([...url.searchParams.keys()].some((key) => key.toLowerCase().includes('checksum'))).toBe(false);
      expect(await clients.internal.config.requestChecksumCalculation()).toBe('WHEN_SUPPORTED');
      expect(await clients.singleAttemptInternal.config.maxAttempts()).toBe(1);
      const transportFailure = new Error('synthetic source failure');
      class HashStub {
        update() { /* no bytes reach a completed digest in this case */ }
        reset() { /* required checksum interface */ }
        async digest() { return new Uint8Array(); }
      }
      const broken = Readable.from((async function* () { throw transportFailure; })());
      const nodeHasher = clients.internal.config.streamHasher as (hash: typeof HashStub, stream: Readable) => Promise<Uint8Array>;
      await expect(nodeHasher(HashStub, broken)).rejects.toBe(transportFailure);
    } finally {
      clients.internal.destroy(); clients.singleAttemptInternal.destroy(); clients.publicOrigin.destroy();
    }
  });
});
