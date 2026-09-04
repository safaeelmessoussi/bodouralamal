import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { issueAccessToken } from '../lib/access-token.js';
import { issueOnboardingToken } from '../lib/onboarding-token.js';
import { loadConfig } from '../lib/config.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import { httpCall } from '../test-support/http-client.js';

/**
 * **The whole business journey, through the real routes** (Document Owner,
 * 2026-09-04).
 *
 * > A مؤطِّرة asks to join. An adult مستفيدة asks to join. The Super Admin
 * > approves both. The مستفيدة is admitted to **two** Levels. An online
 * > assessment is set for **one** of them. Both women are told. She answers it,
 * > saves, comes back, submits. The مؤطِّرة marks it and publishes the mark.
 * > Only then does the مستفيدة see it. Then the مؤطِّرة records what she has
 * > memorised, and it is there on her record.
 *
 * ## Why this exists beside `business-scenario`
 *
 * That file proves the **teaching** steps compose — taxonomy, scheduling,
 * materialization, calendar. This one proves the **admission-to-achievement**
 * steps compose, which is a different chain and shares only its first two
 * entities with that one. Every step below is covered somewhere by a
 * per-feature suite; what none of them asks is whether the person an approval
 * created is the person an enrolment admits, whether the paper an administrator
 * publishes reaches the mailbox of the مؤطِّرة who will mark it, and whether the
 * roster she records memorisation on is the roster the enrolment produced.
 *
 * ## The two-Level assertion is the point, not decoration
 *
 * The مستفيدة is deliberately enrolled in **LEVEL A and LEVEL B**. Almost every
 * defect this shape produces is invisible with one enrolment: a recipient set
 * joined through enrolments delivers twice, a roster built from enrolments lists
 * her twice, and a targeting rule that reads *a* Level rather than *the* Level
 * silently addresses the wrong one. Each of those has its own assertion here,
 * and `LEVEL B` exists for no other reason.
 *
 * Requires the compose stack:
 *   docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build api
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const BASE = `${config.PUBLIC_BASE_URL}/api/v1`;

/** Every row this file creates carries it, and cleanup deletes by it alone. */
const TAG = '[journey]';
const YEAR_LABEL = '2094-2095';

/** R130 — a real adult, and provably one: the assertion below recomputes the
 *  age from this date rather than trusting the constant. */
const ADULT_BIRTH_DATE = '1993-04-17';

const DAY_MS = 86_400_000;
const isoDate = (value: Date): string => value.toISOString().slice(0, 10);
const today = new Date();
const utcToday = new Date(
  Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
);
/** The assessment sits in the future so nothing about it depends on «today». */
const EXAM_DATE = isoDate(new Date(utcToday.getTime() + 21 * DAY_MS));

interface Res {
  status: number;
  body: Record<string, unknown> & {
    error?: { code?: string; reason?: string };
    data?: unknown;
    schedule?: { id: string };
  };
}

