import {
  CopyObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { describe, expect, it, vi } from 'vitest';

import { quarantineKeyFor } from '../lib/file-types.js';
import { BUCKETS, type StorageClients } from '../lib/storage.js';
import {
  collectAbandonedUploadPage,
  collectExpiredQuarantinePage,
  QUARANTINE_SWEEP_MIN_AGE_MS,
  quarantinedContentId,
  quarantineRetiredContentObject,
  retirePurgedContentObjects,
  UPLOAD_GC_MIN_AGE_MS,
  UPLOAD_GC_PAGE_SIZE,
} from './storage-lifecycle.service.js';

function clients(send: ReturnType<typeof vi.fn>): StorageClients {
  return {
    internal: { send } as never,
    singleAttemptInternal: { send } as never,
    publicOrigin: {} as never,
    storagePrefix: '/storage',
  };
}

describe('upload.gc bounded staging collection', () => {
  it('deletes only objects strictly older than 48 hours and advances the fixed scope catalog', async () => {
    const now = new Date('2026-08-26T12:00:00.000Z');
    const cutoff = new Date(now.getTime() - UPLOAD_GC_MIN_AGE_MS);
    const send = vi.fn(async (command: unknown) => {
      if (command instanceof ListObjectsV2Command) {
        expect(command.input).toMatchObject({
          Bucket: BUCKETS.public,
          Prefix: 'staging/content/',
          MaxKeys: UPLOAD_GC_PAGE_SIZE,
        });
        return {
          Contents: [
            {
              Key: 'staging/content/old/file.pdf',
              LastModified: new Date(cutoff.getTime() - 1),
            },
            { Key: 'staging/content/exact/file.pdf', LastModified: cutoff },
            {
              Key: 'staging/content/young/file.pdf',
              LastModified: new Date(cutoff.getTime() + 1),
            },
            { Key: 'staging/content/unknown/file.pdf' },
          ],
          IsTruncated: false,
        };
      }
      if (command instanceof DeleteObjectCommand) return {};
      throw new Error('unexpected command');
    });

    const result = await collectAbandonedUploadPage(clients(send), {}, 'job-1', now);

    expect(result).toMatchObject({ scanned: 4, deleted: 1, retained: 3 });
    expect(result.next).toEqual({
      run_id: 'job-1',
      cutoff: cutoff.toISOString(),
      scope_index: 1,
    });
    const deletes = send.mock.calls
      .map(([command]) => command)
      .filter((command): command is DeleteObjectCommand => command instanceof DeleteObjectCommand);
    expect(deletes.map((command) => command.input.Key)).toEqual([
      'staging/content/old/file.pdf',
    ]);
  });

  it('continues one bounded page and preserves the run cutoff', async () => {
    const send = vi.fn(async (command: unknown) => {
      if (command instanceof ListObjectsV2Command) {
        expect(command.input.ContinuationToken).toBe('opaque-page-1');
        return { Contents: [], IsTruncated: true, NextContinuationToken: 'opaque-page-2' };
      }
      throw new Error('unexpected command');
    });
    const payload = {
      run_id: 'run-1',
      cutoff: '2026-08-20T00:00:00.000Z',
      scope_index: 2,
      continuation_token: 'opaque-page-1',
    };

    const result = await collectAbandonedUploadPage(
      clients(send),
      payload,
      'follow-up-job',
      new Date('2026-08-26T12:00:00.000Z'),
    );

    expect(result.next).toEqual({
      ...payload,
      continuation_token: 'opaque-page-2',
    });
  });

  it('fails closed on a young cutoff, an out-of-prefix result, or ambiguous delete', async () => {
    const now = new Date('2026-08-26T12:00:00.000Z');
    const noCall = vi.fn();
    await expect(
      collectAbandonedUploadPage(
        clients(noCall),
        { run_id: 'bad', cutoff: now.toISOString(), scope_index: 0 },
        'job',
        now,
      ),
    ).rejects.toThrow(/younger than 48 hours/);
    expect(noCall).not.toHaveBeenCalled();

    const outside = vi.fn(async () => ({
      Contents: [
        { Key: 'content/not-staging/file.pdf', LastModified: new Date('2020-01-01') },
      ],
    }));
    await expect(
      collectAbandonedUploadPage(clients(outside), {}, 'job', now),
    ).rejects.toThrow(/outside the upload.gc prefix/);

    const ambiguous = vi.fn(async (command: unknown) => {
      if (command instanceof ListObjectsV2Command) {
        return {
          Contents: [
            { Key: 'staging/content/old/file.pdf', LastModified: new Date('2020-01-01') },
          ],
        };
      }
      throw new Error('ambiguous storage failure');
    });
    await expect(
      collectAbandonedUploadPage(clients(ambiguous), {}, 'job', now),
    ).rejects.toThrow('ambiguous storage failure');
  });
});

describe('manual content purge exact-key retirement', () => {
  it('quarantines only the exact retired key and converges after an ambiguous delete', async () => {
    const contentId = '00000000-0000-4000-8000-000000000001';
    const storageKey = `content/${contentId}/old/file.pdf`;
    const destinationKey = quarantineKeyFor(contentId, storageKey);
    let sourcePresent = true;
    let destinationPresent = false;
    let ambiguousOnce = true;
    const send = vi.fn(async (command: unknown) => {
      if (command instanceof HeadObjectCommand) {
        const present = command.input.Key === storageKey ? sourcePresent : destinationPresent;
        if (!present) throw { name: 'NotFound', $metadata: { httpStatusCode: 404 } };
        return { ContentLength: 11, ETag: '"etag"', Metadata: { sha256: 'digest' } };
      }
      if (command instanceof CopyObjectCommand) {
        expect(command.input.Key).toBe(destinationKey);
        expect(command.input.CopySource).toContain(storageKey);
        destinationPresent = true;
        return {};
      }
      if (command instanceof DeleteObjectCommand) {
        expect(command.input.Key).toBe(storageKey);
        sourcePresent = false;
        if (ambiguousOnce) {
          ambiguousOnce = false;
          throw new Error('response lost after delete');
        }
        return {};
      }
      throw new Error('unexpected command');
    });
    const coordinates = { contentId, bucket: BUCKETS.private, storageKey };

    await expect(quarantineRetiredContentObject(clients(send), coordinates)).rejects.toThrow(
      'response lost after delete',
    );
    await expect(quarantineRetiredContentObject(clients(send), coordinates)).resolves.toBeUndefined();

    expect(sourcePresent).toBe(false);
    expect(destinationPresent).toBe(true);
    expect(
      send.mock.calls.some(
        ([command]) =>
          command instanceof DeleteObjectCommand && command.input.Key !== storageKey,
      ),
    ).toBe(false);
  });

  it('deletes the immutable quarantine coordinate and exact old canonical coordinate', async () => {
    const contentId = '00000000-0000-4000-8000-000000000001';
    const storageKey = `content/${contentId}/version/file.pdf`;
    const send = vi.fn(async (_command: unknown) => ({}));

    await retirePurgedContentObjects(clients(send), {
      contentId,
      bucket: BUCKETS.private,
      storageKey,
    });

    const keys = send.mock.calls.map(
      ([command]) => (command as DeleteObjectCommand).input.Key,
    );
    expect(keys).toEqual([
      quarantineKeyFor(contentId, storageKey),
      storageKey,
    ]);
  });

  it('rejects non-canonical coordinates before storage and propagates deletion failure', async () => {
    const contentId = '00000000-0000-4000-8000-000000000001';
    const noCall = vi.fn();
    await expect(
      retirePurgedContentObjects(clients(noCall), {
        contentId,
        bucket: BUCKETS.private,
        storageKey: 'staging/content/unsafe/file.pdf',
      }),
    ).rejects.toThrow(/exact canonical/);
    expect(noCall).not.toHaveBeenCalled();

    const failed = vi.fn(async () => {
      throw new Error('storage unavailable');
    });
    await expect(
      retirePurgedContentObjects(clients(failed), {
        contentId,
        bucket: BUCKETS.public,
        storageKey: `content/${contentId}/old/file.pdf`,
      }),
    ).rejects.toThrow('storage unavailable');
    expect(failed).toHaveBeenCalledOnce();
  });
});

/**
 * **`content.quarantine-sweep` — the 90-day destruction the Owner switched on**
 * (SRS Revision 170 §10). The same loop as `upload.gc` — one profile, not a
 * copy — so the tests pin what is DIFFERENT: ninety days, `quarantine/` in both
 * buckets, and that an object still OWED to something is kept however old.
 */
describe('content.quarantine-sweep — ninety days, and never what is still owed', () => {
  const OWED = '11111111-1111-4111-8111-111111111111';
  const FREE = '22222222-2222-4222-8222-222222222222';

  it('deletes only quarantine objects strictly older than 90 days, owed to nobody, of a known shape', async () => {
    const now = new Date('2026-09-22T12:00:00.000Z');
    const cutoff = new Date(now.getTime() - QUARANTINE_SWEEP_MIN_AGE_MS);
    const old = new Date(cutoff.getTime() - 1);
    const send = vi.fn(async (command: unknown) => {
      if (command instanceof ListObjectsV2Command) {
        expect(command.input).toMatchObject({ Bucket: BUCKETS.public, Prefix: 'quarantine/' });
        return {
          Contents: [
            { Key: `quarantine/${FREE}/2026/08/a.pdf`, LastModified: old },
            { Key: `quarantine/${OWED}/2026/08/b.pdf`, LastModified: old },
            { Key: `quarantine/${FREE}/2026/09/young.pdf`, LastModified: new Date(cutoff.getTime() + 1) },
            { Key: `quarantine/${FREE}/2026/09/exact.pdf`, LastModified: cutoff },
            { Key: 'quarantine/not-a-uuid/c.pdf', LastModified: old },
            { Key: 'quarantine/orphan.pdf', LastModified: old },
          ],
          IsTruncated: false,
        };
      }
      if (command instanceof DeleteObjectCommand) return {};
      throw new Error('unexpected command');
    });
    const asked: string[] = [];
    const isOwed = async (contentId: string): Promise<boolean> => {
      asked.push(contentId);
      return contentId === OWED;
    };

    const result = await collectExpiredQuarantinePage(clients(send), {}, 'job-q', isOwed, now);

    expect(result).toMatchObject({ scanned: 6, deleted: 1, retained: 5 });
    // Asked only about objects old enough to go — never about the young ones.
    expect(asked).toEqual([FREE, OWED]);
    expect(result.next).toEqual({ run_id: 'job-q', cutoff: cutoff.toISOString(), scope_index: 1 });
    const deletes = send.mock.calls
      .map(([command]) => command)
      .filter((command): command is DeleteObjectCommand => command instanceof DeleteObjectCommand);
    expect(deletes.map((command) => command.input.Key)).toEqual([`quarantine/${FREE}/2026/08/a.pdf`]);
  });

  it('sweeps the private bucket second, and then stops', async () => {
    const now = new Date('2026-09-22T12:00:00.000Z');
    const cutoff = new Date(now.getTime() - QUARANTINE_SWEEP_MIN_AGE_MS).toISOString();
    const send = vi.fn(async (command: unknown) => {
      if (command instanceof ListObjectsV2Command) {
        expect(command.input).toMatchObject({ Bucket: BUCKETS.private, Prefix: 'quarantine/' });
        return { Contents: [], IsTruncated: false };
      }
      throw new Error('unexpected command');
    });
    const result = await collectExpiredQuarantinePage(
      clients(send),
      { run_id: 'job-q', cutoff, scope_index: 1 },
      'job-q2',
      async () => false,
      now,
    );
    expect(result).toMatchObject({ scanned: 0, deleted: 0, next: null, bucket: BUCKETS.private });
  });

  it('refuses a cutoff younger than 90 days — a payload cannot shorten the window', async () => {
    const now = new Date('2026-09-22T12:00:00.000Z');
    const send = vi.fn(async () => ({ Contents: [], IsTruncated: false }));
    await expect(
      collectExpiredQuarantinePage(
        clients(send),
        { run_id: 'job-q', cutoff: new Date(now.getTime() - 24 * 60 * 60 * 1_000).toISOString(), scope_index: 0 },
        'job-q3',
        async () => false,
        now,
      ),
    ).rejects.toThrow('younger than 90 days');
    expect(send).not.toHaveBeenCalled();
  });

  it('reads the content id only from `quarantine/<uuid>/…`', () => {
    expect(quarantinedContentId(`quarantine/${FREE}/2026/08/a.pdf`)).toBe(FREE);
    expect(quarantinedContentId('quarantine/not-a-uuid/c.pdf')).toBeNull();
    expect(quarantinedContentId(`content/${FREE}/a.pdf`)).toBeNull();
    expect(quarantinedContentId('quarantine/')).toBeNull();
  });
});
