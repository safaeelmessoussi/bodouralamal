import type { Prisma } from '../generated/prisma/client.js';

/** Governing lock for paper/submission, sitting and grade-sheet writes.
 * Acquire before reading authority, version, maximum or publication state. */
export async function lockExamRow(tx: Prisma.TransactionClient, examId: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "exam" WHERE "id" = ${examId}::uuid FOR UPDATE`;
}