const call = (
  method: string,
  path: string,
  token?: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<Res> =>
  httpCall<Res['body']>(BASE, method, path, {
    token,
    ...(body !== undefined ? { body } : {}),
    ...(headers !== undefined ? { headers } : {}),
  });

const createdId = (res: Res): string => {
  const body = res.body as Record<string, unknown>;
  const payload = (body['data'] ?? body) as Record<string, unknown>;
  const id = payload['id'];
  if (typeof id !== 'string') throw new Error(`no id in ${JSON.stringify(body).slice(0, 300)}`);
  return id;
};

/**
 * The rows of a list response, whichever envelope it uses.
 *
 * **The envelope is genuinely not uniform**, and this reads the three shapes
 * actually in service rather than encoding one screen's luck: a bare `data`
 * array, a paginated `data.data`, and the grade sheet's `data.rows` beside its
 * `data.exam`. `business-scenario` records the same inconsistency for the
 * creation verbs; it is a real finding, noted rather than papered over.
 */
const rows = (res: Res): Record<string, unknown>[] => {
  const data = res.body.data;
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  const inner = data as Record<string, unknown> | undefined;
  for (const key of ['data', 'rows']) {
    if (Array.isArray(inner?.[key])) return inner![key] as Record<string, unknown>[];
  }
  throw new Error(`no rows in ${JSON.stringify(res.body).slice(0, 300)}`);
};

const bearer = (
  userId: string,
  scopes: { role: string; branches: string[] | null }[],
  accountStatus = 'active',
): string =>
  issueAccessToken(
    { userId, roleScopes: scopes as never, accountStatus: accountStatus as never },
    config.JWT_SIGNING_KEY,
  ).token;

/**
 * **The role has to be a real row, not only a token claim.**
 *
 * TD-12 makes the high-risk surfaces rebuild the caller's authority from live
 * rows (`assertFreshActive`), so a fixture that mints a `super_admin` token
 * without the matching `UserBranchRole` is refused — correctly. Granting it
 * here keeps this suite testing the platform rather than testing a token.
 */
async function grant(userId: string, role: string): Promise<void> {
  const roleRow = await prisma.role.findUnique({ where: { name: role } });
  if (!roleRow) throw new Error(`no such role: ${role}`);
  await prisma.userBranchRole.create({
    data: { userId, roleId: roleRow.id, branchId: null },
  });
}

let counter = 0;
/** The onboarding credential §4.1b step 4c mints after identity verification.
 *  It is the one prerequisite that cannot be produced through a screen here,
 *  and it is minted rather than faked: the server verifies this signature. */
function onboarding(): string {
  counter += 1;
  const stamp = `${Date.now()}-${counter}`;
  return issueOnboardingToken(
    { email: `journey-${stamp}@example.invalid`, providerSubjectId: `journey-sub-${stamp}` },
    config.ONBOARDING_TOKEN_KEY,
  ).token;
}

/** A person who is a PREREQUISITE rather than a subject of the journey — the
 *  approver, and the two controls. The teacher and the مستفيدة under test are
 *  created by `POST /registrations` like anybody else. */
const person = async (label: string, sex: 'female' | 'male' = 'female'): Promise<string> =>
  (
    await prisma.user.create({
      data: { sex, nameArabic: `${TAG} ${label}`, accountStatus: 'active' },
    })
  ).id;

let superAdmin: string;
let branchId: string;
let categoryId: string;
let subjectId: string;
let levelAId: string;
let levelBId: string;
let academicYearId: string;
let academicPeriodId: string;
let consentTextId: string;

let teacherUserId: string;
let teacherToken: string;
let teacherApplicationId: string;
let studentUserId: string;
let studentToken: string;
let studentApplicationId: string;

/** Enrolled in LEVEL B only — the control that proves LEVEL-A targeting is
 *  targeting and not a broadcast. */
let levelBOnlyId: string;
let levelBOnlyToken: string;
/** Teaches nothing here — the control for every staff-side refusal. */
let otherTeacherToken: string;

let assessmentId: string;
const questionIds: string[] = [];
let quranSessionId: string;
const SURAH_ID = 93; // الضحى — 11 ayahs.

async function clear(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);

  const exams = await prisma.exam.findMany({
    where: { title: { startsWith: TAG } },
    select: { id: true },
  });
  const examIds = exams.map((e) => e.id);
  if (examIds.length > 0) {
    await prisma.studentExamAnswerOption.deleteMany({
      where: { answer: { submission: { examId: { in: examIds } } } },
    });
    await prisma.studentExamAnswer.deleteMany({
      where: { submission: { examId: { in: examIds } } },
    });
    await prisma.studentExamSubmission.deleteMany({ where: { examId: { in: examIds } } });
    await prisma.grade.deleteMany({ where: { examId: { in: examIds } } });
    await prisma.notification.deleteMany({ where: { examId: { in: examIds } } });
    await prisma.examQuestionOption.deleteMany({
      where: { question: { examId: { in: examIds } } },
    });
    await prisma.examQuestion.deleteMany({ where: { examId: { in: examIds } } });
    await prisma.examStaff.deleteMany({ where: { examId: { in: examIds } } });
    await prisma.attendance.deleteMany({ where: { examId: { in: examIds } } });
    await prisma.exam.deleteMany({ where: { id: { in: examIds } } });
  }

  const schedules = await prisma.recurringCourseSchedule.findMany({
    where: { title: { startsWith: TAG } },
    select: { id: true },
  });
  const scheduleIds = schedules.map((s) => s.id);
  if (scheduleIds.length > 0) {
    await prisma.notification.deleteMany({
      where: { session: { scheduleId: { in: scheduleIds } } },
    });
    await prisma.attendance.deleteMany({
      where: { session: { scheduleId: { in: scheduleIds } } },
    });
    await prisma.sessionStaff.deleteMany({
      where: { session: { scheduleId: { in: scheduleIds } } },
    });
    await prisma.session.deleteMany({ where: { scheduleId: { in: scheduleIds } } });
    await prisma.courseScheduleStaff.deleteMany({ where: { scheduleId: { in: scheduleIds } } });
    await prisma.recurringCourseSchedule.deleteMany({ where: { id: { in: scheduleIds } } });
  }

  const levels = await prisma.level.findMany({
    where: { name: { startsWith: TAG } },
    select: { id: true },
  });
  const levelIds = levels.map((l) => l.id);
  if (levelIds.length > 0) {
    await prisma.enrollment.deleteMany({ where: { levelId: { in: levelIds } } });
    await prisma.levelSurah.deleteMany({ where: { levelId: { in: levelIds } } });
    await prisma.levelSubject.deleteMany({ where: { levelId: { in: levelIds } } });
    await prisma.administrativeGroup.deleteMany({ where: { levelId: { in: levelIds } } });
    await prisma.level.deleteMany({ where: { id: { in: levelIds } } });
  }

  if (userIds.length > 0) {
    // **A memorisation log names no Level.** `POST /quran-logs` takes a
    // `level_id`, but only to validate against that Level's curriculum
    // (`assertLevelCurriculum`); the row itself records the مستفيدة, the surah
    // and the ayah range. So logs are cleaned by student, and a second
    // enrolment cannot mis-attribute one by construction.
    await prisma.quranProgressLog.deleteMany({
      where: { OR: [{ studentId: { in: userIds } }, { loggedById: { in: userIds } }] },
    });
    // The per-surah aggregate the platform maintains beside the log; it holds
    // the مستفيدة under RESTRICT, so it goes with her logs.
    await prisma.studentSurahProgress.deleteMany({ where: { studentId: { in: userIds } } });
    await prisma.notification.deleteMany({
      where: { OR: [{ userId: { in: userIds } }, { subjectUserId: { in: userIds } }] },
    });
    await prisma.auditLog.deleteMany({
      where: { OR: [{ actorUserId: { in: userIds } }, { targetId: { in: userIds } }] },
    });
    await prisma.trash.deleteMany({ where: { deletedById: { in: userIds } } });
    await prisma.consentRecord.deleteMany({ where: { studentId: { in: userIds } } });
    // R130 — a staff request records willingness rows, under RESTRICT.
    await prisma.framingPreference.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.userBranchRole.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.userIdentity.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }

  await prisma.subject.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.category.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.room.deleteMany({ where: { branch: { name: { startsWith: TAG } } } });
  await prisma.branch.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.academicPeriod.deleteMany({
    where: { academicYear: { label: YEAR_LABEL } },
  });
  await prisma.academicYear.deleteMany({ where: { label: YEAR_LABEL } });
}

beforeAll(async () => {
  const health = await fetch(`${config.PUBLIC_BASE_URL}/healthz`).catch(() => null);
  if (!health || health.status !== 200) throw new Error('API not reachable');
  await clear();

  const superAdminId = await person('المديرة العامة');
  await grant(superAdminId, 'super_admin');
  superAdmin = bearer(superAdminId, [{ role: 'super_admin', branches: null }]);
  academicYearId = (await prisma.academicYear.create({ data: { label: YEAR_LABEL } })).id;

  // R119 — the applicant consents to a specific wording, so the journey submits
  // the id of the text the form would actually render.
  const text = await call('GET', '/registration/consent-text');
  expect(text.status).toBe(200);
  // Top-level, not wrapped in `data` — the anonymous read answers the text itself.
  consentTextId = text.body['id'] as string;
}, 120_000);

/**
 * **`JOURNEY_KEEP=1` leaves the fixture standing, for the browser phase.**
 *
 * `verify-journey.sh` drives the real screens against the state this file
 * produces, and it reuses THIS journey rather than a seed script of its own:
 * a second implementation of the same eleven steps would drift from this one,
 * and the copy that drifts still passes its own tests.
 *
 * The flag is never set in CI, and the verifier re-runs this file without it
 * afterwards so nothing tagged survives — an abandoned fixture is how thirteen
 * test branches once reached the association's public homepage.
 */
afterAll(async () => {
  if (process.env['JOURNEY_KEEP'] !== '1') await clear();
  await prisma.$disconnect();
});

/* ── The association's structure, opened by the Super Admin ───────────────── */

