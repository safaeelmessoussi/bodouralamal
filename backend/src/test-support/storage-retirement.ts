import type { Prisma, PrismaClient } from '../generated/prisma/client.js';

/** Pass the same fixture-only predicate used by the suite's content teardown. */
export async function clearTestContentRetirements(prisma: PrismaClient, where: Prisma.EducationalContentWhereInput): Promise<void> {
  const rows = await prisma.educationalContent.findMany({ where, select: { id: true } });
  await clearTestRetirements(prisma, rows.map((row) => row.id));
}

/** Only a suite's explicitly owned content IDs; never an age/global purge. */
export async function clearTestRetirements(prisma: PrismaClient, contentIds: readonly string[]): Promise<void> {
  if (contentIds.length === 0) return;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      DELETE FROM pgboss.job WHERE name IN ('content.bucket-migrate', 'content.quarantine-purge')
      AND (data->>'content_id' = ANY(${[...contentIds]}::text[]) OR
        data->>'retirement_id' IN (SELECT id::text FROM storage_retirement
          WHERE content_id = ANY(${[...contentIds]}::uuid[])))
    `;
    await tx.storageRetirement.deleteMany({ where: { contentId: { in: [...contentIds] } } });
  });
}
