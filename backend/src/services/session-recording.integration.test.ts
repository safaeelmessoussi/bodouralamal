import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { loadConfig } from "../lib/config.js";
import { createPrismaClient, TEST_CONNECTION_LIMIT } from "../lib/prisma.js";
import type { RoleScope } from "../policies/branch-scope.js";
import type { Actor } from "../policies/actor.js";
import type {
  JoinCredentialRequest,
  OnlineClassProvider,
  RecordingHandle,
  RecordingRequest,
} from "../lib/online-class-provider.js";
import {
  applyProviderReport,
  readState,
  startRecording,
  stopRecording,
} from "./session-recording.service.js";
import { createLevel } from "./level.service.js";
import { createCourseSchedule } from "./course-schedule.service.js";
import { roomNameForSession, stagingKeyFor } from "../policies/online-class.js";
import { recordingCommandSchema } from "../validators/session.validators.js";

/**
 * **SRS Revision 99 — recording an online class.**
 *
 * The properties this suite exists for, each written against the reason it
 * matters rather than the code that currently implements it:
 *
 * 1. **Recording is OPTIONAL.** A class that ran and ended with nobody pressing
 *    the button leaves **no row at all** — asserted directly, because the
 *    tempting implementation starts one on join and the difference is invisible
 *    until somebody audits the table.
 * 2. **A beneficiary can never record**, and neither can a guardian acting for
 *    one, and neither can a مؤطِّرة who does not staff this occurrence.
 * 3. **Assistant parity** — R87 §G, at the recording controls as at the door.
 * 4. **A duplicate provider callback changes nothing.** Delivered twice, three
 *    times, out of order, or naming a job this platform never started.
 * 5. **The format follows the class** (R99.7) and the client cannot name it.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const TAG = "[recording-r99]";

const CLASS_DATE = "2026-06-09";
const DURING = new Date(`${CLASS_DATE}T15:30:00+01:00`);
const NOW = new Date("2026-06-01T08:00:00.000Z");

const at = (hh: number, mm = 0): Date => new Date(Date.UTC(1970, 0, 1, hh, mm, 0));
const day = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

let adminId: string;
let categoryId: string;
let branchA: string;
let branchB: string;
let levelId: string;
let subjectVideo: string;
let subjectAudio: string;
let academicYearId: string;

const actorOf = (userId: string, scopes: RoleScope[]): Actor => ({
  userId,
  roles: scopes.map((s) => s.role),
  roleScopes: scopes,
});
const superAdmin = (): Actor => actorOf(adminId, [{ role: "super_admin", branches: null }]);

async function failure(
  run: () => Promise<unknown>,
): Promise<{ code?: string; details?: Record<string, unknown> }> {
  try {
    await run();
    return {};
  } catch (e) {
    return e as { code?: string; details?: Record<string, unknown> };
  }
}

/**
 * **A provider that records what it was TOLD**, so the assertions are about the
 * platform's instruction rather than about a media server's behaviour. The real
 * Egress path — an actual file, actually produced — is
 * `verify-livekit-recording`, which is where a fake could not stand in.
 */
class FakeProvider implements OnlineClassProvider {
  started: RecordingRequest[] = [];
  stopped: string[] = [];
  nextId = "EG_fake_1";
  failStart = false;

  issueJoinCredentials(request: JoinCredentialRequest) {
    return Promise.resolve({
      url: "wss://example.invalid",
      token: "fake",
      expiresAt: new Date(Date.now() + request.ttlSeconds * 1000),
    });
  }
  startRecording(request: RecordingRequest): Promise<RecordingHandle> {
    if (this.failStart) return Promise.reject(new Error("provider refused"));
    this.started.push(request);
    return Promise.resolve({
      providerEgressId: this.nextId,
      mimeType: request.media === "audio_only" ? "audio/ogg" : "video/mp4",
      outputBucket: "recordings-staging",
      outputKey: request.key,
    });
  }
  stopRecording(id: string): Promise<void> {
    this.stopped.push(id);
    return Promise.resolve();
  }
  verifyCallback(): Promise<null> {
    return Promise.resolve(null);
  }
}

/* ── Fixture ─────────────────────────────────────────────────────────────── */