describe('the journey · 1 · the structure the journey needs', () => {
  it('a branch, a category, a subject, and TWO levels', async () => {
    const branch = await call('POST', '/admin/branches', superAdmin, { name: `${TAG} فرع النور` });
    expect(branch.status).toBe(201);
    branchId = createdId(branch);

    const category = await call('POST', '/admin/categories', superAdmin, {
      name: `${TAG} فئة النساء`,
    });
    expect(category.status).toBe(201);
    categoryId = createdId(category);

    /**
     * **The seeded «حفظ القرآن», not a subject of this suite's own.**
     *
     * Memorisation scope is resolved through `Subject.tracks_quran_progress`
     * (`quranSubjectId` reads it with `findFirst`), the flag is seeded rather
     * than settable through any write boundary, and the platform carries
     * exactly one row holding it. A tagged copy would therefore either be
     * ignored or become a second answer to *which subject is the Quran*, so the
     * journey teaches the real one.
     *
     * Identifying WHICH subject holds the flag is setup rather than a business
     * action, and it is read from the row because the API does not expose it:
     * `GET /admin/subjects` returns id, name, order, version and levels, and no
     * `tracks_quran_progress`. That gap is recorded as a finding of this
     * journey — the fact governs who may record memorisation, and no screen
     * built on that read can show it.
     */
    const quran = await prisma.subject.findFirstOrThrow({
      where: { tracksQuranProgress: true, deletedAt: null },
      select: { id: true },
    });
    subjectId = quran.id;

    for (const [label, set] of [
      ['المستوى الأول', (id: string) => (levelAId = id)],
      ['المستوى الثاني', (id: string) => (levelBId = id)],
    ] as const) {
      const level = await call('POST', '/admin/levels', superAdmin, {
        name: `${TAG} ${label}`,
        category_id: categoryId,
        gender_restriction: 'girls_only',
      });
      expect(level.status, label).toBe(201);
      set(createdId(level));
    }

    // §4.4b — a Level teaches a Subject only once the pairing is made.
    for (const id of [levelAId, levelBId]) {
      expect(
        (await call('PUT', `/admin/levels/${id}/subjects/${subjectId}`, superAdmin)).status,
      ).toBe(204);
    }

    // §4.5 — memorisation is recorded against the LEVEL's curriculum, so LEVEL A
    // must actually teach the surah before any progress in it can exist.
    expect(
      (await call('PUT', `/admin/levels/${levelAId}/surahs/${SURAH_ID}`, superAdmin)).status,
    ).toBe(204);

    const thisYear = new Date().getUTCFullYear();
    const period = await call('POST', '/admin/academic-periods', superAdmin, {
      academic_year_id: academicYearId,
      sequence: 1,
      start_date: `${thisYear - 1}-01-01`,
      end_date: `${thisYear + 1}-12-31`,
    });
    expect(period.status).toBe(201);
    academicPeriodId = createdId(period);
  });
});

/* ── 3 · the مؤطِّرة asks to join ──────────────────────────────────────────── */

describe('the journey · 2 · a مؤطِّرة requests registration', () => {
  it('submits the real staff registration, and is created Pending', async () => {
    const res = await call(
      'POST',
      '/registrations',
      undefined,
      {
        kind: 'adult',
        applicant: {
          first_name_arabic: `${TAG} أمينة`,
          last_name_arabic: 'المدرسة',
          sex: 'female',
          phone: '+212600000031',
        },
        requested_role: 'teacher',
        // R130 — a staff request states willingness, not a placement.
        framing: { mode: 'online' },
        consents: { data_processing: true, consent_text_id: consentTextId },
      },
      { 'X-Onboarding-Token': onboarding() },
    );
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    teacherUserId = res.body['applicant_id'] as string;
    teacherApplicationId = teacherUserId;
    expect(res.body['account_status']).toBe('pending');
  });

  it('holds NO role — `requested_role` is a hint that grants nothing (R49)', async () => {
    const granted = await prisma.userBranchRole.findMany({
      where: { userId: teacherUserId, deletedAt: null },
      select: { id: true },
    });
    expect(granted).toHaveLength(0);
  });

  it('reaches no مؤطِّرة functionality before approval', async () => {
    // The status her account actually holds; §19.2 gives a Pending account no
    // authenticated session at all, which is what does the refusing.
    const pending = bearer(teacherUserId, [{ role: 'teacher', branches: null }], 'pending');
    for (const path of ['/quran-students', '/me/calendar', '/assessments/targets?kind=level']) {
      const res = await call('GET', path, pending);
      expect([401, 403], path).toContain(res.status);
    }
  });

  it('the Super Admin can see the pending request on the approvals screen', async () => {
    const res = await call('GET', '/admin/approvals', superAdmin);
    expect(res.status).toBe(200);
    expect(rows(res).some((r) => r['id'] === teacherApplicationId)).toBe(true);
  });
});

/* ── 4 · the adult مستفيدة asks to join ───────────────────────────────────── */

describe('the journey · 3 · an ADULT beneficiary requests registration', () => {
  it('submits the real adult registration with a date of birth', async () => {
    const res = await call(
      'POST',
      '/registrations',
      undefined,
      {
        kind: 'adult',
        applicant: {
          first_name_arabic: `${TAG} خديجة`,
          last_name_arabic: 'الطالبة',
          sex: 'female',
          phone: '+212600000032',
          birth_date: ADULT_BIRTH_DATE,
        },
        branch_id: branchId,
        category_id: categoryId,
        consents: { data_processing: true, consent_text_id: consentTextId },
      },
      { 'X-Onboarding-Token': onboarding() },
    );
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    studentUserId = res.body['applicant_id'] as string;
    studentApplicationId = studentUserId;
    expect(res.body['account_status']).toBe('pending');
  });

  it('is an ADULT — the age is recomputed here, not asserted from the constant', async () => {
    const row = await prisma.user.findUniqueOrThrow({
      where: { id: studentUserId },
      select: { birthDate: true, isBeneficiary: true },
    });
    expect(row.birthDate).not.toBeNull();
    const born = row.birthDate!;
    const now = new Date();
    let age = now.getUTCFullYear() - born.getUTCFullYear();
    const monthDay = now.getUTCMonth() * 100 + now.getUTCDate();
    if (monthDay < born.getUTCMonth() * 100 + born.getUTCDate()) age -= 1;
    expect(age).toBeGreaterThanOrEqual(18);
  });

  it('is given NO guardian — an adult registers herself (§4.3)', async () => {
    const links = await prisma.familyLink.count({
      where: { OR: [{ studentId: studentUserId }, { parentId: studentUserId }] },
    });
    expect(links).toBe(0);
    const childApplications = await prisma.childApplication.count({
      where: { OR: [{ childUserId: studentUserId }, { parentId: studentUserId }] },
    });
    expect(childApplications).toBe(0);
  });

  it('reaches no beneficiary functionality before approval', async () => {
    // A Pending account holds no session at all (§19.2), so the platform's own
    // answer is the refusal — asserted as a refusal, not as a specific screen.
    // The status is the one her account actually holds. Minting an `active`
    // token for a Pending account would prove nothing about the platform: no
    // sign-in could ever produce one (§19.2).
    const pendingToken = bearer(studentUserId, [{ role: 'student', branches: null }], 'pending');
    const res = await call('GET', '/students/me/quran', pendingToken);
    expect([401, 403]).toContain(res.status);
  });

  it('appears on the Super Admin approvals screen', async () => {
    const res = await call('GET', '/admin/approvals', superAdmin);
    expect(res.status).toBe(200);
    expect(rows(res).some((r) => r['id'] === studentApplicationId)).toBe(true);
  });
});

/* ── 5 · the Super Admin approves both ────────────────────────────────────── */

