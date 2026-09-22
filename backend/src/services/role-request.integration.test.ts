import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../lib/config.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import { actorFor } from '../test-support/actor.js';
import { clearOwnedConsumedTokens, ownedOnboardingTokens } from '../test-support/consumed-tokens.js';
import { clearOwnedEmailLocks } from '../test-support/email-locks.js';
import {
  deleteTestConsentText,
  installTestConsentText,
  removeTestConsentText,
  type InstalledConsentText,
} from '../test-support/legal-consent-text.js';
import { clearPlacement, provisionPlacement, type Placement } from '../test-support/placement.js';
import {
  furtherRoleRequestSchema,
  registrationSchema,
  type RegistrationInput,
} from '../validators/registration.validators.js';
import { decide, listApprovals } from './approval.service.js';
import { decideChildApplication, submitChildApplications } from './child-application.service.js';
import { offeredCircleSlots } from './registration-circle-slots.service.js';
import { register } from './registration.service.js';
import { decideRoleRequest, myRoleRequests, requestFurtherRole } from './role-request.service.js';

/**
 * **SRS Revision 168 §1 — one registration form, four roles, each decided on
 * its own.** Against the real database: what is under test is what a
 * transaction writes and what a second decision finds, and a mocked client would
 * prove neither.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const tokens = ownedOnboardingTokens();
const KEY = config.ONBOARDING_TOKEN_KEY;
const TAG = '[role-request-test]';
const PLACE = '[role-request-place]';

let consentText: InstalledConsentText | null = null;
let placement: Placement;
let superAdminId = '';
let adminId = '';
let counter = 0;

const person = (label: string, birth = false) => ({
  first_name_arabic: `${TAG} ${label}`,
  last_name_arabic: 'العلوي',
  phone: '+212600000001',
  sex: 'female' as const,
  ...(birth ? { birth_date: '1990-04-12' } : {}),
});

const child = (label: string) => ({
  first_name_arabic: `${TAG} ${label}`,
  last_name_arabic: 'العلوي',
  sex: 'female' as const,
  birth_date: '2016-02-03',
  consent_media_release: false,
  requested_branch_id: placement.branchId,
  requested_category_id: placement.categoryId,
});

/** The RAW request — what a browser sends, before the schema parses it. */
type RoleKind = Extract<RegistrationInput, { kind: 'roles' }>['roles'][number];

function body(over: { roles: RoleKind[] } & Record<string, unknown>): unknown {
  return {
    kind: 'roles',
    applicant: person('متقدمة', over.roles.includes('student')),
    consents: { data_processing: true, consent_text_id: consentText!.id },
    ...over,
  };
}

async function submit(input: unknown): Promise<string> {
  counter += 1;
  const parsed = registrationSchema.parse(input);
  const { token } = tokens.issue(
    {
      email: `role-${Date.now()}-${counter}@example.com`,
      providerSubjectId: `role-sub-${Date.now()}-${counter}`,
    },
    KEY,
  );
  return (await register(prisma, token, parsed, KEY)).applicantId;
}

async function staff(label: string, role: 'admin' | 'super_admin'): Promise<string> {
  const user = await prisma.user.create({
    data: { sex: 'female', nameArabic: `${TAG} ${label}`, accountStatus: 'active' },
  });
  const roleRow = await prisma.role.findUniqueOrThrow({ where: { name: role } });
  await prisma.userBranchRole.create({ data: { userId: user.id, roleId: roleRow.id, branchId: null } });
  return user.id;
}

async function clear(): Promise<void> {
  const ids = (
    await prisma.user.findMany({ where: { nameArabic: { startsWith: TAG } }, select: { id: true } })
  ).map((u) => u.id);
  await prisma.notification.deleteMany({
    where: { OR: [{ userId: { in: ids } }, { subjectUserId: { in: ids } }] },
  });
  await prisma.childApplication.deleteMany({
    where: { OR: [{ parentId: { in: ids } }, { childUserId: { in: ids } }, { decidedById: { in: ids } }] },
  });
  await prisma.auditLog.deleteMany({
    where: { OR: [{ targetId: { in: ids } }, { actorUserId: { in: ids } }] },
  });
  await prisma.consentRecord.deleteMany({
    where: { OR: [{ studentId: { in: ids } }, { grantedByUserId: { in: ids } }] },
  });
  await prisma.familyLink.deleteMany({ where: { OR: [{ parentId: { in: ids } }, { studentId: { in: ids } }] } });
  await prisma.enrollment.deleteMany({ where: { studentId: { in: ids } } });
  await prisma.framingPreferenceBranch.deleteMany({ where: { userId: { in: ids } } });
  await prisma.framingPreference.deleteMany({ where: { userId: { in: ids } } });
  await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } });
  await prisma.refreshSession.deleteMany({ where: { userId: { in: ids } } });
  await prisma.userIdentity.deleteMany({ where: { userId: { in: ids } } });
  await prisma.userBranchRole.deleteMany({ where: { userId: { in: ids } } });
  // role_request and circle_preference go WITH the person (ON DELETE CASCADE).
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await clearOwnedConsumedTokens(prisma, tokens);
  await clearOwnedEmailLocks(prisma, tokens.issuedEmails);

  const schedules = await prisma.recurringCourseSchedule.findMany({
    where: { title: { startsWith: TAG } },
    select: { id: true },
  });
  await prisma.session.deleteMany({ where: { scheduleId: { in: schedules.map((s) => s.id) } } });
  await prisma.recurringCourseSchedule.deleteMany({ where: { id: { in: schedules.map((s) => s.id) } } });
  await prisma.teachingGroup.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.subject.deleteMany({ where: { name: { startsWith: TAG } } });
  await clearPlacement(prisma, PLACE);
}

