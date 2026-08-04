import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { loadConfig } from '../lib/config.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import {
  describeProtection,
  protectionReasons,
  protectionReasonsFor,
  registerSessionProtectionRule,
  resetContributedRules,
  sessionProtectionRules,
  SELECT_PROTECTABLE,
  type ProtectableSession,
} from './session-protection.js';

/**
 * Session protection — the semantic rule and its extensibility point
 * (SRS §4.4, Revision 43.6).
 *
 * > A Session is protected whenever it holds data created by a user or an
 * > administrator **whose loss or silent modification would change historical
 * > truth.**
 *
 * These tests defend the *mechanism*: that the built-ins hold with no
 * registration step, that a module can contribute a condition knowing nothing
 * about scheduling, and that evaluation stays bulk rather than per-session.
 * Whether a schedule edit then honours the answer is the schedule suite's job.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const TAG = '[session-protection-test]';

let scheduleId: string;
let sessions: ProtectableSession[];

const bySession = (id: string, reasons: Map<string, string[]>): string[] =>
  (reasons.get(id) ?? []).slice().sort();

beforeAll(async () => {
  const category = await prisma.category.create({ data: { name: `${TAG} فئة` } });
  const level = await prisma.level.create({
    data: { name: `${TAG} مستوى`, categoryId: category.id, genderRestriction: 'any' },
  });
  const branch = await prisma.branch.create({
    data: { name: `${TAG} فرع`, operationalStartDate: new Date('2026-01-01') },
  });
  const subject = await prisma.subject.create({ data: { name: `${TAG} مادة` } });
  const academicYear = await prisma.academicYear.findFirstOrThrow({ select: { id: true } });

  const schedule = await prisma.recurringCourseSchedule.create({
    data: {
      subjectId: subject.id,
      teachingMode: 'entire_level',
      levelId: level.id,
      branchId: branch.id,
      startTime: new Date(Date.UTC(1970, 0, 1, 9, 0, 0)),
      endTime: new Date(Date.UTC(1970, 0, 1, 10, 0, 0)),
      recurrence: 'weekly',
      weekdays: ['tuesday'],
      academicYearId: academicYear.id,
    },
  });
  scheduleId = schedule.id;

  // One session per state the built-in rules care about, plus a plain one.
  const rows = [
    { date: new Date('2026-06-02'), overridden: false, status: 'scheduled' as const },
    { date: new Date('2026-06-09'), overridden: true, status: 'scheduled' as const },
    { date: new Date('2026-06-16'), overridden: false, status: 'held' as const },
    {
      date: new Date('2026-06-23'),
      overridden: false,
      status: 'cancelled' as const,
      cancellationReason: 'عطلة',
    },
    { date: new Date('2026-06-30'), overridden: true, status: 'held' as const },
  ];
  for (const r of rows) {
    await prisma.session.create({
      data: {
        scheduleId,
        startTime: new Date(Date.UTC(1970, 0, 1, 9, 0, 0)),
        endTime: new Date(Date.UTC(1970, 0, 1, 10, 0, 0)),
        ...r,
      },
    });
  }

  sessions = await prisma.session.findMany({
    where: { scheduleId },
    select: SELECT_PROTECTABLE,
    orderBy: { date: 'asc' },
  });
});

afterEach(() => {
  // Contributed rules are per-test; the built-ins are untouched by design.
  resetContributedRules();
});

afterAll(async () => {
  const tagged = { name: { startsWith: TAG } };
  await prisma.sessionContent.deleteMany({ where: { session: { scheduleId } } });
  await prisma.educationalContent.deleteMany({ where: { title: { startsWith: TAG } } });
  await prisma.sessionStaff.deleteMany({ where: { session: { scheduleId } } });
  await prisma.session.deleteMany({ where: { scheduleId } });
  await prisma.recurringCourseSchedule.deleteMany({ where: { subject: tagged } });
  await prisma.subject.deleteMany({ where: tagged });
  await prisma.level.deleteMany({ where: tagged });
  await prisma.branch.deleteMany({ where: tagged });
  await prisma.category.deleteMany({ where: tagged });
  await prisma.$disconnect();
});

describe('the built-in rules hold with NO registration step', () => {
  it('are present the moment the module is imported', () => {
    // A protection that can be switched off by forgetting to call a bootstrap
    // function is not a protection (§4.4). This asserts they are unconditional.
    const codes = sessionProtectionRules().map((r) => r.code);
    expect(codes).toEqual(expect.arrayContaining(['OVERRIDDEN', 'LIFECYCLE', 'HAS_CONTENT']));
  });

  it('resetting contributed rules never removes a built-in', () => {
    registerSessionProtectionRule({
      code: 'TEMP',
      describes: 'temporary',
      evaluate: () => new Set(),
    });
    resetContributedRules();
    const codes = sessionProtectionRules().map((r) => r.code);
    expect(codes).toContain('OVERRIDDEN');
    expect(codes).not.toContain('TEMP');
  });

  it('leaves a plain scheduled session unprotected', async () => {
    const reasons = await protectionReasons(prisma, sessions);
    const plain = sessions.find((s) => s.date.toISOString().startsWith('2026-06-02'));
    expect(reasons.has(plain!.id)).toBe(false);
  });

  it('protects an overridden session, a held one, and a cancelled one', async () => {
    const reasons = await protectionReasons(prisma, sessions);
    const at = (iso: string): ProtectableSession =>
      sessions.find((s) => s.date.toISOString().startsWith(iso))!;

    expect(bySession(at('2026-06-09').id, reasons)).toEqual(['OVERRIDDEN']);
    expect(bySession(at('2026-06-16').id, reasons)).toEqual(['LIFECYCLE']);
    expect(bySession(at('2026-06-23').id, reasons)).toEqual(['LIFECYCLE']);
  });

  it('returns EVERY applicable reason, not just the first', async () => {
    // A session may be both already held AND deliberately changed. An
    // administrator deciding whether to overwrite it deserves both facts, and
    // a first-match-wins answer would hide one.
    const reasons = await protectionReasons(prisma, sessions);
    const both = sessions.find((s) => s.date.toISOString().startsWith('2026-06-30'))!;
    expect(bySession(both.id, reasons)).toEqual(['LIFECYCLE', 'OVERRIDDEN']);
  });

  it('protects a session with attached content, whatever its date', async () => {
    const plain = sessions.find((s) => s.date.toISOString().startsWith('2026-06-02'))!;
    const content = await prisma.educationalContent.create({
      data: {
        title: `${TAG} ملف`,
        levelId: (await prisma.level.findFirstOrThrow({ where: { name: { startsWith: TAG } } })).id,
        academicYearId: (await prisma.academicYear.findFirstOrThrow()).id,
        storageBucket: 'private',
        storageKey: `${TAG}/${Date.now()}`,
        originalFilename: 'x.pdf',
        mimeType: 'application/pdf',
        sizeBytes: BigInt(1),
      },
    });
    const link = await prisma.sessionContent.create({
      data: { sessionId: plain.id, contentId: content.id },
    });

    expect(await protectionReasonsFor(prisma, plain)).toEqual(['HAS_CONTENT']);

    await prisma.sessionContent.delete({ where: { id: link.id } });
    await prisma.educationalContent.delete({ where: { id: content.id } });
  });
});

describe('a module contributes a rule knowing nothing about scheduling', () => {
  it('is consulted alongside the built-ins', async () => {
    // This is the shape a future attendance/grades/evaluations module takes: it
    // names its own condition and never mentions schedules, materialization or
    // regeneration.
    const plain = sessions.find((s) => s.date.toISOString().startsWith('2026-06-02'))!;
    registerSessionProtectionRule({
      code: 'HAS_ATTENDANCE',
      describes: 'attendance has been recorded for this session',
      evaluate: (_tx, candidates) =>
        new Set(candidates.filter((c) => c.id === plain.id).map((c) => c.id)),
    });

    const reasons = await protectionReasons(prisma, sessions);
    expect(bySession(plain.id, reasons)).toEqual(['HAS_ATTENDANCE']);
  });

  it('ADDS to an existing reason rather than replacing it', async () => {
    const held = sessions.find((s) => s.date.toISOString().startsWith('2026-06-16'))!;
    registerSessionProtectionRule({
      code: 'HAS_EVALUATION',
      describes: 'an evaluation was recorded against this session',
      evaluate: () => new Set([held.id]),
    });

    // A rule may only ADD protection — there is no un-protect, deliberately, or
    // one module could overrule another module's safeguard.
    expect(bySession(held.id, await protectionReasons(prisma, sessions))).toEqual([
      'HAS_EVALUATION',
      'LIFECYCLE',
    ]);
  });

  it('refuses a duplicate code rather than shadowing one', () => {
    registerSessionProtectionRule({
      code: 'HAS_GRADES',
      describes: 'grades were recorded',
      evaluate: () => new Set(),
    });
    // Codes appear in audit rows, so two rules under one code would make the
    // record ambiguous about which safeguard applied.
    expect(() =>
      registerSessionProtectionRule({
        code: 'HAS_GRADES',
        describes: 'something else entirely',
        evaluate: () => new Set(),
      }),
    ).toThrow(/already registered/u);
  });

  it('refuses to shadow a BUILT-IN code too', () => {
    expect(() =>
      registerSessionProtectionRule({
        code: 'HAS_CONTENT',
        describes: 'a competing definition',
        evaluate: () => new Set(),
      }),
    ).toThrow(/already registered/u);
  });

  it('surfaces the human description an administrator is shown', () => {
    registerSessionProtectionRule({
      code: 'HAS_CERTIFICATE',
      describes: 'a certificate was issued from this session',
      evaluate: () => new Set(),
    });
    expect(describeProtection(['HAS_CONTENT', 'HAS_CERTIFICATE'])).toEqual([
      'educational content is attached to this occurrence',
      'a certificate was issued from this session',
    ]);
  });
});

describe('evaluation is BULK, not per session', () => {
  it('calls each rule ONCE for the whole set', async () => {
    // §4.4 requires this: at a full academic-year horizon a per-session check
    // would be an N+1 wearing a guard's clothing.
    let calls = 0;
    let sawCount = 0;
    registerSessionProtectionRule({
      code: 'COUNTING',
      describes: 'counts its invocations',
      evaluate: (_tx, candidates) => {
        calls += 1;
        sawCount = candidates.length;
        return new Set();
      },
    });

    await protectionReasons(prisma, sessions);

    expect(calls).toBe(1);
    expect(sawCount).toBe(sessions.length);
  });

  it('short-circuits on an empty set without calling any rule', async () => {
    let calls = 0;
    registerSessionProtectionRule({
      code: 'NEVER_CALLED',
      describes: 'should not run',
      evaluate: () => {
        calls += 1;
        return new Set();
      },
    });

    expect((await protectionReasons(prisma, [])).size).toBe(0);
    expect(calls).toBe(0);
  });
});
