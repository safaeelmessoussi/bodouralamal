import type { Prisma } from '../generated/prisma/client.js';
import type { Db } from './audit.repository.js';

export const PLATFORM_OWNER_KEY = 'platform';

export interface PlatformOwnerRow {
  ownerUserId: string;
  version: number;
}

/**
 * The first lock in every Platform Owner lifecycle transaction.
 *
 * Ownership transfer and any operation capable of invalidating the owner take
 * this stable singleton row before User and Role locks. That global order makes
 * a transfer serialize with suspension, deletion and demotion rather than
 * allowing each side to validate a different moment.
 */
export async function lockPlatformOwner(
  tx: Prisma.TransactionClient,
): Promise<PlatformOwnerRow | null> {
  const rows = await tx.$queryRaw<PlatformOwnerRow[]>`
    SELECT "owner_user_id" AS "ownerUserId", "version"
    FROM "platform_owner"
    WHERE "singleton_key" = ${PLATFORM_OWNER_KEY}
    FOR UPDATE`;
  return rows[0] ?? null;
}

export async function findPlatformOwner(db: Db): Promise<PlatformOwnerRow | null> {
  return db.platformOwner.findUnique({
    where: { singletonKey: PLATFORM_OWNER_KEY },
    select: { ownerUserId: true, version: true },
  });
}

export async function isPlatformOwner(db: Db, userId: string): Promise<boolean> {
  return (await db.platformOwner.count({ where: { ownerUserId: userId } })) === 1;
}