describe('the journey · 4 · the Super Admin approves both requests', () => {
  it('approves the مؤطِّرة, granting the Teacher role in the same transaction', async () => {
    const res = await call('POST', `/admin/approvals/${teacherApplicationId}/approve`, superAdmin, {
      // R49 — the grant rides on the decision, so the account never exists in
      // the active-with-no-role state.
      assignments: [{ role: 'teacher', branch_id: null }],
    });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
  });

  it('approves the adult مستفيدة by PLACING her — the role follows the placement', async () => {
    /**
     * **No `assignments` here, and that is the platform's design rather than an
     * omission.** §4.1/R43 make the placement the defining content of a
     * beneficiary approval, and the `student` role is then granted inside the
     * same transaction with its branch scope *read from where she was placed*
     * (R66.5's Level+branch shape, since LEVEL A has no subdivision). Naming the
     * role explicitly is refused — the approver would be choosing a scope the
     * placement already determines.
     */
    const res = await call('POST', `/admin/approvals/${studentApplicationId}/approve`, superAdmin, {
      enrollments: [{ user_id: studentUserId, level_id: levelAId, branch_id: branchId }],
    });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
  });

  it('both accounts are Active, hold exactly the role granted, and were not duplicated', async () => {
    for (const [id, role] of [
      [teacherUserId, 'teacher'],
      [studentUserId, 'student'],
    ] as const) {
      const user = await prisma.user.findUniqueOrThrow({
        where: { id },
        select: { accountStatus: true, deletedAt: true },
      });
      expect(user.accountStatus, role).toBe('active');
      expect(user.deletedAt).toBeNull();

      const held = await prisma.userBranchRole.findMany({
        where: { userId: id, deletedAt: null },
        select: { role: { select: { name: true } } },
      });
      expect(held.map((r) => r.role.name).sort(), role).toEqual([role]);
      // R79.7 — the durable beneficiary fact, which is what identifies a
      // مستفيدة; role membership alone does not (a مؤطِّرة may also study).
      const { isBeneficiary } = await prisma.user.findUniqueOrThrow({
        where: { id },
        select: { isBeneficiary: true },
      });
      expect(isBeneficiary, role).toBe(role === 'student');
    }

    // **No second account, and no second identity.** An approval activates the
    // applicant row; anything that created a new one would leave the person
    // unable to sign in as themselves.
    for (const name of ['أمينة', 'خديجة']) {
      const matches = await prisma.user.count({
        where: { nameArabic: { startsWith: TAG, contains: name }, deletedAt: null },
      });
      expect(matches, name).toBe(1);
    }
    for (const id of [teacherUserId, studentUserId]) {
      expect(await prisma.userIdentity.count({ where: { userId: id } })).toBeLessThanOrEqual(1);
    }

    teacherToken = bearer(teacherUserId, [{ role: 'teacher', branches: null }]);
    studentToken = bearer(studentUserId, [{ role: 'student', branches: null }]);
  });

  it('the adult مستفيدة still has no guardian — approval invents none', async () => {
    expect(
      await prisma.familyLink.count({
        where: { OR: [{ studentId: studentUserId }, { parentId: studentUserId }] },
      }),
    ).toBe(0);
  });
});

/* ── 6 · two enrolments ───────────────────────────────────────────────────── */

describe('the journey · 5 · the مستفيدة is admitted to TWO Levels', () => {
  it('adds LEVEL B beside the LEVEL A the approval placed her in', async () => {
    const res = await call('POST', '/admin/enrollments', superAdmin, {
      student_id: studentUserId,
      level_id: levelBId,
      branch_id: branchId,
      administrative_group_id: null,
      academic_period_id: academicPeriodId,
    });
    expect(res.status, JSON.stringify(res.body).slice(0, 250)).toBe(201);
  });

  it('BOTH enrolments coexist — neither overwrote the other', async () => {
    const held = await prisma.enrollment.findMany({
      where: { studentId: studentUserId, deletedAt: null },
      select: { levelId: true, academicPeriodId: true },
    });
    expect(held).toHaveLength(2);
    expect(held.map((e) => e.levelId).sort()).toEqual([levelAId, levelBId].sort());
    // R122 — both belong to the same semester, which is the case that would
    // tempt an implementation into treating one Level per year as the rule.
    for (const e of held) expect(e.academicPeriodId).toBe(academicPeriodId);
  });

  it('the enrolment screen shows both', async () => {
    const res = await call('GET', `/admin/enrollments?level_id=${levelAId}`, superAdmin);
    expect(res.status).toBe(200);
    expect(rows(res).some((r) => (r['student'] as { id?: string })?.id === studentUserId
      || r['student_id'] === studentUserId)).toBe(true);

    const b = await call('GET', `/admin/enrollments?level_id=${levelBId}`, superAdmin);
    expect(b.status).toBe(200);
    expect(rows(b).some((r) => (r['student'] as { id?: string })?.id === studentUserId
      || r['student_id'] === studentUserId)).toBe(true);
  });

  it('the two controls exist: a LEVEL-B-only مستفيدة, and an unrelated مؤطِّرة', async () => {
    levelBOnlyId = await person('مستفيدة المستوى الثاني');
    await grant(levelBOnlyId, 'student');
    const enrolled = await call('POST', '/admin/enrollments', superAdmin, {
      student_id: levelBOnlyId,
      level_id: levelBId,
      branch_id: branchId,
      administrative_group_id: null,
      academic_period_id: academicPeriodId,
    });
    expect(enrolled.status).toBe(201);
    levelBOnlyToken = bearer(levelBOnlyId, [{ role: 'student', branches: null }]);

    const otherTeacherId = await person('مؤطِّرة أخرى');
    await grant(otherTeacherId, 'teacher');
    otherTeacherToken = bearer(otherTeacherId, [{ role: 'teacher', branches: null }]);
  });
});

/* ── 7 · the مؤطِّرة is given LEVEL A to teach ─────────────────────────────── */

describe('the journey · 6 · the مؤطِّرة is assigned to teach LEVEL A', () => {
  it('a weekly class on LEVEL A, staffed by her', async () => {
    /**
     * **This IS the assignment** (§4.4c, R73/R87). Teaching authority on this
     * platform is an effective staffing row and the audience it reaches — never
     * a role and never a declared ability. Everything the مؤطِّرة may do below —
     * author, read submissions, mark, publish, record memorisation — is derived
     * from this one row through `studentsTaughtBy`, so the journey creates it
     * explicitly rather than granting her anything extra.
     */
    const created = await call('POST', '/admin/course-schedules', superAdmin, {
      staff: [{ user_id: teacherUserId, position: 'teacher' }],
      title: `${TAG} حلقة القرآن`,
      subject_id: subjectId,
      teaching_mode: 'entire_level',
      target_id: levelAId,
      branch_id: branchId,
      start_time: '09:00',
      end_time: '11:00',
      recurrence: 'weekly',
      weekdays: ['monday'],
      academic_year_id: academicYearId,
    });
    expect(created.status, JSON.stringify(created.body).slice(0, 300)).toBe(201);
  });

  it('her reach now contains the مستفيدة — and contains her ONCE', async () => {
    const res = await call('GET', '/quran-students', teacherToken);
    expect(res.status).toBe(200);
    const students = (res.body.data as { students?: { id: string }[] })?.students
      ?? (res.body.data as { id: string }[]);
    const mine = (students as { id: string }[]).filter((s) => s.id === studentUserId);
    // **The two-enrolment assertion, on the roster.** She holds LEVEL A and
    // LEVEL B; a roster joined through enrolments would list her twice.
    expect(mine).toHaveLength(1);
  });
});

