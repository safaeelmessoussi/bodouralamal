import type {
  Prisma,
  PrismaClient,
  RecordingStatus,
} from "../generated/prisma/client.js";
import { AppError } from "../lib/errors.js";
import type {
  OnlineClassProvider,
  RecordingReport,
} from "../lib/online-class-provider.js";
import type { Actor } from "../policies/actor.js";
import { authorizeJoin } from "./online-class.service.js";
import { roomNameForSession, stagingKeyFor } from "../policies/online-class.js";
import * as audit from "../repositories/audit.repository.js";
import { enqueue, JOB_QUEUES } from "../repositories/jobs.repository.js";

/**
 * **Recording an online class (SRS Revision 99).**
 *
 * ## The rule that shapes every line here: recording is OPTIONAL
 *
 * A class must be able to run start to finish with nothing recorded, and
 * **joining never records** (R99.2). There is therefore no code path anywhere
 * that starts a recording as a side effect of anything: the only way a
 * `SessionRecording` row comes into existence is a person pressing «بدء
 * التسجيل», and if nobody presses it the class leaves no trace here at all.
 *
 * That is why `startRecording` is its own endpoint rather than a flag on the
 * join, and why `readState` answers `null` rather than inventing a row.
 *
 * ## Authorization is R98's, reused rather than restated
 *
 * `authorizeJoin` already resolves *who is this person for this occurrence* —
 * R91 effective staffing, assistant parity, branch-scoped administration, the
 * R92 audience, the §4.3 guardian, the join window, the online-ness of the
 * class. Recording asks exactly one further question of its answer: **is that
 * role allowed to record?** Re-deriving any of it here would be a second
 * implementation of the platform's teaching authority, which is the failure
 * §4.4c names in terms.
 *
 * ## The provider reports; the platform decides
 *
 * R98.1's direction is unchanged. The provider is told to record and told to
 * stop. What it says afterwards is **verified** and then translated into the
 * platform's own `RecordingStatus`; it never writes a state directly, and a
 * callback that does not verify creates nothing (R99.15).
 */

/** Who may press «بدء التسجيل» — R99.3, stated once and asserted below. */
const MAY_RECORD = ["teacher", "assistant", "admin"] as const;

/**
 * **The state machine, written out rather than inferred from a chain of `if`s**
 * (the discipline TD-1 established for `Session`).
 *
 * Absent means prohibited. In particular nothing returns to `recording` once it
 * has left, and the four terminal states accept nothing at all — which is what
 * makes a duplicate callback a no-op instead of a resurrection.
 */
const TRANSITIONS: Record<RecordingStatus, RecordingStatus[]> = {
  /**
   * **`stopping` belongs here**, and its absence was a real defect the tests
   * caught: a مؤطِّرة who presses بدء and immediately changes her mind is
   * stopping a recording the provider has not yet confirmed, which is an
   * ordinary act and not an edge case. Without it the stop silently did
   * nothing and the interface went on showing «جارٍ بدء التسجيل».
   */
  starting: ["recording", "stopping", "processing", "completed", "failed", "aborted"],
  recording: ["stopping", "processing", "completed", "failed", "aborted"],
  stopping: ["processing", "completed", "failed", "aborted"],
  processing: ["completed", "failed"],
  completed: [],
  failed: [],
  aborted: [],
};

/** The states in which a recording is genuinely in flight. Matches the partial
 *  unique index that allows only one of them per occurrence. */
const LIVE: RecordingStatus[] = ["starting", "recording", "stopping"];

export interface RecordingState {
  id: string;
  sessionId: string;
  status: RecordingStatus;
  startedById: string;
  startedAt: Date;
  stoppedAt: Date | null;
  mimeType: string | null;
  /** True while the provider is capturing — what «جاري التسجيل» reports. */
  live: boolean;
  /**
   * **The library item this recording became, or `null`** (R99.13, C2).
   *
   * This single column is what «متاح» means. It is not a second status value
   * because a second value can disagree with the object it describes, and
   * R99.14 is explicit that a content item whose object is absent is worse than
   * an honest failure.
   */
  educationalContentId: string | null;
  /**
   * **Where the recording is from the ASSOCIATION's point of view**, which is
   * not the same question as what the provider is doing (R99.14).
   *
   * `completed` on the provider's side means only that an object exists in a
   * staging bucket. A مؤطِّرة is told «تتم تهيئته للنشر» until the asset is
   * genuinely in Bodour storage, and «متاح» only then.
   */
  availability: RecordingAvailability;
}

