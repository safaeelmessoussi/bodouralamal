import type { PrismaClient } from '../generated/prisma/client.js';

export async function requireSeededSubject(
  prisma: PrismaClient,
  name: string,
): Promise<{ id: string; name: string }> {
  const rows = await prisma.subject.findMany({
    where: { name, deletedAt: null },
    select: { id: true, name: true },
    take: 2,
  });
  if (rows.length !== 1) {
    throw new Error(
      `R107 fixture requires exactly one live Subject named ${name}; found ${rows.length}. Run the Production seed first.`,
    );
  }
  return rows[0]!;
}

/**
 * Returns the one live Production memorisation Subject established by R107.
 *
 * Integration and browser fixtures run on top of the §15.1 seed. Creating a
 * second marked Subject used to work only because the Production seed omitted
 * its required marker; after R107 it correctly violates the partial unique
 * index. Fixtures therefore consume the same structural fact as production
 * and leave that reference row intact during teardown.
 */
export async function requireMemorisationSubject(
  prisma: PrismaClient,
): Promise<{ id: string; name: string }> {
  const rows = await prisma.subject.findMany({
    where: { tracksQuranProgress: true, deletedAt: null },
    select: { id: true, name: true },
    take: 2,
  });
  if (rows.length !== 1) {
    throw new Error(
      `R107 fixture requires exactly one live tracks_quran_progress Subject; found ${rows.length}. Run the Production seed first.`,
    );
  }
  return rows[0]!;
}
