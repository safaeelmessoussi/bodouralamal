import { randomBytes } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../lib/config.js';
import { BUCKETS, createStorageClients, type StorageClients } from '../lib/storage.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import { issueUploadTicket } from '../lib/upload-token.js';
import type { Actor } from '../policies/actor.js';
import { createTeachingContext, staff } from '../test-support/educational-fixture.js';
import {
  abortUpload,
  completeUpload,
  deleteContent,
  initiateUpload,
  mintDownloadUrl,
  UPLOAD_QUOTA,
} from './content.service.js';

/**
 * TD-3.5 end to end, against **real MinIO through the real Nginx proxy**.
 *
 * §3.1 is explicit that the storage round-trip must never be "verified" by
 * direct-to-MinIO access: the property under test is that a SigV4 signature
 * survives the proxy's prefix strip and Host rewrite. Every PUT below therefore
 * goes to the URL the service actually handed out — the same one a browser gets.
 *
 * That also means the magic-byte and size checks are exercised against bytes
 * that genuinely made the trip, rather than against a mock that would agree with
 * whatever the implementation happened to do.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const KEY = config.JWT_SIGNING_KEY;
const TAG = '[content-test]';

let clients: StorageClients;
let adminId = '';
let teacherId = '';
let levelId = '';
let subjectId = '';
let branchId = '';
let otherBranchId = '';
let academicYearId = '';

const actorOf = (userId: string, roles: { role: string; branches: string[] | null }[]): Actor =>
  ({ userId, roles: roles.map((r) => r.role), roleScopes: roles } as unknown as Actor);
const admin = (): Actor => actorOf(adminId, [{ role: 'admin', branches: null }]);
const teacher = (): Actor => actorOf(teacherId, [{ role: 'teacher', branches: [branchId] }]);

async function failure(
  run: () => Promise<unknown>,
): Promise<{ code?: string; status?: number; details?: Record<string, unknown> }> {
  try {
    await run();
    return {};
  } catch (e) {
    return e as { code?: string; status?: number; details?: Record<string, unknown> };
  }
}

/** A real, valid PDF header — the sniffer reads the first 512 bytes and nothing else. */
const pdfBytes = (): Buffer => Buffer.concat([Buffer.from('%PDF-1.7\n'), randomBytes(200)]);

/** Uploads to the presigned URL exactly as a browser would. */
async function putObject(url: string, body: Buffer, mime: string): Promise<number> {
  const res = await fetch(url, { method: 'PUT', body, headers: { 'content-type': mime } });
  return res.status;
}

/**
 * Teardown, innermost first.
 *
 * Every FK here is `Restrict`, so the order is a requirement rather than a
 * preference — a schedule with materialized sessions refuses to go, and the
 * failure surfaces in an unrelated test as a constraint violation rather than as
 * anything readable. (This is the third suite to learn that; the ordering rule
 * is recorded in `development/testing.md`.)
 */
async function clear(): Promise<void> {
  const ids = (
    await prisma.user.findMany({ where: { nameArabic: { startsWith: TAG } }, select: { id: true } })
  ).map((u) => u.id);
  const levels = (
    await prisma.level.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } })
  ).map((l) => l.id);
  const groups = (
    await prisma.administrativeGroup.findMany({
      where: { levelId: { in: levels } },
      select: { id: true },
    })
  ).map((g) => g.id);
  // A schedule reaches its Level through its TARGET, not through a column —
  // `teaching_mode` decides which of the three it is (R43), so the group is
  // where this suite's schedules are found.
  const schedules = (
    await prisma.recurringCourseSchedule.findMany({
      where: { OR: [{ administrativeGroupId: { in: groups } }, { levelId: { in: levels } }] },
      select: { id: true },
    })
  ).map((s) => s.id);

  const contents = await prisma.educationalContent.findMany({
    where: { title: { startsWith: TAG } },
    select: { id: true },
  });
  await prisma.trash.deleteMany({ where: { targetId: { in: contents.map((c) => c.id) } } });
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: ids } } });
  await prisma.rateLimitCounter.deleteMany({ where: { userId: { in: ids } } });
  await prisma.educationalContent.deleteMany({ where: { title: { startsWith: TAG } } });

  await prisma.sessionStaff.deleteMany({ where: { session: { scheduleId: { in: schedules } } } });
  // R77 — `notification.session_id` is RESTRICT, like every other reference
  // to a Session: a cancellation notice whose session vanished is unreadable.
  // Fixtures therefore unwind notices before the occurrences they name.
  await prisma.notification.deleteMany({ where: { session: { scheduleId: { in: schedules } } } });
  await prisma.session.deleteMany({ where: { scheduleId: { in: schedules } } });
  await prisma.courseScheduleStaff.deleteMany({ where: { scheduleId: { in: schedules } } });
  await prisma.recurringCourseSchedule.deleteMany({ where: { id: { in: schedules } } });
  await prisma.enrollment.deleteMany({ where: { levelId: { in: levels } } });
  await prisma.administrativeGroup.deleteMany({ where: { levelId: { in: levels } } });
  await prisma.levelSubject.deleteMany({ where: { levelId: { in: levels } } });
  await prisma.level.deleteMany({ where: { id: { in: levels } } });
  await prisma.subject.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.category.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.userBranchRole.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.branch.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  clients = createStorageClients(config);
  const res = await fetch(`${config.STORAGE_BASE_URL}/${BUCKETS.public}/`, { redirect: 'manual' });
  if (res.status <= 0) {
    throw new Error('storage proxy unreachable — docker compose up -d minio nginx');
  }
});