/**
 * The six states R99.14 requires the interface to distinguish, **derived** —
 * every one of them is a reading of facts already stored, so none can drift
 * from what is true.
 */
export type RecordingAvailability =
  | "capturing"
  | "processing"
  | "importing"
  | "available"
  | "import_failed"
  | "failed";

function availabilityOf(row: {
  status: RecordingStatus;
  educationalContentId: string | null;
  ingestionFailureReason: string | null;
}): RecordingAvailability {
  if (row.educationalContentId !== null) return "available";
  if (row.status === "failed" || row.status === "aborted") return "failed";
  if (row.status === "completed") {
    // The provider is done and the platform is not. The distinction between
    // *in flight* and *the last attempt was refused* is the difference between
    // waiting and acting, so it is reported rather than collapsed.
    return row.ingestionFailureReason !== null ? "import_failed" : "importing";
  }
  if (row.status === "processing") return "processing";
  return "capturing";
}

const toState = (row: {
  id: string;
  sessionId: string;
  status: RecordingStatus;
  startedById: string;
  startedAt: Date;
  stoppedAt: Date | null;
  mimeType: string | null;
  educationalContentId: string | null;
  ingestionFailureReason: string | null;
}): RecordingState => ({
  id: row.id,
  sessionId: row.sessionId,
  status: row.status,
  startedById: row.startedById,
  startedAt: row.startedAt,
  stoppedAt: row.stoppedAt,
  mimeType: row.mimeType,
  live: LIVE.includes(row.status),
  educationalContentId: row.educationalContentId,
  availability: availabilityOf(row),
});

/* ─────────────────────────────── starting ──────────────────────────────── */

/**
 * **«بدء التسجيل» — the only way a recording ever begins.**
 *
 * Authorization first, provider last: nothing is asked of the recording
 * facility until the platform has decided this person may record this class.
 */
