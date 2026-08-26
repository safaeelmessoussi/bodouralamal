import { createHash } from 'node:crypto';

import {
  BUCKETS,
  copyObject,
  deleteObject,
  listObjectsPage,
  statObjectStrict,
  type StorageClients,
} from '../lib/storage.js';
import { quarantineKeyFor } from '../lib/file-types.js';

/** TD-7: an upload capability expires long before abandoned staging is eligible. */
export const UPLOAD_GC_MIN_AGE_MS = 48 * 60 * 60 * 1_000;
export const UPLOAD_GC_PAGE_SIZE = 250;

const UPLOAD_GC_SCOPES = [
  { bucket: BUCKETS.public, prefix: 'staging/content/' },
  { bucket: BUCKETS.private, prefix: 'staging/content/' },
  { bucket: BUCKETS.private, prefix: 'staging/server-finalization/' },
] as const;

export interface UploadGcPayload {
  run_id?: string;
  cutoff?: string;
  scope_index?: number;
  continuation_token?: string;
}

export interface UploadGcPageResult {
  scanned: number;
  deleted: number;
  retained: number;
  bucket: string;
  prefix: string;
  next: UploadGcPayload | null;
}

/** Stable, bounded deduplication for crash/retry overlap in a paginated run. */
export function uploadGcContinuationSingletonKey(payload: UploadGcPayload): string {
  return `upload-gc:${createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex')}`;
}

/**
 * Reaps one bounded page of disposable upload staging (TD-7).
 *
 * Browser PUT capabilities address only `staging/content/` and expire after one
 * hour. Server-finalization attempts use their own unguessable private keys.
 * Neither prefix can ever be a database-authoritative canonical coordinate, so
 * an object strictly older than 48 hours is abandoned rather than content.
 * Provider recording staging is intentionally absent: R100 gives each of those
 * objects an exact retryable ingestion obligation instead of an age sweep.
 */
export async function collectAbandonedUploadPage(
  clients: StorageClients,
  payload: UploadGcPayload,
  jobId: string,
  now = new Date(),
): Promise<UploadGcPageResult> {
  const continuation = normalizeUploadGcPayload(payload, jobId, now);
  const scope = UPLOAD_GC_SCOPES[continuation.scope_index!];
  if (!scope) throw new Error('upload.gc scope is outside the fixed staging catalog');
  const cutoff = new Date(continuation.cutoff!);

  const page = await listObjectsPage(clients, scope.bucket, scope.prefix, {
    maxKeys: UPLOAD_GC_PAGE_SIZE,
    ...(continuation.continuation_token === undefined
      ? {}
      : { continuationToken: continuation.continuation_token }),
  });

  let deleted = 0;
  let retained = 0;
  for (const object of page.objects) {
    // A provider that returns a coordinate outside the requested prefix has
    // violated the boundary. Failing the job is safer than broadening deletion.
    if (!object.key.startsWith(scope.prefix)) {
      throw new Error('storage returned an object outside the upload.gc prefix');
    }
    if (object.lastModified === null || object.lastModified.getTime() >= cutoff.getTime()) {
      retained += 1;
      continue;
    }
    // DeleteObject is idempotent. An ambiguous response is re-thrown so pg-boss
    // retries the same page; an already-completed delete then becomes success.
    await deleteObject(clients, scope.bucket, object.key);
    deleted += 1;
  }

  const next = page.nextContinuationToken
    ? {
        run_id: continuation.run_id,
        cutoff: continuation.cutoff,
        scope_index: continuation.scope_index,
        continuation_token: page.nextContinuationToken,
      }
    : continuation.scope_index! + 1 < UPLOAD_GC_SCOPES.length
      ? {
          run_id: continuation.run_id,
          cutoff: continuation.cutoff,
          scope_index: continuation.scope_index! + 1,
        }
      : null;

  return {
    scanned: page.objects.length,
    deleted,
    retained,
    bucket: scope.bucket,
    prefix: scope.prefix,
    next,
  };
}

