import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { subjectsTaughtAt } from './curriculum.js';

/**
 * **Level completion — BR-11, with its second clause finally defined** (Document
 * Owner, 2026-09-21 — SRS Revision 166 §1).
 *
 * > *A مستفيدة completes a Level by memorising its Surahs AND taking the تفسير
 * > exams of the same Surahs.*
 *
 * BR-11 always had two clauses — *100 % memorisation coverage, plus the Level's
 * final exam only if one is configured* — and the second was unreachable:
 * nothing in the model could mark an exam as a Level's final one, so
 * `levelCompletion` reported `final_exam_configured: false` and said so rather
 * than invent a marker. Revision 165 gave an exam its Surah and gave Subjects
 * `requires_surahs`; this is what those two facts were for.
 *
 * ## The rule, once
 *
 * For every Surah of the Level's «مقرر الحفظ»:
 *
 * 1. **memorised** — §4.5's coverage is 100 % (`new_memorization` only, R95);
 * 2. **examined** — she has TAKEN an exam of that Surah in a Subject that works
 *    by Surah and is NOT the memorisation tracker. With today's baseline that is
 *    exactly تفسير القرآن, found by its two columns and never by its name (R27,
 *    §4.4b).
 *
 * *Taken* means a recorded mark that is not «غائبة», or a remote paper she
 * submitted. **No pass mark is applied, because the platform has none** — §4.6
 * records a score out of a maximum and nothing calls a score a failure. The
 * Owner's word was *taking*, and that is what is computed.
 *
 * **Clause 2 applies only where it can be met** — BR-11's own *"only if one is
 * configured"*: a Level that teaches no such Subject is completed by
 * memorisation alone, exactly as before. And a Level with no «مقرر الحفظ» is
 * `null`, never complete: coverage of an empty syllabus is vacuously total.
 *
 * Like memorisation, *examined* is a fact about (student, Surah) and does not
 * fork per Level: a Surah two Levels share is not sat twice.
 *
 * Attendance gates nothing here (§4.5: *"not grades, not certification, not
 * level completion"*).
 */
export interface CompletionVerdict {
  /** `null` — the Level has no «مقرر الحفظ», so the question cannot be asked. */
  complete: boolean | null;
  configuredSurahs: number;
  memorisedSurahs: number;
  examinedSurahs: number;
  /** Whether clause 2 applies to this Level at all. */
  examsRequired: boolean;
}

/** Pure, so the admin's per-Level list and one beneficiary's own page cannot
 *  decide the same question two ways. */
export function decideCompletion(input: {
  configuredSurahIds: readonly number[];
  memorisedSurahIds: ReadonlySet<number>;
  examinedSurahIds: ReadonlySet<number>;
  examsRequired: boolean;
}): CompletionVerdict {
  const configured = input.configuredSurahIds;
  const memorised = configured.filter((id) => input.memorisedSurahIds.has(id)).length;
  const examined = configured.filter((id) => input.examinedSurahIds.has(id)).length;
  return {
    complete:
      configured.length === 0
        ? null
        : memorised === configured.length &&
          (!input.examsRequired || examined === configured.length),
    configuredSurahs: configured.length,
    memorisedSurahs: memorised,
    examinedSurahs: examined,
    examsRequired: input.examsRequired,
  };
}

/** Whether clause 2 applies: does this Level teach a by-Surah Subject other
 *  than the memorisation tracker? Keyed by Level. */
export async function levelsRequiringSurahExams(
  prisma: PrismaClient,
  levelIds: readonly string[],
): Promise<Set<string>> {
  if (levelIds.length === 0) return new Set();
  // R172 §1 — through the curriculum policy: a by-Surah Subject taught to the
  // whole Category counts at every one of its Levels.
  const taught = await subjectsTaughtAt(prisma, levelIds);
  const subjectIds = [...new Set([...taught.values()].flatMap((set) => [...set]))];
  if (subjectIds.length === 0) return new Set();
  const examined = await prisma.subject.findMany({
    where: { id: { in: subjectIds }, deletedAt: null, requiresSurahs: true, tracksQuranProgress: false },
    select: { id: true },
  });
  const examinedIds = new Set(examined.map((row) => row.id));
  return new Set(
    [...taught].filter(([, set]) => [...set].some((id) => examinedIds.has(id))).map(([levelId]) => levelId),
  );
}

/**
 * Which Surahs each of these مستفيدات has been EXAMINED on — one pair of reads
 * for the whole list, never one per student per Surah.
 */
export async function examinedSurahs(
  prisma: PrismaClient,
  studentIds: readonly string[],
  surahIds: readonly number[],
): Promise<Map<string, Set<number>>> {
  const result = new Map<string, Set<number>>();
  if (studentIds.length === 0 || surahIds.length === 0) return result;

  const sitting: Prisma.ExamWhereInput = {
    deletedAt: null,
    surahId: { in: [...surahIds] },
    subject: { deletedAt: null, requiresSurahs: true, tracksQuranProgress: false },
  };
  const [marks, papers] = await Promise.all([
    prisma.grade.findMany({
      where: { studentId: { in: [...studentIds] }, absent: false, exam: sitting },
      select: { studentId: true, exam: { select: { surahId: true } } },
    }),
    prisma.studentExamSubmission.findMany({
      where: {
        studentId: { in: [...studentIds] },
        state: { not: 'in_progress' },
        exam: sitting,
      },
      select: { studentId: true, exam: { select: { surahId: true } } },
    }),
  ]);
  for (const row of [...marks, ...papers]) {
    if (row.exam.surahId === null) continue;
    const set = result.get(row.studentId) ?? new Set<number>();
    set.add(row.exam.surahId);
    result.set(row.studentId, set);
  }
  return result;
}
