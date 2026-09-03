import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../lib/config.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import type { Actor } from '../policies/actor.js';
import type { RoleScope } from '../policies/branch-scope.js';
import { createEvent } from './event.service.js';
import {
  createSchedulingType,
  deleteSchedulingType,
  listSchedulingTypes,
  reorderSchedulingTypes,
  updateSchedulingType,
} from './scheduling-type.service.js';

/**
 * **SRS Revision 110 — the scheduling-type catalogue** (NEW H).
 *
 * Three claims, each of which could hold while another silently broke:
 *
 * 1. **Authorization.** Anyone who may schedule can READ the catalogue — a
 *    مؤطِّرة included, or the activity form would be one she cannot open — and
 *    only a Super Admin may WRITE it (OD-01). The negative halves are asserted,
 *    because a permission test that proves only the yes is not one.
 * 2. **The catalogue is data, not a constant.** It can be renamed, reordered,
 *    re-flagged and extended, and a subsequent seed run preserves all of it.
 *    *Seeded does not mean immutable* is the Owner's rule; a seed that restored
 *    its own names would make the management screen a lie.
 * 3. **Structural kind is stored and enforced.** An `Event` cannot be typed
 *    حصة دراسية, and a type in use cannot be deleted out from under it.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const TAG = '[r110-type-test]';

let SUPER_ID = '';

const actor = (roleScopes: RoleScope[]): Actor => ({
  userId: SUPER_ID,
  roles: roleScopes.map((s) => s.role),
  roleScopes,
  activeRole: roleScopes[0]?.role ?? '',
});

const superAdmin = () => actor([{ role: 'super_admin', branches: null }]);
const admin = () => actor([{ role: 'admin', branches: null }]);
const teacher = () => actor([{ role: 'teacher', branches: null }]);
const beneficiary = () => actor([{ role: 'student', branches: null }]);

const FAR_FUTURE = new Date('2097-06-01T00:00:00.000Z');
const NOW = new Date('2097-01-01T00:00:00.000Z');

const mine = <T extends { name: string }>(rows: T[]): T[] =>
  rows.filter((r) => r.name.startsWith(TAG));

async function makeType(
  name: string,
  structuralKind: 'class' | 'activity' | 'exam',
  attendanceMode: 'disabled' | 'optional' | 'required' = 'optional',
) {
  return createSchedulingType(prisma, superAdmin(), {
    name: `${TAG} ${name}`,
    structuralKind,
    attendanceMode,
  });
}

async function makeActivity(title: string, schedulingTypeId: string) {
  return createEvent(
    prisma,
    superAdmin(),
    {
      title: `${TAG} ${title}`,
      schedulingTypeId,
      visibility: 'public',
      startDate: FAR_FUTURE,
      recurrenceType: 'none',
    },
    NOW,
  );
}

async function clear(): Promise<void> {
  const types = await prisma.schedulingType.findMany({
    where: { name: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = types.map((t) => t.id);
  const events = await prisma.event.findMany({
    where: { title: { startsWith: TAG } },
    select: { id: true },
  });
  const eventIds = events.map((e) => e.id);
  await prisma.eventBranch.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.eventStaff.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.notification.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
  await prisma.trash.deleteMany({ where: { targetId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { targetId: { in: ids } } });
  await prisma.schedulingType.deleteMany({ where: { id: { in: ids } } });
  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

beforeEach(async () => {
  await clear();
  SUPER_ID = (
    await prisma.user.create({
      data: { sex: 'female', nameArabic: `${TAG} مديرة`, accountStatus: 'active' },
    })
  ).id;
});

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

/* ── 1. Authorization ───────────────────────────────────────────────────── */