async function person(
  label: string,
  roles: { role: string; branchId: string | null }[] = [],
): Promise<string> {
  const user = await prisma.user.create({
    data: { sex: "female", nameArabic: `${TAG} ${label}`, accountStatus: "active" },
  });
  for (const a of roles) {
    const role = await prisma.role.findFirstOrThrow({
      where: { name: a.role },
      select: { id: true },
    });
    await prisma.userBranchRole.create({
      data: { userId: user.id, roleId: role.id, branchId: a.branchId },
    });
  }
  return user.id;
}

async function onlineClass(
  media: "audio_video" | "audio_only",
  subjectId: string,
  /** Always CLASS_DATE's own weekday. Two online classes at one hour cannot
   *  collide — an online occurrence holds no room (R97.5) — and each test
   *  gives them different staff, so there is no staff-time conflict either. */
  weekday: string,
): Promise<{ scheduleId: string; sessionId: string }> {
  const { id } = await createCourseSchedule(
    prisma,
    superAdmin(),
    {
      title: `${TAG} ${media}`,
      subjectId,
      teachingMode: "entire_level",
      targetId: levelId,
      branchId: branchA,
      roomId: null,
      startTime: at(15),
      endTime: at(17),
      recurrence: "weekly",
      weekdays: [weekday],
      academicYearId,
      staff: [],
      deliveryMode: "online",
      onlineMediaMode: media,
    } as never,
    NOW,
  );
  const session = await prisma.session.findFirstOrThrow({
    where: { scheduleId: id, date: day(CLASS_DATE) },
    select: { id: true },
  });
  return { scheduleId: id, sessionId: session.id };
}

async function staff(
  scheduleId: string,
  userId: string,
  position: "teacher" | "assistant",
): Promise<void> {
  await prisma.courseScheduleStaff.create({
    data: { scheduleId, userId, position },
  });
}

async function cleanup(): Promise<void> {
  const tagged = { name: { startsWith: TAG } };
  const taggedPerson = { nameArabic: { startsWith: TAG } };
  const scheduleWhere = { schedule: { subject: tagged } };

  await prisma.sessionRecording.deleteMany({ where: { session: scheduleWhere } });
  await prisma.sessionAudienceBranch.deleteMany({ where: { session: scheduleWhere } });
  await prisma.sessionContent.deleteMany({ where: { session: scheduleWhere } });
  await prisma.sessionStaff.deleteMany({ where: { session: scheduleWhere } });
  await prisma.notification.deleteMany({ where: { session: scheduleWhere } });
  await prisma.session.deleteMany({ where: scheduleWhere });
  await prisma.courseScheduleStaff.deleteMany({ where: { schedule: { subject: tagged } } });
  await prisma.recurringCourseSchedule.deleteMany({ where: { subject: tagged } });
  await prisma.familyLink.deleteMany({ where: { parent: taggedPerson } });
  await prisma.enrollment.deleteMany({ where: { student: taggedPerson } });
  await prisma.levelSubject.deleteMany({ where: { subject: tagged } });
  await prisma.userBranchRole.deleteMany({ where: { user: taggedPerson } });
  await prisma.auditLog.deleteMany({ where: { actor: taggedPerson } });
  await prisma.user.deleteMany({ where: taggedPerson });
  await prisma.subject.deleteMany({ where: tagged });
  await prisma.level.deleteMany({ where: tagged });
  await prisma.branch.deleteMany({ where: tagged });
  await prisma.category.deleteMany({ where: tagged });
}