beforeEach(async () => {
  await clear();
  consentText ??= await installTestConsentText(prisma, 'role-request-v1');
  placement = await provisionPlacement(prisma, PLACE);
  superAdminId = await staff('مديرة النظام', 'super_admin');
  adminId = await staff('مديرة', 'admin');
});

afterAll(async () => {
  // Restored FIRST (B10): the installation gets its own wording back even if
  // the teardown below fails. Deleted LAST: `consent_text_id` is RESTRICT, so
  // the scratch row is free to go only once this suite's consent records have.
  await removeTestConsentText(prisma, consentText);
  await clear();
  await deleteTestConsentText(prisma, consentText);
  await prisma.$disconnect();
});

const requestsOf = async (userId: string) =>
  Object.fromEntries(
    (await prisma.roleRequest.findMany({ where: { userId }, select: { kind: true, status: true } })).map(
      (r) => [r.kind, r.status],
    ),
  );
const statusOf = async (userId: string) =>
  (await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { accountStatus: true } })).accountStatus;
const rolesOf = async (userId: string) =>
  (
    await prisma.userBranchRole.findMany({
      where: { userId, deletedAt: null },
      select: { role: { select: { name: true } } },
    })
  )
    .map((r) => r.role.name)
    .sort();
const failure = async (run: () => Promise<unknown>) => {
  try {
    await run();
    return {};
  } catch (error) {
    return error as { code?: string; details?: Record<string, unknown> };
  }
};

/* ── The contract ─────────────────────────────────────────────────────────── */

describe('the request: a section for every role asked for, and for no other', () => {
  const ok = (input: unknown): boolean => registrationSchema.safeParse(input).success;
  const student = { branch_id: '00000000-0000-4000-8000-000000000001', category_id: '00000000-0000-4000-8000-000000000002', first_time: false };
  const base = (roles: string[], extra: Record<string, unknown> = {}, birth = false) => ({
    kind: 'roles',
    roles,
    applicant: { first_name_arabic: 'فاطمة', last_name_arabic: 'العلوي', phone: '+212600000001', sex: 'female', ...(birth ? { birth_date: '1990-04-12' } : {}) },
    consents: { data_processing: true, consent_text_id: '00000000-0000-4000-8000-000000000003' },
    ...extra,
  });

  it('accepts any combination, asking her identity ONCE', () => {
    expect(ok(base(['student'], { student }, true))).toBe(true);
    expect(ok(base(['administration'], { administration: { branch_id: null } }))).toBe(true);
    expect(
      ok(
        base(
          ['student', 'teaching', 'administration'],
          { student, teaching: { framing: { mode: 'online' } }, administration: { branch_id: null } },
          true,
        ),
      ),
    ).toBe(true);
  });

  it('refuses a ticked role with no section, a section with no ticked role, a role twice, and no role at all', () => {
    expect(ok(base(['student'], {}, true))).toBe(false);
    expect(ok(base(['teaching'], { teaching: { framing: { mode: 'online' } }, administration: { branch_id: null } }))).toBe(false);
    expect(ok(base(['teaching', 'teaching'], { teaching: { framing: { mode: 'online' } } }))).toBe(false);
    expect(ok(base([], {}))).toBe(false);
  });

  it('collects a date of birth from a beneficiary and from nobody else', () => {
    expect(ok(base(['student'], { student }))).toBe(false);
    expect(ok(base(['teaching'], { teaching: { framing: { mode: 'online' } } }, true))).toBe(false);
  });

  it('never lets the applicant say WHICH administrative role', () => {
    expect(ok(base(['administration'], { administration: { branch_id: null, role: 'super_admin' } }))).toBe(false);
  });

  it('takes circle preferences from a FIRST-TIME beneficiary only, each circle once', () => {
    const circle = '00000000-0000-4000-8000-000000000009';
    expect(ok(base(['student'], { student: { ...student, first_time: true, circle_preferences: [circle] } }, true))).toBe(true);
    expect(ok(base(['student'], { student: { ...student, circle_preferences: [circle] } }, true))).toBe(false);
    expect(ok(base(['student'], { student: { ...student, first_time: true, circle_preferences: [circle, circle] } }, true))).toBe(false);
  });
});

