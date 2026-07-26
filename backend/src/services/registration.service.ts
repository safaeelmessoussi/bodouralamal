import type { PrismaClient, User } from '../generated/prisma/client.js';
import { ConsentMethod, ConsentType } from '../generated/prisma/enums.js';
import { AppError, uniqueViolationFields } from '../lib/errors.js';
import { verifyOnboardingToken } from '../lib/onboarding-token.js';
import * as audit from '../repositories/audit.repository.js';
import type { RegistrationInput } from '../validators/registration.validators.js';

/**
 * Unified registration (SRS §4.1, §4.1b step 5, TD-4.1).
 *
 * The whole point of TD-4.1 is atomicity: Parent `User` + child `User` +
 * `FamilyLink(pending)` + `ConsentRecord`(s) + `UserIdentity` + `ConsumedToken`
 * either all land or none do. §4.1 puts it plainly — "never a parent without
 * their child or vice versa" — and §4.1b step 6 requires that an abandoned or
 * failed submission persist nothing at all.
 *
 * ## Token-consumption invariant (binding)
 *
 * **The onboarding token is consumed ONLY as part of the same transaction that
 * creates every registration row. If any later write fails, the rollback also
 * un-consumes the token, so the applicant can retry. No path may permanently
 * consume the token unless the registration commits.**
 *
 * This follows from §4.1b's "the `jti` is inserted … inside the registration
 * transaction" and TD-4.1's "the token-consumption insert inside this
 * transaction is the replay guard", but the *retry consequence* is not spelled
 * out there, so it is stated here and pinned by two tests: one asserts the `jti`
 * row is absent after a failure at the final write, and one performs the actual
 * retry with the same token and requires it to succeed.
 *
 * The failure mode this prevents is severe and silent: a token consumed by a
 * half-failed attempt would leave the applicant holding a single-use credential
 * that no longer works, with no account and no way to obtain another except by
 * restarting the whole Google flow — and §4.1b issues exactly one token per
 * callback.
 */

/**
 * The `SystemSetting` key holding the currently-active consent text version
 * (TD-13: "legal/consent text versions").
 *
 * It is deliberately **not seeded** by §15.1: §2.3 makes legally verifying and
 * versioning the Arabic consent text an owner compliance task, and inventing a
 * version string would mean recording that someone agreed to text nobody has
 * approved. Registration therefore fails closed until the owner sets it.
 */
export const CONSENT_TEXT_VERSION_KEY = 'legal.consent_text_version';

export interface RegistrationResult {
  applicantId: string;
  childId: string | null;
  accountStatus: 'pending';
}

async function activeConsentTextVersion(
  tx: Pick<PrismaClient, 'systemSetting'>,
): Promise<string> {
  const setting = await tx.systemSetting.findUnique({
    where: { key: CONSENT_TEXT_VERSION_KEY },
  });
  const value = setting?.value;
  if (typeof value !== 'string' || value.trim() === '') {
    // §4.1a requires the exact text version agreed to be stored on every
    // record. Without it we cannot honestly say what was consented to, so we
    // refuse rather than write an unattributable consent.
    throw new AppError(
      'SERVICE_UNAVAILABLE',
      `${CONSENT_TEXT_VERSION_KEY} is not configured — see SRS §2.3 owner task`,
    );
  }
  return value;
}

/**
 * §4.1b step 5 + TD-4.1.
 *
 * Identity comes **only** from the verified token payload; the caller passes the
 * raw token and nothing else identity-bearing (§20 rule 9).
 */
