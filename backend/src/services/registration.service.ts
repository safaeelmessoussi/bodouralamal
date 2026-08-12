import type { PrismaClient, User } from '../generated/prisma/client.js';
import { ConsentMethod, ConsentType } from '../generated/prisma/enums.js';
import { AppError, uniqueViolationFields } from '../lib/errors.js';
import { verifyOnboardingToken } from '../lib/onboarding-token.js';
import { composeArabicName, composeFrenchName } from '../lib/person-name.js';
import * as audit from '../repositories/audit.repository.js';
import { submitChildApplications } from './child-application.service.js';
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
  /** R62 — the applications this request created; `[]` on an adult registration. */
  childApplicationIds: string[];
  accountStatus: 'pending';
}

export async function activeConsentTextVersion(
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
    // The `details` are deliberately populated: TD-3.8 defines `details` as
    // "structured context for codes that carry it", and this is the one 503 a
    // client can do something about. A bare "service unavailable" sent an
    // operator hunting through logs for a missing configuration row — the exact
    // failure this project hit while trying to test registration end to end.
    //
    // Safe to expose: a SystemSetting KEY is not a secret, it is already named
    // in the SRS, and naming it is the difference between an actionable message
    // and a mystery.
    throw new AppError(
      'SERVICE_UNAVAILABLE',
      `${CONSENT_TEXT_VERSION_KEY} is not configured — see SRS §2.3 owner task`,
      { reason: 'CONSENT_TEXT_VERSION_NOT_CONFIGURED', setting: CONSENT_TEXT_VERSION_KEY },
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

      // §4.1 / Revision 39: the chosen branch must be REAL and not closed.
      //
      // Checked inside the transaction rather than before it, so a branch
      // soft-deleted between the check and the write cannot slip through — the
      // FK alone would not catch that, because a soft delete leaves the row.
      //
      // A branch whose `operational_start_date` has not yet occurred IS
      // selectable, deliberately: §4.4 excludes such a branch from the
      // calendar, but an association must be able to take registrations for a
      // premises before it opens — which is the entire point of recording an
      // opening date.
      /**
       * **R67 — where the applicant's own branch comes from.**
       *
       * On the adult path it is what they chose: they ARE the student. On the
       * parent+child path there is no family-level branch any more, so it is
       * taken from the **first child's** requested branch — a parent enrols in
       * nothing, and the branch they are associated with is wherever their
       * children go. Asking separately would put a request-level branch back on
       * the form this revision removes it from.
       */
      const applicantBranchId =
        input.kind === 'adult' ? input.branch_id : input.children[0]!.requested_branch_id;
      /**
       * **The same derivation, for the same reason (R67.3).**
       *
       * `intended_category_id` records *the stage the applicant asked for*, and
       * a parent asks for none — they enrol in nothing. Leaving it null would
       * blank the §14.2 queue item's stage for every family registration and
       * take §4.1 step 1's Level preselection with it, so it is taken from the
       * first child exactly as the branch is. **Per-child accuracy lives where
       * approval reads it**: each `ChildApplication` carries its own, and that
       * is what a decision is made from.
       */
      const applicantCategoryId =
        input.kind === 'adult' ? input.category_id : input.children[0]!.requested_category_id;

      const branch = await tx.branch.findFirst({
        where: { id: applicantBranchId, deletedAt: null },
        select: { id: true },
      });
      if (!branch) {
        throw new AppError('VALIDATION_FAILED', 'branch_id does not name a live branch (§4.1)');
      }

      // Revision 49 — the same liveness rule the branch gets, for the same
      // reason: a Category soft-deleted between the form loading and the form
      // submitting would leave the approval screen preselecting from a stage
      // that no longer exists. Checked inside the transaction so a delete
      // committed a moment ago cannot slip through — the FK alone would not
      // catch it, because a soft delete leaves the row.
      const wantedCategoryId = applicantCategoryId;
      if (wantedCategoryId !== undefined) {
        const category = await tx.category.findFirst({
          where: { id: wantedCategoryId, deletedAt: null },
          select: { id: true },
        });
        if (!category) {
          throw new AppError('VALIDATION_FAILED', 'category_id does not name a live category (§4.1)');
        }
      }

      // Every new registration enters Pending (§4.1); no role is granted until
      // an Admin approves (TD-4.2).
      const applicant: User = await tx.user.create({
        data: {
          // Revision 40 — the parts are what was collected; the full name is
          // composed here so search, ordering and display all read one value.
          firstNameArabic: applicantData.first_name_arabic,
          lastNameArabic: applicantData.last_name_arabic,
          nameArabic: composeArabicName(
            applicantData.first_name_arabic,
            applicantData.last_name_arabic,
          ),
          firstNameFrench: applicantData.first_name_french ?? null,
          lastNameFrench: applicantData.last_name_french ?? null,
          nameFrench: composeFrenchName(
            applicantData.first_name_french,
            applicantData.last_name_french,
          ),
          nickname: applicantData.nickname ?? null,
          phone: applicantData.phone ?? null,
          notes: applicantData.notes ?? null,
          // §4.1b step 5, Revision 27: written HERE, in the same transaction
          // that creates the person — the registration precedes the User.
          sex: applicantData.sex,
          // Revision 39 — what the applicant ASKED FOR, not where they end up.
          // On the applicant only: the parent chose one branch for the family,
          // and copying it onto the child would be a second value to keep in
          // step. The child's branch, once they have one, is their Group's.
          intendedBranchId: applicantBranchId,
          // Revision 49 — on the APPLICANT row, exactly like the branch. On the
          // parent+child path the parent chose one stage for the application,
          // and the approval screen reads it from the bundle's applicant; a
          // copy on the child would be a second value to keep in step.
          intendedCategoryId: applicantCategoryId ?? null,
          // Revision 49 (proposed) — what they ASKED to be. Written here for the
          // same reason `sex` is: the registration precedes the User, so it
          // lands in this transaction rather than being patched on. It grants
          // nothing; `user_branch_role` is written at approval by a Super Admin.
          // Absent on the parent+child path, which is a family rather than a
          // staff request.
          requestedRole: input.kind === 'adult' ? (input.requested_role ?? null) : null,
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

      // ── R62 — the children arrive as APPLICATIONS, not as accounts ────────
      //
      // Before this revision the child `User`, its `FamilyLink(pending)` and its
      // consent records were all created here. That is precisely what forced
      // approval to be all-or-nothing: a refused child would otherwise have left
      // an orphan account behind.
      //
      // Now the request records what was asked for, and **the child is created
      // at approval, one at a time** — so an approver can accept one sibling and
      // refuse another, and a refusal leaves no `User`, no link and no consent.
      //
      // The applicant's OWN consent records are written above, unchanged: they
      // belong to a person who exists.
      let childApplications: { requestId: string; applicationIds: string[] } | null = null;
      if (input.kind === 'parent_child') {
        childApplications = await submitChildApplications(tx, applicant.id, {
          consentDataProcessing: true,
          // R62.3b — the version in force NOW. Approval must never substitute
          // the current value for the one this parent actually saw.
          consentTextVersion: textVersion,
          children: input.children.map((c) => ({
            firstNameArabic: c.first_name_arabic,
            lastNameArabic: c.last_name_arabic,
            sex: c.sex,
            ...(c.schooling_stage ? { schoolingStage: c.schooling_stage } : {}),
            // R67 — **this child's own**, not the family's. They used to be one
            // answer copied onto every application, so a parent could not ask
            // for الطفل at تاركة for one child and اليافعون at أمرشيش for
            // another — though the rows have held both per child since R62/R64.
            requestedCategoryId: c.requested_category_id,
            requestedBranchId: c.requested_branch_id,
            consentMediaRelease: c.consent_media_release,
          })),
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
          // R62 — how many children were APPLIED for; none exists yet.
          ...(childApplications
            ? { child_applications: childApplications.applicationIds.length }
            : {}),
        },
      });

      return {
        applicantId: applicant.id,
        // R62 — a request may name several children and none of them exists
        // yet. The ids identify the APPLICATIONS, which is what an approver
        // acts on.
        childApplicationIds: childApplications?.applicationIds ?? [],
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