/* ── 8 · the online assessment ────────────────────────────────────────────── */

describe('the journey · 7 · the Super Admin sets an ONLINE assessment on LEVEL A', () => {
  it('creates it, in draft, targeting LEVEL A and nothing else', async () => {
    const res = await call('POST', '/assessments', superAdmin, {
      title: `${TAG} اختبار الحفظ`,
      description: 'أجيبي عن الأسئلة الثلاثة.',
      max_grade: 20,
      level_id: levelAId,
      subject_id: subjectId,
      academic_year_id: academicYearId,
      target: { kind: 'level' },
      date: EXAM_DATE,
    });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    assessmentId = createdId(res);

    const row = await prisma.exam.findUniqueOrThrow({
      where: { id: assessmentId },
      select: { mode: true, status: true, levelId: true, maxGrade: true, targetKind: true },
    });
    expect(row.mode).toBe('online');
    expect(row.status).toBe('draft');
    expect(row.levelId).toBe(levelAId);
    expect(row.targetKind).toBe('level');
    expect(Number(row.maxGrade)).toBe(20);
  });

  it('carries the three supported question kinds', async () => {
    const paper = [
      { kind: 'short_text', prompt: 'اذكري اسم السورة التي حفظتِها هذا الأسبوع.' },
      {
        kind: 'single_choice',
        prompt: 'كم عدد آيات سورة الضحى؟',
        options: ['ثمان آيات', 'إحدى عشرة آية', 'خمس عشرة آية'],
      },
      {
        kind: 'multiple_choice',
        prompt: 'أي مما يلي من آداب التلاوة؟',
        options: ['الطهارة', 'الاستعاذة', 'الإسراع في القراءة'],
      },
    ];
    for (const q of paper) {
      const res = await call('POST', `/assessments/${assessmentId}/questions`, superAdmin, q);
      expect(res.status, `${q.kind} ${JSON.stringify(res.body).slice(0, 250)}`).toBe(201);
      questionIds.push(createdId(res));
    }
    expect(questionIds).toHaveLength(3);
  });

  it('a draft reaches NOBODY — not even the مستفيدة it targets', async () => {
    const paper = await call('GET', `/assessments/${assessmentId}/paper`, studentToken);
    // §20 rule 17 — a draft is indistinguishable from an assessment that does
    // not exist, rather than a 403 that confirms one does.
    expect(paper.status).toBe(404);

    const list = await call('GET', '/me/assessments', studentToken);
    expect(list.status).toBe(200);
    expect(rows(list).some((r) => r['id'] === assessmentId)).toBe(false);
  });

  it('publishes it', async () => {
    const res = await call('POST', `/assessments/${assessmentId}/publish`, superAdmin);
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(204);
    const row = await prisma.exam.findUniqueOrThrow({
      where: { id: assessmentId },
      select: { status: true, publishedAt: true },
    });
    expect(row.status).toBe('published');
    expect(row.publishedAt).not.toBeNull();
  });
});

/* ── 9 · the notifications ────────────────────────────────────────────────── */

describe('the journey · 8 · publication tells the people it concerns', () => {
  const inbox = async (token: string): Promise<Record<string, unknown>[]> => {
    const res = await call('GET', '/notifications', token);
    expect(res.status).toBe(200);
    return rows(res).filter((r) => r['exam_id'] === assessmentId
      || (r['exam'] as { id?: string } | undefined)?.id === assessmentId);
  };

  it('the مستفيدة is told, exactly ONCE despite holding two enrolments', async () => {
    const mine = await inbox(studentToken);
    // **The two-enrolment assertion, on the inbox.** She holds LEVEL A and
    // LEVEL B; a recipient set joined through enrolments delivers twice.
    expect(mine.filter((r) => r['type'] === 'assessment_published')).toHaveLength(1);
  });

  it('the مؤطِّرة who teaches LEVEL A is told', async () => {
    const hers = await inbox(teacherToken);
    expect(hers.filter((r) => r['type'] === 'assessment_published')).toHaveLength(1);
  });

  it('a LEVEL-B-only مستفيدة is told NOTHING — targeting is targeting', async () => {
    expect(await inbox(levelBOnlyToken)).toHaveLength(0);
  });

  it('an unrelated مؤطِّرة is told nothing', async () => {
    expect(await inbox(otherTeacherToken)).toHaveLength(0);
  });

  it('nobody may read another person’s inbox', async () => {
    const mine = await inbox(studentToken);
    const id = mine[0]?.['id'] as string | undefined;
    if (id !== undefined) {
      // §20 rule 17 — another user's row answers 404, never 403.
      expect((await call('POST', `/notifications/${id}/read`, levelBOnlyToken)).status).toBe(404);
      expect((await call('POST', `/notifications/${id}/read`, studentToken)).status).toBeLessThan(300);
    }
  });
});

/* ── 10-11 · she opens it, answers, leaves, returns, submits ──────────────── */

interface PaperQuestion {
  id: string;
  kind: string;
  prompt: string;
  options?: { id: string; label: string }[];
}

const paperFor = async (token: string): Promise<{
  questions: PaperQuestion[];
  submission: { state?: string; answers?: Record<string, unknown>[] } | null;
}> => {
  const res = await call('GET', `/assessments/${assessmentId}/paper`, token);
  expect(res.status, JSON.stringify(res.body).slice(0, 250)).toBe(200);
  // The paper DTO is the response, not a `data` envelope.
  return res.body as never;
};

