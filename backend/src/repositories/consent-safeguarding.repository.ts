import type { Prisma, PrismaClient } from '../generated/prisma/client.js';

/**
 * PostgreSQL serialization anchors used by BR-2 reconciliation.
 *
 * Raw SQL is intentionally confined to this repository (§20 rule 8). The
 * callers discover the graph; these helpers only acquire its governing rows in
 * one deterministic order.
 */
export async function lockLiveSessions(
  tx: Prisma.TransactionClient,
  sessionIds: readonly string[],
): Promise<string[]> {
  const ids = [...new Set(sessionIds)].sort();
  if (ids.length === 0) return [];
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id"
    FROM "session"
    WHERE "id" = ANY(${ids}::uuid[])
      AND "deleted_at" IS NULL
    ORDER BY "id"
    FOR UPDATE
  `;
  return rows.map((row) => row.id);
}

export async function lockEducationalContent(
  tx: Prisma.TransactionClient,
  contentIds: readonly string[],
): Promise<string[]> {
  const ids = [...new Set(contentIds)].sort();
  if (ids.length === 0) return [];
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id"
    FROM "educational_content"
    WHERE "id" = ANY(${ids}::uuid[])
    ORDER BY "id"
    FOR UPDATE
  `;
  return rows.map((row) => row.id);
}

/**
 * The public bucket is physically anonymous, but production exposes it only
 * through Nginx. A stable key remains readable only while one live row names
 * that exact public coordinate and BR-2 has not closed its public gate.
 */
export async function isCurrentPublicObject(
  prisma: PrismaClient,
  storageKey: string,
): Promise<boolean> {
  const row = await prisma.educationalContent.findFirst({
    where: {
      deletedAt: null,
      visibility: 'public',
      consentForcedPrivate: false,
      storageBucket: 'public',
      storageKey,
    },
    select: { id: true },
  });
  return row !== null;
}