/* ── What one submission writes ──────────────────────────────────────────── */

describe('one submission, several roles', () => {
  it('writes ONE person, one request per role, her children as applications and her framing — and grants nothing', async () => {
    const id = await submit(
      body({
        roles: ['student', 'guardian', 'teaching', 'administration'],
        student: { branch_id: placement.branchId, category_id: placement.categoryId, first_time: false },
        children: [child('ابنة أولى'), child('ابنة ثانية')],
        teaching: { framing: { mode: 'online' } },
        administration: { branch_id: null },
      }),
    );

    expect(await requestsOf(id)).toEqual({
      student: 'pending',
      guardian: 'pending',
      teaching: 'pending',
      administration: 'pending',
    });
    expect(await statusOf(id)).toBe('pending');
    expect(await rolesOf(id)).toEqual([]);
    expect(await prisma.childApplication.count({ where: { parentId: id, status: 'pending' } })).toBe(2);
    expect(await prisma.framingPreference.count({ where: { userId: id } })).toBe(1);
    const student = await prisma.roleRequest.findUniqueOrThrow({
      where: { userId_kind: { userId: id, kind: 'student' } },
      select: { firstTime: true },
    });
    expect(student.firstTime).toBe(false);
  });

  it('the two older request shapes are the same thing with one role each', async () => {
    const adult = await submit({
      kind: 'adult',
      applicant: person('بالغة', true),
      branch_id: placement.branchId,
      category_id: placement.categoryId,
      consents: { data_processing: true, consent_text_id: consentText!.id },
    });
    const family = await submit({
      kind: 'parent_child',
      parent: person('أم'),
      children: [child('طفلة')],
      consents: { data_processing: true, consent_text_id: consentText!.id },
    });
    expect(await requestsOf(adult)).toEqual({ student: 'pending' });
    expect(await requestsOf(family)).toEqual({ guardian: 'pending' });
  });
});

/* ── The circles on offer ────────────────────────────────────────────────── */

describe('the memorisation circles a first-time مستفيدة may order', () => {
  /** Three حلقات of the memorisation Subject at the Category's first Level, and
   *  a weekly class for two of them at the branch — the third has none. */
  async function circles(): Promise<{ tuesday: string; thursday: string; unscheduled: string }> {
    // The REAL tracker: at most one live Subject may carry the marker.
    const tracker = await prisma.subject.findFirstOrThrow({
      where: { tracksQuranProgress: true, deletedAt: null },
      select: { id: true },
    });
    const year = await prisma.academicYear.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } });
    const make = async (name: string): Promise<string> =>
      (
        await prisma.teachingGroup.create({
          data: { name: `${TAG} ${name}`, levelId: placement.levelId, subjectId: tracker.id },
        })
      ).id;
    const tuesday = await make('حلقة الثلاثاء');
    const thursday = await make('حلقة الخميس');
    const unscheduled = await make('حلقة بلا حصة');
    const at = (h: number): Date => new Date(Date.UTC(1970, 0, 1, h, 0, 0));
    const weekly = (teachingGroupId: string, weekday: 'tuesday' | 'thursday', from: number, to: number) =>
      prisma.recurringCourseSchedule.create({
        data: {
          title: `${TAG} ${weekday}`,
          subjectId: tracker.id,
          teachingMode: 'teaching_group',
          teachingGroupId,
          branchId: placement.branchId,
          academicYearId: year.id,
          recurrence: 'weekly',
          weekdays: [weekday],
          startTime: at(from),
          endTime: at(to),
          anchorDate: new Date('2026-01-05T00:00:00.000Z'),
        },
      });
    await weekly(tuesday, 'tuesday', 15, 20);
    await weekly(thursday, 'thursday', 9, 12);
    return { tuesday, thursday, unscheduled };
  }

  it('are the SCHEDULED classes of her Category’s first Level at her branch — a حلقة with no class has no time to offer', async () => {
    const made = await circles();
    const view = await offeredCircleSlots(prisma, placement.categoryId, placement.branchId);
    expect(view.level?.id).toBe(placement.levelId);
    expect(view.circles.map((c) => c.teaching_group_id).sort()).toEqual([made.tuesday, made.thursday].sort());
    const tuesday = view.circles.find((c) => c.teaching_group_id === made.tuesday)!;
    expect(tuesday.meetings).toEqual([{ weekdays: ['tuesday'], start_time: '15:00', end_time: '20:00' }]);
    // …and it publishes nothing about who teaches or who attends.
    expect(Object.keys(tuesday).sort()).toEqual(['meetings', 'name', 'teaching_group_id']);

    // Another branch has scheduled nothing: no choice is offered there.
    const elsewhere = await prisma.branch.create({ data: { name: `${PLACE} فرع آخر` } });
    expect((await offeredCircleSlots(prisma, placement.categoryId, elsewhere.id)).circles).toEqual([]);
  });

  it('her order is kept as she gave it — and a circle that is not on offer is refused, whole', async () => {
    const made = await circles();
    const id = await submit(
      body({
        roles: ['student'],
        student: {
          branch_id: placement.branchId,
          category_id: placement.categoryId,
          first_time: true,
          circle_preferences: [made.thursday, made.tuesday],
        },
      }),
    );
    expect(
      await prisma.circlePreference.findMany({
        where: { userId: id },
        orderBy: { rank: 'asc' },
        select: { teachingGroupId: true, rank: true },
      }),
    ).toEqual([
      { teachingGroupId: made.thursday, rank: 1 },
      { teachingGroupId: made.tuesday, rank: 2 },
    ]);

    const before = await prisma.user.count({ where: { nameArabic: { startsWith: TAG } } });
    const refused = await failure(() =>
      submit(
        body({
          roles: ['student'],
          student: {
            branch_id: placement.branchId,
            category_id: placement.categoryId,
            first_time: true,
            circle_preferences: [made.unscheduled],
          },
        }),
      ),
    );
    expect(refused).toMatchObject({ code: 'VALIDATION_FAILED', details: { reason: 'CIRCLE_NOT_OFFERED' } });
    // Atomic (TD-4.1): the refused submission left nobody behind.
    expect(await prisma.user.count({ where: { nameArabic: { startsWith: TAG } } })).toBe(before);

    // The approver sees her order beside the request.
    const queue = await listApprovals(prisma, await actorFor(prisma, superAdminId), { reviewUserId: id });
    expect(queue.data[0]?.circlePreferences.map((p) => [p.teachingGroupId, p.rank])).toEqual([
      [made.thursday, 1],
      [made.tuesday, 2],
    ]);
    expect(queue.data[0]?.roleRequests).toEqual([{ kind: 'student', status: 'pending', firstTime: true }]);
  });
});