describe('the journey · 9 · the مستفيدة sits the assessment', () => {
  it('it is on her list, with the right title and the LEVEL-A subject', async () => {
    const res = await call('GET', '/me/assessments', studentToken);
    expect(res.status).toBe(200);
    const mine = rows(res).filter((r) => r['id'] === assessmentId);
    // **Once.** Two enrolments, one row: the list resolves papers, not enrolments.
    expect(mine).toHaveLength(1);
    expect(mine[0]!['title']).toContain('اختبار الحفظ');
    expect(mine[0]!['grade_published']).toBe(false);
  });

  it('a LEVEL-B-only مستفيدة cannot see it or open it', async () => {
    const list = await call('GET', '/me/assessments', levelBOnlyToken);
    expect(list.status).toBe(200);
    expect(rows(list).some((r) => r['id'] === assessmentId)).toBe(false);
    // §20 rule 17 — 404, never 403: the refusal must not confirm it exists.
    expect((await call('GET', `/assessments/${assessmentId}/paper`, levelBOnlyToken)).status).toBe(404);
  });

  it('she opens the paper and finds three questions and no answers yet', async () => {
    const paper = await paperFor(studentToken);
    expect(paper.questions).toHaveLength(3);
    expect(paper.submission).toBeNull();
  });

  it('حفظ — she answers the first question and saves a DRAFT', async () => {
    const paper = await paperFor(studentToken);
    const short = paper.questions.find((q) => q.kind === 'short_text')!;
    const res = await call('PUT', `/assessments/${assessmentId}/responses`, studentToken, {
      answers: [{ question_id: short.id, text: 'سورة الضحى' }],
    });
    expect(res.status, JSON.stringify(res.body).slice(0, 250)).toBe(200);

    const row = await prisma.studentExamSubmission.findFirstOrThrow({
      where: { examId: assessmentId, studentId: studentUserId },
      select: { state: true, submittedAt: true },
    });
    // R127 — SAVE is not SUBMIT, and the state says so.
    expect(row.state).toBe('in_progress');
    expect(row.submittedAt).toBeNull();
  });

  it('she comes back later and her answer is still there — resume', async () => {
    const paper = await paperFor(studentToken);
    expect(paper.submission).not.toBeNull();
    expect(paper.submission!.state).toBe('in_progress');
    const answers = paper.submission!.answers ?? [];
    const kept = answers.find((a) => (a['text'] as string | null) === 'سورة الضحى');
    expect(kept, 'the saved answer must survive the round trip').toBeDefined();
  });

  it('إرسال — she completes the paper and submits, and it becomes final', async () => {
    const paper = await paperFor(studentToken);
    const byKind = (k: string): PaperQuestion => paper.questions.find((q) => q.kind === k)!;
    const single = byKind('single_choice');
    const multi = byKind('multiple_choice');

    const res = await call('POST', `/assessments/${assessmentId}/submit`, studentToken, {
      answers: [
        { question_id: byKind('short_text').id, text: 'سورة الضحى' },
        { question_id: single.id, option_ids: [single.options![1]!.id] },
        {
          question_id: multi.id,
          option_ids: [multi.options![0]!.id, multi.options![1]!.id],
        },
      ],
    });
    expect(res.status, JSON.stringify(res.body).slice(0, 250)).toBe(200);

    const row = await prisma.studentExamSubmission.findFirstOrThrow({
      where: { examId: assessmentId, studentId: studentUserId },
      select: { state: true, submittedAt: true },
    });
    expect(row.state).toBe('submitted');
    expect(row.submittedAt).not.toBeNull();
  });

  it('a submitted paper cannot be silently rewritten — by save OR by resubmit', async () => {
    const paper = await paperFor(studentToken);
    const short = paper.questions.find((q) => q.kind === 'short_text')!;
    const before = await prisma.studentExamAnswer.findMany({
      where: { submission: { examId: assessmentId, studentId: studentUserId } },
      select: { text: true },
      orderBy: { text: 'asc' },
    });

    for (const [verb, path] of [
      ['PUT', `/assessments/${assessmentId}/responses`],
      ['POST', `/assessments/${assessmentId}/submit`],
    ] as const) {
      const res = await call(verb, path, studentToken, {
        answers: [{ question_id: short.id, text: 'إجابة مختلفة تمامًا' }],
      });
      expect(res.status, verb).toBe(409);
      expect(res.body.error?.code, verb).toBe('STATE_CONFLICT');
    }

    // **Refused AND unchanged** — a refusal that still wrote would be worse
    // than one that did not refuse at all.
    const after = await prisma.studentExamAnswer.findMany({
      where: { submission: { examId: assessmentId, studentId: studentUserId } },
      select: { text: true },
      orderBy: { text: 'asc' },
    });
    expect(after).toEqual(before);
  });
});

/* ── 12-13 · the مؤطِّرة marks it, and publishing is what reveals it ───────── */

describe('the journey · 10 · the مؤطِّرة reviews, marks and publishes', () => {
  it('she can see who answered — and the مستفيدة appears ONCE', async () => {
    const res = await call('GET', `/assessments/${assessmentId}/submissions`, teacherToken);
    expect(res.status, JSON.stringify(res.body).slice(0, 250)).toBe(200);
    const mine = rows(res).filter((r) => r['student_id'] === studentUserId
      || (r['student'] as { id?: string } | undefined)?.id === studentUserId);
    expect(mine).toHaveLength(1);
  });

  it('she can read the submitted answers', async () => {
    const res = await call(
      'GET',
      `/assessments/${assessmentId}/submissions/${studentUserId}`,
      teacherToken,
    );
    expect(res.status, JSON.stringify(res.body).slice(0, 250)).toBe(200);
    const paper = res.body as unknown as { submission?: { answers?: { text?: string | null }[] } };
    expect(paper.submission).toBeTruthy();
    expect(
      (paper.submission!.answers ?? []).some((a) => a.text === 'سورة الضحى'),
    ).toBe(true);
  });

  it('an unrelated مؤطِّرة may read neither the list nor the paper', async () => {
    for (const path of [
      `/assessments/${assessmentId}/submissions`,
      `/assessments/${assessmentId}/submissions/${studentUserId}`,
    ]) {
      const res = await call('GET', path, otherTeacherToken);
      expect([403, 404], path).toContain(res.status);
    }
  });

  it('the مستفيدة may not mark her own paper', async () => {
    const res = await call('PUT', `/exams/${assessmentId}/grades`, studentToken, {
      entries: [{ student_id: studentUserId, score: 20, absent: false, version: 0 }],
    });
    expect([403, 404]).toContain(res.status);
  });

  it('a score above the paper’s maximum is refused', async () => {
    const sheet = await call('GET', `/exams/${assessmentId}/grades`, teacherToken);
    expect(sheet.status, JSON.stringify(sheet.body).slice(0, 250)).toBe(200);
    const mine = rows(sheet).find((r) => r['student_id'] === studentUserId)!;
    const res = await call('PUT', `/exams/${assessmentId}/grades`, teacherToken, {
      entries: [
        {
          student_id: studentUserId,
          // The paper is out of 20 (R81 — the maximum belongs to the exam).
          score: 21,
          absent: false,
          version: (mine['version'] as number) ?? 0,
        },
      ],
    });
    expect(res.status).toBe(400);
  });

  it('she marks it — and the mark is a DRAFT, invisible to the مستفيدة', async () => {
    const sheet = await call('GET', `/exams/${assessmentId}/grades`, teacherToken);
    const mine = rows(sheet).find((r) => r['student_id'] === studentUserId)!;
    const res = await call('PUT', `/exams/${assessmentId}/grades`, teacherToken, {
      entries: [
        {
          student_id: studentUserId,
          score: 17.5,
          absent: false,
          version: (mine['version'] as number) ?? 0,
        },
      ],
    });
    expect(res.status, JSON.stringify(res.body).slice(0, 250)).toBe(200);

    const row = await prisma.grade.findFirstOrThrow({
      where: { examId: assessmentId, studentId: studentUserId },
      select: { status: true, score: true },
    });
    expect(row.status).toBe('draft');
    expect(Number(row.score)).toBe(17.5);
  });

  it('BEFORE publication the مستفيدة sees no grade anywhere', async () => {
    const mine = await call('GET', '/students/me/grades', studentToken);
    expect(mine.status).toBe(200);
    expect(rows(mine).some((r) => r['exam_id'] === assessmentId)).toBe(false);

    const list = await call('GET', '/me/assessments', studentToken);
    const row = rows(list).find((r) => r['id'] === assessmentId)!;
    expect(row['grade_published']).toBe(false);

    // And no notification claims one is available.
    const inbox = await call('GET', '/notifications', studentToken);
    expect(
      rows(inbox).some((r) => r['type'] === 'grade_published' && r['exam_id'] === assessmentId),
    ).toBe(false);
  });

  it('she publishes the mark', async () => {
    const res = await call('POST', `/exams/${assessmentId}/grades/publish`, teacherToken);
    expect(res.status, JSON.stringify(res.body).slice(0, 250)).toBe(200);
    const row = await prisma.grade.findFirstOrThrow({
      where: { examId: assessmentId, studentId: studentUserId },
      select: { status: true },
    });
    expect(row.status).toBe('published');
  });
});

