import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { issueAccessToken } from "../lib/access-token.js";
import { loadConfig } from "../lib/config.js";
import { createPrismaClient, TEST_CONNECTION_LIMIT } from "../lib/prisma.js";
import { httpCall } from "../test-support/http-client.js";

/**
 * **The maximum grade belongs to the Exam (§4.6, SRS Revision 81).**
 *
 * The Owner retired the platform-wide `grading.display_scale` and
 * `grading.passing_grade_bp`: each exam now states what its marks are out of,
 * different exams may state different things, and nothing derives a verdict from
 * a score.
 *
 * What is asserted here can only be asserted over real HTTP: that **two exams
 * with different maxima coexist without interfering**, that the bound is applied
 * **by the server** rather than by a form, and that the retired concepts are
 * absent from the wire rather than merely hidden on a screen.
 *
 * Requires the compose stack with the api image built from current source:
 *   docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build api
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const BASE = `${config.PUBLIC_BASE_URL}/api/v1`;
const TAG = "[r81-max-grade-test]";
const YEAR_LABEL = "2099-2100";

interface Res {
  status: number;
  body: Record<string, unknown> & {
    error?: { code?: string; details?: Record<string, unknown> };
    data?: Record<string, unknown>;
  };
}

const call = (method: string, path: string, token?: string, body?: unknown) =>
  httpCall<Res["body"]>(BASE, method, path, {
    token,
    ...(body !== undefined ? { body } : {}),
  }) as Promise<Res>;

const bearer = (userId: string, roles: { role: string; branches: string[] | null }[]) =>
  issueAccessToken(
    { userId, roleScopes: roles as never, accountStatus: "active" as never },
    config.JWT_SIGNING_KEY,
  ).token;

let superToken: string;
let studentToken: string;
let levelId: string;
let branchId: string;
let subjectId: string;
let roomId: string;
let yearId: string;
let studentId: string;
/** Out of 20 — the association's historical scale, now this exam's own. */
let examOutOf20: string;
/** Out of 10 — the whole point: a second scale, coexisting. */
let examOutOf10: string;

async function clear(): Promise<void> {
  const exams = await prisma.exam.findMany({
    where: { title: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = exams.map((e) => e.id);
  await prisma.grade.deleteMany({ where: { examId: { in: ids } } });
  await prisma.examStaff.deleteMany({ where: { examId: { in: ids } } });
  // R82 — a notification RESTRICTs the exam or event it is about, deliberately:
  // a notice whose subject vanished would be unreadable. Test teardown is the
  // only place anything here is HARD-deleted (production soft-deletes), so the
  // notices go first.
  await prisma.notification.deleteMany({ where: { exam: { id: { in: ids } } } });
  await prisma.exam.deleteMany({ where: { id: { in: ids } } });

  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const uids = users.map((u) => u.id);
  await prisma.grade.deleteMany({ where: { studentId: { in: uids } } });
  await prisma.enrollment.deleteMany({ where: { studentId: { in: uids } } });
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: uids } } });
  await prisma.userBranchRole.deleteMany({ where: { userId: { in: uids } } });
  await prisma.user.deleteMany({ where: { id: { in: uids } } });

  await prisma.levelSubject.deleteMany({ where: { level: { name: { startsWith: TAG } } } });
  await prisma.administrativeGroup.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.level.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.category.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.subject.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.room.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.branch.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.academicYear.deleteMany({ where: { label: YEAR_LABEL } });
}