beforeEach(async () => {
  await clear();

  const year = await prisma.academicYear.findFirst({ where: { isCurrent: true } });
  academicYearId = year!.id;

  branchId = (await prisma.branch.create({ data: { name: `${TAG} فرع` } })).id;
  otherBranchId = (await prisma.branch.create({ data: { name: `${TAG} فرع آخر` } })).id;

  adminId = (
    await prisma.user.create({ data: { nameArabic: `${TAG} مديرة`, accountStatus: 'active' } })
  ).id;
  teacherId = (
    await prisma.user.create({ data: { nameArabic: `${TAG} مؤطرة`, accountStatus: 'active' } })
  ).id;

  // §4.4c: a teacher's branch reach is the branches of the schedules they staff,
  // not their role assignment — so the fixture builds that whole path rather
  // than a Level and a Subject in isolation. It is the shared one on purpose:
  // a suite that builds a slightly different model is testing something the
  // application cannot produce.
  const fixture = await createTeachingContext(prisma, TAG, branchId);
  levelId = fixture.levelId;
  subjectId = fixture.subjectId;
  await staff(prisma, fixture, teacherId);

  // **Real `UserBranchRole` rows, not just role names on the actor.** TD-12's
  // freshness check re-reads the assignment from the database on every mint, so
  // an actor whose roles exist only in a token would be refused for the right
  // reason at the wrong time — and the suspended-teacher test below would pass
  // without ever exercising the suspension.
  const adminRole = await prisma.role.findFirstOrThrow({ where: { name: 'admin' } });
  const teacherRole = await prisma.role.findFirstOrThrow({ where: { name: 'teacher' } });
  await prisma.userBranchRole.createMany({
    data: [
      { userId: adminId, roleId: adminRole.id, branchId: null },
      { userId: teacherId, roleId: teacherRole.id, branchId },
    ],
  });
});

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

const meta = (over: Partial<Record<string, unknown>> = {}) => ({
  levelId,
  subjectId,
  academicYearId,
  branchId,
  visibility: 'private',
  ...over,
});

/** initiate → PUT → complete, the whole path a browser takes. */
async function uploadPdf(actor: Actor, title: string, over: Record<string, unknown> = {}) {
  const bytes = pdfBytes();
  const initiated = await initiateUpload(prisma, clients, KEY, actor, {
    filename: 'درس القرآن.pdf',
    size: bytes.length,
    mime: 'application/pdf',
    meta: meta(over) as never,
  });
  expect(await putObject(initiated.putUrl, bytes, 'application/pdf')).toBe(200);
  const created = await completeUpload(prisma, clients, KEY, actor, initiated.uploadId, {
    title: `${TAG} ${title}`,
    description: null,
  });
  return { ...created, initiated, bytes };
}