describe('who may read the catalogue, and who may change it', () => {
  it('lets a مؤطِّرة and an Admin read it — both schedule against it', async () => {
    await expect(listSchedulingTypes(prisma, teacher())).resolves.toBeInstanceOf(Array);
    await expect(listSchedulingTypes(prisma, admin())).resolves.toBeInstanceOf(Array);
  });

  it('refuses a beneficiary the read outright', async () => {
    await expect(listSchedulingTypes(prisma, beneficiary())).rejects.toThrow(/requires staff/);
  });

  it('refuses an Admin every write — OD-01 keeps types Super-Admin-only', async () => {
    // The negative half. An Admin reads the catalogue because she schedules
    // against it; changing what the catalogue IS is a different decision.
    await expect(
      createSchedulingType(prisma, admin(), {
        name: `${TAG} ورشة`,
        structuralKind: 'activity',
        attendanceMode: 'optional',
      }),
    ).rejects.toThrow(/Super Admin only/);
    await expect(reorderSchedulingTypes(prisma, admin(), [])).rejects.toThrow(/Super Admin only/);
  });

  it('lets a Super Admin create, rename and re-flag', async () => {
    const created = await makeType('ورشة', 'activity', 'optional');
    expect(created.attendanceMode).toBe('optional');

    const renamed = await updateSchedulingType(prisma, superAdmin(), created.id, created.version, {
      name: `${TAG} ورشة تطبيقية`,
      attendanceMode: 'required',
    });
    expect(renamed.name).toBe(`${TAG} ورشة تطبيقية`);
    // The setting is hers to change once the row exists — the whole point of it
    // being a column rather than display text (OD-03, widened by R123).
    expect(renamed.attendanceMode).toBe('required');
    // Unchanged by a rename: what a type ROUTES to is not a label.
    expect(renamed.structuralKind).toBe('activity');
  });
});

/* ── 2. Seeded does not mean immutable ──────────────────────────────────── */

describe('the catalogue is data, and the seed preserves what the Owner changed', () => {
  it('is found by LIVE NAME, so a renamed row is not resurrected', async () => {
    // The seed's rule, exercised directly: it looks for a live row by name and
    // creates only when there is none. A row the Owner renamed is invisible to
    // it — which is correct; restoring the old name would leave her with two
    // rows for one concept.
    const original = await makeType('محاضرة', 'activity');
    await updateSchedulingType(prisma, superAdmin(), original.id, original.version, {
      name: `${TAG} محاضرة عامة`,
    });

    const live = await prisma.schedulingType.findMany({
      where: { name: `${TAG} محاضرة`, deletedAt: null },
    });
    expect(live).toHaveLength(0);
  });

  it('keeps the order the Owner chose, and a create appends rather than inserts', async () => {
    const a = await makeType('أ', 'activity');
    const b = await makeType('ب', 'activity');
    // One ordering mechanism, R76's — `PATCH .../order`. A create that also
    // chose a position would be a second, and the two would disagree.
    expect(b.displayOrder).toBeGreaterThan(a.displayOrder);

    /**
     * **A reorder is necessarily whole-set, so this test RESTORES what it
     * disturbs.**
     *
     * R76 refuses a partial sequence — it cannot say where the omitted rows
     * belong — so exercising the reorder means sending every live id, including
     * the SEEDED catalogue rows this suite does not own. The first version of
     * this test flipped them and cleaned up only its own `TAG` rows, leaving the
     * Owner's canonical order reversed in the shared development database. It
     * was caught by the browser harness reading `5 → 4 → 3 → 2 → 1` off the real
     * screen, not by anything here — a suite that mutates shared reference data
     * and does not put it back is precisely the P1.2 defect class.
     */
    const before = (await listSchedulingTypes(prisma, superAdmin())).map((r) => ({
      id: r.id,
      displayOrder: r.displayOrder,
    }));
    const beforeIds = before.map((r) => r.id);
    const flipped = [...beforeIds].reverse();
    try {
      await reorderSchedulingTypes(prisma, superAdmin(), flipped);

      const after = await listSchedulingTypes(prisma, superAdmin());
      expect(after.map((r) => r.id)).toEqual(flipped);
      // 1-based and contiguous (R76.6): gaps and duplicates are impossible
      // because positions in a list are, not because they are validated against.
      expect(after.map((r) => r.displayOrder)).toEqual(after.map((_, i) => i + 1));
    } finally {
      // `finally`, so a failed assertion above still leaves the catalogue as it
      // was found. Restoring only on success would make one red test corrupt
      // every later run.
      // Restore the exact coordinates, not merely the sequence. A migrated
      // pre-marker catalogue can legitimately contain duplicate/gapped values;
      // replaying the sequence through the domain reorder would normalize it
      // to 1..n and silently mutate reference data the suite does not own.
      await prisma.$transaction(
        before.map(({ id, displayOrder }) =>
          prisma.schedulingType.update({ where: { id }, data: { displayOrder } }),
        ),
      );
    }
  });

  it('reports how many activities use each type, so a refusal is legible first', async () => {
    const type = await makeType('حفل', 'activity');
    await makeActivity('حفل الختام', type.id);

    const row = mine(await listSchedulingTypes(prisma, superAdmin())).find(
      (r) => r.id === type.id,
    );
    expect(row?.eventCount).toBe(1);
  });
});