export async function startRecording(
  prisma: PrismaClient,
  provider: OnlineClassProvider | null,
  actor: Actor,
  sessionId: string,
  now: Date = new Date(),
): Promise<RecordingState> {
  // The whole of R98's authorization, unchanged and unrepeated. It also
  // enforces that the occurrence is online, not cancelled, and inside its
  // window — a recording of a class nobody may enter is not a thing to start.
  const authorization = await authorizeJoin(prisma, actor, sessionId, undefined, now);

  if (!(MAY_RECORD as readonly string[]).includes(authorization.role)) {
    /**
     * **A beneficiary, or a guardian acting for one** (R99.3).
     *
     * `FORBIDDEN`, not `404`: she is legitimately in this class and the
     * platform has already told her so by letting her in. Pretending the
     * occurrence does not exist would be a lie she can immediately disprove,
     * and §20 rule 17's concealment is about things outside her reach.
     */
    throw new AppError("FORBIDDEN", "only teaching staff may record a class", {
      reason: "RECORDING_NOT_PERMITTED",
    });
  }

  if (provider === null) {
    throw new AppError(
      "SERVICE_UNAVAILABLE",
      "the online-class provider is not configured",
      { settings: ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"] },
    );
  }

  /**
   * **Already recording is not an error — it is the answer.**
   *
   * Two مؤطِّرات in one class both pressing the button is an ordinary event, and
   * the second one should see «جاري التسجيل», not a refusal. Returning the live
   * recording makes the operation idempotent from the interface's side, and the
   * partial unique index makes it idempotent from the database's even if both
   * requests arrive at the same instant.
   */
  const live = await prisma.sessionRecording.findFirst({
    where: { sessionId, deletedAt: null, status: { in: LIVE } },
    select: SELECT_STATE,
  });
  if (live) return toState(live);

  /**
   * **Two مؤطِّرات pressing the button at the same instant.**
   *
   * The check above is a read, so both requests can pass it. What actually
   * decides is the partial unique index on the live states — one `INSERT`
   * wins and the other is refused — and **the loser must see the recording
   * that won**, not a five-hundred. Catching it here is what turns a database
   * constraint into the idempotent answer the interface promised.
   */
  let created;
  try {
    created = await prisma.sessionRecording.create({
      data: { sessionId, startedById: actor.userId, status: "starting" },
      select: SELECT_STATE,
    });
  } catch (error) {
    const raced = await prisma.sessionRecording.findFirst({
      where: { sessionId, deletedAt: null, status: { in: LIVE } },
      select: SELECT_STATE,
    });
    if (raced) return toState(raced);
    throw error;
  }

  // Declared outside the `try` so the catch can tell "the provider refused"
  // from "the provider accepted and we then failed" — two very different
  // situations with two very different clean-ups.
  let handle: Awaited<ReturnType<OnlineClassProvider["startRecording"]>> | null = null;
  try {
    handle = await provider.startRecording({
      room: roomNameForSession(sessionId),
      media: authorization.mediaMode,
      // The key is the platform's, so an object can always be traced back to
      // the recording that produced it without asking the provider anything.
      // The bucket is the deployment's and comes back on the handle.
      key: stagingKeyFor(sessionId, created.id, authorization.mediaMode),
    });

    const updated = await prisma.sessionRecording.update({
      where: { id: created.id },
      data: {
        providerEgressId: handle.providerEgressId,
        mimeType: handle.mimeType,
        outputBucket: handle.outputBucket,
        outputKey: handle.outputKey,
      },
      select: SELECT_STATE,
    });

    // TD-8 — *who recorded this class* is asked long after everybody has gone.
    await audit.write(prisma, {
      actorUserId: actor.userId,
      ...(actor.activeRole !== undefined ? { activeRole: actor.activeRole } : {}),
      actionType: "session.recording_start",
      targetEntity: "session",
      targetId: sessionId,
      detail: { recording_id: created.id, media_mode: authorization.mediaMode },
    });

    return toState(updated);
  } catch (error) {
    /**
     * **A start that never started is `failed`, not a deleted row.**
     *
     * The row is the record that somebody tried, which is exactly what a
     * مؤطِّرة standing in front of her class needs to be able to report. It also
     * releases the one-live-recording index, so she can try again immediately.
     *
     * **And if the provider actually STARTED before we failed, stop it.**
     *
     * The dangerous case is not the provider refusing — it is the provider
     * accepting and the *database* write failing afterwards. Marking the row
     * failed and walking away would leave a recorder running to the end of the
     * lesson, writing a file nobody is tracking and nobody can stop, whose
     * eventual callback matches no row. So the handle is captured before the
     * write is attempted and the orphan is cancelled here, best-effort: this
     * path is already an error, and failing to clean up must not replace the
     * error a مؤطِّرة needs to see.
     */
    if (handle) {
      try {
        await provider.stopRecording(handle.providerEgressId);
      } catch {
        // Nothing further to try. The row below records the attempt, and the
        // failure reason names the orphan so an operator can find it.
      }
    }
    /**
     * **`updateMany`, because the failure path must not be able to fail.**
     *
     * `update` throws when the row is gone — and the row being gone is one of
     * the very situations that lands here. That threw *out of the catch*, so
     * the مؤطِّرة received a raw database error instead of the refusal this
     * block exists to give her, and the orphan cancellation above was invisible.
     * Matching zero rows is a legitimate outcome here, not an exception.
     */
    await prisma.sessionRecording.updateMany({
      where: { id: created.id },
      data: {
        status: "failed",
        failureReason:
          (handle ? `orphaned egress ${handle.providerEgressId} cancelled: ` : "") +
          String(error).slice(0, 400),
      },
    });
    throw new AppError("SERVICE_UNAVAILABLE", "the recording could not be started", {
      reason: "RECORDING_START_FAILED",
    });
  }
}

/* ─────────────────────────────── stopping ──────────────────────────────── */

/**
 * **«إيقاف التسجيل».**
 *
 * Whoever may start may stop, and **not only the person who started** — a
 * class covered by an assistant must be stoppable by the assistant, and a
 * مؤطِّرة whose connection died must not leave a recording nobody can end
 * (R99.3, R87 §G).
 */
export async function stopRecording(
  prisma: PrismaClient,
  provider: OnlineClassProvider | null,
  actor: Actor,
  sessionId: string,
  now: Date = new Date(),
): Promise<RecordingState> {
  const authorization = await authorizeJoin(prisma, actor, sessionId, undefined, now);
  if (!(MAY_RECORD as readonly string[]).includes(authorization.role)) {
    throw new AppError("FORBIDDEN", "only teaching staff may record a class", {
      reason: "RECORDING_NOT_PERMITTED",
    });
  }

  const live = await prisma.sessionRecording.findFirst({
    where: { sessionId, deletedAt: null, status: { in: LIVE } },
    select: { ...SELECT_STATE, providerEgressId: true },
  });
  // Stopping what is not running is not a failure the interface should have to
  // distinguish: the state she wanted is the state there is.
  if (!live) {
    const last = await prisma.sessionRecording.findFirst({
      where: { sessionId, deletedAt: null },
      orderBy: { startedAt: "desc" },
      select: SELECT_STATE,
    });
    if (!last) {
      throw new AppError("STATE_CONFLICT", "this class is not being recorded", {
        reason: "NOT_RECORDING",
      });
    }
    return toState(last);
  }

  if (provider !== null && live.providerEgressId) {
    try {
      await provider.stopRecording(live.providerEgressId);
    } catch {
      // The provider may have ended it already — a lost race, not a fault. The
      // callback remains the authority on what actually happened.
    }
  }

  const transition = await applyTransition(prisma, live.id, "stopping", {
    stoppedById: actor.userId,
    stoppedAt: new Date(),
  });
  // A refused transition means the provider's own report won the race and the
  // recording has already moved on — report where it actually IS rather than
  // where the request wanted it.
  if (transition === null) {
    const current = await prisma.sessionRecording.findUniqueOrThrow({
      where: { id: live.id },
      select: SELECT_STATE,
    });
    return toState(current);
  }

  await audit.write(prisma, {
    actorUserId: actor.userId,
    ...(actor.activeRole !== undefined ? { activeRole: actor.activeRole } : {}),
    actionType: "session.recording_stop",
    targetEntity: "session",
    targetId: sessionId,
    detail: { recording_id: live.id },
  });

  return transition.state;
}

/* ─────────────────────────────── reading ───────────────────────────────── */

/**
 * **What the classroom asks on every read: is this occurrence being recorded?**
 *
 * `null` when nothing was ever started, which is the ordinary case — a class
 * nobody recorded has no row, and the interface shows no recording state at
 * all rather than «لم يبدأ التسجيل» on every screen.
 *
 * Readable by **anyone who may enter the class**, deliberately: R99.5 requires
 * every participant to see «جاري التسجيل», including a beneficiary and
 * including somebody who arrives after it began. Reading the state is
 * transparency; changing it is the authority above.
 */
export async function readState(
  prisma: PrismaClient,
  actor: Actor,
  sessionId: string,
  activeChildHeader: string | undefined,
  now: Date = new Date(),
): Promise<RecordingState | null> {
  await authorizeJoin(prisma, actor, sessionId, activeChildHeader, now);
  const row = await prisma.sessionRecording.findFirst({
    where: { sessionId, deletedAt: null },
    orderBy: { startedAt: "desc" },
    select: SELECT_STATE,
  });
  return row ? toState(row) : null;
}

/* ────────────────────────── the provider's report ──────────────────────── */

/**
 * **A verified callback, applied idempotently** (R99.15).
 *
 * Three properties, and each is a refusal:
 *
 * 1. **It cannot manufacture content.** The report is matched to a recording
 *    *this platform started*, by the provider job id it was given. An egress id
 *    nobody here has seen is ignored — which is what stops an arbitrary
 *    external request creating anything at all.
 * 2. **Duplicate delivery changes nothing.** The transition table refuses a
 *    move out of a terminal state, so the second delivery of a completion is a
 *    no-op rather than a second file, a second row, or a re-opened recording.
 * 3. **It never skips backwards.** A late `recording` arriving after a
 *    `completed` cannot un-finish the recording.
 */
export async function applyProviderReport(
  prisma: PrismaClient,
  report: RecordingReport,
): Promise<{ applied: boolean; recordingId: string | null; enqueued: boolean }> {
  const existing = await prisma.sessionRecording.findFirst({
    where: { providerEgressId: report.providerEgressId, deletedAt: null },
    select: { id: true, status: true },
  });
  // Not ours. Silently ignored — answering differently would tell an unverified
  // caller which job ids exist.
  if (!existing) return { applied: false, recordingId: null, enqueued: false };

  const data = {
    ...(report.outputKey ? { outputKey: report.outputKey } : {}),
    ...(report.sizeBytes ? { sizeBytes: BigInt(report.sizeBytes) } : {}),
    ...(report.durationMs ? { durationMs: Math.round(report.durationMs) } : {}),
    ...(report.failureReason
      ? { failureReason: report.failureReason.slice(0, 500) }
      : {}),
  };

  /**
   * **The handoff: persist the provider's fact, enqueue the import, return**
   * (R99.13, C2).
   *
   * The callback must not do the import. A 500 MB `CopyObject` inside an HTTP
   * handler holds the request open for as long as the copy takes, and a
   * provider that times out **retries** — so a slow import becomes several
   * concurrent ones, which is the failure mode most likely to produce duplicate
   * content. What happens here is one row update and one row insert.
   *
   * **The enqueue is in the SAME transaction as the status write** (§16.2, §20
   * rule 8, TD-4): if the write rolls back the job must vanish with it, and if
   * it commits the job must be guaranteed. `boss.send()` on its own connection
   * can satisfy neither. TD-16's other half follows for free — with workers
   * down, enqueues keep succeeding and jobs drain on restart.
   *
   * **The singleton key is the recording id**, so a provider delivering the same
   * completion three times leaves **one** pending job. Even without it the
   * worker is idempotent — `educationalContentId` is unique and is checked
   * first — but collapsing the duplicates means three deliveries do not become
   * three concurrent copies racing for the same key.
   */
  const outcome = await prisma.$transaction(async (tx) => {
    const updated = await applyTransition(tx, existing.id, report.state, data);
    if (updated === null) return { applied: false, enqueued: false };

    // Only a completion has anything to import. A `failed` or `aborted` report
    // has no object, and enqueuing for one would make the worker's first act be
    // to discover there is nothing to do.
    //
    // **`moved`, not merely `completed`.** A re-delivered completion finds the
    // row already terminal, which is *success* to the caller and must not be a
    // second job: enqueuing on the state rather than on the edge would queue one
    // import per delivery.
    if (report.state !== "completed" || !updated.moved) {
      return { applied: true, enqueued: false };
    }

    await enqueue(
      tx,
      JOB_QUEUES.sessionRecordingIngest,
      { recording_id: existing.id },
      existing.id,
    );
    return { applied: true, enqueued: true };
  });

  return { ...outcome, recordingId: existing.id };
}

/* ───────────────────────────────── internals ───────────────────────────── */

const SELECT_STATE = {
  id: true,
  sessionId: true,
  status: true,
  startedById: true,
  startedAt: true,
  stoppedAt: true,
  mimeType: true,
  educationalContentId: true,
  ingestionFailureReason: true,
} as const;

/**
 * The single place a recording's status changes, so the transition table is
 * consulted exactly once and cannot be bypassed by a convenient `update`.
 *
 * The guard is expressed **in the `where`**, not read-then-write: two callbacks
 * delivered simultaneously would both pass an in-memory check and both write.
 * Matching on the current status makes the second one update zero rows.
 */
async function applyTransition(
  prisma: PrismaClient | Prisma.TransactionClient,
  id: string,
  next: RecordingStatus,
  data: Record<string, unknown>,
): Promise<TransitionResult | null> {
  const current = await prisma.sessionRecording.findUnique({
    where: { id },
    select: { status: true },
  });
  if (!current) return null;
  if (current.status === next) {
    // Already there. Idempotent, and not an error.
    const row = await prisma.sessionRecording.findUniqueOrThrow({
      where: { id },
      select: SELECT_STATE,
    });
    return { state: toState(row), moved: false };
  }
  if (!TRANSITIONS[current.status].includes(next)) return null;

  const result = await prisma.sessionRecording.updateMany({
    where: { id, status: current.status },
    data: { status: next, ...data },
  });
  if (result.count === 0) return null;

  const row = await prisma.sessionRecording.findUniqueOrThrow({
    where: { id },
    select: SELECT_STATE,
  });
  return { state: toState(row), moved: true };
}

/**
 * **`moved` separates *the row changed* from *it was already there*, and the
 * distinction is load-bearing** (found by the C2 tests).
 *
 * Idempotence made both answers *success*, which is right for the interface —
 * a مؤطِّرة pressing stop twice should see the same state, not an error. It is
 * wrong for the ingestion handoff: a provider re-delivering a completion would
 * enqueue a second import job every time, so a provider that retries ten times
 * would queue ten. The worker is idempotent and no duplicate content could
 * result, but *enqueue only on the edge* is the property, and one that holds
 * only because the thing downstream is forgiving is not a property.
 */
interface TransitionResult {
  state: RecordingState;
  moved: boolean;
}
