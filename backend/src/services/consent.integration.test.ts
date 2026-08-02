import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../lib/config.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import { effectiveConsent, readConsent, recordStaffConsent } from './consent.service.js';
import { CONSENT_TEXT_VERSION_KEY } from './registration.service.js';
import {
  captureConsentVersion,
  restoreConsentVersion,
  type SavedConsentVersion,
} from '../test-support/consent-setting.js';

/**
 * Staff-recorded consent — §4.1a, BR-1, TD-2, TD-7, TD-8, TD-12.
 *
 * The safeguarding-critical properties are that history survives (§7 makes the
 * table append-only), that BR-1's "absence = no consent" is never softened into
 * a default, and that **every** change enqueues the §4.1a re-evaluation inside
 * the same transaction.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
/**
 * Restored in `afterAll` — a fixture must not leave the app unrunnable.
 *
 * Captured ONCE. A `beforeEach` capture would re-save whatever the previous
 * test left behind, so by the end the suite would "restore" its own scratch
 * value rather than the developer's.
 */
let savedConsentVersion: SavedConsentVersion | null = null;
const TAG = '[consent-test]';

let levelId: string;

async function person(label: string): Promise<string> {
  const u = await prisma.user.create({
    data: { nameArabic: `${TAG} ${label}`, accountStatus: 'active' },
  });
  return u.id;
}

async function staff(label: string, role: string, branchId: string | null): Promise<string> {
  const id = await person(label);
  const roleRow = await prisma.role.findUnique({ where: { name: role } });
  await prisma.userBranchRole.create({ data: { userId: id, roleId: roleRow!.id, branchId } });
  return id;
}

async function makeBranch(): Promise<string> {
  const b = await prisma.branch.create({
    data: { name: `${TAG} فرع`, operationalStartDate: new Date('2026-01-01') },
  });
  return b.id;
}

async function makeGroup(branchId: string, name: string): Promise<string> {
  const g = await prisma.group.create({
    data: {
      name: `${TAG} ${name}`,
      levelId,
      branchId,
      dayOfWeek: 'monday',
      startTime: new Date('1970-01-01T09:00:00Z'),
      endTime: new Date('1970-01-01T10:30:00Z'),
      maxStudents: 20,
    },
  });
  return g.id;
}

const enrol = (groupId: string, studentId: string) =>
  prisma.studentGroup.create({ data: { groupId, studentId } });