beforeAll(async () => {
  const health = await fetch(`${config.PUBLIC_BASE_URL}/healthz`).catch(() => null);
  if (!health || health.status !== 200) throw new Error("API not reachable");
  await clear();

  // Its own Category/Level/Branch: borrowing another suite's fixtures makes a
  // failure here mean something about that suite instead of about this rule.
  const category = await prisma.category.create({ data: { name: `${TAG} فئة`, displayOrder: 1 } });
  const level = await prisma.level.create({
    data: { name: `${TAG} مستوى`, categoryId: category.id, displayOrder: 1, genderRestriction: "any" },
  });
  levelId = level.id;
  const branch = await prisma.branch.create({ data: { name: `${TAG} فرع`, address: "—" } });
  branchId = branch.id;
  roomId = (await prisma.room.create({ data: { name: `${TAG} قاعة`, branchId, capacity: 20 } })).id;
  subjectId = (await prisma.subject.create({ data: { name: `${TAG} مادة`, displayOrder: 1 } })).id;
  // The exam service refuses a subject the Level does not teach
  // (`SUBJECT_NOT_IN_LEVEL`), which is the rule doing its job — the fixture has
  // to build a Level that genuinely teaches it.
  await prisma.levelSubject.create({ data: { levelId, subjectId } });
  yearId = (await prisma.academicYear.create({ data: { label: YEAR_LABEL } })).id;

  const su = await prisma.user.create({
    data: { nameArabic: `${TAG} مديرة`, sex: "female", accountStatus: "active" },
  });
  superToken = bearer(su.id, [{ role: "super_admin", branches: null }]);
  // The role row as well as the claim: TD-12 re-asserts authorization against
  // the database on high-risk endpoints, so a token alone reaches nothing.
  const roleRow = await prisma.role.findFirst({ where: { name: "super_admin" } });
  await prisma.userBranchRole.create({
    data: { userId: su.id, roleId: roleRow!.id, branchId: null },
  });

  const student = await prisma.user.create({
    data: { nameArabic: `${TAG} مستفيدة`, sex: "female", accountStatus: "active", isBeneficiary: true },
  });
  studentId = student.id;
  studentToken = bearer(student.id, [{ role: "student", branches: null }]);
  await prisma.enrollment.create({ data: { studentId, levelId, branchId } });
});

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

const examBody = (title: string, maxGrade: unknown) => ({
  mode: "physical",
  title: `${TAG} ${title}`,
  max_grade: maxGrade,
  date: "2099-11-11",
  start_time: "09:00",
  end_time: "11:00",
  level_id: levelId,
  subject_id: subjectId,
  academic_year_id: yearId,
  branch_id: branchId,
  room_id: roomId,
});

/* ── A, B, C · different maxima, side by side ───────────────────────────── */

describe("an Exam carries its own maximum grade", () => {
  it("A · creates one out of 20", async () => {
    const res = await call("POST", "/exams", superToken, examBody("امتحان أ", 20));
    expect(res.status).toBe(201);
    // The create response is `{ id }`; the maximum is read back from the list,
    // which is the contract a client actually renders from.
    examOutOf20 = (res.body as unknown as { id: string }).id;
    const list = await call("GET", `/exams?branch_id=${branchId}`, superToken);
    const row = (list.body.data as unknown as Record<string, unknown>[]).find(
      (e) => e["id"] === examOutOf20,
    )!;
    expect(row["max_grade"]).toBe(20);
  });

  it("B · creates another out of 10", async () => {
    const res = await call("POST", "/exams", superToken, examBody("امتحان ب", 10));
    expect(res.status).toBe(201);
    examOutOf10 = (res.body as unknown as { id: string }).id;
    const list = await call("GET", `/exams?branch_id=${branchId}`, superToken);
    const row = (list.body.data as unknown as Record<string, unknown>[]).find(
      (e) => e["id"] === examOutOf10,
    )!;
    expect(row["max_grade"]).toBe(10);
  });

  it("C · both coexist, each reporting its own maximum", async () => {
    // The property the retired global scale made impossible.
    const a = await call("GET", `/exams/${examOutOf20}/grades`, superToken);
    const b = await call("GET", `/exams/${examOutOf10}/grades`, superToken);
    expect((a.body.data as Record<string, unknown>)["max_grade"]).toBe(20);
    expect((b.body.data as Record<string, unknown>)["max_grade"]).toBe(10);
  });

  it("is REQUIRED at creation — an exam nobody can mark is refused", async () => {
    const body = examBody("بلا حدّ", undefined) as Record<string, unknown>;
    delete body["max_grade"];
    const res = await call("POST", "/exams", superToken, body);
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe("VALIDATION_FAILED");
  });

  it("must be positive — zero and negatives are refused", async () => {
    for (const bad of [0, -5]) {
      const res = await call("POST", "/exams", superToken, examBody("سالب", bad));
      expect(res.status).toBe(400);
    }
  });
});

/* ── D–H · the bound is the exam's, and the server applies it ───────────── */