beforeEach(async () => {
  await cleanup();
  adminId = await person("المسؤولة", [{ role: "super_admin", branchId: null }]);
  categoryId = (await prisma.category.create({ data: { name: `${TAG} النساء` } })).id;
  branchA = (await prisma.branch.create({ data: { name: `${TAG} تاركة` } })).id;
  branchB = (await prisma.branch.create({ data: { name: `${TAG} المسيرة` } })).id;
  levelId = (
    await createLevel(prisma, superAdmin(), {
      name: `${TAG} المستوى 1`,
      categoryId,
      genderRestriction: "any",
    })
  ).level.id;
  subjectVideo = (await prisma.subject.create({ data: { name: `${TAG} تفسير` } })).id;
  subjectAudio = (await prisma.subject.create({ data: { name: `${TAG} سيرة` } })).id;
  await prisma.levelSubject.createMany({
    data: [
      { levelId, subjectId: subjectVideo },
      { levelId, subjectId: subjectAudio },
    ],
  });
  academicYearId = (
    await prisma.academicYear.findFirstOrThrow({ select: { id: true } })
  ).id;
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

/* ── Optional ────────────────────────────────────────────────────────────── */

describe("recording is OPTIONAL and never automatic (R99.2)", () => {
  it("a class nobody recorded has NO recording row at all", async () => {
    const { scheduleId, sessionId } = await onlineClass("audio_video", subjectVideo, "tuesday");
    const teacher = await person("مؤطِّرة", [{ role: "teacher", branchId: branchA }]);
    await staff(scheduleId, teacher, "teacher");
    const actor = actorOf(teacher, [{ role: "teacher", branches: [branchA] }]);

    // The whole class: she enters, and she does not press the button.
    const { authorizeJoin } = await import("./online-class.service.js");
    await authorizeJoin(prisma, actor, sessionId, undefined, DURING);
    await authorizeJoin(prisma, actor, sessionId, undefined, DURING);

    expect(await prisma.sessionRecording.count({ where: { sessionId } })).toBe(0);
    expect(await readState(prisma, actor, sessionId, undefined, DURING)).toBeNull();
  });

  it("the boundary carries nothing — a client cannot name the format", () => {
    // R99.7: the artefact follows the class. A `media_mode` here would let a
    // مؤطِّرة record video of a صوت فقط lesson.
    expect(recordingCommandSchema.safeParse({ media_mode: "audio_video" }).success).toBe(false);
    expect(recordingCommandSchema.safeParse({}).success).toBe(true);
  });
});

/* ── Authorization ───────────────────────────────────────────────────────── */

describe("who may record (R99.3)", () => {
  async function classWithStaff(): Promise<{
    sessionId: string;
    lead: string;
    assistant: string;
  }> {
    const { scheduleId, sessionId } = await onlineClass("audio_video", subjectVideo, "tuesday");
    const lead = await person("المؤطِّرة", [{ role: "teacher", branchId: branchA }]);
    const assistant = await person("المساعِدة", [{ role: "teacher", branchId: branchA }]);
    await staff(scheduleId, lead, "teacher");
    await staff(scheduleId, assistant, "assistant");
    await prisma.sessionStaff.createMany({
      data: [
        { sessionId, userId: lead, position: "teacher" },
        { sessionId, userId: assistant, position: "assistant" },
      ],
    });
    return { sessionId, lead, assistant };
  }

  it("the مؤطِّرة may start", async () => {
    const { sessionId, lead } = await classWithStaff();
    const state = await startRecording(
      prisma,
      new FakeProvider(),
      actorOf(lead, [{ role: "teacher", branches: [branchA] }]),
      sessionId,
      DURING,
    );
    expect({ status: state.status, live: state.live }).toEqual({
      status: "starting",
      live: true,
    });
  });

  it("the ASSISTANT may start — identical authority (R87 §G)", async () => {
    const { sessionId, assistant } = await classWithStaff();
    const state = await startRecording(
      prisma,
      new FakeProvider(),
      actorOf(assistant, [{ role: "teacher", branches: [branchA] }]),
      sessionId,
      DURING,
    );
    expect(state.live).toBe(true);
  });

  it("the assistant may STOP what the مؤطِّرة started", async () => {
    const { sessionId, lead, assistant } = await classWithStaff();
    const provider = new FakeProvider();
    await startRecording(
      prisma,
      provider,
      actorOf(lead, [{ role: "teacher", branches: [branchA] }]),
      sessionId,
      DURING,
    );
    // A class covered by an assistant must be stoppable by the person actually
    // delivering it — not only by whoever pressed start.
    const stopped = await stopRecording(
      prisma,
      provider,
      actorOf(assistant, [{ role: "teacher", branches: [branchA] }]),
      sessionId,
      DURING,
    );
    expect(stopped.status).toBe("stopping");
    expect(provider.stopped).toHaveLength(1);
  });

  it("a BENEFICIARY is refused — 403, and she is told why", async () => {
    const { sessionId } = await classWithStaff();
    const student = await person("مستفيدة", [{ role: "student", branchId: branchA }]);
    await prisma.enrollment.create({
      data: { studentId: student, levelId, branchId: branchA },
    });

    const error = await failure(() =>
      startRecording(
        prisma,
        new FakeProvider(),
        actorOf(student, [{ role: "student", branches: [branchA] }]),
        sessionId,
        DURING,
      ),
    );
    // FORBIDDEN rather than 404: she is legitimately in this class and the
    // platform has already let her in, so concealing it would be a lie she can
    // disprove.
    expect({ code: error.code, reason: error.details?.["reason"] }).toEqual({
      code: "FORBIDDEN",
      reason: "RECORDING_NOT_PERMITTED",
    });
    expect(await prisma.sessionRecording.count({ where: { sessionId } })).toBe(0);
  });

  it("she may still SEE the state — transparency is not authority (R99.5)", async () => {
    const { sessionId, lead } = await classWithStaff();
    const student = await person("مستفيدة", [{ role: "student", branchId: branchA }]);
    await prisma.enrollment.create({
      data: { studentId: student, levelId, branchId: branchA },
    });
    await startRecording(
      prisma,
      new FakeProvider(),
      actorOf(lead, [{ role: "teacher", branches: [branchA] }]),
      sessionId,
      DURING,
    );

    const seen = await readState(
      prisma,
      actorOf(student, [{ role: "student", branches: [branchA] }]),
      sessionId,
      undefined,
      DURING,
    );
    expect(seen?.live).toBe(true);
  });

  it("a مؤطِّرة who does NOT staff this occurrence is refused — 404", async () => {
    const { sessionId } = await classWithStaff();
    const stranger = await person("مؤطِّرة أخرى", [{ role: "teacher", branchId: branchB }]);
    const error = await failure(() =>
      startRecording(
        prisma,
        new FakeProvider(),
        actorOf(stranger, [{ role: "teacher", branches: [branchB] }]),
        sessionId,
        DURING,
      ),
    );
    // R98's authorization refuses her before recording is even considered.
    expect(error.code).toBe("NOT_FOUND");
  });
});

/* ── The format follows the class ────────────────────────────────────────── */

describe("the artefact follows the class, never a provider default (R99.7)", () => {
  it("a صوت وصورة class records VIDEO — never silently downgraded", async () => {
    const { scheduleId, sessionId } = await onlineClass("audio_video", subjectVideo, "tuesday");
    const teacher = await person("مؤطِّرة", [{ role: "teacher", branchId: branchA }]);
    await staff(scheduleId, teacher, "teacher");
    const provider = new FakeProvider();

    await startRecording(
      prisma,
      provider,
      actorOf(teacher, [{ role: "teacher", branches: [branchA] }]),
      sessionId,
      DURING,
    );

    expect(provider.started[0]?.media).toBe("audio_video");
    expect(provider.started[0]?.key).toBe(
      stagingKeyFor(sessionId, (await liveRow(sessionId)).id, "audio_video"),
    );
    expect(provider.started[0]?.key.endsWith(".mp4")).toBe(true);
    const row = await liveRow(sessionId);
    expect(row.mimeType).toBe("video/mp4");
  });

  it("a صوت فقط class records AUDIO — no video is captured for a class with none", async () => {
    const { scheduleId, sessionId } = await onlineClass("audio_only", subjectAudio, "tuesday");
    const teacher = await person("مؤطِّرة", [{ role: "teacher", branchId: branchA }]);
    await staff(scheduleId, teacher, "teacher");
    const provider = new FakeProvider();

    await startRecording(
      prisma,
      provider,
      actorOf(teacher, [{ role: "teacher", branches: [branchA] }]),
      sessionId,
      DURING,
    );

    expect(provider.started[0]?.media).toBe("audio_only");
    expect(provider.started[0]?.key.endsWith(".ogg")).toBe(true);
    expect((await liveRow(sessionId)).mimeType).toBe("audio/ogg");
  });

  it("tells the provider the DERIVED room, never a stored one (R97.9)", async () => {
    const { scheduleId, sessionId } = await onlineClass("audio_video", subjectVideo, "tuesday");
    const teacher = await person("مؤطِّرة", [{ role: "teacher", branchId: branchA }]);
    await staff(scheduleId, teacher, "teacher");
    const provider = new FakeProvider();
    await startRecording(
      prisma,
      provider,
      actorOf(teacher, [{ role: "teacher", branches: [branchA] }]),
      sessionId,
      DURING,
    );
    expect(provider.started[0]?.room).toBe(roomNameForSession(sessionId));
  });
});

/* ── Idempotency ─────────────────────────────────────────────────────────── */

describe("the lifecycle is idempotent in both directions (R99.15)", () => {
  async function recordingClass(): Promise<{
    sessionId: string;
    teacher: string;
    provider: FakeProvider;
  }> {
    const { scheduleId, sessionId } = await onlineClass("audio_video", subjectVideo, "tuesday");
    const teacher = await person("مؤطِّرة", [{ role: "teacher", branchId: branchA }]);
    await staff(scheduleId, teacher, "teacher");
    const provider = new FakeProvider();
    await startRecording(
      prisma,
      provider,
      actorOf(teacher, [{ role: "teacher", branches: [branchA] }]),
      sessionId,
      DURING,
    );
    return { sessionId, teacher, provider };
  }

  it("pressing بدء التسجيل twice yields ONE recording, not two", async () => {
    const { sessionId, teacher, provider } = await recordingClass();
    const again = await startRecording(
      prisma,
      provider,
      actorOf(teacher, [{ role: "teacher", branches: [branchA] }]),
      sessionId,
      DURING,
    );
    expect(again.live).toBe(true);
    expect(await prisma.sessionRecording.count({ where: { sessionId } })).toBe(1);
    // And the provider was asked exactly once.
    expect(provider.started).toHaveLength(1);
  });

  it("a duplicate completion callback creates nothing and changes nothing", async () => {
    const { sessionId } = await recordingClass();
    const row = await liveRow(sessionId);
    const report = {
      providerEgressId: row.providerEgressId!,
      state: "completed" as const,
      outputKey: "session-recordings/x.mp4",
      sizeBytes: 4096,
      durationMs: 90_000,
    };

    const first = await applyProviderReport(prisma, report);
    const second = await applyProviderReport(prisma, report);
    const third = await applyProviderReport(prisma, report);

    expect(first.applied).toBe(true);
    // The state machine refuses a move out of a terminal state, so redelivery
    // is a no-op rather than a second file or a re-opened recording.
    expect([second.applied, third.applied]).toEqual([true, true]);
    expect(await prisma.sessionRecording.count({ where: { sessionId } })).toBe(1);
    const after = await prisma.sessionRecording.findFirstOrThrow({
      where: { sessionId },
      select: { status: true, sizeBytes: true },
    });
    expect({ status: after.status, size: Number(after.sizeBytes) }).toEqual({
      status: "completed",
      size: 4096,
    });
  });

  it("a LATE report cannot un-finish a completed recording", async () => {
    const { sessionId } = await recordingClass();
    const row = await liveRow(sessionId);
    await applyProviderReport(prisma, {
      providerEgressId: row.providerEgressId!,
      state: "completed",
    });
    const late = await applyProviderReport(prisma, {
      providerEgressId: row.providerEgressId!,
      state: "recording",
    });
    expect(late.applied).toBe(false);
    expect((await liveRow(sessionId, true)).status).toBe("completed");
  });

  it("a report naming a job this platform never started creates NOTHING", async () => {
    const before = await prisma.sessionRecording.count();
    const result = await applyProviderReport(prisma, {
      providerEgressId: "EG_forged_by_a_stranger",
      state: "completed",
      outputKey: "anything.mp4",
    });
    expect(result).toEqual({ applied: false, recordingId: null });
    expect(await prisma.sessionRecording.count()).toBe(before);
  });

  it("stopping something that is not running is not an error", async () => {
    const { scheduleId, sessionId } = await onlineClass("audio_video", subjectVideo, "tuesday");
    const teacher = await person("مؤطِّرة", [{ role: "teacher", branchId: branchA }]);
    await staff(scheduleId, teacher, "teacher");
    const error = await failure(() =>
      stopRecording(
        prisma,
        new FakeProvider(),
        actorOf(teacher, [{ role: "teacher", branches: [branchA] }]),
        sessionId,
        DURING,
      ),
    );
    expect(error.details?.["reason"]).toBe("NOT_RECORDING");
  });
});

/* ── Concurrency and partial failure ─────────────────────────────────────── */

describe("two people, one class, and a provider that half-works", () => {
  async function staffed(): Promise<{ sessionId: string; lead: string; assistant: string }> {
    const { scheduleId, sessionId } = await onlineClass("audio_video", subjectVideo, "tuesday");
    const lead = await person("المؤطِّرة", [{ role: "teacher", branchId: branchA }]);
    const assistant = await person("المساعِدة", [{ role: "teacher", branchId: branchA }]);
    await staff(scheduleId, lead, "teacher");
    await staff(scheduleId, assistant, "assistant");
    return { sessionId, lead, assistant };
  }

  it("two staff pressing بدء at the SAME INSTANT produce ONE recording", async () => {
    const { sessionId, lead, assistant } = await staffed();
    const provider = new FakeProvider();
    // Distinct ids, so a second provider job would be visible if one happened.
    let n = 0;
    const original = provider.startRecording.bind(provider);
    provider.startRecording = (request) => {
      n += 1;
      provider.nextId = `EG_race_${n}`;
      return original(request);
    };

    // Genuinely concurrent: the read-then-create check cannot separate them,
    // so what decides is the partial unique index.
    const [a, b] = await Promise.all([
      startRecording(
        prisma,
        provider,
        actorOf(lead, [{ role: "teacher", branches: [branchA] }]),
        sessionId,
        DURING,
      ),
      startRecording(
        prisma,
        provider,
        actorOf(assistant, [{ role: "teacher", branches: [branchA] }]),
        sessionId,
        DURING,
      ),
    ]);

    // Both callers get an answer, and it is the SAME recording — the loser sees
    // what is running rather than a five-hundred.
    expect(a.id).toBe(b.id);
    expect(
      await prisma.sessionRecording.count({
        where: { sessionId, status: { in: ["starting", "recording", "stopping"] } },
      }),
    ).toBe(1);
  });

  it("cancels the ORPHAN when the provider starts and the write then fails", async () => {
    const { sessionId, lead } = await staffed();
    const provider = new FakeProvider();
    provider.nextId = "EG_orphan";
    // The provider accepts; the row it belongs to is then destroyed underneath
    // us, so the update cannot land. This is the dangerous shape: a recorder
    // running to the end of the lesson that nobody is tracking.
    const original = provider.startRecording.bind(provider);
    provider.startRecording = async (request) => {
      const handle = await original(request);
      await prisma.sessionRecording.updateMany({
        where: { sessionId },
        data: { deletedAt: new Date() },
      });
      await prisma.sessionRecording.deleteMany({ where: { sessionId } });
      return handle;
    };

    const error = await failure(() =>
      startRecording(
        prisma,
        provider,
        actorOf(lead, [{ role: "teacher", branches: [branchA] }]),
        sessionId,
        DURING,
      ),
    );
    expect(error.details?.["reason"]).toBe("RECORDING_START_FAILED");
    // The orphan was cancelled rather than left running.
    expect(provider.stopped).toContain("EG_orphan");
  });

  it("ignores a callback that arrives BEFORE the job id is stored, and still completes", async () => {
    const { sessionId, lead } = await staffed();
    const provider = new FakeProvider();
    provider.nextId = "EG_early";

    // The provider's `egress_started` webhook can outrun its own synchronous
    // response. Arriving first, it matches no row and is ignored — which is
    // benign, because `starting` is already a LIVE state and the participant
    // banner comes from the room rather than from this row.
    const early = await applyProviderReport(prisma, {
      providerEgressId: "EG_early",
      state: "recording",
    });
    expect(early).toEqual({ applied: false, recordingId: null });

    await startRecording(
      prisma,
      provider,
      actorOf(lead, [{ role: "teacher", branches: [branchA] }]),
      sessionId,
      DURING,
    );
    // Still live from the reader's point of view, whatever was lost.
    expect((await readState(prisma, actorOf(lead, [{ role: "teacher", branches: [branchA] }]), sessionId, undefined, DURING))?.live).toBe(true);

    // And the completion that follows lands normally.
    const done = await applyProviderReport(prisma, {
      providerEgressId: "EG_early",
      state: "completed",
      outputKey: "k.mp4",
    });
    expect(done.applied).toBe(true);
    expect((await liveRow(sessionId, true)).status).toBe("completed");
  });

  it("treats an ABORTED job as terminal and not as a recording to ingest", async () => {
    const { sessionId, lead } = await staffed();
    const provider = new FakeProvider();
    provider.nextId = "EG_aborted";
    await startRecording(
      prisma,
      provider,
      actorOf(lead, [{ role: "teacher", branches: [branchA] }]),
      sessionId,
      DURING,
    );
    await applyProviderReport(prisma, {
      providerEgressId: "EG_aborted",
      state: "aborted",
      failureReason: "no participants published",
    });
    const row = await liveRow(sessionId, true);
    expect(row.status).toBe("aborted");
    // Terminal: a later completion cannot resurrect it into something C2 would
    // then try to ingest.
    const late = await applyProviderReport(prisma, {
      providerEgressId: "EG_aborted",
      state: "completed",
      outputKey: "k.mp4",
    });
    expect(late.applied).toBe(false);
  });
});

/* ── Failure is honest ───────────────────────────────────────────────────── */

describe("a recording that could not start says so (R99.14)", () => {
  it("leaves a FAILED row rather than a phantom recording, and can be retried", async () => {
    const { scheduleId, sessionId } = await onlineClass("audio_video", subjectVideo, "tuesday");
    const teacher = await person("مؤطِّرة", [{ role: "teacher", branchId: branchA }]);
    await staff(scheduleId, teacher, "teacher");
    const actor = actorOf(teacher, [{ role: "teacher", branches: [branchA] }]);

    const provider = new FakeProvider();
    provider.failStart = true;
    const error = await failure(() =>
      startRecording(prisma, provider, actor, sessionId, DURING),
    );
    expect(error.details?.["reason"]).toBe("RECORDING_START_FAILED");

    const failed = await prisma.sessionRecording.findFirstOrThrow({
      where: { sessionId },
      select: { status: true },
    });
    expect(failed.status).toBe("failed");

    // The one-live index is released, so she can try again immediately.
    provider.failStart = false;
    provider.nextId = "EG_fake_2";
    const retried = await startRecording(prisma, provider, actor, sessionId, DURING);
    expect(retried.live).toBe(true);
    expect(await prisma.sessionRecording.count({ where: { sessionId } })).toBe(2);
  });

  it("answers 503 naming the settings when no provider is configured", async () => {
    const { scheduleId, sessionId } = await onlineClass("audio_video", subjectVideo, "tuesday");
    const teacher = await person("مؤطِّرة", [{ role: "teacher", branchId: branchA }]);
    await staff(scheduleId, teacher, "teacher");
    const error = await failure(() =>
      startRecording(
        prisma,
        null,
        actorOf(teacher, [{ role: "teacher", branches: [branchA] }]),
        sessionId,
        DURING,
      ),
    );
    expect(error.code).toBe("SERVICE_UNAVAILABLE");
    expect(await prisma.sessionRecording.count({ where: { sessionId } })).toBe(0);
  });
});

/* ── The audit trail ─────────────────────────────────────────────────────── */

describe("who recorded this class is answerable later (R99.16)", () => {
  it("writes a TD-8 row for the start and for the stop", async () => {
    const { scheduleId, sessionId } = await onlineClass("audio_video", subjectVideo, "tuesday");
    const teacher = await person("مؤطِّرة", [{ role: "teacher", branchId: branchA }]);
    await staff(scheduleId, teacher, "teacher");
    const actor = actorOf(teacher, [{ role: "teacher", branches: [branchA] }]);
    const provider = new FakeProvider();

    await startRecording(prisma, provider, actor, sessionId, DURING);
    await stopRecording(prisma, provider, actor, sessionId, DURING);

    const rows = await prisma.auditLog.findMany({
      where: { targetId: sessionId, actionType: { startsWith: "session.recording_" } },
      select: { actionType: true, actorUserId: true },
      orderBy: { createdAt: "asc" },
    });
    expect(rows.map((r) => r.actionType)).toEqual([
      "session.recording_start",
      "session.recording_stop",
    ]);
    expect(rows.every((r) => r.actorUserId === teacher)).toBe(true);
  });
});

async function liveRow(
  sessionId: string,
  any = false,
): Promise<{ id: string; status: string; providerEgressId: string | null; mimeType: string | null }> {
  return prisma.sessionRecording.findFirstOrThrow({
    where: {
      sessionId,
      deletedAt: null,
      ...(any ? {} : { status: { in: ["starting", "recording", "stopping"] } }),
    },
    orderBy: { startedAt: "desc" },
    select: { id: true, status: true, providerEgressId: true, mimeType: true },
  });
}