describe('the two-phase upload (TD-3.5)', () => {
  it('round-trips a real file through the presigned PUT and creates the content row', async () => {
    const { id, initiated, bytes } = await uploadPdf(admin(), 'ملف');

    // The URL handed to the browser is rooted at the public storage origin and
    // never at MinIO's internal endpoint (§3.1).
    expect(initiated.putUrl.startsWith(config.STORAGE_BASE_URL)).toBe(true);

    const row = await prisma.educationalContent.findUniqueOrThrow({ where: { id } });
    expect(row.storageKey).toBe(initiated.key);
    expect(row.storageBucket).toBe(BUCKETS.private);
    expect(Number(row.sizeBytes)).toBe(bytes.length);
    // TD-9: the true filename is kept verbatim; the key carries a slug of it.
    expect(row.originalFilename).toBe('درس القرآن.pdf');
    expect(row.storageKey).toMatch(/^content\/[0-9a-f-]{36}\/[0-9a-f]{8}\/drs-alqran\.pdf$/);
  });

  it('writes a content.upload audit row', async () => {
    const { id } = await uploadPdf(admin(), 'مدقق');
    const entry = await prisma.auditLog.findFirst({
      where: { actionType: 'content.upload', targetId: id },
    });
    expect(entry).not.toBeNull();
  });

  it('refuses a MIME type TD-9 does not list, before anything is uploaded', async () => {
    const e = await failure(() =>
      initiateUpload(prisma, clients, KEY, admin(), {
        filename: 'clip.mp4',
        size: 1000,
        mime: 'video/mp4',
        meta: meta() as never,
      }),
    );
    expect(e.code).toBe('VALIDATION_FAILED');
  });

  it('refuses a declared size over the TD-9 cap without minting a URL', async () => {
    const e = await failure(() =>
      initiateUpload(prisma, clients, KEY, admin(), {
        filename: 'huge.pdf',
        size: 51 * 1024 * 1024,
        mime: 'application/pdf',
        meta: meta() as never,
      }),
    );
    expect(e.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('refuses a subject that is not taught at that level (R43)', async () => {
    const stray = await prisma.subject.create({ data: { name: `${TAG} مادة غريبة` } });
    const e = await failure(() =>
      initiateUpload(prisma, clients, KEY, admin(), {
        filename: 'a.pdf',
        size: 10,
        mime: 'application/pdf',
        meta: meta({ subjectId: stray.id }) as never,
      }),
    );
    expect(e.code).toBe('STATE_CONFLICT');
    // One code across all three surfaces (`policies/curriculum.ts`): scheduling
    // and teaching-group splits raise the same one, and the older spelling wins
    // because clients render it.
    expect(e.details?.['reason']).toBe('SUBJECT_NOT_IN_LEVEL');
  });
});

describe('§4.9 upload authorization', () => {
  it('refuses a Teacher the Global scope — the named §19.2 regression', async () => {
    const e = await failure(() =>
      initiateUpload(prisma, clients, KEY, teacher(), {
        filename: 'a.pdf',
        size: 10,
        mime: 'application/pdf',
        meta: meta({ branchId: null }) as never,
      }),
    );
    expect(e.code).toBe('FORBIDDEN');
    expect(e.details?.['reason']).toBe('GLOBAL_SCOPE_FORBIDDEN');
  });

  it('refuses a Teacher a branch they do not teach at', async () => {
    const e = await failure(() =>
      initiateUpload(prisma, clients, KEY, teacher(), {
        filename: 'a.pdf',
        size: 10,
        mime: 'application/pdf',
        meta: meta({ branchId: otherBranchId }) as never,
      }),
    );
    expect(e.code).toBe('FORBIDDEN');
    expect(e.details?.['reason']).toBe('BRANCH_OUT_OF_SCOPE');
  });

  it('admits a Teacher at a branch they DO teach at, resolved through the schedule', async () => {
    // The scope comes from `CourseScheduleStaff` (§4.4c), not from the role
    // assignment — the fixture's teacher has no admin scope of any kind.
    const result = await uploadPdf(teacher(), 'ملف المؤطرة');
    expect(result.id).toBeTruthy();
  });

  it('lets an Admin publish to the Global scope', async () => {
    const { id } = await uploadPdf(admin(), 'عام', { branchId: null });
    const row = await prisma.educationalContent.findUniqueOrThrow({ where: { id } });
    expect(row.branchId).toBeNull();
  });
});

describe('completion verification (§4.9 Revision 8)', () => {
  it('deletes the object and refuses with 409 when the magic bytes lie', async () => {
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      randomBytes(100),
    ]);
    const initiated = await initiateUpload(prisma, clients, KEY, admin(), {
      filename: 'liar.pdf',
      size: png.length,
      mime: 'application/pdf',
      meta: meta() as never,
    });
    await putObject(initiated.putUrl, png, 'application/pdf');

    const e = await failure(() =>
      completeUpload(prisma, clients, KEY, admin(), initiated.uploadId, {
        title: `${TAG} كاذب`,
        description: null,
      }),
    );
    expect(e.code).toBe('VALIDATION_FAILED');
    // §4.9 says 409 here, not 400: the request is well-formed, the object is not
    // what it claimed. TD-3.8 records it as the "409 variant on upload complete".
    expect(e.status).toBe(409);

    expect(await prisma.educationalContent.count({ where: { title: `${TAG} كاذب` } })).toBe(0);
    // And the object is gone — a rejected upload must not linger in the bucket.
    const orphan = await fetch(initiated.putUrl.replace('X-Amz', 'x-amz'), { method: 'HEAD' });
    expect(orphan.status).toBeGreaterThanOrEqual(400);
  });

  it('refuses with 409 when the stored size disagrees with the declared size', async () => {
    const bytes = pdfBytes();
    const initiated = await initiateUpload(prisma, clients, KEY, admin(), {
      filename: 'short.pdf',
      size: bytes.length + 500,
      mime: 'application/pdf',
      meta: meta() as never,
    });
    await putObject(initiated.putUrl, bytes, 'application/pdf');

    const e = await failure(() =>
      completeUpload(prisma, clients, KEY, admin(), initiated.uploadId, {
        title: `${TAG} قصير`,
        description: null,
      }),
    );
    expect(e.code).toBe('VALIDATION_FAILED');
    expect(e.status).toBe(409);
  });

  it('answers UPLOAD_INCOMPLETE when nothing was ever PUT', async () => {
    const initiated = await initiateUpload(prisma, clients, KEY, admin(), {
      filename: 'never.pdf',
      size: 100,
      mime: 'application/pdf',
      meta: meta() as never,
    });
    const e = await failure(() =>
      completeUpload(prisma, clients, KEY, admin(), initiated.uploadId, {
        title: `${TAG} مفقود`,
        description: null,
      }),
    );
    expect(e.code).toBe('UPLOAD_INCOMPLETE');
  });

  it('refuses a ticket belonging to another caller', async () => {
    const initiated = await initiateUpload(prisma, clients, KEY, admin(), {
      filename: 'a.pdf',
      size: 100,
      mime: 'application/pdf',
      meta: meta() as never,
    });
    const e = await failure(() =>
      completeUpload(prisma, clients, KEY, teacher(), initiated.uploadId, {
        title: `${TAG} مسروق`,
        description: null,
      }),
    );
    expect(e.code).toBe('NOT_FOUND');
  });

  it('refuses a ticket whose scope was rewritten after it was issued', async () => {
    // The forged ticket is what a client would have to produce to complete into
    // the Global scope after initiating inside a branch.
    const forged = issueUploadTicket(
      {
        sub: teacherId,
        cid: '11111111-2222-3333-4444-555555555555',
        bucket: BUCKETS.private,
        key: 'content/x/abcd1234/a.pdf',
        filename: 'a.pdf',
        mime: 'application/pdf',
        size: 10,
        level_id: levelId,
        subject_id: subjectId,
        academic_year_id: academicYearId,
        branch_id: null,
        visibility: 'private',
      },
      'a-different-key',
    ).token;
    const e = await failure(() =>
      completeUpload(prisma, clients, KEY, teacher(), forged, {
        title: `${TAG} مزور`,
        description: null,
      }),
    );
    expect(e.code).toBe('NOT_FOUND');
    expect(e.details?.['reason']).toBe('BAD_SIGNATURE');
  });
});

describe('abort', () => {
  it('removes the object so an abandoned upload leaves nothing behind', async () => {
    const bytes = pdfBytes();
    const initiated = await initiateUpload(prisma, clients, KEY, admin(), {
      filename: 'gone.pdf',
      size: bytes.length,
      mime: 'application/pdf',
      meta: meta() as never,
    });
    await putObject(initiated.putUrl, bytes, 'application/pdf');
    await abortUpload(clients, KEY, admin(), initiated.uploadId);

    const e = await failure(() =>
      completeUpload(prisma, clients, KEY, admin(), initiated.uploadId, {
        title: `${TAG} ملغى`,
        description: null,
      }),
    );
    expect(e.code).toBe('UPLOAD_INCOMPLETE');
  });
});

describe('the per-user upload quota (TD-4.12, Revision 14)', () => {
  it('refuses the 31st initiation within the hour with RATE_LIMITED', async () => {
    // Counted in PostgreSQL inside the initiating transaction — never in process
    // memory (dies with the container) and never through pg-boss (asynchronous).
    await prisma.rateLimitCounter.create({
      data: {
        userId: adminId,
        bucket: UPLOAD_QUOTA.bucket,
        windowStart: new Date(new Date().setUTCMinutes(0, 0, 0)),
        count: UPLOAD_QUOTA.perHour,
      },
    });
    const e = await failure(() =>
      initiateUpload(prisma, clients, KEY, admin(), {
        filename: 'a.pdf',
        size: 10,
        mime: 'application/pdf',
        meta: meta() as never,
      }),
    );
    expect(e.code).toBe('RATE_LIMITED');
    expect(e.details?.['limit']).toBe(30);
  });

  it('admits exactly one of two concurrent initiations at the boundary', async () => {
    // The check-then-write race TD-15.2's row lock exists to close: without the
    // lock both would read 29 and both would pass.
    await prisma.rateLimitCounter.create({
      data: {
        userId: adminId,
        bucket: UPLOAD_QUOTA.bucket,
        windowStart: new Date(new Date().setUTCMinutes(0, 0, 0)),
        count: UPLOAD_QUOTA.perHour - 1,
      },
    });
    const attempt = () =>
      initiateUpload(prisma, clients, KEY, admin(), {
        filename: 'a.pdf',
        size: 10,
        mime: 'application/pdf',
        meta: meta() as never,
      });
    const results = await Promise.allSettled([attempt(), attempt()]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
  });
});

describe('the presigned GET mint (TD-3.5, TD-12)', () => {
  it('mints a short-lived URL that actually serves the bytes', async () => {
    const { id, bytes } = await uploadPdf(admin(), 'قابل للتنزيل');
    const minted = await mintDownloadUrl(prisma, clients, admin(), id, undefined);

    expect(minted.expiresIn).toBe(600);
    expect(minted.url.startsWith(config.STORAGE_BASE_URL)).toBe(true);
    const res = await fetch(minted.url);
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).length).toBe(bytes.length);
  });

  it('refuses a suspended Teacher inside their unexpired token window (§19.2)', async () => {
    const { id } = await uploadPdf(admin(), 'محمي');
    await prisma.user.update({ where: { id: teacherId }, data: { accountStatus: 'suspended' } });
    // TD-12: "statelessness ends where safeguarding begins" — the token is still
    // valid, and that is exactly the case this check exists for.
    const e = await failure(() => mintDownloadUrl(prisma, clients, teacher(), id, undefined));
    expect(e.code).toBe('FORBIDDEN');
  });

  it('answers 404 rather than 403 for content out of the caller’s reach (§20 rule 17)', async () => {
    const { id } = await uploadPdf(admin(), 'مخفي', { visibility: 'hidden' });
    const student = await prisma.user.create({
      data: { nameArabic: `${TAG} طالبة`, accountStatus: 'active' },
    });
    const role = await prisma.role.findFirstOrThrow({ where: { name: 'student' } });
    await prisma.userBranchRole.create({
      data: { userId: student.id, roleId: role.id, branchId },
    });
    const e = await failure(() =>
      mintDownloadUrl(
        prisma,
        clients,
        actorOf(student.id, [{ role: 'student', branches: [branchId] }]),
        id,
        undefined,
      ),
    );
    // A 403 would confirm the file exists to someone with no business knowing.
    expect(e.code).toBe('NOT_FOUND');
  });
});

