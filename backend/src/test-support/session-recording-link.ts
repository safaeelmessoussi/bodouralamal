import type { PrismaClient } from "../generated/prisma/client.js";
import { BUCKETS } from "../lib/storage.js";

/**
 * A `session_recording` item linked to one Session — what a consent
 * re-evaluation exists for. Since 2026-11-14 a student's enrolment change
 * queues re-evaluation only for sessions holding one
 * (`consentSessionIdsForStudent`), so a fixture class that should be
 * re-evaluated must hold a recording. Private, no stored object: the rows are
 * what the queueing reads. Removed by `unlinkTestRecordings`.
 */
export async function linkTestRecording(
  prisma: PrismaClient,
  sessionId: string,
  tag: string,
): Promise<string> {
  const session = await prisma.session.findUniqueOrThrow({
    where: { id: sessionId },
    select: { schedule: { select: { branchId: true, subjectId: true, academicYearId: true, levelId: true } } },
  });
  const level =
    session.schedule.levelId ??
    (await prisma.level.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
  const content = await prisma.educationalContent.create({
    data: {
      title: `${tag} recording`,
      visibility: "private",
      levelId: level,
      branchId: session.schedule.branchId,
      subjectId: session.schedule.subjectId,
      academicYearId: session.schedule.academicYearId,
      origin: "session_recording",
      storageBucket: BUCKETS.private,
      storageKey: `test/${sessionId}.mp4`,
      originalFilename: "recording.mp4",
      mimeType: "video/mp4",
      sizeBytes: BigInt(1),
    },
    select: { id: true },
  });
  await prisma.sessionContent.create({ data: { sessionId, contentId: content.id } });
  return content.id;
}

/** Removes what `linkTestRecording` wrote for these sessions. */
export async function unlinkTestRecordings(prisma: PrismaClient, sessionIds: readonly string[]): Promise<void> {
  const links = await prisma.sessionContent.findMany({
    where: { sessionId: { in: [...sessionIds] }, content: { origin: "session_recording", storageKey: { startsWith: "test/" } } },
    select: { contentId: true },
  });
  await prisma.sessionContent.deleteMany({ where: { contentId: { in: links.map((l) => l.contentId) } } });
  await prisma.educationalContent.deleteMany({ where: { id: { in: links.map((l) => l.contentId) } } });
}