/* ── Each role, decided on its own ───────────────────────────────────────── */

describe('each requested role is decided separately', () => {
  const everything = () =>
    submit(
      body({
        roles: ['student', 'guardian', 'teaching', 'administration'],
        student: { branch_id: placement.branchId, category_id: placement.categoryId, first_time: false },
        children: [child('ابنة')],
        teaching: { framing: { mode: 'online' } },
        administration: { branch_id: null },
      }),
    );

  it('the first approval activates the account; a later one ADDS its role and revokes nothing', async () => {
    const id = await everything();
    const boss = await actorFor(prisma, superAdminId);

    const asStudent = await decideRoleRequest(prisma, boss, id, 'student', {
      approve: true,
      placement: { administrativeGroupId: placement.groupId },
    });
    expect(asStudent).toEqual({ status: 'approved', accountStatus: 'active' });
    expect(await rolesOf(id)).toEqual(['student']);
    expect(await prisma.enrollment.count({ where: { studentId: id, deletedAt: null } })).toBe(1);

    await decideRoleRequest(prisma, boss, id, 'teaching', {
      approve: true,
      grant: { role: 'teacher', branchId: placement.branchId },
    });
    expect(await rolesOf(id)).toEqual(['student', 'teacher']);

    // Still in the queue: two of her requests are waiting. (Now that she is
    // active, her child's application is a queue item of its own beside it.)
    const queue = await listApprovals(prisma, boss, { reviewUserId: id });
    const registration = queue.data.filter((item) => item.type === 'registration');
    expect(registration).toHaveLength(1);
    expect(Object.fromEntries(registration[0]!.roleRequests.map((r) => [r.kind, r.status]))).toEqual({
      student: 'approved',
      guardian: 'pending',
      teaching: 'approved',
      administration: 'pending',
    });

    // Decided is decided.
    expect(
      await failure(() => decideRoleRequest(prisma, boss, id, 'teaching', { approve: false, reason: 'ثانيةً' })),
    ).toMatchObject({ code: 'STATE_CONFLICT', details: { reason: 'ALREADY_DECIDED' } });
  });

  it('WHICH administrative role is the Super Admin’s to say — and only hers to decide at all', async () => {
    const id = await everything();
    expect(
      await failure(async () =>
        decideRoleRequest(prisma, await actorFor(prisma, adminId), id, 'administration', {
          approve: true,
          grant: { role: 'admin', branchId: null },
        }),
      ),
    ).toMatchObject({ code: 'FORBIDDEN' });

    const boss = await actorFor(prisma, superAdminId);
    // A teaching request cannot be turned into an administrative grant.
    expect(
      await failure(() =>
        decideRoleRequest(prisma, boss, id, 'teaching', { approve: true, grant: { role: 'admin', branchId: null } }),
      ),
    ).toMatchObject({ code: 'VALIDATION_FAILED', details: { reason: 'ROLE_NOT_GRANTABLE_HERE' } });

    await decideRoleRequest(prisma, boss, id, 'administration', {
      approve: true,
      grant: { role: 'admin', branchId: placement.branchId },
    });
    expect(await rolesOf(id)).toEqual(['admin']);
    expect(await statusOf(id)).toBe('active');
  });

  it('a beneficiary is approved by PLACING her — nothing else', async () => {
    const id = await everything();
    expect(
      await failure(async () =>
        decideRoleRequest(prisma, await actorFor(prisma, superAdminId), id, 'student', { approve: true }),
      ),
    ).toMatchObject({ code: 'VALIDATION_FAILED', details: { reason: 'ENROLLMENT_REQUIRED' } });
    expect(await requestsOf(id)).toMatchObject({ student: 'pending' });
  });

  it('declining «أسجّل أبنائي» rejects her children with it and takes nothing else away; approving a child IS accepting her', async () => {
    const id = await everything();
    const boss = await actorFor(prisma, superAdminId);
    await decideRoleRequest(prisma, boss, id, 'student', {
      approve: true,
      placement: { administrativeGroupId: placement.groupId },
    });
    const application = await prisma.childApplication.findFirstOrThrow({ where: { parentId: id } });

    await decideRoleRequest(prisma, boss, id, 'guardian', { approve: false, reason: 'لا تتوفر شروط التسجيل' });
    expect(
      (await prisma.childApplication.findUniqueOrThrow({ where: { id: application.id } })).status,
    ).toBe('rejected');
    // She keeps what was approved: declining one role takes nothing else away.
    expect(await statusOf(id)).toBe('active');
    expect(await rolesOf(id)).toEqual(['student']);

    // Another mother, whose child is approved directly — as it always could be.
    // That IS her acceptance as a guardian, and the queue says so.
    const mother = await submit(body({ roles: ['guardian'], children: [child('ابنة أخرى')] }));
    const hers = await prisma.childApplication.findFirstOrThrow({ where: { parentId: mother } });
    await decideChildApplication(prisma, boss, hers.id, {
      approve: true,
      placement: { administrativeGroupId: placement.groupId },
    });
    expect(await requestsOf(mother)).toEqual({ guardian: 'approved' });
  });

  it('the account is REJECTED only when every role has been declined — and a decline needs a reason', async () => {
    const id = await submit(
      body({
        roles: ['teaching', 'administration'],
        teaching: { framing: { mode: 'online' } },
        administration: { branch_id: null },
      }),
    );
    const boss = await actorFor(prisma, superAdminId);
    expect(
      await failure(() => decideRoleRequest(prisma, boss, id, 'teaching', { approve: false })),
    ).toMatchObject({ code: 'VALIDATION_FAILED' });

    await decideRoleRequest(prisma, boss, id, 'teaching', { approve: false, reason: 'لا حاجة حاليًا' });
    expect(await statusOf(id)).toBe('pending');
    const last = await decideRoleRequest(prisma, boss, id, 'administration', { approve: false, reason: 'لا حاجة حاليًا' });
    expect(last).toEqual({ status: 'declined', accountStatus: 'rejected' });
    expect(await rolesOf(id)).toEqual([]);
    expect(
      await prisma.auditLog.count({ where: { targetId: id, actionType: 'rolerequest.decline' } }),
    ).toBe(2);
  });

  it('the whole-account decision refuses a several-role registration, and keeps a one-role one in step', async () => {
    const several = await everything();
    const boss = await actorFor(prisma, superAdminId);
    expect(
      await failure(() => decide(prisma, boss, several, { approve: false, reason: 'كلّها' })),
    ).toMatchObject({ code: 'VALIDATION_FAILED', details: { reason: 'DECIDE_PER_ROLE' } });

    const one = await submit(body({ roles: ['teaching'], teaching: { framing: { mode: 'online' } } }));
    await decide(prisma, boss, one, { approve: true, assignments: [{ role: 'teacher', branchId: null }] });
    expect(await requestsOf(one)).toEqual({ teaching: 'approved' });
  });

  it('a lone administration request is never decided whole — that act is open to an Admin, and this decision is not', async () => {
    const id = await submit(body({ roles: ['administration'], administration: { branch_id: null } }));
    for (const approve of [true, false]) {
      expect(
        await failure(async () =>
          decide(prisma, await actorFor(prisma, adminId), id, { approve, reason: 'أيّ سبب' }),
        ),
      ).toMatchObject({ code: 'VALIDATION_FAILED', details: { reason: 'DECIDE_PER_ROLE' } });
    }
    expect(await requestsOf(id)).toEqual({ administration: 'pending' });
    expect(await statusOf(id)).toBe('pending');
  });
});

