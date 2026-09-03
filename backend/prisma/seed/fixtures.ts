import { createHash } from 'node:crypto';
import {
  ConsentMethod,
  ConsentType,
  DayOfWeek,
  ExamAccessPolicy,
  FamilyLinkStatus,
  RecurrenceType,
  Visibility,
} from '../../src/generated/prisma/enums.js';
import { loadConfig } from '../../src/lib/config.js';
import { createPrismaClient } from '../../src/lib/prisma.js';

/**
 * Development fixtures (SRS §15.2) — NON-PRODUCTION ONLY.
 *
 * The NODE_ENV guard below is not a convenience: it is the Law 09-08 / CNDP
 * firewall (R-10, BR-18). Dev and staging sit outside Morocco (developer
 * machines, Vercel), so **fixture data is the only data permitted there**, and
 * real beneficiary data must never reach them. Refusing to run under
 * `NODE_ENV=production` is the mechanical half of that rule; the other half is
 * never copying production dumps outward (§19.0).
 *
 * Every fixture email uses the reserved `example.com` domain (§15.2), which
 * cannot receive mail and cannot collide with a real Google account.
 */

const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL);

/** Fixture marker: every generated person's name is prefixed so fixture rows
 *  are identifiable at a glance in a dev database. */
const FIXTURE_TAG = '[تجريبي]';

function fixtureEmail(local: string): string {
  // Lowercase per TD-12; reserved domain per §15.2.
  return `${local}@example.com`.toLowerCase();
}

/** Local wall-clock time helper — Group times are NOT UTC instants (TD-11). */
function wallClock(hhmm: string): Date {
  return new Date(`1970-01-01T${hhmm}:00Z`);
}

function daysAgo(days: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d;
}

async function assertNonProduction(): Promise<void> {
  if (config.NODE_ENV === 'production') {
    throw new Error(
      'REFUSING TO RUN: development fixtures must never execute in production ' +
        '(SRS §15.2, R-10, BR-18 — Law 09-08 data residency). Production data is ' +
        'entered through the admin UI (§15.1).',
    );
  }
}


/**
 * A **development** consent text version, so registration is testable.
 *
 * §4.1a requires every `ConsentRecord` to be tied to the exact wording agreed
 * to, and registration **fails closed** without one — correctly, because
 * recording that somebody agreed to text nobody has approved would be worse
 * than refusing. §2.3 makes legally verifying and versioning the Arabic consent
 * text an **owner compliance task**, and §15.1's normative seed therefore
 * creates no wording at all.
 *
 * That is right for production and left development with a registration flow
 * that could never succeed. Seeding it *here* is the honest split: fixtures are
 * development-only and refuse to run under `NODE_ENV=production` (the Law 09-08
 * firewall above), so this can never become a real consent wording by accident.
 *
 * **The wording says what it is, in Arabic, in the text itself** — not only in
 * its label. R119 made the body the thing a person actually reads on the
 * registration form, so a placeholder that looked like a legal notice would be
 * displayed as one; this one cannot be mistaken for approved wording by anybody
 * who reads it.
 *
 * **Never activated over an existing active version.** A developer who has
 * written and activated a wording of their own keeps it; this seeds only when
 * nothing is in force, so a repeated run is not a silent replacement.
 */
async function seedDevConsentText(): Promise<void> {
  const LABEL = 'dev-unapproved-v1';
  const BODY = 'نص تجريبي للتطوير فقط — لا قيمة قانونية له ولم تتم الموافقة عليه.';

  const active = await prisma.legalConsentText.findFirst({
    where: { status: 'active' },
    select: { versionLabel: true },
  });
  if (active) {
    console.log(`  consent wording: «${active.versionLabel}» already in force — left alone`);
    return;
  }

  // `created_by_id` is NOT NULL and a fixture has no natural author; the first
  // live account (the §15.1 Super Admin on a seeded database) is the honest one.
  const author = await prisma.user.findFirstOrThrow({
    where: { deletedAt: null },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });
  const digest = createHash('sha256').update(BODY, 'utf8').digest('hex');
  const row = await prisma.legalConsentText.upsert({
    where: { versionLabel: LABEL },
    update: {
      status: 'active',
      activatedAt: new Date(),
      activatedById: author.id,
      supersededAt: null,
    },
    create: {
      versionLabel: LABEL,
      bodyArabic: BODY,
      bodyDigest: digest,
      status: 'active',
      activatedAt: new Date(),
      activatedById: author.id,
      createdById: author.id,
    },
    select: { versionLabel: true },
  });
  console.log(`  consent wording: «${row.versionLabel}» (development only, not approved)`);
}

