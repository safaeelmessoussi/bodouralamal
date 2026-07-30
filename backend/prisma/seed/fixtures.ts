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

async function main(): Promise<void> {
  await assertNonProduction();
  console.log(`Development fixtures (§15.2) — NODE_ENV=${config.NODE_ENV}\n`);

  // Fixtures build on the §15.1 production seed (roles, categories, levels,
  // subjects, academic year, surahs) rather than duplicating it.
  const category = await prisma.category.findFirst({
    where: { deletedAt: null },
    orderBy: { displayOrder: 'asc' },
  });
  const academicYear = await prisma.academicYear.findFirst({ where: { isCurrent: true } });
  const teacherRole = await prisma.role.findUnique({ where: { name: 'teacher' } });

  if (!category || !academicYear || !teacherRole) {
    throw new Error('Run `npm run seed:production` first — fixtures build on the §15.1 seed.');
  }

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
  const days = [DayOfWeek.monday, DayOfWeek.wednesday, DayOfWeek.saturday];
  let groupCount = 0;
  const groups = [];
  for (const branch of branches) {
    const rooms = await prisma.room.findMany({ where: { branchId: branch.id, deletedAt: null } });
    for (let i = 0; i < 3; i++) {
      const name = `${FIXTURE_TAG} مجموعة ${branch.name.slice(-4)} ${i + 1}`;
      const existing = await prisma.group.findFirst({ where: { name, deletedAt: null } });
      const group =
        existing ??
        (await prisma.group.create({
          data: {
            name,
            levelId: levels[i % levels.length]!.id,
            branchId: branch.id,
            roomId: rooms[i % rooms.length]?.id ?? null,
            dayOfWeek: days[i]!,
            startTime: wallClock('17:00'),
            endTime: wallClock('19:00'),
            maxStudents: 12,
          },
        }));
      groups.push(group);
      groupCount++;
    }
  }
  console.log(`  groups: ${groupCount} (wall-clock 17:00–19:00, never UTC instants)`);

  // --- People: a teacher, two parents, an adult student, and login-less minors
  async function upsertPerson(nameArabic: string, opts: { preProvisionedEmail?: string } = {}) {
    const name = `${FIXTURE_TAG} ${nameArabic}`;
    const existing = await prisma.user.findFirst({ where: { nameArabic: name, deletedAt: null } });
    if (existing) return existing;
    return prisma.user.create({
      data: {
        nameArabic: name,
        accountStatus: 'active',
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

  const teacher = await upsertPerson('أمينة المؤطرة', {
    preProvisionedEmail: 'teacher.amina',
  });
  const parentConsenting = await upsertPerson('والدة سعاد', {
    preProvisionedEmail: 'parent.souad',
  });
  const parentRevoked = await upsertPerson('والدة ياسمين', {
    preProvisionedEmail: 'parent.yasmine',
  });
  const adultStudent = await upsertPerson('خديجة الطالبة', {
    preProvisionedEmail: 'student.khadija',
  });
  // Minor students: login-less — no identity, no pre_provisioned_email (BR-5).
  const minorConsenting = await upsertPerson('سعاد الصغيرة');
  const minorNoConsent = await upsertPerson('ياسمين الصغيرة');

  // Teacher scoping resolves exclusively through GroupTeacher (§4.2).
  for (const group of groups.slice(0, 2)) {
    const link = await prisma.groupTeacher.findFirst({
      where: { groupId: group.id, teacherId: teacher.id, deletedAt: null },
    });
    if (!link) {
      await prisma.groupTeacher.create({ data: { groupId: group.id, teacherId: teacher.id } });
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
  console.log('  people: teacher, 2 parents, 1 adult student, 2 login-less minors');

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
    const existing = await prisma.studentGroup.findFirst({
      where: { studentId: student.id, groupId: group.id, deletedAt: null },
    });
    if (!existing) {
      await prisma.studentGroup.create({ data: { studentId: student.id, groupId: group.id } });
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
  for (const [index, recurrence] of recurrences.entries()) {
    const title = `${FIXTURE_TAG} حدث ${recurrence}`;
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
        date: daysAgo(7),
        accessPolicy: ExamAccessPolicy.save_and_resume,
        // Every question carries an immutable auto-generated UUID; submissions
        // reference these, never array positions (TD-6).
        questions: [
          {
            id: crypto.randomUUID(),
            type: 'mcq',
            prompt: 'سؤال اختيار من متعدد',
            options: ['أ', 'ب', 'ج'],
            correctIndex: 0,
            maxPointsBp: 5000,
          },
          {
            id: crypto.randomUUID(),
            type: 'free_text',
            prompt: 'سؤال مقالي',
            maxPointsBp: 5000,
          },
        ],
      },
    });
  }
  console.log('  exams: 1 (stable question UUIDs; no grading templates — post-MVP §10.1)');

  // --- Official Hijri month starts (Revisions 31–32).
  //
  // WHY THESE ARE HERE. The calendar's Hijri overlay reads `HijriMonthStart` and
  // nothing else; a month the Ministry of Habous has not announced renders NO
  // overlay, by rule (§4.4, §20 rule 14). With the table empty — which is how a
  // fresh database starts — the whole overlay is invisible, and a developer
  // cannot tell a correctly-silent calendar from a broken one.
  //
  // WHY ONLY TWO. These are the only two announcements this project has on
  // record: SRS Revision 31 states **1 Muharram 1448 = Wednesday 17 June 2026**
  // (contrasting the Ministry with Umm al-Qura's 16 June), and the calendar HTTP
  // suite uses **1 Dhu al-Hijja 1447 = 18 May 2026** as the officially announced
  // Moroccan date. Both are real; everything after them would be INVENTED, and
  // fabricating an official religious calendar is precisely what Revisions 31–32
  // exist to prevent. A made-up month start would look authoritative and be
  // wrong — the worst possible failure for this feature.
  //
  // WHAT THAT MEANS ON SCREEN. Consecutive recorded months resolve completely,
  // so 18 May – 16 June 2026 is fully labelled. Muharram 1448 resolves for its
  // certain 29 days (17 June – 15 July). **From 16 July 2026 the overlay is
  // silent** until Safar 1448 is recorded, because knowing when a month began
  // says nothing about when it ends — that depends on the next sighting. That
  // boundary is correct behaviour, not a gap in these fixtures.
  //
  // Production is unaffected: §15.1 seeds no Hijri data, and real months are
  // recorded by a Super Admin from the Ministry's announcements (§2.3, §5.7).
  const officialMonthStarts = [
    { hijriYear: 1447, hijriMonth: 12, gregorianStartDate: '2026-05-18' },
    { hijriYear: 1448, hijriMonth: 1, gregorianStartDate: '2026-06-17' },
  ];
  for (const month of officialMonthStarts) {
    await prisma.hijriMonthStart.upsert({
      where: {
        hijriYear_hijriMonth: { hijriYear: month.hijriYear, hijriMonth: month.hijriMonth },
      },
      update: {},
      create: {
        hijriYear: month.hijriYear,
        hijriMonth: month.hijriMonth,
        gregorianStartDate: new Date(`${month.gregorianStartDate}T00:00:00.000Z`),
        // Only PUBLISHED months render anywhere (Revision 31), so a draft here
        // would leave the overlay just as invisible as an empty table.
        status: 'published',
        // `manual` is the provenance for a transcribed announcement; an importer
        // would write its own identifier (Revision 32).
        source: 'manual',
      },
    });
  }
  console.log(
    `  hijri months: ${officialMonthStarts.length} recorded official starts (Revisions 31–32) — published; the overlay is silent past 15 July 2026 until Safar 1448 is announced`,
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
