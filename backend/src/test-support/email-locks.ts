import type { PrismaClient } from '../generated/prisma/client.js';
import { emailLockDigest } from '../lib/email-lock.js';

/** Test-owned input coordinates only: digests cannot be cleaned by email prefix. */
export async function clearOwnedEmailLocks(
  prisma: Pick<PrismaClient, 'normalizedEmailLock'>,
  emails: Set<string>,
): Promise<void> {
  await prisma.normalizedEmailLock.deleteMany({
    where: { emailDigest: { in: [...emails].map((email) => emailLockDigest(email)) } },
  });
  emails.clear();
}