describe('the journey · 11 · the مستفيدة sees her published mark', () => {
  it('the score and the scale are hers, and they are the ones that were entered', async () => {
    const res = await call('GET', '/students/me/grades', studentToken);
    expect(res.status).toBe(200);
    const mine = rows(res).filter((r) => r['exam_id'] === assessmentId);
    // Once — not once per enrolment.
    expect(mine).toHaveLength(1);
    expect(Number(mine[0]!['score'])).toBe(17.5);
    // R81 — each row carries its OWN maximum.
    expect(Number(mine[0]!['max_grade'] ?? mine[0]!['max_score'])).toBe(20);
  });

  it('her assessment list now says the grade is published', async () => {
    const list = await call('GET', '/me/assessments', studentToken);
    const row = rows(list).find((r) => r['id'] === assessmentId)!;
    expect(row['grade_published']).toBe(true);
  });

  it('publication told her — the existing grade_published notice, once', async () => {
    const res = await call('GET', '/notifications', studentToken);
    const told = rows(res).filter(
      (r) => r['type'] === 'grade_published' && r['exam_id'] === assessmentId,
    );
    expect(told).toHaveLength(1);
  });

  it('no unrelated مستفيدة gained a grade or a notice', async () => {
    const res = await call('GET', '/students/me/grades', levelBOnlyToken);
    expect(res.status).toBe(200);
    expect(rows(res).some((r) => r['exam_id'] === assessmentId)).toBe(false);
  });
});

/* ── 14-16 · the Quran memorization session, and the entry on it ──────────── */

describe('the journey · 12 · the LEVEL-A Quran class and its roster', () => {
  it('the class the مؤطِّرة teaches has MATERIALIZED occurrences she staffs', async () => {
    /**
     * **A Session is not created directly, and no route offers it.** §4.4/TD-4.6c
     * make an occurrence a materialized row of a `RecurringCourseSchedule`,
     * which is why there is no `POST /sessions` in TD-3 — the administration
     * organises the teaching and the مؤطِّرة delivers it. The Quran class was
     * therefore opened by the Super Admin in step 6 and its occurrences exist
     * as rows; what follows asserts they are hers and that she can work on them.
     */
    const schedule = await prisma.recurringCourseSchedule.findFirstOrThrow({
      where: { title: { startsWith: TAG }, deletedAt: null },
      select: { id: true, subjectId: true, levelId: true },
    });
    expect(schedule.subjectId).toBe(subjectId);
    expect(schedule.levelId).toBe(levelAId);

    const occurrences = await prisma.session.findMany({
      where: { scheduleId: schedule.id, deletedAt: null },
      select: { id: true, date: true },
      orderBy: { date: 'asc' },
    });
    expect(occurrences.length).toBeGreaterThan(0);
    quranSessionId = occurrences[0]!.id;

    // It is the مؤطِّرة's own occurrence — the snapshot R43.4 keeps per session.
    const staffed = await prisma.sessionStaff.count({
      where: { sessionId: quranSessionId, userId: teacherUserId, deletedAt: null },
    });
    expect(staffed).toBe(1);
  });

  it('a مؤطِّرة may NOT open a class herself — and that boundary is not widened here', async () => {
    const res = await call('POST', '/admin/course-schedules', teacherToken, {
      staff: [{ user_id: teacherUserId, position: 'teacher' }],
      title: `${TAG} حلقة لا يجوز إنشاؤها`,
      subject_id: subjectId,
      teaching_mode: 'entire_level',
      target_id: levelAId,
      branch_id: branchId,
      start_time: '14:00',
      end_time: '15:00',
      recurrence: 'weekly',
      weekdays: ['tuesday'],
      academic_year_id: academicYearId,
    });
    expect([403, 404]).toContain(res.status);
  });

  it('the occurrence’s roster carries the مستفيدة exactly ONCE', async () => {
    const res = await call('GET', `/sessions/${quranSessionId}/roster`, teacherToken);
    expect(res.status, JSON.stringify(res.body).slice(0, 250)).toBe(200);
    const body = res.body.data as Record<string, unknown>;
    const people = (Array.isArray(body) ? body : (body['students'] ?? body['audience'])) as
      | { id: string }[]
      | undefined;
    expect(people, 'the roster must list its audience').toBeDefined();
    // **The two-enrolment assertion, on the class roster.**
    expect(people!.filter((s) => s.id === studentUserId)).toHaveLength(1);
  });
});

