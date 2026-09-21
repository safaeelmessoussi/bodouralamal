import type { PrismaClient } from "../generated/prisma/client.js";
import type { OnlineClassProvider, RecordingReport } from "../lib/online-class-provider.js";
import { statObjectStrict, type StorageClients } from "../lib/storage.js";
import { requeueStrandedRecordings } from "./session-recording-ingest.service.js";
import {
  ffmpegAssemble,
  recoverFromSegments,
  type Assembler,
} from "./session-recording-recover.service.js";
import { listSegments, recorderHasGoneSilent } from "./session-recording-segments.js";
import { applyProviderReport, retireSilentRecording } from "./session-recording.service.js";

/**
 * **No recording is ever left behind** (Document Owner, 2026-09-21 — SRS
 * Revision 167 §5: *«it would be catastrophic to record a two-hour class, then
 * lose it»*).
 *
 * A finished recording reaches the library through two hand-offs, and each one
 * used to be attempted a fixed number of times and then never again:
 *
 * 1. **The provider tells the platform the file is ready** — a callback,
 *    delivered a handful of times. An API that was restarting at that moment
 *    never heard it: the row stayed `processing` for ever, the finished file
 *    sat in staging, and the occurrence could not even be recorded again
 *    (one live recording per occurrence).
 * 2. **The platform imports the file** — a job, retried four times (TD-7). A
 *    defect in the import (Revision 166 §4 was one) exhausted the four in a
 *    minute, and a deployed FIX healed nothing until an operator ran a tool.
 *
 * This runs every few minutes and closes both, from the facts rather than from
 * a delivery that may not have happened:
 *
 * - a recording still open after a grace period is **asked about**
 *   (`reportRecording`), and the answer travels the SAME door a callback does
 *   (`applyProviderReport`), so nothing here can do what a callback could not;
 * - where the provider has no answer, **the staging object is the fact**: the
 *   recorder uploads it in one atomic PUT after it has finalised the file, so
 *   an object that exists is a complete recording;
 * - every completed recording that is not yet library content is **re-queued**,
 *   indefinitely. The import is idempotent and the singleton key collapses a
 *   re-queue onto a job that is already waiting.
 *
 * **Nothing here deletes anything.** `upload.gc` does not address the recording
 * staging bucket at all (its scope catalogue is fixed), and the import sweeps a
 * staging object only after the library row and its relation are committed — so
 * a recording that has not been imported still has its file, however long that
 * takes.
 *
 * **A recorder killed mid-class** (SRS Revision 168 §2) no longer loses what it
 * had captured: it uploads ten-second safety segments while the class runs, and
 * where the final file never arrives this assembles them
 * (`recoverFromSegments`) — after the provider has said the recorder gave up,
 * or after the segments have gone quiet. `ops:active-recordings` is still asked
 * before a deployment restarts the recorder: a recovered recording is whole but
 * for its last seconds, and an uninterrupted one is simply whole.
 */

/** A recording this young is left to its callback. */
export const RECONCILE_GRACE_MS = 3 * 60_000;

/**
 * After this long, a recording the provider POSITIVELY no longer knows and that
 * left nothing in staging is recorded as failed — otherwise «جاري التسجيل»
 * would be shown for ever and the occurrence could never be recorded again.
 * Far longer than any class; never applied when the provider could not be asked.
 */
export const RECONCILE_DEAD_AFTER_MS = 24 * 60 * 60_000;

/**
 * **How long a recorder's silence must last before this job acts on it** (SRS
 * Revision 168 §2). A live recorder uploads a segment every ten seconds, so
 * SILENCE is the fact — the provider's word is not (it calls a killed recorder
 * «active»). Ten minutes is sixty missed segments: first to RETIRE a recording
 * still marked live, then, on a later pass, to ASSEMBLE a retired one.
 */
export const SEGMENTS_QUIET_MS = 10 * 60_000;

/** How far back an already-failed recording is still looked at for segments. */
export const RECOVERY_LOOKBACK_MS = 7 * 24 * 60 * 60_000;

const OPEN = ["starting", "recording", "stopping", "processing"] as const;

export interface ReconcileOutcome {
  open: number;
  advanced: number;
  recovered_from_staging: number;
  marked_failed: number;
  provider_unreachable: number;
  /** R168 §2 — still marked live, but silent: taken out of the live states. */
  retired: number;
  /** R168 §2 — assembled from safety segments after the recorder died. */
  recovered_from_segments: number;
  recovery_failed: number;
  stranded: number;
  queued: number;
}