describe("a score is bounded by ITS OWN exam's maximum", () => {
  it("D · exam A accepts 15", async () => {
    const res = await call("PUT", `/exams/${examOutOf20}/grades`, superToken, {
      entries: [{ student_id: studentId, score: 15, absent: false }],
    });
    expect(res.status).toBe(200);
    const sheet = await call("GET", `/exams/${examOutOf20}/grades`, superToken);
    const row = (sheet.body.data as { rows: Record<string, unknown>[] }).rows.find(
      (r) => r["student_id"] === studentId,
    )!;
    expect(row["score"]).toBe(15);
  });

  it("E · exam A refuses 21 — from the SERVER, with no form involved", async () => {
    const res = await call("PUT", `/exams/${examOutOf20}/grades`, superToken, {
      entries: [{ student_id: studentId, score: 21, absent: false }],
    });
    expect(res.status).toBe(400);
    expect(res.body.error?.details?.["reason"]).toBe("SCORE_OUT_OF_RANGE");
    expect(res.body.error?.details?.["max_grade"]).toBe(20);

    // **And nothing moved.** A refusal that had already written would be worse
    // than one that accepted, because it would look like a refusal.
    const sheet = await call("GET", `/exams/${examOutOf20}/grades`, superToken);
    const row = (sheet.body.data as { rows: Record<string, unknown>[] }).rows.find(
      (r) => r["student_id"] === studentId,
    )!;
    expect(row["score"]).toBe(15);
  });

  it("F · exam B accepts 8", async () => {
    const res = await call("PUT", `/exams/${examOutOf10}/grades`, superToken, {
      entries: [{ student_id: studentId, score: 8, absent: false }],
    });
    expect(res.status).toBe(200);
  });

  it("G · exam B refuses 11, which exam A would have accepted", async () => {
    // The decisive pair: the SAME number is valid on one exam and not on the
    // other, which is only true if the bound really is per-exam.
    const onB = await call("PUT", `/exams/${examOutOf10}/grades`, superToken, {
      entries: [{ student_id: studentId, score: 11, absent: false }],
    });
    expect(onB.status).toBe(400);

    const onA = await call("PUT", `/exams/${examOutOf20}/grades`, superToken, {
      entries: [{ student_id: studentId, score: 11, absent: false }],
    });
    expect(onA.status).toBe(200);
  });

  it("H · accepts a decimal score, exactly as given", async () => {
    const res = await call("PUT", `/exams/${examOutOf20}/grades`, superToken, {
      entries: [{ student_id: studentId, score: 15.25, absent: false }],
    });
    expect(res.status).toBe(200);
    const sheet = await call("GET", `/exams/${examOutOf20}/grades`, superToken);
    const row = (sheet.body.data as { rows: Record<string, unknown>[] }).rows.find(
      (r) => r["student_id"] === studentId,
    )!;
    // **No rounding surprise**: what went in is what comes back. Under the old
    // basis-point storage this round trip was the risk R81 removed.
    expect(row["score"]).toBe(15.25);
  });

  it("refuses a third decimal rather than rounding it silently", async () => {
    const res = await call("PUT", `/exams/${examOutOf20}/grades`, superToken, {
      entries: [{ student_id: studentId, score: 15.256, absent: false }],
    });
    expect(res.status).toBe(400);
  });

  it("accepts full marks — the bound is inclusive at both ends", async () => {
    for (const [exam, value] of [
      [examOutOf20, 20],
      [examOutOf10, 10],
    ] as const) {
      const res = await call("PUT", `/exams/${exam}/grades`, superToken, {
        entries: [{ student_id: studentId, score: value, absent: false }],
      });
      expect(res.status).toBe(200);
    }
  });
});

/* ── L · exams do not affect each other ─────────────────────────────────── */