async function queuedFor(groupId: string): Promise<number> {
  const rows = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT count(*)::bigint AS count FROM pgboss.job
    WHERE name = 'consent.reevaluate' AND data->>'group_id' = ${groupId}
  `;
  return Number(rows[0]?.count ?? 0);
}

async function clear(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  const groups = await prisma.group.findMany({
    where: { name: { startsWith: TAG } },
    select: { id: true },
  });
  const groupIds = groups.map((g) => g.id);
  for (const g of groupIds) {
    await prisma.$executeRaw`DELETE FROM pgboss.job WHERE name = 'consent.reevaluate' AND data->>'group_id' = ${g}`;
  }
  await prisma.auditLog.deleteMany({
    where: { OR: [{ actorUserId: { in: ids } }, { targetId: { in: ids } }] },
  });
  await prisma.consentRecord.deleteMany({
    where: { OR: [{ studentId: { in: ids } }, { grantedByUserId: { in: ids } }] },
  });
  await prisma.studentGroup.deleteMany({
    where: { OR: [{ studentId: { in: ids } }, { groupId: { in: groupIds } }] },
  });
  await prisma.groupTeacher.deleteMany({ where: { groupId: { in: groupIds } } });
  await prisma.group.deleteMany({ where: { id: { in: groupIds } } });
  await prisma.userBranchRole.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.branch.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeEach(async () => {
  savedConsentVersion ??= await captureConsentVersion(prisma);
  await clear();
  const level = await prisma.level.findFirst({ select: { id: true } });
  levelId = level!.id;
  await prisma.systemSetting.upsert({
    where: { key: CONSENT_TEXT_VERSION_KEY },
    update: { value: 'consent-test-v1' },
    create: { key: CONSENT_TEXT_VERSION_KEY, value: 'consent-test-v1' },
  });
});

afterAll(async () => {
  await clear();
  // Restore, never delete: deleting left the developer's database with no
  // consent text version, and registration then failed closed for everyone
  // who used the form after a test run (see test-support/consent-setting).
  if (savedConsentVersion) await restoreConsentVersion(prisma, savedConsentVersion);
  await prisma.$disconnect();
});

/** An admin scoped to a branch, with one group and one enrolled student. */
async function scenario() {
  const branchId = await makeBranch();
  const groupId = await makeGroup(branchId, 'مجموعة');
  const admin = await staff('مشرفة', 'admin', branchId);
  const student = await person('طالبة');
  await enrol(groupId, student);
  return { branchId, groupId, admin, student };
}

describe('§4.1a — recording a decision declared in person', () => {
  it('records a grant with method staff_recorded and the active text version', async () => {
    const { admin, student } = await scenario();
    const result = await recordStaffConsent(prisma, admin, student, {
      consentType: 'media_release',
      granted: true,
    });

    const row = await prisma.consentRecord.findUnique({ where: { id: result.recordId } });
    expect(row?.method).toBe('staff_recorded');
    expect(row?.granted).toBe(true);
    expect(row?.consentTextVersion).toBe('consent-test-v1');
    // The on-behalf actor is the staff member, not the family.
    expect(row?.grantedByUserId).toBe(admin);
  });

  it('a revocation is a NEW row — history is never erased (§7 append-only)', async () => {
    const { admin, student } = await scenario();
    await recordStaffConsent(prisma, admin, student, {
      consentType: 'media_release',
      granted: true,
    });
    await recordStaffConsent(prisma, admin, student, {
      consentType: 'media_release',
      granted: false,
    });

    const rows = await prisma.consentRecord.findMany({ where: { studentId: student } });
    expect(rows).toHaveLength(2);
    // What the family originally agreed to survives the change.
    expect(rows.filter((r) => r.granted)).toHaveLength(1);
  });

  it('a revocation records who revoked it and when', async () => {
    const { admin, student } = await scenario();
    const { recordId } = await recordStaffConsent(prisma, admin, student, {
      consentType: 'media_release',
      granted: false,
    });
    const row = await prisma.consentRecord.findUnique({ where: { id: recordId } });
    expect(row?.revokedAt).toBeInstanceOf(Date);
    expect(row?.revokedByUserId).toBe(admin);
  });

  it('fails closed when no consent text version is configured (§2.3)', async () => {
    const { admin, student } = await scenario();
    await prisma.systemSetting.deleteMany({ where: { key: CONSENT_TEXT_VERSION_KEY } });

    // A decision that cannot be tied to a wording is not a record of consent.
    await expect(
      recordStaffConsent(prisma, admin, student, { consentType: 'media_release', granted: true }),
    ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    expect(await prisma.consentRecord.count({ where: { studentId: student } })).toBe(0);
  });
});

describe('BR-1 — effective status', () => {
  it('absence of any record is NO consent, never a default of granted', async () => {
    const { student } = await scenario();
    const state = await effectiveConsent(prisma, student);
    expect(state['media_release']).toBeNull();
    expect(state['data_processing']).toBeNull();
  });

  it('the MOST RECENT record wins, not the first', async () => {
    const { admin, student } = await scenario();
    await recordStaffConsent(prisma, admin, student, {
      consentType: 'media_release',
      granted: true,
    });
    await new Promise((r) => setTimeout(r, 5));
    await recordStaffConsent(prisma, admin, student, {
      consentType: 'media_release',
      granted: false,
    });

    expect((await effectiveConsent(prisma, student))['media_release']?.granted).toBe(false);
  });

  it('consent types are tracked independently', async () => {
    const { admin, student } = await scenario();
    await recordStaffConsent(prisma, admin, student, {
      consentType: 'media_release',
      granted: false,
    });
    await recordStaffConsent(prisma, admin, student, {
      consentType: 'data_processing',
      granted: true,
    });

    const state = await effectiveConsent(prisma, student);
    expect(state['media_release']?.granted).toBe(false);
    expect(state['data_processing']?.granted).toBe(true);
  });
});

describe('§4.1a + TD-4 — the re-evaluation enqueue', () => {
  it('enqueues consent.reevaluate for the student\'s group', async () => {
    const { admin, student, groupId } = await scenario();
    expect(await queuedFor(groupId)).toBe(0);

    const result = await recordStaffConsent(prisma, admin, student, {
      consentType: 'media_release',
      granted: true,
    });

    expect(result.reevaluatedGroups).toEqual([groupId]);
    expect(await queuedFor(groupId)).toBeGreaterThan(0);
  });

  it('enqueues for EVERY group the student is enrolled in', async () => {
    const { admin, student, branchId } = await scenario();
    const second = await makeGroup(branchId, 'مجموعة ثانية');
    await enrol(second, student);

    const result = await recordStaffConsent(prisma, admin, student, {
      consentType: 'media_release',
      granted: false,
    });
    expect(result.reevaluatedGroups).toHaveLength(2);
    expect(await queuedFor(second)).toBeGreaterThan(0);
  });

  it('a student in no group enqueues nothing — a normal outcome', async () => {
    // A Super Admin, deliberately: an unenrolled student belongs to no branch,
    // so a branch-scoped Admin cannot reach them — the same rule R25 applies to
    // the user list. Recorded as a finding: a newly approved applicant is not
    // yet placed, so only a Super Admin can record their consent until an Admin
    // enrols them.
    const superAdmin = await staff('مشرف عام', 'super_admin', null);
    const unenrolled = await person('غير مسجلة');

    const result = await recordStaffConsent(prisma, superAdmin, unenrolled, {
      consentType: 'media_release',
      granted: true,
    });
    expect(result.reevaluatedGroups).toEqual([]);
  });

  it('FINDING: a branch Admin cannot reach an UNPLACED student', async () => {
    // Pinned so the consequence is visible rather than surprising: consent for a
    // just-approved applicant is Super-Admin-only until they are enrolled.
    const { admin } = await scenario();
    const unplaced = await person('غير معينة');

    await expect(
      recordStaffConsent(prisma, admin, unplaced, {
        consentType: 'media_release',
        granted: true,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('a group the student has LEFT is not re-evaluated', async () => {
    // §4.1a scopes the enqueue to the *affected* groups. A group the student is
    // no longer enrolled in is not affected by their consent decision, and a
    // soft-deleted group is not affected by anything.
    const { admin, student, groupId, branchId } = await scenario();
    const left = await makeGroup(branchId, 'مجموعة سابقة');
    const enrolment = await enrol(left, student);
    await prisma.studentGroup.update({
      where: { id: enrolment.id },
      data: { deletedAt: new Date() },
    });

    const result = await recordStaffConsent(prisma, admin, student, {
      consentType: 'media_release',
      granted: true,
    });

    expect(result.reevaluatedGroups).toEqual([groupId]);
    expect(await queuedFor(left)).toBe(0);
  });

  it('TD-4: a rolled-back decision leaves NO job behind', async () => {
    const { admin, student, groupId } = await scenario();
    // Force the transaction to fail after the enqueue by deleting the student
    // mid-flight is impractical; instead assert the paired invariant — a refused
    // decision writes neither a record nor a job.
    await prisma.systemSetting.deleteMany({ where: { key: CONSENT_TEXT_VERSION_KEY } });
    await recordStaffConsent(prisma, admin, student, {
      consentType: 'media_release',
      granted: true,
    }).catch(() => undefined);

    expect(await prisma.consentRecord.count({ where: { studentId: student } })).toBe(0);
    expect(await queuedFor(groupId)).toBe(0);
  });
});

describe('TD-2 / TD-12 — who may record', () => {
  it('a Teacher may NOT record a decision on a family\'s behalf', async () => {
    const { student, groupId } = await scenario();
    const teacher = await staff('معلمة', 'teacher', null);
    await prisma.groupTeacher.create({ data: { groupId, teacherId: teacher } });

    // TD-2 marks the row ⊘ for Teacher even though they may view the student.
    await expect(
      recordStaffConsent(prisma, teacher, student, {
        consentType: 'media_release',
        granted: true,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await prisma.consentRecord.count({ where: { studentId: student } })).toBe(0);
  });

  it('an Admin outside the student\'s branch is refused', async () => {
    const { student } = await scenario();
    const elsewhere = await prisma.branch.create({
      data: { name: `${TAG} فرع آخر`, operationalStartDate: new Date('2026-01-01') },
    });
    const admin = await staff('مشرفة أخرى', 'admin', elsewhere.id);

    await expect(
      recordStaffConsent(prisma, admin, student, { consentType: 'media_release', granted: true }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('TD-12: an admin suspended mid-session cannot record', async () => {
    const { admin, student } = await scenario();
    await prisma.user.update({ where: { id: admin }, data: { accountStatus: 'suspended' } });

    await expect(
      recordStaffConsent(prisma, admin, student, { consentType: 'media_release', granted: true }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('a Super Admin may record for any student', async () => {
    const { student } = await scenario();
    const superAdmin = await staff('مشرف عام', 'super_admin', null);
    await expect(
      recordStaffConsent(prisma, superAdmin, student, {
        consentType: 'media_release',
        granted: true,
      }),
    ).resolves.toBeTruthy();
  });

  it('readConsent enforces the same audience', async () => {
    const { admin, student } = await scenario();
    const teacher = await staff('معلمة', 'teacher', null);

    await expect(readConsent(prisma, admin, student)).resolves.toBeTruthy();
    await expect(readConsent(prisma, teacher, student)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});

describe('TD-8 — audit', () => {
  it('a grant writes consent.grant naming the on-behalf actor and text version', async () => {
    const { admin, student } = await scenario();
    await recordStaffConsent(prisma, admin, student, {
      consentType: 'media_release',
      granted: true,
      note: 'صرحت الأم شخصيا',
    });

    const row = await prisma.auditLog.findFirst({
      where: { actorUserId: admin, actionType: 'consent.grant' },
    });
    const detail = row!.detail as Record<string, unknown>;
    expect(detail['method']).toBe('staff_recorded');
    expect(detail['on_behalf_actor']).toBe(admin);
    expect(detail['consent_text_version']).toBe('consent-test-v1');
    expect(detail['note']).toBe('صرحت الأم شخصيا');
  });

  it('a revocation writes consent.revoke', async () => {
    const { admin, student } = await scenario();
    await recordStaffConsent(prisma, admin, student, {
      consentType: 'media_release',
      granted: false,
    });

    expect(
      await prisma.auditLog.count({ where: { actorUserId: admin, actionType: 'consent.revoke' } }),
    ).toBe(1);
  });
});