export async function register(
  prisma: PrismaClient,
  rawOnboardingToken: string,
  input: RegistrationInput,
  onboardingKey: string,
  now: Date = new Date(),
): Promise<RegistrationResult> {
  const verified = verifyOnboardingToken(rawOnboardingToken, onboardingKey, now);
  if (!verified.valid) {
    // An expired or forged token is a validation failure, not a state conflict;
    // replay (a *valid* token used twice) is what yields STATE_CONFLICT below.
    throw new AppError('VALIDATION_FAILED', `onboarding token ${verified.reason}`);
  }
  const { email, provider_subject_id: providerSubjectId, jti, exp } = verified.claims;

  // §4.1 / TD-3.8 `CONSENT_REQUIRED`: the generic data-processing consent is
  // mandatory on every form. Refusing it is not a validation quibble — there is
  // no lawful basis to create the record at all.
  if (!input.consents.data_processing) {
    throw new AppError('CONSENT_REQUIRED', 'data_processing consent is mandatory (§4.1)');
  }
  // The parent+child form carries the explicit, separate media-release
  // checkbox, so a *decision* must be present. `false` is a valid decision.
  if (input.kind === 'parent_child' && input.consents.media_release === undefined) {
    throw new AppError('CONSENT_REQUIRED', 'media_release decision is required for a minor (§4.1)');
  }

  const textVersion = await activeConsentTextVersion(prisma);

  try {
    return await prisma.$transaction(async (tx) => {
      // THE REPLAY GUARD FIRST (§4.1b step 4c, TD-6). Order matters here and was
      // found by test: with this insert last, a replayed token collided on
      // `UserIdentity(provider, provider_subject_id)` before ever reaching the
      // `jti`, so a replay reported `DUPLICATE` instead of the `STATE_CONFLICT`
      // §4.1b requires. Consuming the token first makes the jti authoritative for
      // replay, leaves `DUPLICATE` meaning what it should (the same Google account
      // registering twice under *different* tokens), and fails fast before any
      // user row is written. TD-4.1 fixes the SET of writes and their atomicity,
      // not their order.
      await tx.consumedToken.create({
        data: { jti, purpose: 'onboarding', expiresAt: new Date(exp * 1000) },
      });

      const applicantData = input.kind === 'adult' ? input.applicant : input.parent;

      // Every new registration enters Pending (§4.1); no role is granted until
      // an Admin approves (TD-4.2).
      const applicant: User = await tx.user.create({
        data: {
          nameArabic: applicantData.name_arabic,
          nameFrench: applicantData.name_french ?? null,
          nickname: applicantData.nickname ?? null,
          phone: applicantData.phone ?? null,
          notes: applicantData.notes ?? null,
          accountStatus: 'pending',
        },
      });

      // The applicant's identity is bound here, from the token payload only.
      // Email is already lowercased by the token issuer (TD-12).
      await tx.userIdentity.create({
        data: { userId: applicant.id, provider: 'google', providerSubjectId, email },
      });

      // Data-processing consent: recorded for the applicant themselves.
      await tx.consentRecord.create({
        data: {
          studentId: applicant.id,
          consentType: ConsentType.data_processing,
          granted: true,
          method: ConsentMethod.online_form,
          consentTextVersion: textVersion,
          grantedByUserId: applicant.id,
        },
      });

      let child: User | null = null;
      if (input.kind === 'parent_child') {
        // Minor students are login-less: NO UserIdentity and NO
        // pre_provisioned_email (§4.3, BR-5).
        child = await tx.user.create({
          data: {
            nameArabic: input.child.name_arabic,
            nameFrench: input.child.name_french ?? null,
            nickname: input.child.nickname ?? null,
            phone: input.child.phone ?? null,
            notes: input.child.notes ?? null,
            accountStatus: 'pending',
          },
        });

        // Pending link — grants zero visibility until approved (BR-4).
        await tx.familyLink.create({
          data: { parentId: applicant.id, studentId: child.id, status: 'pending' },
        });

        // The child's own data-processing consent, granted by the parent.
        await tx.consentRecord.create({
          data: {
            studentId: child.id,
            consentType: ConsentType.data_processing,
            granted: true,
            method: ConsentMethod.online_form,
            consentTextVersion: textVersion,
            grantedByUserId: applicant.id,
          },
        });

        // Media release: the parent's decision either way is recorded, so the
        // effective status is derived from a real record rather than inferred
        // from absence (BR-1, §4.1a).
        const mediaGranted = input.consents.media_release === true;
        await tx.consentRecord.create({
          data: {
            studentId: child.id,
            consentType: ConsentType.media_release,
            granted: mediaGranted,
            method: ConsentMethod.online_form,
            consentTextVersion: textVersion,
            grantedByUserId: applicant.id,
            ...(mediaGranted ? {} : { revokedAt: now, revokedByUserId: applicant.id }),
          },
        });
      }

      await audit.write(tx, {
        actorUserId: applicant.id,
        actionType: audit.AUDIT_ACTIONS.login,
        targetEntity: 'User',
        targetId: applicant.id,
        // TD-14: no PII in the detail — no names, no phone, no email.
        detail: {
          provider: 'google',
          account_status: 'pending',
          registration_kind: input.kind,
          ...(child ? { child_created: true } : {}),
        },
      });

      return {
        applicantId: applicant.id,
        childId: child?.id ?? null,
        accountStatus: 'pending' as const,
      };
    });
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    if (code === 'P2002') {
      const fields = uniqueViolationFields(error);
      // A replayed onboarding token: §4.1b requires 409 STATE_CONFLICT.
      if (fields.includes('jti')) {
        throw new AppError('STATE_CONFLICT', 'onboarding token already consumed (§4.1b)');
      }
      // The same Google identity registering twice concurrently (TD-15.3).
      throw new AppError('DUPLICATE', 'identity already registered');
    }
    throw error;
  }
}
