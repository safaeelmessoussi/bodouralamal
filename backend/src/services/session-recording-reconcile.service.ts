import type { PrismaClient } from "../generated/prisma/client.js";
import type { OnlineClassProvider, RecordingReport } from "../lib/online-class-provider.js";
import { statObjectStrict, type StorageClients } from "../lib/storage.js";
import { requeueStrandedRecordings } from "./session-recording-ingest.service.js";
import { applyProviderReport } from "./session-recording.service.js";

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
 * What this CANNOT recover is a file that never reached staging: a recorder
 * killed mid-class loses what it had captured. That is prevented, not repaired
 * — see `ops:active-recordings`, which a deployment asks before it restarts
 * anything.
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

const OPEN = ["starting", "recording", "stopping", "processing"] as const;

export interface ReconcileOutcome {
  open: number;
  advanced: number;
  recovered_from_staging: number;
  marked_failed: number;
  provider_unreachable: number;
  stranded: number;
  queued: number;
}

export async function reconcileRecordings(
  prisma: PrismaClient,
  clients: StorageClients,
  provider: OnlineClassProvider | null,
  now: Date = new Date(),
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
    stranded: 0,
    queued: 0,
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

    if (report !== null) {
      const applied = await applyProviderReport(prisma, report);
      if (applied.applied && report.state !== recording.status) outcome.advanced += 1;
      continue;
    }

    // No answer. The file itself is the fact.
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

    const age = now.getTime() - recording.startedAt.getTime();
    if (asked && age > RECONCILE_DEAD_AFTER_MS) {
      const applied = await applyProviderReport(prisma, {
        providerEgressId: egressId,
        state: "failed",
        failureReason:
          "reconciler: the provider no longer knows this recording and nothing reached staging",
      });
      if (applied.applied) outcome.marked_failed += 1;
    }
  }

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