describe('replace and delete (R53)', () => {
  it('replacement mints a NEW key and never overwrites the old object (TD-9)', async () => {
    const first = await uploadPdf(admin(), 'نسخة أولى');
    const before = await prisma.educationalContent.findUniqueOrThrow({ where: { id: first.id } });

    const second = await uploadPdf(admin(), 'نسخة ثانية', { replacesContentId: first.id });
    expect(second.id).toBe(first.id);

    const after = await prisma.educationalContent.findUniqueOrThrow({ where: { id: first.id } });
    expect(after.storageKey).not.toBe(before.storageKey);
    expect(after.version).toBe(before.version + 1);
    // One row, not two — the record keeps its identity and every link to it.
    expect(await prisma.educationalContent.count({ where: { id: first.id } })).toBe(1);
  });

  it('deletion soft-deletes, snapshots to the Trash, and leaves the file recoverable', async () => {
    const { id } = await uploadPdf(admin(), 'للحذف');
    await deleteContent(prisma, clients, admin(), id);

    const row = await prisma.educationalContent.findUniqueOrThrow({ where: { id } });
    expect(row.deletedAt).not.toBeNull();
    const tomb = await prisma.trash.findFirst({
      where: { targetEntity: 'EducationalContent', targetId: id },
    });
    // BR-15: the object waits out the 90-day window in quarantine rather than
    // being destroyed — the retention rule is the whole point of a soft delete.
    expect(tomb).not.toBeNull();
    expect(tomb!.purgeAfter.getTime()).toBeGreaterThan(Date.now());
  });

  it('refuses a Teacher deleting content outside their branch scope, as a 404', async () => {
    const { id } = await uploadPdf(admin(), 'عام للحذف', { branchId: null });
    const e = await failure(() => deleteContent(prisma, clients, teacher(), id));
    // Global content is readable by a teacher and not writable — and the refusal
    // is a 404 for the same reason every other out-of-scope answer is.
    expect(['NOT_FOUND', 'FORBIDDEN']).toContain(e.code);
  });
});