/* ── 3. Structural kind is stored, and enforced ─────────────────────────── */

describe('a type routes to one entity, and the server holds the line', () => {
  it('refuses an activity typed as a class', async () => {
    const classType = await makeType('حصة دراسية', 'class', 'required');

    // Not a UI concern: a forged body naming the class type must be refused by
    // the server, or the row would be an Event the catalogue calls a class —
    // two answers to *what is this*, which is what storing the kind prevents.
    /**
     * **Asserted on the CODED reason, not the prose** (2026-09-02).
     *
     * This pinned the message *«not delivered as an activity»*, and R119
     * generalised the rule into `assertTypeOfKind` so a schedule and a sitting
     * could be validated by the same code rather than a second copy — at which
     * point the message became kind-agnostic. **The property was never the
     * wording**: it is that the mismatch is refused with a reason a client can
     * branch on, and that is what this now says.
     */
    await expect(makeActivity('نشاط مزيّف', classType.id)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      details: { reason: 'STRUCTURAL_KIND_MISMATCH', structural_kind: 'class' },
    });
  });

  it('refuses a type id that names nothing live', async () => {
    await expect(
      makeActivity('نشاط بلا نوع', '00000000-0000-4000-8000-000000000000'),
    ).rejects.toThrow(/no such scheduling type/);
  });

  it('refuses to delete a type an activity still names', async () => {
    const type = await makeType('عطلة', 'activity');
    await makeActivity('عطلة الربيع', type.id);

    // TD-5 blocked delete, not a foreign-key violation surfacing as a 500: the
    // record of what an activity WAS must survive tidying the catalogue.
    await expect(deleteSchedulingType(prisma, superAdmin(), type.id)).rejects.toMatchObject({
      code: 'STATE_CONFLICT',
    });
    const still = await prisma.schedulingType.findUnique({ where: { id: type.id } });
    expect(still?.deletedAt).toBeNull();
  });

  it('soft-deletes an unused type, and frees its name for a fresh one', async () => {
    const type = await makeType('مهجور', 'activity');
    await deleteSchedulingType(prisma, superAdmin(), type.id);

    const gone = await prisma.schedulingType.findUnique({ where: { id: type.id } });
    // Soft (TD-5): a retired type keeps its name in the record, which is what a
    // historical activity is still labelled by. The live-name unique index is
    // partial for exactly that reason.
    expect(gone?.deletedAt).not.toBeNull();
    await expect(makeType('مهجور', 'activity')).resolves.toBeTruthy();
  });

  it('عطلة is an ordinary schedulable activity that takes no attendance (OD-03)', async () => {
    const holiday = await makeType('عطلة', 'activity', 'disabled');
    const created = await makeActivity('عطلة عيد', holiday.id);

    // Schedulable and on the calendar like any other (OD-03) — it is NOT a
    // suppression mechanism. BR-17 keeps non-teaching activity out of the
    // timetable and §4.4(6) makes a cancellation an edit to a Session row, so a
    // holiday cancels no class. Asserted because the opposite is the intuition.
    expect(created.event.id).toBeTruthy();
    expect(holiday.attendanceMode).toBe('disabled');
    const row = await prisma.event.findUniqueOrThrow({
      where: { id: created.event.id },
      select: { schedulingTypeId: true },
    });
    expect(row.schedulingTypeId).toBe(holiday.id);
  });
});