/* ── A further role, from an account that already exists (R169 §1) ────────── */

describe('an existing account asks for a further role — and again after a decline', () => {
  /** An ACTIVE teacher: registered for teaching, approved. */
  async function teacher(): Promise<string> {
    const id = await submit(body({ roles: ['teaching'], teaching: { framing: { mode: 'online' } } }));
    await decideRoleRequest(prisma, await actorFor(prisma, superAdminId), id, 'teaching', {
      approve: true,
      grant: { role: 'teacher', branchId: null },
    });
    return id;
  }
  /** Through the SCHEMA, as a browser's request is — it is what turns the date
   *  of birth into a date. */
  const studentAsk = (extra: Record<string, unknown> = {}) =>
    furtherRoleRequestSchema.parse({
      kind: 'student',
      student: { branch_id: placement.branchId, category_id: placement.categoryId, first_time: false },
      birth_date: '1991-07-09',
      consents: { data_processing: true, consent_text_id: consentText!.id },
      ...extra,
    });

  it('opens ONE pending request, tells the approvers, grants nothing — and the queue lists the ACTIVE account', async () => {
    const id = await teacher();
    const me = await actorFor(prisma, id);
    const before = await myRoleRequests(prisma, me);
    expect(before.askable).toEqual(['student', 'administration']);
    // R170 §1 — what she HOLDS is said too, from live role rows: a person who
    // holds everything has nothing askable and no request, and the screen must
    // still be able to say why.
    expect(before.held).toEqual(['teaching']);

    const asked = await requestFurtherRole(prisma, me, studentAsk());
    expect(asked).toEqual({ kind: 'student', status: 'pending', reopened: false });
    expect(await requestsOf(id)).toEqual({ teaching: 'approved', student: 'pending' });
    expect(await rolesOf(id)).toEqual(['teacher']);
    expect((await myRoleRequests(prisma, me)).askable).toEqual(['administration']);
    expect(
      await prisma.notification.count({
        where: { subjectUserId: id, type: 'registration_review_required', userId: superAdminId },
      }),
    ).toBe(1);

    // …by the exact coordinate her notification carries, too.
    const queue = await listApprovals(prisma, await actorFor(prisma, superAdminId), { reviewUserId: id });
    expect(queue.data[0]).toMatchObject({ id, type: 'registration', accountActive: true });

    // The decision is the ordinary per-role one, and ADDS the role.
    await decideRoleRequest(prisma, await actorFor(prisma, superAdminId), id, 'student', {
      approve: true,
      placement: { administrativeGroupId: placement.groupId },
    });
    expect(await rolesOf(id)).toEqual(['student', 'teacher']);
    expect((await prisma.user.findUniqueOrThrow({ where: { id } })).birthDate).not.toBeNull();
  });

  it('an account that was never registered through the form and holds every role: nothing askable, no request — and `held` says why (R170 §1)', async () => {
    // The Owner's own case: provisioned, never «registered», holding them all.
    // The screen showed NOTHING, and she could not find the section.
    const mine = await myRoleRequests(prisma, await actorFor(prisma, superAdminId));
    expect(mine.requests).toEqual([]);
    expect(mine.held).toContain('administration');
    expect(mine.askable).not.toContain('administration');
  });

  it('refuses a role she holds, a request already waiting, and an account that is not active', async () => {
    const id = await teacher();
    const me = await actorFor(prisma, id);
    expect(
      await failure(() =>
        requestFurtherRole(prisma, me, { kind: 'teaching', teaching: { framing: { mode: 'online' } } } as never),
      ),
    ).toMatchObject({ code: 'STATE_CONFLICT', details: { reason: 'ROLE_ALREADY_HELD' } });

    await requestFurtherRole(prisma, me, { kind: 'administration', administration: { branch_id: null } });
    expect(
      await failure(() =>
        requestFurtherRole(prisma, me, { kind: 'administration', administration: { branch_id: null } }),
      ),
    ).toMatchObject({ code: 'STATE_CONFLICT', details: { reason: 'ALREADY_PENDING' } });

    // A beneficiary request from a record with no date of birth must bring one.
    expect(
      await failure(() => requestFurtherRole(prisma, me, studentAsk({ birth_date: undefined }))),
    ).toMatchObject({ code: 'VALIDATION_FAILED', details: { reason: 'BIRTH_DATE_REQUIRED' } });

    const pending = await submit(body({ roles: ['teaching'], teaching: { framing: { mode: 'online' } } }));
    expect(
      await failure(async () =>
        requestFurtherRole(
          prisma,
          { userId: pending, activeRole: null, roleScopes: [] } as never,
          { kind: 'administration', administration: { branch_id: null } },
        ),
      ),
    ).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('a DECLINED role is asked for again by RE-OPENING its row — one line of history, two audit facts', async () => {
    const id = await teacher();
    const me = await actorFor(prisma, id);
    const boss = await actorFor(prisma, superAdminId);
    await requestFurtherRole(prisma, me, { kind: 'administration', administration: { branch_id: null } });
    await decideRoleRequest(prisma, boss, id, 'administration', { approve: false, reason: 'لا حاجة حاليًا' });
    // Declining a FURTHER role never touches the account she already has.
    expect(await statusOf(id)).toBe('active');
    expect((await myRoleRequests(prisma, me)).askable).toContain('administration');

    const again = await requestFurtherRole(prisma, me, { kind: 'administration', administration: { branch_id: null } });
    expect(again.reopened).toBe(true);
    const rows = await prisma.roleRequest.findMany({ where: { userId: id, kind: 'administration' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'pending', decidedAt: null, decidedById: null, declineReason: null });
    expect(
      await prisma.auditLog.count({ where: { targetId: id, actionType: { in: ['rolerequest.decline', 'rolerequest.reopen'] } } }),
    ).toBe(2);
  });

  it('registering a child RE-OPENS a declined guardian request, so the application is not dead on arrival', async () => {
    const id = await submit(
      body({ roles: ['guardian', 'teaching'], children: [child('ابنة')], teaching: { framing: { mode: 'online' } } }),
    );
    const boss = await actorFor(prisma, superAdminId);
    await decideRoleRequest(prisma, boss, id, 'teaching', { approve: true, grant: { role: 'teacher', branchId: null } });
    await decideRoleRequest(prisma, boss, id, 'guardian', { approve: false, reason: 'لا مقاعد' });

    const made = await prisma.$transaction((tx) =>
      submitChildApplications(tx, id, {
        consentDataProcessing: true,
        consentTextVersion: consentText!.versionLabel,
        consentTextId: consentText!.id,
        children: [
          {
            firstNameArabic: `${TAG} ابنة ثانية`,
            lastNameArabic: 'العلوي',
            sex: 'female',
            birthDate: new Date('2017-01-02T00:00:00.000Z'),
            consentMediaRelease: false,
            requestedBranchId: placement.branchId,
            requestedCategoryId: placement.categoryId,
          },
        ],
      } as never),
    );
    expect(await requestsOf(id)).toMatchObject({ guardian: 'pending' });
    await decideChildApplication(prisma, boss, made.applicationIds[0]!, {
      approve: true,
      placement: { administrativeGroupId: placement.groupId },
    });
    expect(await requestsOf(id)).toMatchObject({ guardian: 'approved' });
  });
});

/* ── A refused applicant may be told the real reason (R170 §11) ───────────── */

describe('the reason reaches her only when the approver chose to share it (R170 §11)', () => {
  async function teacherAsking(): Promise<string> {
    const id = await submit(body({ roles: ['teaching'], teaching: { framing: { mode: 'online' } } }));
    await decideRoleRequest(prisma, await actorFor(prisma, superAdminId), id, 'teaching', {
      approve: true,
      grant: { role: 'teacher', branchId: null },
    });
    await requestFurtherRole(prisma, await actorFor(prisma, id), {
      kind: 'administration',
      administration: { branch_id: null },
    });
    return id;
  }

  it('declined WITHOUT sharing: she is told that, and never the operator’s words', async () => {
    const id = await teacherAsking();
    await decideRoleRequest(prisma, await actorFor(prisma, superAdminId), id, 'administration', {
      approve: false,
      reason: 'لا حاجة حاليًا — كلام داخلي',
    });
    const mine = await myRoleRequests(prisma, await actorFor(prisma, id));
    const row = mine.requests.find((request) => request.kind === 'administration')!;
    expect(row.status).toBe('declined');
    expect(row.shared_reason).toBeNull();
    expect(JSON.stringify(mine)).not.toContain('كلام داخلي');
    const stored = await prisma.roleRequest.findUniqueOrThrow({ where: { userId_kind: { userId: id, kind: 'administration' } } });
    expect(stored).toMatchObject({ declineReason: 'لا حاجة حاليًا — كلام داخلي', sharedDeclineReason: null });
    const trail = await prisma.auditLog.findFirst({
      where: { actionType: 'rolerequest.decline', targetId: id },
      orderBy: { createdAt: 'desc' },
    });
    expect(trail?.detail).toMatchObject({ reason_shared: false });
  });

  it('declined AND shared: the sentence is hers to read, and re-asking clears it', async () => {
    const id = await teacherAsking();
    await decideRoleRequest(prisma, await actorFor(prisma, superAdminId), id, 'administration', {
      approve: false,
      reason: 'الإدارة مكتملة هذا الموسم.',
      shareReason: true,
    });
    let mine = await myRoleRequests(prisma, await actorFor(prisma, id));
    expect(mine.requests.find((request) => request.kind === 'administration')?.shared_reason).toBe(
      'الإدارة مكتملة هذا الموسم.',
    );
    const trail = await prisma.auditLog.findFirst({
      where: { actionType: 'rolerequest.decline', targetId: id },
      orderBy: { createdAt: 'desc' },
    });
    expect(trail?.detail).toMatchObject({ reason_shared: true });

    await requestFurtherRole(prisma, await actorFor(prisma, id), { kind: 'administration', administration: { branch_id: null } });
    mine = await myRoleRequests(prisma, await actorFor(prisma, id));
    expect(mine.requests.find((request) => request.kind === 'administration')).toMatchObject({
      status: 'pending',
      shared_reason: null,
    });
  });

  it('the whole-account rejection shares the same way', async () => {
    const id = await submit(body({
      roles: ['student'],
      student: { branch_id: placement.branchId, category_id: placement.categoryId, first_time: false },
    }));
    await decide(prisma, await actorFor(prisma, superAdminId), id, {
      approve: false,
      reason: 'الفئة ممتلئة.',
      shareReason: true,
    });
    const stored = await prisma.roleRequest.findUniqueOrThrow({ where: { userId_kind: { userId: id, kind: 'student' } } });
    expect(stored.sharedDeclineReason).toBe('الفئة ممتلئة.');
  });
});

/* ── A Category says who holds the login (R170 §6) ────────────────────────── */

describe('a request must agree with its Category about who holds the login (R170 §6)', () => {
  const mark = (holdsOwnLogin: boolean | null) =>
    prisma.category.update({ where: { id: placement.categoryId }, data: { holdsOwnLogin } });
  const failureOf = async (run: () => Promise<unknown>): Promise<unknown> => {
    try {
      await run();
      return null;
    } catch (error) {
      return error;
    }
  };
  const selfRegistration = () =>
    body({
      roles: ['student'],
      student: { branch_id: placement.branchId, category_id: placement.categoryId, first_time: false },
    });
  const familyRegistration = () => body({ roles: ['guardian'], children: [child('ابنة')] });

  it('«not stated» restricts nothing — a Category nobody answered for behaves as it always did', async () => {
    await mark(null);
    expect(await failureOf(() => submit(selfRegistration()))).toBeNull();
    expect(await failureOf(() => submit(familyRegistration()))).toBeNull();
  });

  it('a guardian-managed Category refuses a woman registering HERSELF, and still takes a child', async () => {
    await mark(false);
    try {
      expect(await failureOf(() => submit(selfRegistration()))).toMatchObject({
        code: 'VALIDATION_FAILED',
        details: { reason: 'CATEGORY_IS_GUARDIAN_MANAGED' },
      });
      expect(await failureOf(() => submit(familyRegistration()))).toBeNull();
    } finally {
      await mark(null);
    }
  });

  it('an own-login Category refuses a CHILD application — on the form and from «حسابي» — and still takes her', async () => {
    await mark(true);
    try {
      expect(await failureOf(() => submit(familyRegistration()))).toMatchObject({
        code: 'VALIDATION_FAILED',
        details: { reason: 'CATEGORY_HOLDS_OWN_LOGIN' },
      });
      expect(await failureOf(() => submit(selfRegistration()))).toBeNull();
      // The refusal wrote nothing: no applicant was left behind by the failed family form.
      expect(await prisma.childApplication.count({ where: { requestedCategoryId: placement.categoryId, firstNameArabic: { startsWith: TAG } } })).toBe(0);
    } finally {
      await mark(null);
    }
  });

  it('…and the same rule meets an EXISTING account asking to become a مستفيدة', async () => {
    const id = await submit(body({ roles: ['teaching'], teaching: { framing: { mode: 'online' } } }));
    await decideRoleRequest(prisma, await actorFor(prisma, superAdminId), id, 'teaching', {
      approve: true,
      grant: { role: 'teacher', branchId: null },
    });
    await mark(false);
    try {
      const ask = furtherRoleRequestSchema.parse({
        kind: 'student',
        student: { branch_id: placement.branchId, category_id: placement.categoryId, first_time: false },
        birth_date: '1991-07-09',
        consents: { data_processing: true, consent_text_id: consentText!.id },
      });
      expect(await failureOf(async () => requestFurtherRole(prisma, await actorFor(prisma, id), ask))).toMatchObject({
        code: 'VALIDATION_FAILED',
        details: { reason: 'CATEGORY_IS_GUARDIAN_MANAGED' },
      });
    } finally {
      await mark(null);
    }
  });
});