function normalizeUploadGcPayload(
  payload: UploadGcPayload,
  jobId: string,
  now: Date,
): Required<Pick<UploadGcPayload, 'run_id' | 'cutoff' | 'scope_index'>> &
  Pick<UploadGcPayload, 'continuation_token'> {
  const empty = Object.keys(payload).length === 0;
  const candidate = empty
    ? {
        run_id: jobId,
        cutoff: new Date(now.getTime() - UPLOAD_GC_MIN_AGE_MS).toISOString(),
        scope_index: 0,
      }
    : payload;
  if (
    typeof candidate.run_id !== 'string' ||
    candidate.run_id.length < 1 ||
    candidate.run_id.length > 100 ||
    typeof candidate.cutoff !== 'string' ||
    !Number.isInteger(candidate.scope_index) ||
    candidate.scope_index! < 0 ||
    candidate.scope_index! >= UPLOAD_GC_SCOPES.length ||
    (candidate.continuation_token !== undefined &&
      (typeof candidate.continuation_token !== 'string' ||
        candidate.continuation_token.length < 1 ||
        candidate.continuation_token.length > 4_096))
  ) {
    throw new Error('upload.gc payload is invalid');
  }
  const cutoff = new Date(candidate.cutoff);
  if (
    Number.isNaN(cutoff.getTime()) ||
    cutoff.getTime() > now.getTime() - UPLOAD_GC_MIN_AGE_MS
  ) {
    throw new Error('upload.gc cutoff may never include staging younger than 48 hours');
  }
  return {
    run_id: candidate.run_id,
    cutoff: cutoff.toISOString(),
    scope_index: candidate.scope_index!,
    ...(candidate.continuation_token === undefined
      ? {}
      : { continuation_token: candidate.continuation_token }),
  };
}

export interface PurgedContentCoordinates {
  contentId: string;
  bucket: string;
  storageKey: string;
}

function assertCanonicalCoordinate(coordinates: PurgedContentCoordinates): void {
  if (
    !Object.values(BUCKETS).includes(
      coordinates.bucket as (typeof BUCKETS)[keyof typeof BUCKETS],
    ) ||
    !coordinates.storageKey.startsWith(`content/${coordinates.contentId}/`)
  ) {
    throw new Error('content.quarantine-purge requires an exact canonical content coordinate');
  }
}

/**
 * Moves one replaced/deleted immutable key into same-bucket quarantine.
 *
 * Copy precedes delete. A retry after an ambiguous delete sees the destination
 * and an absent source and converges; both absent is also terminal because a
 * later manual purge may legitimately have retired them before this stale job.
 * A unique content-id/version key is never reused, so a duplicate job cannot
 * target the replacement's newer canonical coordinate.
 */
export async function quarantineRetiredContentObject(
  clients: StorageClients,
  coordinates: PurgedContentCoordinates,
): Promise<void> {
  assertCanonicalCoordinate(coordinates);
  const destinationKey = quarantineKeyFor(
    coordinates.contentId,
    coordinates.storageKey,
  );
  const [source, existingDestination] = await Promise.all([
    statObjectStrict(clients, coordinates.bucket, coordinates.storageKey),
    statObjectStrict(clients, coordinates.bucket, destinationKey),
  ]);
  if (source === null) return;

  if (existingDestination === null) {
    await copyObject(
      clients,
      { bucket: coordinates.bucket, key: coordinates.storageKey },
      { bucket: coordinates.bucket, key: destinationKey },
      undefined,
      source.etag === null ? {} : { sourceIfMatch: source.etag },
    );
  }
  const destination = await statObjectStrict(
    clients,
    coordinates.bucket,
    destinationKey,
  );
  if (
    destination === null ||
    destination.sizeBytes !== source.sizeBytes ||
    (source.sha256 !== null && destination.sha256 !== source.sha256)
  ) {
    throw new Error(`quarantine copy verification failed for ${coordinates.contentId}`);
  }
  await deleteObject(clients, coordinates.bucket, coordinates.storageKey);
}

/**
 * Fulfils one manual permanent-delete obligation from an exact immutable
 * canonical coordinate. Both possible leftovers are targeted because a soft
 * delete copies canonical → quarantine before deleting canonical; a crash can
 * therefore leave either or both. Failures are never swallowed: pg-boss owns
 * retry and terminal observability after the row and Trash entry are gone.
 */
export async function retirePurgedContentObjects(
  clients: StorageClients,
  coordinates: PurgedContentCoordinates,
): Promise<void> {
  assertCanonicalCoordinate(coordinates);
  await deleteObject(
    clients,
    coordinates.bucket,
    quarantineKeyFor(coordinates.contentId, coordinates.storageKey),
  );
  await deleteObject(clients, coordinates.bucket, coordinates.storageKey);
}