describe('the journey · 13 · the مؤطِّرة records new memorization', () => {
  it('the مستفيدة is on her Quran roster once, with LEVEL A available', async () => {
    const res = await call('GET', '/quran-students', teacherToken);
    expect(res.status).toBe(200);
    const body = res.body.data as {
      students: { id: string; level_ids: string[] }[];
      levels: { level_id: string; surahs: { surah_id: number }[] }[];
    };
    // **The two-enrolment assertion, on the memorisation roster.**
    const mine = body.students.filter((s) => s.id === studentUserId);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.level_ids).toContain(levelAId);
    const levelA = body.levels.find((l) => l.level_id === levelAId);
    expect(levelA, 'LEVEL A must be offered — it carries a curriculum').toBeDefined();
    expect(levelA!.surahs.some((x) => x.surah_id === SURAH_ID)).toBe(true);
  });

  it('records الحفظ الجديد for سورة الضحى, آيات 1–5', async () => {
    const res = await call('POST', '/quran-logs', teacherToken, {
      student_id: studentUserId,
      level_id: levelAId,
      surah_id: SURAH_ID,
      start_ayah: 1,
      end_ayah: 5,
      category: 'new_memorization',
    });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
  });

  it('it persists, against the right مستفيدة, by the right مؤطِّرة, exactly once', async () => {
    const logs = await prisma.quranProgressLog.findMany({
      where: { studentId: studentUserId, surahId: SURAH_ID, deletedAt: null },
      select: { startAyah: true, endAyah: true, category: true, loggedById: true },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0]!.startAyah).toBe(1);
    expect(logs[0]!.endAyah).toBe(5);
    expect(logs[0]!.category).toBe('new_memorization');
    expect(logs[0]!.loggedById).toBe(teacherUserId);
  });

  it('a range beyond the surah is refused — الضحى has 11 آيات', async () => {
    const res = await call('POST', '/quran-logs', teacherToken, {
      student_id: studentUserId,
      level_id: levelAId,
      surah_id: SURAH_ID,
      start_ayah: 1,
      end_ayah: 40,
      category: 'new_memorization',
    });
    expect(res.status).toBe(400);
  });

  it('an unrelated مؤطِّرة may not write progress for this مستفيدة', async () => {
    const res = await call('POST', '/quran-logs', otherTeacherToken, {
      student_id: studentUserId,
      level_id: levelAId,
      surah_id: SURAH_ID,
      start_ayah: 6,
      end_ayah: 7,
      category: 'new_memorization',
    });
    expect([403, 404]).toContain(res.status);
    // Refused AND nothing written.
    expect(
      await prisma.quranProgressLog.count({
        where: { studentId: studentUserId, startAyah: 6, deletedAt: null },
      }),
    ).toBe(0);
  });

  it('the مستفيدة may not write her own staff-side record', async () => {
    const res = await call('POST', '/quran-logs', studentToken, {
      student_id: studentUserId,
      level_id: levelAId,
      surah_id: SURAH_ID,
      start_ayah: 8,
      end_ayah: 9,
      category: 'new_memorization',
    });
    expect([403, 404]).toContain(res.status);
  });
});

describe('the journey · 14 · her Quran record shows it', () => {
  it('the مستفيدة sees her own new memorization', async () => {
    const res = await call('GET', '/students/me/quran', studentToken);
    expect(res.status, JSON.stringify(res.body).slice(0, 250)).toBe(200);
    const serialized = JSON.stringify(res.body);
    expect(serialized).toContain('"surah_id":93');
  });

  it('the مؤطِّرة sees the same entry on her student’s record', async () => {
    const res = await call('GET', `/students/${studentUserId}/quran`, teacherToken);
    expect(res.status, JSON.stringify(res.body).slice(0, 250)).toBe(200);
    expect(JSON.stringify(res.body)).toContain('"surah_id":93');
  });

  it('an unrelated مؤطِّرة reads nothing about her — 404, never 403', async () => {
    const res = await call('GET', `/students/${studentUserId}/quran`, otherTeacherToken);
    expect(res.status).toBe(404);
  });
});

/* ── 17 · the permission matrix, asserted rather than assumed ─────────────── */

describe('the journey · 15 · the boundaries hold in both directions', () => {
  it('a مؤطِّرة cannot sit a paper as though she were the مستفيدة', async () => {
    // The student endpoints resolve the ACTING student, and she is not one.
    for (const [verb, path] of [
      ['GET', `/assessments/${assessmentId}/paper`],
      ['PUT', `/assessments/${assessmentId}/responses`],
      ['POST', `/assessments/${assessmentId}/submit`],
    ] as const) {
      const res = await call(verb, path, teacherToken, verb === 'GET' ? undefined : { answers: [] });
      expect(res.status, `${verb} ${path}`).toBeGreaterThanOrEqual(400);
    }
    // And the مستفيدة's own submission is untouched by any of it.
    const row = await prisma.studentExamSubmission.findFirstOrThrow({
      where: { examId: assessmentId, studentId: studentUserId },
      select: { state: true },
    });
    expect(row.state).toBe('submitted');
  });

  it('a مستفيدة cannot reach the authoring or marking side', async () => {
    for (const [verb, path] of [
      ['GET', `/assessments/${assessmentId}`],
      ['GET', `/assessments/${assessmentId}/submissions`],
      ['POST', `/assessments/${assessmentId}/close`],
      ['GET', '/assessments/targets?kind=level'],
    ] as const) {
      const res = await call(verb, path, studentToken, verb === 'POST' ? {} : undefined);
      expect(res.status, `${verb} ${path}`).toBeGreaterThanOrEqual(400);
    }
  });

  it('the memorisation roster discloses nothing to a beneficiary', async () => {
    /**
     * **Asserted as disclosure, not as a status code.** `GET /quran-students`
     * answers `200` with an empty roster for a مستفيدة rather than refusing:
     * she reaches the مؤطِّرة branch of the resolver, `studentsTaughtBy` returns
     * nobody, and the list is empty. That is safe — and it is a different shape
     * from `GET /assessments/targets`, which refuses a beneficiary outright on
     * the stated reasoning that *an empty list is an answer, and «you may not
     * ask» is a different one*. The inconsistency is recorded rather than
     * changed here: the security property is what this journey must hold, and
     * narrowing a route's contract is the Document Owner's call.
     */
    const res = await call('GET', '/quran-students', studentToken);
    const body = res.body.data as { students: unknown[]; levels: unknown[] } | undefined;
    expect(body?.students ?? []).toHaveLength(0);
    expect(body?.levels ?? []).toHaveLength(0);
  });

  it('a مستفيدة cannot reach the administration at all', async () => {
    for (const path of ['/admin/approvals', '/admin/enrollments', '/admin/levels']) {
      const res = await call('GET', path, studentToken);
      expect([403, 404], path).toContain(res.status);
    }
  });

  it('the Super Admin retains the administrative reads this journey used', async () => {
    for (const path of ['/admin/approvals', `/admin/enrollments?level_id=${levelAId}`]) {
      expect((await call('GET', path, superAdmin)).status, path).toBe(200);
    }
  });

  it('the LEVEL-B enrolment never became a way in', async () => {
    // The single most important negative of this scenario, restated at the end
    // against every surface the journey touched.
    expect((await call('GET', `/assessments/${assessmentId}/paper`, levelBOnlyToken)).status).toBe(404);
    expect(
      rows(await call('GET', '/me/assessments', levelBOnlyToken)).some(
        (r) => r['id'] === assessmentId,
      ),
    ).toBe(false);
    expect(
      rows(await call('GET', '/students/me/grades', levelBOnlyToken)).some(
        (r) => r['exam_id'] === assessmentId,
      ),
    ).toBe(false);
    const inbox = await call('GET', '/notifications', levelBOnlyToken);
    expect(rows(inbox).some((r) => r['exam_id'] === assessmentId)).toBe(false);
  });
});
