import type { PrismaClient, User } from '../generated/prisma/client.js';
import { ConsentMethod, ConsentType } from '../generated/prisma/enums.js';
import { AppError, uniqueViolationFields } from '../lib/errors.js';
import { verifyOnboardingToken } from '../lib/onboarding-token.js';
import { composeArabicName, composeFrenchName } from '../lib/person-name.js';
import * as audit from '../repositories/audit.repository.js';
import * as users from '../repositories/user.repository.js';
import { submitChildApplications } from './child-application.service.js';
import { resolvePresentedConsentText } from './legal-consent-text.service.js';
import type { RegistrationInput } from '../validators/registration.validators.js';
import {
  approvalReviewRecipients,
  notifySubjectUserChange,
} from './notification.service.js';

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
 * **`legal.consent_text_version` is retired** (Owner, 2026-09-02).
 *
 * It was a `SystemSetting` string an administrator typed, with no technical
 * relationship to the Arabic wording — which lived in the frontend's i18n
 * catalogue — so the two could drift in either direction and a `ConsentRecord`
 * could not be resolved back to the words it was recorded against.
 *
 * The authority is now `LegalConsentText` (`services/legal-consent-text.service.ts`),
 * and there is exactly one of it: this module no longer reads a setting, and
 * `WRITABLE_SETTINGS` no longer offers one, so the two cannot disagree. **The
 * existing setting row is left in the database untouched** — it is the only
 * record of which label was last in force before the cutover — but nothing
 * reads or writes it, so it cannot drift.
 *
 * The fail-closed behaviour is unchanged and deliberately so: with no active
 * version, registration answers `503` / `CONSENT_TEXT_VERSION_NOT_CONFIGURED`
 * exactly as before. See `activeConsentText`.
 */

export interface RegistrationResult {
  applicantId: string;
  /** R62 — the applications this request created; `[]` on an adult registration. */
  childApplicationIds: string[];
  accountStatus: 'pending';
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
  // R62.3b: each child carries her own required media-release decision. The
  // boundary schema enforces presence for every array element; there is no
  // request-level media decision to inspect here.

  /**
   * **The wording this person was actually shown** (Owner, 2026-09-02).
   *
   * Resolved from the id the form submitted, checked against what is in force,
   * and refused if they differ — see `resolvePresentedConsentText`. Reading
   * *«whatever is active now»* here, as this did while the version was a
   * `SystemSetting` string, is precisely the race that lets somebody be
   * recorded as agreeing to a version they never read.
   */
  const consentText = await resolvePresentedConsentText(prisma, input.consents.consent_text_id);
  const textVersion = consentText.versionLabel;

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

      // The callback's "nobody known" result is only a ten-minute routing
      // snapshot. Staff may have pre-provisioned this address since then, so
      // registration must serialize and re-read both ownership channels before
      // creating a second account. The lock row also covers the absent-row race
      // where registration and provisioning begin concurrently.
      await users.lockNormalizedEmail(tx, email);
      if ((await users.emailClaimingUserIds(tx, email)).length > 0) {
        throw new AppError('DUPLICATE', 'that email now belongs to an account', {
          reason: 'EMAIL_ALREADY_CLAIMED',
        });
      }

      const applicantData = input.kind === 'adult' ? input.applicant : input.parent;
      const staffRequest = input.kind === 'adult' && input.requested_role === 'teacher';

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

      if (applicantBranchId !== undefined) {
        const branch = await tx.branch.findFirst({
          where: { id: applicantBranchId, deletedAt: null },
          select: { id: true },
        });
        if (!branch) {
          throw new AppError('VALIDATION_FAILED', 'branch_id does not name a live branch (§4.1)');
        }
      }

      // A physical/both staff preference may name several live branches. The
      // future-inclusive all-branches case deliberately names none, and online
      // is rejected by the schema if it carries any hidden branch data.
      const framingBranchIds =
        staffRequest && input.framing && input.framing.mode !== 'online'
          ? input.framing.willingness.all_branches
            ? []
            : input.framing.willingness.branch_ids
          : [];
      if (framingBranchIds.length > 0) {
        const liveBranches = await tx.branch.count({
          where: { id: { in: framingBranchIds }, deletedAt: null },
        });
        if (liveBranches !== framingBranchIds.length) {
          throw new AppError(
            'VALIDATION_FAILED',
            'framing branch_ids must each name a live branch',
          );
        }
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
          intendedBranchId: applicantBranchId ?? null,
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

      if (staffRequest && input.framing) {
        const physical = input.framing.mode !== 'online' ? input.framing.willingness : null;
        await tx.framingPreference.create({
          data: {
            userId: applicant.id,
            mode: input.framing.mode,
            allBranches: physical?.all_branches ?? false,
            ...(framingBranchIds.length > 0
              ? {
                  branches: {
                    create: framingBranchIds.map((branchId) => ({ branchId })),
                  },
                }
              : {}),
          },
        });
      }

      // Data-processing consent: recorded for the applicant themselves.
      await tx.consentRecord.create({
        data: {
          studentId: applicant.id,
          consentType: ConsentType.data_processing,
          granted: true,
          method: ConsentMethod.online_form,
          consentTextVersion: textVersion,
          // The technical binding the string above never was.
          consentTextId: consentText.id,
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
          consentTextId: consentText.id,
          children: input.children.map((c) => ({
            firstNameArabic: c.first_name_arabic,
            lastNameArabic: c.last_name_arabic,
            ...(c.first_name_french ? { firstNameFrench: c.first_name_french } : {}),
            ...(c.last_name_french ? { lastNameFrench: c.last_name_french } : {}),
            ...(c.nickname ? { nickname: c.nickname } : {}),
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
      } else {
        await notifySubjectUserChange(tx, {
          type: 'registration_review_required',
          subjectUserId: applicant.id,
          recipientUserIds: await approvalReviewRecipients(tx),
          actorUserId: applicant.id,
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
