import type { PrismaClient } from '../../src/generated/prisma/client.js';
import * as users from '../../src/repositories/user.repository.js';

/**
 * The bootstrap account's sex, from the environment, or a loud refusal naming it.
 *
 * It fails rather than defaulting because a default here would be exactly the
 * inference R80 forbids — and because the person this account belongs to is
 * standing next to whoever runs the seed.
 */
function requireSuperAdminSex(): 'female' | 'male' {
  const raw = (process.env['SUPER_ADMIN_SEX'] ?? '').trim().toLowerCase();
  if (raw === 'female' || raw === 'male') return raw;
  throw new Error(
    'SUPER_ADMIN_SEX must be set to `female` or `male` before this seed can create the ' +
      'Super Administrator account (SRS Revision 80). It is seed-only, like SUPER_ADMIN_EMAIL: ' +
      'the running API never reads it. Nothing is defaulted, because a default would be the ' +
      'inference R80 exists to forbid.',
  );
}

/**
 * §15.1 Super Admin — BOOTSTRAP ONLY (Revision 22).
 *
 * `SUPER_ADMIN_EMAIL` is a bootstrap configuration value, not an operational
 * one. It is consulted **only when no active Super Administrator exists**; once
 * one does, the value is ignored permanently and every later change of
 * administrators happens through the application, with the database as the
 * single source of truth.
 *
 * The gate used to be "a row matching this email", which is idempotent only
 * while the env var never changes: editing it and re-running created a SECOND
 * Super Admin and left the previous one active, privileged and unclaimed.
 *
 * Because the gate is "no active Super Administrator", the value becomes live
 * again if every administrator is suspended or deleted. That is the intended
 * lockout-recovery path and grants no new authority — reaching it requires
 * running this seed on the host, which already requires DATABASE_URL.
 *
 * No placeholder identity row is written — §7 prohibits stub identities, and no
 * password exists anywhere in this system (§20 rule 10).
 */
export async function bootstrapSuperAdmin(prisma: PrismaClient, email: string | undefined): Promise<void> {
  const role = await prisma.role.findUnique({ where: { name: 'super_admin' } });
  if (!role) throw new Error('super_admin role missing — seedRoles must run first');

  // ── The gate: does an ACTIVE Super Administrator already exist?
  const activeSuperAdmin = await prisma.userBranchRole.findFirst({
    where: {
      roleId: role.id,
      deletedAt: null,
      user: { accountStatus: 'active', deletedAt: null },
    },
    include: { user: { select: { id: true } } },
  });

  if (activeSuperAdmin) {
    // Revision 22: ignored permanently from here on. Re-running is a no-op for
    // administrators no matter what SUPER_ADMIN_EMAIL currently says.
    console.log('  super admin: active administrator exists — SUPER_ADMIN_EMAIL ignored (§15.1 R22)');
    return;
  }

  // Revision 23: the value is required only HERE, and only now that the gate is
  // open. Failing loudly is the point — completing the seed without an
  // administrator would leave a platform nobody can approve anyone into.
  if (!email?.trim()) {
    throw new Error(
      'No active Super Administrator exists and SUPER_ADMIN_EMAIL is not set. ' +
        'Set it for this first deployment (§15.1, TD-13 Revision 23); it may be removed afterwards.',
    );
  }

  // TD-12: lowercase before every lookup and every write, so a capitalised
  // value in .env can never create an account that its owner cannot claim.
  const normalized = email.trim().toLowerCase();

  const result = await prisma.$transaction(async (tx) => {
    // Bootstrap is a production ownership writer too. It shares the same
    // normalized-email boundary as registration, staff pre-provisioning and
    // first binding before re-reading either ownership channel.
    await users.lockNormalizedEmail(tx, normalized);

    // A soft-deleted holder of this address is a hard stop: §4.1 forbids silent
    // reactivation. Choosing between resurrecting a deleted person and
    // hijacking their address is not a decision a seed script may make.
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
        `SUPER_ADMIN_EMAIL (${normalized}) belongs to a soft-deleted account (${deletedHolder.id}). ` +
          'Refusing to resurrect it or to create a parallel account (§15.1 Revision 22). ' +
          'Either restore that account deliberately, or set SUPER_ADMIN_EMAIL to a different address.',
      );
    }

    // Either channel a verified address can legitimately occupy (§15.1 R22 step 1):
    // a completed binding, or an account still awaiting one. This read is
    // authoritative because the shared email lock is held.
    const existing = await tx.user.findFirst({
      where: {
        deletedAt: null,
        OR: [
          { preProvisionedEmail: normalized },
          { identities: { some: { email: normalized } } },
        ],
      },
      select: { id: true, accountStatus: true },
    });

    let user: { id: string };
    let action: string;

    if (existing) {
      // Granted, not duplicated. Set active if it is not: bootstrap must yield a
      // USABLE administrator, and TD-12's freshness check refuses a non-active
      // caller, so a suspended Super Admin would be no Super Admin at all.
      if (existing.accountStatus === 'active') {
        user = { id: existing.id };
        action = 'granted to the existing account for that address';
      } else {
        user = await tx.user.update({
          where: { id: existing.id },
          data: { accountStatus: 'active' },
          select: { id: true },
        });
        action = `granted to the existing account for that address (activated from ${existing.accountStatus})`;
      }
    } else {
      user = await tx.user.create({
        data: {
          nameArabic: 'المشرف العام',
          preProvisionedEmail: normalized,
          // Pre-approved by definition: the Super Admin must not land in the
          // approval queue that only a Super Admin could clear.
          accountStatus: 'active',
          /** R79: bootstrap administration is not beneficiary status. */
          isBeneficiary: false,
          /** R80.2: supplied from the seed-only setting, never defaulted. */
          sex: requireSuperAdminSex(),
        },
        select: { id: true },
      });
      action = 'created';
    }

    // Unscoped role assignment: Super Admin is not branch-scoped (§2.1).
    const assignment = await tx.userBranchRole.findFirst({
      where: { userId: user.id, roleId: role.id, branchId: null, deletedAt: null },
    });
    if (!assignment) {
      await tx.userBranchRole.create({
        data: { userId: user.id, roleId: role.id, branchId: null },
      });
    }

    const identityCount = await tx.userIdentity.count({ where: { userId: user.id } });
    return { action, identityCount };
  });
  console.log(
    `  super admin: ${result.action} ` +
      `(identity ${result.identityCount === 0 ? 'not yet bound — binds on first Google login' : 'bound'})`,
  );
}
