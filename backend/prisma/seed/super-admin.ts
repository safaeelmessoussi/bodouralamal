import type { PrismaClient } from '../../src/generated/prisma/client.js';
import * as audit from '../../src/repositories/audit.repository.js';
import * as owners from '../../src/repositories/platform-owner.repository.js';
import * as users from '../../src/repositories/user.repository.js';

/** The Owner-ratified bootstrap identity for every deployment tier. */
export const INITIAL_PLATFORM_OWNER = {
  email: 'safae.elmessoussi@gmail.com',
  firstNameArabic: 'صفاء',
  lastNameArabic: 'المسوسي',
  nameArabic: 'صفاء المسوسي',
  sex: 'female' as const,
  framingMode: 'both' as const,
};

export function requireInitialOwnerConfiguration(email: string | undefined): string {
  if (!email?.trim()) {
    throw new Error(
      'Platform Owner has not been bootstrapped and SUPER_ADMIN_EMAIL is not set. ' +
        `Set it to ${INITIAL_PLATFORM_OWNER.email}; it is ignored after ownership exists.`,
    );
  }
  const normalized = email.trim().toLowerCase();
  if (normalized !== INITIAL_PLATFORM_OWNER.email) {
    throw new Error(
      `Initial Platform Owner must be ${INITIAL_PLATFORM_OWNER.email}; ` +
        `SUPER_ADMIN_EMAIL was ${normalized}. Refusing to bootstrap a different owner.`,
    );
  }
  const sex = (process.env['SUPER_ADMIN_SEX'] ?? '').trim().toLowerCase();
  if (sex !== INITIAL_PLATFORM_OWNER.sex) {
    throw new Error(
      'Initial Platform Owner SUPER_ADMIN_SEX must be `female` (Owner decision, 2026-08-31).',
    );
  }
  return normalized;
}

/**
 * Establishes the one Platform Owner and her Global Super Admin authority.
 *
 * The singleton relationship is the gate. Once it exists, every later seed is
 * a no-op regardless of configuration or how many other Super Admins exist; a
 * legitimate transfer therefore cannot be stolen back by deployment. Before
 * it exists, an advisory transaction lock makes concurrent seed processes
 * converge on one transaction even though there is not yet a row to lock.
 *
 * No placeholder UserIdentity is written. The existing verified-email binding
 * flow creates the real Google subject on first login.
 */
export async function bootstrapSuperAdmin(
  prisma: PrismaClient,
  email: string | undefined,
): Promise<void> {
  const existingOwner = await owners.findPlatformOwner(prisma);
  if (existingOwner) {
    console.log('  platform owner: ownership exists — bootstrap configuration ignored');
    return;
  }

  const normalized = requireInitialOwnerConfiguration(email);
  const result = await prisma.$transaction(async (tx) => {
    // Stable, database-local serialization for the absent-row bootstrap case.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('bodour-platform-owner-bootstrap', 0))`;

    const racedOwner = await owners.findPlatformOwner(tx);
    if (racedOwner) return { action: 'already bootstrapped concurrently', identityCount: null };

    const role = await tx.role.findUnique({ where: { name: 'super_admin' } });
    if (!role) throw new Error('super_admin role missing — seedRoles must run first');

    await users.lockNormalizedEmail(tx, normalized);

    const deletedHolder = await tx.user.findFirst({
      where: {
        deletedAt: { not: null },
        OR: [
          { preProvisionedEmail: normalized },
          { identities: { some: { email: normalized } } },
        ],
      },
      select: { id: true },
    });
    if (deletedHolder) {
      throw new Error(
        `Initial Platform Owner address belongs to a soft-deleted account (${deletedHolder.id}). ` +
          'Refusing to resurrect it or create a parallel identity.',
      );
    }

    const claimants = await users.emailClaimingUserIds(tx, normalized);
    if (claimants.length > 1) {
      throw new Error(
        `Initial Platform Owner address is claimed by ${claimants.length} accounts; ` +
          'resolve the identity conflict before bootstrap.',
      );
    }

    let user: { id: string };
    let action: string;
    if (claimants.length === 1) {
      user = await tx.user.update({
        where: { id: claimants[0]! },
        data: {
          nameArabic: INITIAL_PLATFORM_OWNER.nameArabic,
          firstNameArabic: INITIAL_PLATFORM_OWNER.firstNameArabic,
          lastNameArabic: INITIAL_PLATFORM_OWNER.lastNameArabic,
          sex: INITIAL_PLATFORM_OWNER.sex,
          accountStatus: 'active',
          deletedAt: null,
          deletedById: null,
        },
        select: { id: true },
      });
      action = 'granted to the existing verified account';
    } else {
      user = await tx.user.create({
        data: {
          nameArabic: INITIAL_PLATFORM_OWNER.nameArabic,
          firstNameArabic: INITIAL_PLATFORM_OWNER.firstNameArabic,
          lastNameArabic: INITIAL_PLATFORM_OWNER.lastNameArabic,
          preProvisionedEmail: normalized,
          accountStatus: 'active',
          isBeneficiary: false,
          sex: INITIAL_PLATFORM_OWNER.sex,
        },
        select: { id: true },
      });
      action = 'created and pre-provisioned';
    }

    // One live role per account. Preserve old rows as tombstones, then revive
    // the exact global assignment when one exists or create it otherwise.
    const assignments = await tx.userBranchRole.findMany({
      where: { userId: user.id },
      select: { id: true, roleId: true, branchId: true, deletedAt: true },
    });
    const globalSuperAdmin = assignments.find(
      (row) => row.roleId === role.id && row.branchId === null,
    );
    await tx.userBranchRole.updateMany({
      where: { userId: user.id, deletedAt: null },
      data: { deletedAt: new Date(), deletedById: null },
    });
    if (globalSuperAdmin) {
      await tx.userBranchRole.update({
        where: { id: globalSuperAdmin.id },
        data: { deletedAt: null, deletedById: null, userStatus: 'active' },
      });
    } else {
      await tx.userBranchRole.create({
        data: { userId: user.id, roleId: role.id, branchId: null, userStatus: 'active' },
      });
    }

    // General capability, not a teacher role and not a fabricated weekly
    // schedule. «both + all branches» is future-inclusive willingness.
    await tx.framingPreferenceBranch.deleteMany({ where: { userId: user.id } });
    await tx.framingPreference.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        mode: INITIAL_PLATFORM_OWNER.framingMode,
        allBranches: true,
      },
      update: { mode: INITIAL_PLATFORM_OWNER.framingMode, allBranches: true },
    });

    await tx.platformOwner.create({
      data: { singletonKey: owners.PLATFORM_OWNER_KEY, ownerUserId: user.id },
    });

    await audit.write(tx, {
      actorUserId: null,
      actionType: 'platform_owner.bootstrap',
      targetEntity: 'PlatformOwner',
      // Audit target ids are UUID coordinates. The singleton key is implicit in
      // the entity type; the governed owner User is the attributable target.
      targetId: user.id,
      detail: { owner_user_id: user.id },
    });

    const identityCount = await tx.userIdentity.count({ where: { userId: user.id } });
    return { action, identityCount };
  });

  console.log(
    `  platform owner: ${result.action}` +
      (result.identityCount === null
        ? ''
        : ` (identity ${
            result.identityCount === 0
              ? 'not yet bound — binds on first Google login'
              : 'already bound'
          })`),
  );
}