export async function reconcileRecordings(
  prisma: PrismaClient,
  clients: StorageClients,
  provider: OnlineClassProvider | null,
  now: Date = new Date(),
  assemble: Assembler = ffmpegAssemble,
): Promise<ReconcileOutcome> {
  const open = await prisma.sessionRecording.findMany({
    where: {
      status: { in: [...OPEN] },
      deletedAt: null,
      providerEgressId: { not: null },
      startedAt: { lt: new Date(now.getTime() - RECONCILE_GRACE_MS) },
    },
    select: {
      id: true,
      status: true,
      providerEgressId: true,
      outputBucket: true,
      outputKey: true,
      startedAt: true,
    },
    orderBy: { startedAt: "asc" },
  });

  const outcome: ReconcileOutcome = {
    open: open.length,
    advanced: 0,
    recovered_from_staging: 0,
    marked_failed: 0,
    provider_unreachable: 0,
    retired: 0,
    recovered_from_segments: 0,
    recovery_failed: 0,
    stranded: 0,
    queued: 0,
  };

  /**
   * Assembles one recording's segments, if there are any and they have been
   * quiet for `quietMs`. A failure to assemble is counted and written where an
   * operator reads it, and tried again next time — the segments are still
   * there, because nothing deletes them before the import has succeeded.
   */
  const tryRecover = async (
    recording: { id: string; outputBucket: string | null; outputKey: string | null },
    quietMs: number,
  ): Promise<boolean> => {
    if (!recording.outputBucket || !recording.outputKey) return false;
    try {
      const inventory = await listSegments(clients, recording.outputBucket, recording.outputKey);
      if (inventory.keys.length === 0) return false;
      const quietFor = now.getTime() - (inventory.newestAt?.getTime() ?? 0);
      if (quietFor < quietMs) return false;
      const result = await recoverFromSegments(prisma, clients, recording.id, assemble);
      if (result.recovered) outcome.recovered_from_segments += 1;
      return result.recovered;
    } catch (error) {
      outcome.recovery_failed += 1;
      await prisma.sessionRecording.update({
        where: { id: recording.id },
        data: {
          ingestionFailureReason: `recovery from segments failed: ${
            error instanceof Error ? error.message : String(error)
          }`.slice(0, 500),
        },
      });
      return false;
    }
  };

  for (const recording of open) {
    const egressId = recording.providerEgressId!;

    let report: RecordingReport | null = null;
    let asked = false;
    if (provider !== null) {
      try {
        report = await provider.reportRecording(egressId);
        asked = true;
      } catch {
        // Unreachable is not «unknown»: nothing may be concluded from silence.
        outcome.provider_unreachable += 1;
      }
    }

    // The provider says the recorder GAVE UP. What it had already delivered is
    // assembled first — only if there is nothing is the failure recorded. It has
    // said the recorder is finished, so a minute of quiet is enough.
    if (report !== null && (report.state === "failed" || report.state === "aborted")) {
      if (await tryRecover(recording, 60_000)) continue;
      const applied = await applyProviderReport(prisma, report);
      if (applied.applied) outcome.advanced += 1;
      continue;
    }
    if (report !== null && report.state === "completed") {
      const applied = await applyProviderReport(prisma, report);
      if (applied.applied) outcome.advanced += 1;
      continue;
    }

    // From here the provider says the job is running, has no answer, or could
    // not be asked — and none of the three is evidence. Storage is.
    const staged =
      recording.outputBucket && recording.outputKey
        ? await statObjectStrict(clients, recording.outputBucket, recording.outputKey)
        : null;
    if (staged !== null && staged.sizeBytes > 0) {
      const applied = await applyProviderReport(prisma, {
        providerEgressId: egressId,
        state: "completed",
        outputKey: recording.outputKey!,
        sizeBytes: staged.sizeBytes,
      });
      if (applied.applied) outcome.recovered_from_staging += 1;
      continue;
    }

    if (recording.status !== "processing") {
      /**
       * **Still marked live. Is it?** A live recorder uploads a segment every
       * ten seconds, and — measured — the provider goes on answering «active»
       * for a recorder whose container was killed. Ten silent minutes retire
       * the recording: the provider is asked to stop the job (a recorder that
       * was alive after all then delivers its OWN complete file, which always
       * wins), the occurrence is free to be recorded again, and the segments
       * are assembled on a LATER pass — never in the same breath as the doubt.
       */
      if (
        await recorderHasGoneSilent(clients, recording, now, {
          silentMs: SEGMENTS_QUIET_MS,
          requireSegments: true,
        })
      ) {
        if (await retireSilentRecording(prisma, provider, recording.id, now)) outcome.retired += 1;
        continue;
      }
      if (report !== null) {
        const applied = await applyProviderReport(prisma, report);
        if (applied.applied && report.state !== recording.status) outcome.advanced += 1;
        continue;
      }
    } else if (await tryRecover(recording, SEGMENTS_QUIET_MS)) {
      // `processing`: the recording is over and its file is owed — by the
      // provider (finalising) or, for a retired recording, by this job. No file,
      // and the segments quiet for ten minutes: they were assembled.
      continue;
    }

    const age = now.getTime() - recording.startedAt.getTime();
    if (asked && report === null && age > RECONCILE_DEAD_AFTER_MS) {
      const applied = await applyProviderReport(prisma, {
        providerEgressId: egressId,
        state: "failed",
        failureReason:
          "reconciler: the provider no longer knows this recording and nothing reached staging",
      });
      if (applied.applied) outcome.marked_failed += 1;
    }
  }

  // A recording a callback ALREADY declared failed — the webhook usually beats
  // this job to it. The provider has said the recorder is finished, so a minute
  // of quiet is enough.
  const failed = await prisma.sessionRecording.findMany({
    where: {
      status: { in: ["failed", "aborted"] },
      deletedAt: null,
      educationalContentId: null,
      outputKey: { not: null },
      startedAt: { gt: new Date(now.getTime() - RECOVERY_LOOKBACK_MS) },
    },
    select: { id: true, outputBucket: true, outputKey: true },
    orderBy: { startedAt: "asc" },
  });
  for (const recording of failed) await tryRecover(recording, 60_000);

  const requeued = await requeueStrandedRecordings(prisma, { dryRun: false });
  outcome.stranded = requeued.stranded;
  outcome.queued = requeued.queued;
  return outcome;
}

/** What a deployment asks before it restarts the recorder. */
export async function activeRecordings(
  prisma: PrismaClient,
): Promise<{ id: string; session_id: string; status: string; started_at: string }[]> {
  const rows = await prisma.sessionRecording.findMany({
    where: { status: { in: [...OPEN] }, deletedAt: null },
    select: { id: true, sessionId: true, status: true, startedAt: true },
    orderBy: { startedAt: "asc" },
  });
  return rows.map((row) => ({
    id: row.id,
    session_id: row.sessionId,
    status: row.status,
    started_at: row.startedAt.toISOString(),
  }));
}