async function main(): Promise<void> {
  await assertNonProduction();
  console.log(`Development fixtures (§15.2) — NODE_ENV=${config.NODE_ENV}\n`);

  /**
   * Fixtures build on the §15.1 production seed (roles, categories, levels,
   * subjects, academic year, surahs) rather than duplicating it.
   *
   * **The first Category that actually HAS Levels, not simply the first**
   * (2026-08-26). This read `findFirst` ordered by `displayOrder` and then threw
   * *"no levels found for the category"* — on a development database whose
   * §15.1 data was entirely intact. The cause was **leaked integration-test
   * residue**: a suite that hard-deletes its own Category in teardown leaks one
   * every time that teardown fails, and six such empty Categories had
   * accumulated at the lowest display orders, ahead of the association's own.
   *
   * Choosing by the property the fixture actually needs makes the seed immune
   * to residue instead of hostage to it, and **changes nothing on a clean
   * database**, where the first Category is a seeded one with Levels. The
   * error below now means what it says — the production seed has not been run —
   * rather than *something unrelated sorted ahead of it.*
   */
  const category = await prisma.category.findFirst({
    where: { deletedAt: null, levels: { some: { deletedAt: null } } },
    orderBy: { displayOrder: 'asc' },
  });
  const academicYear = await prisma.academicYear.findFirst({ where: { isCurrent: true } });
  const teacherRole = await prisma.role.findUnique({ where: { name: 'teacher' } });

  if (!category || !academicYear || !teacherRole) {
    throw new Error('Run `npm run seed:production` first — fixtures build on the §15.1 seed.');
  }

  await seedDevConsentText();

  const levels = await prisma.level.findMany({
    where: { categoryId: category.id, deletedAt: null },
    orderBy: { displayOrder: 'asc' },
  });
  if (levels.length === 0) {
    throw new Error('Run `npm run seed:production` first — no levels found for the category.');
  }

  // --- 2 branches, each with 2 rooms and an operational_start_date in the past.
  //
  // These carry the association's real premises and their Revision-35 public
  // contact fields, so the §5.1 landing page renders against realistic data in
  // development. They stay HERE rather than in the production seed: §15.1
  // prohibits seeding Branches there, and Revision 35 created no exception —
  // production branches are entered through the admin UI from real data (§2.3).
  const branchFixtures = [
    {
      name: `${FIXTURE_TAG} مقر أمرشيش`,
      address: 'تجزئة الزيتون رقم 5، أمرشيش، مراكش',
      phone: '0524292925',
      email: 'bodoralamal@gmail.com',
      openingHoursAr: 'الاثنين - السبت\n09:00 - 12:30\n15:00 - 18:00',
      googleMapsUrl: 'https://maps.google.com/?q=Amerchich+Marrakesh',
    },
    {
      name: `${FIXTURE_TAG} مقر تاركة`,
      address: 'تجزئة صوفيا، حي الوردة 172، مراكش',
      phone: '0524392829',
      email: 'bodourtargua@gmail.com',
      openingHoursAr: 'الاثنين - السبت\n09:00 - 12:30\n15:00 - 18:00',
      // Deliberately absent, so the landing page's disabled-button path is
      // exercised by the fixtures rather than only by a unit test.
      googleMapsUrl: null,
    },
  ];
  const branches = [];
  for (const [index, fixture] of branchFixtures.entries()) {
    const name = fixture.name;
    const existing = await prisma.branch.findFirst({ where: { name, deletedAt: null } });
    const branch =
      existing ??
      (await prisma.branch.create({
        data: {
          ...fixture,
          displayOrder: index + 1,
          operationalStartDate: daysAgo(180),
        },
      }));
    branches.push(branch);

    for (const roomIndex of [1, 2]) {
      const roomName = `${FIXTURE_TAG} قاعة ${roomIndex}`;
      const room = await prisma.room.findFirst({
        where: { name: roomName, branchId: branch.id, deletedAt: null },
      });
      if (!room) {
        await prisma.room.create({ data: { name: roomName, branchId: branch.id } });
      }
    }
  }
  console.log(`  branches: ${branches.length} (2 rooms each, operational since 180 days ago)`);

  // --- 3 groups per branch, on local wall-clock times (TD-11)
  // Revision 43: **organisation and delivery are separate**. An Administrative
  // Group is a roster at a branch and carries no timetable; the weekly slot
  // belongs to a Recurring Course Schedule, which materializes Sessions.
  // Rewritten rather than migrated, by Document Owner decision: the retired
  // model recorded no Subject for a slot, so any conversion would have had to
  // invent curriculum data.
  const days = [DayOfWeek.monday, DayOfWeek.wednesday, DayOfWeek.saturday];
  const subjects = await prisma.subject.findMany({
    where: { deletedAt: null },
    orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
    take: 3,
  });

  const groups = [];
  for (const branch of branches) {
    const rooms = await prisma.room.findMany({ where: { branchId: branch.id, deletedAt: null } });
    for (let i = 0; i < 3; i++) {
      const name = `${FIXTURE_TAG} مجموعة ${branch.name.slice(-4)} ${i + 1}`;
      const levelId = levels[i % levels.length]!.id;
      const existing = await prisma.administrativeGroup.findFirst({
        where: { name, deletedAt: null },
      });
      const group =
        existing ??
        (await prisma.administrativeGroup.create({
          data: { name, levelId, branchId: branch.id, displayOrder: i },
        }));
      groups.push(group);

      // The delivery half. One schedule per group, so the fixture exercises the
      // `administrative_group` teaching mode; the other two modes are covered by
      // the integration suites rather than seeded here.
      const subjectId = subjects[i % subjects.length]?.id;
      if (subjectId) {
        const already = await prisma.recurringCourseSchedule.findFirst({
          where: { administrativeGroupId: group.id, deletedAt: null },
        });
        if (!already) {
          await prisma.levelSubject.upsert({
            where: { levelId_subjectId: { levelId, subjectId } },
            create: { levelId, subjectId },
            update: {},
          });
          await prisma.recurringCourseSchedule.create({
            data: {
              title: `${FIXTURE_TAG} حلقة`,
              subjectId,
              teachingMode: 'administrative_group',
              administrativeGroupId: group.id,
              branchId: branch.id,
              roomId: rooms[i % rooms.length]?.id ?? null,
              // Wall-clock, never UTC instants (TD-11, §20 rule 14).
              startTime: wallClock('17:00'),
              endTime: wallClock('19:00'),
              recurrence: 'weekly',
              weekdays: [days[i]!],
              academicYearId: academicYear.id,
            },
          });
        }
      }
    }
  }
  console.log(
    `  administrative groups: ${groups.length}, each with a weekly course schedule ` +
      `(wall-clock 17:00–19:00, never UTC instants)`,
  );

  // --- People: a teacher, two parents, an adult student, and login-less minors
  /**
   * **Every fixture person carries a `sex`, and that is not cosmetic.**
   *
   * R27 added the person-side half of `Level.gender_restriction`, and enrolment
   * treats a **NULL sex as NOT eligible** for a restricted Level. This seed
   * predated R27 and was never backfilled, so every fixture beneficiary was
   * silently unenrollable in any `girls_only` Level — the platform refusing
   * correctly against data that could never satisfy it, which is the worst kind
   * of fixture: it looks like a product defect.
   *
   * `female` is the default because every person this seed creates is a woman or
   * a girl (أمينة، خديجة، سعاد، ياسمين، والدة…). It is a parameter rather than a
   * constant so a `boys_only` case can be added without touching the helper.
   */
  async function upsertPerson(
    nameArabic: string,
    opts: {
      preProvisionedEmail?: string;
      sex?: 'female' | 'male';
      /**
       * **R79 — the durable beneficiary fact, declared per fixture.**
       *
       * Explicit rather than inferred, because the whole point of the revision
       * is that it cannot be derived from a role, an enrolment or a name. The
       * QA set below deliberately spans all six shapes so the independence is
       * demonstrable rather than asserted.
       */
      beneficiary?: boolean;
    } = {},
  ) {
    const name = `${FIXTURE_TAG} ${nameArabic}`;
    const existing = await prisma.user.findFirst({ where: { nameArabic: name, deletedAt: null } });
    // **Backfilled, not skipped.** A fixture created before R27 exists with a
    // NULL sex, and returning it unchanged would leave the defect in place on
    // every database that has already been seeded once.
    if (existing) {
      const repair: { sex?: 'female' | 'male'; isBeneficiary?: boolean } = {};
      if (existing.sex === null) repair.sex = opts.sex ?? 'female';
      // Re-asserted on every run: the fixture definition is the authority for
      // what these people ARE, and a database seeded before R79 carries `false`
      // from the column default rather than from a decision.
      if (opts.beneficiary !== undefined && existing.isBeneficiary !== opts.beneficiary) {
        repair.isBeneficiary = opts.beneficiary;
      }
      if (Object.keys(repair).length > 0) {
        return prisma.user.update({ where: { id: existing.id }, data: repair });
      }
      return existing;
    }
    return prisma.user.create({
      data: {
        nameArabic: name,
        accountStatus: 'active',
        sex: opts.sex ?? 'female',
        isBeneficiary: opts.beneficiary ?? false,
        // Staff/adults are pre-provisioned against a fixture address; minors get
        // NOTHING here — they are login-less by rule (BR-5, §4.3).
        ...(opts.preProvisionedEmail
          ? { preProvisionedEmail: fixtureEmail(opts.preProvisionedEmail) }
          : {}),
        nickname: nameArabic,
        phone: '+212 600 000 000',
      },
    });
  }

  /**
   * **The six shapes R79 has to keep apart**, seeded deliberately so the
   * independence of beneficiary status from roles is demonstrable rather than
   * argued: staff-only, beneficiary-only, both, a minor with no role at all,
   * a guardian who does not study, and an admin.
   */
  const teacher = await upsertPerson('أمينة المؤطرة', {
    beneficiary: false,
    preProvisionedEmail: 'teacher.amina',
  });
  // **Guardian only** — she registers her daughters and studies nothing herself.
  const parentConsenting = await upsertPerson('والدة سعاد', {
    beneficiary: false,
    preProvisionedEmail: 'parent.souad',
  });
  const parentRevoked = await upsertPerson('والدة ياسمين', {
    beneficiary: false,
    preProvisionedEmail: 'parent.yasmine',
  });
  // **Beneficiary only** — an adult مستفيدة with the ordinary student role.
  const adultStudent = await upsertPerson('خديجة الطالبة', {
    beneficiary: true,
    preProvisionedEmail: 'student.khadija',
  });
  // **Minor beneficiaries with NO ROLE ROW AT ALL** (§4.3, BR-5) — the shape
  // that makes role-based identification impossible, and the reason R79 exists.
  const minorConsenting = await upsertPerson('سعاد الصغيرة', { beneficiary: true });
  const minorNoConsent = await upsertPerson('ياسمين الصغيرة', { beneficiary: true });

  /**
   * **مؤطرة who also studies** — staff AND beneficiary at once.
   *
   * The case that defeats every shortcut: she must appear in the enrolment
   * selector *because she is a beneficiary*, while `أمينة المؤطرة` beside her
   * must not, and no role distinguishes them.
   */
  const teachingBeneficiary = await upsertPerson('نادية المؤطرة الدارسة', {
    beneficiary: true,
    preProvisionedEmail: 'teacher.nadia',
  });
  /** **Beneficiary with ZERO enrolments** — accepted, not yet placed (R79.4). */
  const unplacedBeneficiary = await upsertPerson('سلمى بلا تسجيل', { beneficiary: true });

  /**
   * Revision 43: teacher scope resolves through `CourseScheduleStaff` (§4.4c) —
   * a teacher reaches students through the courses they staff, not through a
   * group assignment.
   *
   * **This silently staffed NOBODY, and that made the whole teacher portal look
   * broken** (found 2026-08-26, §5). It iterated `groups.slice(0, 2)` and looked
   * up a schedule for each, with `if (!schedule) continue;` — so when the first
   * two groups happened to have no schedule, the loop created **zero** staffing
   * rows and said nothing. The Owner's development database held 15 course
   * schedules and **0** `course_schedule_staff` rows, which is why a مؤطِّرة saw
   * an empty الجدولة, an empty exam list and no إدخال حفظ المستفيدات entry at
   * all: with no assignment, §4.4c resolves an empty scope and every one of
   * those screens is *correctly* empty.
   *
   * **The fix is to iterate what must exist rather than what might.** Schedules
   * are seeded above, so staffing is derived from THEM — the entity the
   * assignment actually needs — and the result is asserted rather than assumed,
   * because a fixture that quietly produces nothing is worse than one that
   * fails: it sends somebody looking for a bug in the application.
   */
  const staffable = await prisma.recurringCourseSchedule.findMany({
    where: {
      deletedAt: null,
      administrativeGroupId: { in: groups.map((g) => g.id) },
    },
    select: { id: true },
    orderBy: { id: 'asc' },
    take: 2,
  });
  if (staffable.length === 0) {
    throw new Error(
      'fixtures: no seeded course schedule to staff — a مؤطِّرة with no assignment ' +
        'has no §4.4c scope, so her whole portal would seed empty. Fix the schedule ' +
        'fixtures above rather than skipping this.',
    );
  }
  for (const schedule of staffable) {
    const link = await prisma.courseScheduleStaff.findFirst({
      where: { scheduleId: schedule.id, userId: teacher.id, deletedAt: null },
    });
    if (!link) {
      await prisma.courseScheduleStaff.create({
        data: { scheduleId: schedule.id, userId: teacher.id, position: 'teacher' },
      });
    }
  }
  const teacherScope = await prisma.userBranchRole.findFirst({
    where: { userId: teacher.id, roleId: teacherRole.id, deletedAt: null },
  });
  if (!teacherScope) {
    await prisma.userBranchRole.create({
      data: { userId: teacher.id, roleId: teacherRole.id, branchId: branches[0]!.id },
    });
  }
  // The مؤطرة who also studies carries the SAME teacher role as أمينة. Nothing
  // in her roles says she is a beneficiary — only `isBeneficiary` does, which is
  // exactly what R79 is for.
  const dualScope = await prisma.userBranchRole.findFirst({
    where: { userId: teachingBeneficiary.id, roleId: teacherRole.id, deletedAt: null },
  });
  if (!dualScope) {
    await prisma.userBranchRole.create({
      data: {
        userId: teachingBeneficiary.id,
        roleId: teacherRole.id,
        branchId: branches[0]!.id,
      },
    });
  }
  console.log(
    '  people: 2 مؤطرات (one of them also a beneficiary), 2 guardians, ' +
      '1 adult beneficiary, 2 login-less minor beneficiaries, 1 unplaced beneficiary',
  );
  void unplacedBeneficiary;

  // --- Family links in BOTH states: approved and pending (§15.2)
  for (const [parent, child, status] of [
    [parentConsenting, minorConsenting, FamilyLinkStatus.approved],
    [parentRevoked, minorNoConsent, FamilyLinkStatus.pending],
  ] as const) {
    const existing = await prisma.familyLink.findFirst({
      where: { parentId: parent.id, studentId: child.id, deletedAt: null },
    });
    if (!existing) {
      await prisma.familyLink.create({
        data: { parentId: parent.id, studentId: child.id, status },
      });
    }
  }
  console.log('  family links: 1 approved, 1 pending (pending grants zero visibility, BR-4)');

  // --- Consent records in both states (§15.2). Absence of a record = NO
  //     consent (BR-1), so the non-consenting minor deliberately gets a
  //     REVOKED record rather than nothing, to exercise the revocation path.
  const consentPairs = [
    { student: minorConsenting, granted: true, by: parentConsenting },
    { student: minorNoConsent, granted: false, by: parentRevoked },
  ];
  for (const pair of consentPairs) {
    const existing = await prisma.consentRecord.findFirst({
      where: { studentId: pair.student.id, consentType: ConsentType.media_release },
    });
    if (!existing) {
      await prisma.consentRecord.create({
        data: {
          studentId: pair.student.id,
          consentType: ConsentType.media_release,
          granted: pair.granted,
          method: ConsentMethod.online_form,
          consentTextVersion: 'fixture-v1',
          grantedByUserId: pair.by.id,
          ...(pair.granted ? {} : { revokedAt: new Date(), revokedByUserId: pair.by.id }),
        },
      });
    }
  }
  console.log('  consent records: 1 granted, 1 revoked (media_release)');

  // --- Enrollments. The non-consenting minor sits in group[0], which is what
  //     makes that group's recordings consent-gated (BR-2).
  for (const [student, group] of [
    [adultStudent, groups[0]!],
    [minorConsenting, groups[0]!],
    [minorNoConsent, groups[0]!],
  ] as const) {
    const existing = await prisma.enrollment.findFirst({
      where: { studentId: student.id, administrativeGroupId: group.id, deletedAt: null },
    });
    if (!existing) {
      // `levelId` comes from the GROUP, never invented here — the composite FK
      // would refuse a disagreement, but passing it from the group is what makes
      // the column a constraint rather than a second source of truth (§4.4c).
      await prisma.enrollment.create({
        data: {
          studentId: student.id,
          administrativeGroupId: group.id,
          levelId: group.levelId,
          // R66 — from the group, which the composite FK then proves.
          branchId: group.branchId,
        },
      });
    }
  }
  console.log('  enrollments: 3 into group 1 (one without consent → gate engages, BR-2)');

  // --- Events covering EVERY recurrence type, incl. biweekly-alternating,
  //     which §4.4 requires to be modeled and tested explicitly.
  const recurrences = [
    RecurrenceType.none,
    RecurrenceType.daily,
    RecurrenceType.weekly,
    RecurrenceType.biweekly_alternating,
    RecurrenceType.yearly,
  ];
  /** Arabic names for the demo rows, so no fixture puts an enum on a screen. */
  const RECURRENCE_LABEL_AR: Record<string, string> = {
    [RecurrenceType.daily]: 'حصة تقوية يومية',
    [RecurrenceType.weekly]: 'لقاء أسبوعي',
    [RecurrenceType.biweekly_alternating]: 'ورشة كل أسبوعين',
    [RecurrenceType.yearly]: 'حفل نهاية السنة',
  };

  for (const [index, recurrence] of recurrences.entries()) {
    // **An Arabic name, not the enum value.** These titles are what the
    // scheduling list renders, and embedding `daily`/`yearly` in them put an
    // internal value on screen as if it were something somebody had typed.
    // The recurrence is still one per row — the fixture's purpose — it is
    // simply no longer the row's *name*.
    const label = RECURRENCE_LABEL_AR[recurrence] ?? 'نشاط';
    const title = `${FIXTURE_TAG} ${label}`;
    const existing = await prisma.event.findFirst({ where: { title, deletedAt: null } });
    if (!existing) {
      const event = await prisma.event.create({
        data: {
          title,
          startDate: daysAgo(30 - index),
          recurrenceType: recurrence,
          // One event per visibility tier across the set (BR-14).
          visibility: [Visibility.public, Visibility.private, Visibility.hidden][index % 3]!,
        },
      });
      // Scope joins are populated EXPLICITLY at creation, never evaluated as
      // runtime wildcards (§4.4).
      await prisma.eventBranch.create({
        data: { eventId: event.id, branchId: branches[index % branches.length]!.id },
      });
    }
  }
  console.log(`  events: ${recurrences.length} (every recurrence type incl. biweekly-alternating)`);

  // --- Content in all three visibility tiers + one consent-forced-private
  const contentSpecs = [
    { title: 'ملف عام', visibility: Visibility.public, forced: false },
    { title: 'ملف خاص', visibility: Visibility.private, forced: false },
    { title: 'ملف مخفي', visibility: Visibility.hidden, forced: false },
    { title: 'تسجيل محمي بالموافقة', visibility: Visibility.private, forced: true },
  ];
  for (const [index, spec] of contentSpecs.entries()) {
    const title = `${FIXTURE_TAG} ${spec.title}`;
    const existing = await prisma.educationalContent.findFirst({
      where: { title, deletedAt: null },
    });
    if (!existing) {
      await prisma.educationalContent.create({
        data: {
          title,
          visibility: spec.visibility,
          consentForcedPrivate: spec.forced,
          levelId: levels[0]!.id,
          // Required since the Revision 43 contract phase (§7): content belongs
          // to a Subject as well as a Level.
          subjectId: subjects[0]!.id,
          branchId: branches[0]!.id,
          academicYearId: academicYear.id,
          // Hash-segmented immutable key shape (TD-9); visibility is never
          // encoded in the key — the bucket carries it.
          storageBucket: spec.visibility === Visibility.public ? 'public' : 'private',
          storageKey: `content/fixture-${index}/a1b2c3d4/fixture-file-${index}.pdf`,
          originalFilename: `fixture-${index}.pdf`,
          mimeType: 'application/pdf',
          sizeBytes: BigInt(1024 * (index + 1)),
        },
      });
    }
  }
  console.log('  content: 3 tiers + 1 consent-forced-private');

  // --- Exams. NOTE: §15.2's grading-template fixtures are deliberately absent
  //     — the weight-template engine is post-MVP and §7 forbids pre-creating
  //     its tables (Revision 13). MVP exams are per-exam and informational.
  const examTitle = `${FIXTURE_TAG} امتحان تجريبي`;
  const existingExam = await prisma.exam.findFirst({ where: { title: examTitle, deletedAt: null } });
  if (!existingExam) {
    await prisma.exam.create({
      data: {
        title: examTitle,
        levelId: levels[0]!.id,
        // R81 — every exam states what its marks are out of; there is no
        // platform-wide scale left to inherit one from.
        maxGrade: 20,
        date: daysAgo(7),
        accessPolicy: ExamAccessPolicy.save_and_resume,
        // R124 — a PHYSICAL sitting, so it is `published` from creation and
        // carries no paper: the questions are on real paper, outside the
        // platform (R58). The builder's own fixture is the online exam below.
        status: 'published',
        /**
         * **R124 — the paper, as rows.** This was a `questions` jsonb blob
         * holding `correctIndex` and `maxPointsBp` — an auto-scoring shape v1
         * deliberately does not have (grading is manual). The blob was
         * snapshotted into `trash` by the migration rather than discarded, and
         * what replaces it is a real online assessment a developer can open.
         */
        questions: {
          create: [
            {
              displayOrder: 1,
              kind: 'multiple_choice',
              prompt: 'سؤال اختيار من متعدد',
              justification: 'optional',
              options: {
                create: [
                  { displayOrder: 1, label: 'أ' },
                  { displayOrder: 2, label: 'ب' },
                  { displayOrder: 3, label: 'ج' },
                ],
              },
            },
            { displayOrder: 2, kind: 'long_text', prompt: 'سؤال مقالي' },
          ],
        },
      },
    });
  }
  console.log('  exams: 1 (stable question UUIDs; no grading templates — post-MVP §10.1)');

  // --- Official Hijri month starts: DELIBERATELY NOT SEEDED (Revisions 31–32).
  //
  // The overlay reads `HijriMonthStart` and nothing else, so an empty table means
  // the calendar shows no Hijri dates at all. That is correct by rule (§4.4,
  // §20 rule 14) but indistinguishable on screen from a broken feature, so it is
  // worth saying why these fixtures do not fill it.
  //
  // TWO REASONS, and the second is the decisive one.
  //
  // 1. Only two real announcements are on record anywhere in this project —
  //    1 Dhu al-Hijja 1447 = 18 May 2026 and 1 Muharram 1448 = 17 June 2026
  //    (SRS Revision 31). Seeding anything beyond them would mean INVENTING an
  //    official religious calendar, which is precisely what Revisions 31–32
  //    exist to prevent: a fabricated month start looks authoritative and is
  //    wrong, the worst possible failure for this feature.
  //
  // 2. THE INTEGRATION SUITES OWN THOSE TWO YEARS, and they have the stronger
  //    claim. `calendar.integration.test.ts` asserts that 16 June 2026 still
  //    reads 1447-12-30 — Umm al-Qura puts 1 Muharram 1448 there, Morocco
  //    announced the 17th — and that test is the guard that catches an algorithm
  //    creeping back in. It therefore MUST use the real values. Because
  //    (hijri_year, hijri_month) is unique (TD-6), a fixture row for 1447/12
  //    would collide with the row that test creates, and the suite's cleanup
  //    would silently delete the fixture. A fix that degrades invisibly the
  //    first time someone runs the tests is worse than no fix.
  //
  // TO SEE THE OVERLAY LOCALLY, record months through the API — the runbook has
  // the exact calls (docs/operations/runbooks.md, "Recording an official Hijri
  // month"). Record TWO CONSECUTIVE months: one alone resolves only its certain
  // 29 days, because knowing when a month began says nothing about when it
  // ended.
  console.log(
    '  hijri months: none — by design (Revisions 31–32). The integration suites own\n' +
      '                 1447–1448, and inventing later months is prohibited. To see the\n' +
      '                 overlay locally, record two consecutive months via the API:\n' +
      '                 see docs/operations/runbooks.md → "Recording an official Hijri month"',
  );

  console.log('\nFixtures complete.');
}

main()
  .catch((error: unknown) => {
    console.error('Fixtures failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
