import { listObjectsPage, type StorageClients } from "../lib/storage.js";
import { segmentsPrefixFor } from "../policies/online-class.js";

/**
 * **A recording's safety segments, and what their silence means** (SRS Revision
 * 168 §2). No dependency on the recording services, so that both the service
 * that starts a recording and the one that recovers it can ask.
 *
 * ## Silence is the fact
 *
 * A live recorder uploads a segment every ten seconds. The provider cannot be
 * relied on to say a recorder has died: measured on the real stack, a recorder
 * whose container was killed outright was still reported «active» minutes
 * later, with no end in sight. What storage holds does not lie — the newest
 * segment's timestamp is the recorder's last sign of life.
 */

/** `seg_00012.ts` → 12. Anything else under the prefix is not a segment. */
const SEGMENT = /seg_(\d+)\.ts$/;

export interface SegmentInventory {
  keys: string[];
  /** When the newest segment was written — the recorder's last sign of life. */
  newestAt: Date | null;
}

/** Every safety segment of a recording, in playing order. */
export async function listSegments(
  clients: StorageClients,
  bucket: string,
  stagingKey: string,
): Promise<SegmentInventory> {
  const found: { key: string; index: number; at: Date | null }[] = [];
  let token: string | undefined;
  do {
    const page = await listObjectsPage(clients, bucket, segmentsPrefixFor(stagingKey), {
      maxKeys: 1_000,
      ...(token === undefined ? {} : { continuationToken: token }),
    });
    for (const object of page.objects) {
      const match = SEGMENT.exec(object.key);
      if (match) found.push({ key: object.key, index: Number(match[1]), at: object.lastModified });
    }
    token = page.nextContinuationToken ?? undefined;
  } while (token !== undefined);

  found.sort((a, b) => a.index - b.index);
  const newest = found.reduce<Date | null>(
    (latest, s) => (s.at !== null && (latest === null || s.at > latest) ? s.at : latest),
    null,
  );
  return { keys: found.map((s) => s.key), newestAt: newest };
}

/**
 * How long a recorder may say nothing before a مؤطِّرة pressing «بدء التسجيل»
 * is believed over it: nine missed segments. Short, because a class is running
 * and every minute of doubt is a minute not recorded — and safe, because the
 * worst a wrong answer can do is start a second recording beside a live one.
 */
export const RECORDER_SILENT_MS = 90_000;

/**
 * Whether a recording that claims to be live has, by the evidence, stopped.
 * `false` whenever that cannot be established — a recording too young to have
 * delivered anything, or storage that cannot be asked.
 */
export async function recorderHasGoneSilent(
  clients: StorageClients,
  recording: { outputBucket: string | null; outputKey: string | null; startedAt: Date },
  now: Date,
  options: {
    silentMs?: number;
    /**
     * Judge ONLY a recording that has delivered at least one segment. The
     * unattended reconciler must: a recording started before this revision
     * writes no segments at all, and its silence says nothing about it —
     * retiring it would stop a class that is being recorded perfectly well. A
     * مؤطِّرة pressing «بدء التسجيل» need not: she is looking at a room that
     * says nothing is being recorded.
     */
    requireSegments?: boolean;
  } = {},
): Promise<boolean> {
  const silentMs = options.silentMs ?? RECORDER_SILENT_MS;
  if (!recording.outputBucket || !recording.outputKey) return false;
  if (now.getTime() - recording.startedAt.getTime() < silentMs) return false;
  try {
    const inventory = await listSegments(clients, recording.outputBucket, recording.outputKey);
    if (inventory.newestAt === null && options.requireSegments === true) return false;
    const lastSign = inventory.newestAt ?? recording.startedAt;
    return now.getTime() - lastSign.getTime() >= silentMs;
  } catch {
    return false;
  }
}