describe("changing one exam leaves the other alone", () => {
  it("L · editing exam A's maximum does not touch exam B", async () => {
    const before = await call("GET", `/exams/${examOutOf10}/grades`, superToken);
    const beforeRow = (before.body.data as { rows: Record<string, unknown>[] }).rows.find(
      (r) => r["student_id"] === studentId,
    )!;

    const exam = await prisma.exam.findUniqueOrThrow({ where: { id: examOutOf20 } });
    const res = await call("PATCH", `/exams/${examOutOf20}`, superToken, {
      max_grade: 100,
      version: exam.version,
    });
    // PATCH answers 204 — an edit returns nothing, by this contract's own
    // convention (the read below is what proves the change landed).
    expect(res.status).toBe(204);

    const a = await call("GET", `/exams/${examOutOf20}/grades`, superToken);
    const b = await call("GET", `/exams/${examOutOf10}/grades`, superToken);
    expect((a.body.data as Record<string, unknown>)["max_grade"]).toBe(100);
    expect((b.body.data as Record<string, unknown>)["max_grade"]).toBe(10);
    const afterRow = (b.body.data as { rows: Record<string, unknown>[] }).rows.find(
      (r) => r["student_id"] === studentId,
    )!;
    expect(afterRow["score"]).toBe(beforeRow["score"]);
  });

  it("refuses a maximum BELOW a mark already recorded, rather than clamping it", async () => {
    // A mark of 20 capped to 5 is not the student's result, and silently
    // rewriting it to make a form succeed is the one outcome that must not
    // happen. The edit fails and says how many rows disagree.
    const exam = await prisma.exam.findUniqueOrThrow({ where: { id: examOutOf20 } });
    const res = await call("PATCH", `/exams/${examOutOf20}`, superToken, {
      max_grade: 5,
      version: exam.version,
    });
    expect(res.status).toBe(400);
    expect(res.body.error?.details?.["reason"]).toBe("GRADES_EXCEED_MAX_GRADE");
    expect(res.body.error?.details?.["grades_above_maximum"]).toBe(1);

    const after = await prisma.exam.findUniqueOrThrow({ where: { id: examOutOf20 } });
    expect(Number(after.maxGrade)).toBe(100);
  });
});

/* ── K, N, O, Q · what the student sees, and what nobody sees ───────────── */

describe("the student reads a score out of a maximum, and no verdict", () => {
  it("Q · draft is invisible; publishing is what reveals it (BR-8)", async () => {
    const before = await call("GET", "/students/me/grades", studentToken);
    expect((before.body.data as unknown as unknown[]).length).toBe(0);

    for (const exam of [examOutOf20, examOutOf10]) {
      const res = await call("POST", `/exams/${exam}/grades/publish`, superToken);
      expect(res.status).toBe(200);
    }
  });

  it("K · sees each exam's own pair — 20 / 100 beside 10 / 10", async () => {
    const res = await call("GET", "/students/me/grades", studentToken);
    const rows = res.body.data as unknown as Record<string, unknown>[];
    const a = rows.find((r) => r["exam_id"] === examOutOf20)!;
    const b = rows.find((r) => r["exam_id"] === examOutOf10)!;
    expect(a["score"]).toBe(20);
    expect(a["max_grade"]).toBe(100);
    expect(b["score"]).toBe(10);
    expect(b["max_grade"]).toBe(10);
  });

  it("O · produces no pass/fail label, and nothing to compute one from", async () => {
    const res = await call("GET", "/students/me/grades", studentToken);
    const rows = res.body.data as unknown as Record<string, unknown>[];
    for (const row of rows) {
      for (const gone of ["passed", "manual_pass_fail_override", "value_bp", "passing_grade_bp"]) {
        expect(row).not.toHaveProperty(gone);
      }
    }
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain("ناجح");
    expect(raw).not.toContain("راسب");
  });

  it("M · no endpoint publishes a platform-wide scale any more", async () => {
    const sheet = await call("GET", `/exams/${examOutOf20}/grades`, superToken);
    expect(sheet.body.data).not.toHaveProperty("display_scale");
    expect(sheet.body.data).not.toHaveProperty("passing_grade_bp");
    expect(sheet.body.meta).toBeUndefined();

    const student = await call("GET", "/students/me/grades", studentToken);
    expect(student.body.meta).toBeUndefined();
  });

  it("N · the settings surface offers no passing threshold to configure", async () => {
    const res = await call("GET", "/admin/settings", superToken);
    expect(res.status).toBe(200);
    const keys = (res.body.data as unknown as { key: string }[]).map((r) => r.key);
    expect(keys).not.toContain("grading.display_scale");
    expect(keys).not.toContain("grading.passing_grade_bp");
  });

  it("and the retired rows are gone from the database, not merely hidden", async () => {
    const rows = await prisma.systemSetting.findMany({
      where: { key: { in: ["grading.display_scale", "grading.passing_grade_bp"] } },
    });
    expect(rows).toEqual([]);
  });

  it("the override endpoint is gone rather than left reachable", async () => {
    // Hiding a control while the route still answers is the defect AF names.
    const res = await call(
      "POST",
      `/exams/${examOutOf20}/grades/${studentId}/override`,
      superToken,
      { value: true, reason: "should not exist", version: 0 },
    );
    expect(res.status).toBe(404);
  });
});
