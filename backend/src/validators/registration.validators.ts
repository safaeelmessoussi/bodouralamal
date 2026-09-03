import { z } from 'zod';

import * as person from './person.js';

/**
 * Registration payloads (SRS §4.1, §4.1b step 5, TD-9).
 *
 * **These schemas deliberately do NOT accept `email` or `provider_subject_id`.**
 * §4.1b step 5 and §20 rule 9 require the server to take identity fields
 * exclusively from the verified onboarding-token payload — "the Zod schema for
 * this endpoint does not even accept those fields". Because `.strict()` is used,
 * a client that sends them is **rejected**, not silently ignored: a request
 * attempting identity substitution should fail loudly rather than appear to
 * succeed under a different identity than it asked for.
 */

/** TD-9 field limits — encoded here once and shared with the frontend. */
/**
 * الاسم الشخصي / الاسم العائلي (Revision 40) — 1–60 characters each, so the
 * name the server composes cannot exceed `name_arabic`'s 120.
 *
 * **`name_arabic` is deliberately NOT accepted.** It is composed by the service
 * from these two parts; taking it from the client would make the client the
 * authority on how a person's name reads (§1.1), and `.strict()` below turns a
 * submitted `name_arabic` into a refusal rather than a silently ignored field.
 */
// Shared with the back-office edit so both forms ask the same thing (§16.2).
const namePart = person.namePart;

const nickname = person.nickname;
/** TD-9: 5–20 chars, digits/`+`/spaces only; non-unique (families share phones). */
const phone = person.phone;

/**
 * §4.1b step 5, Revision 27: `sex` is **required** on every person the
 * registration transaction creates. The registration exists *before* the User
 * does, so sex arrives here and is written in the same TD-4.1 transaction — it
 * is never patched on afterwards.
 *
 * It is the person-side half of `Level.gender_restriction`: without it nothing
 * can compare a person against a `girls_only` Level, and enrolment enforcement
 * treats a missing sex as *not eligible* rather than as a wildcard.
 */
function requireFrenchNamePair(
  person: {
    first_name_french?: string | undefined;
    last_name_french?: string | undefined;
  },
  ctx: z.RefinementCtx,
): void {
  const missing =
    person.first_name_french === undefined && person.last_name_french !== undefined
      ? 'first_name_french'
      : person.first_name_french !== undefined && person.last_name_french === undefined
        ? 'last_name_french'
        : null;
  if (missing !== null) {
    ctx.addIssue({
      code: 'custom',
      path: [missing],
      message: 'both French name parts are required together, or neither (Revision 41)',
    });
  }
}

const personCore = z.object({
  first_name_arabic: namePart,
  last_name_arabic: namePart,
  // Revision 41 — optional as a PAIR. `.refine` below rejects exactly one,
  // because half a name is not a name and would store an unrenderable value.
  first_name_french: namePart.optional(),
  last_name_french: namePart.optional(),
  nickname: nickname.optional(),
  // R117 — prospective registrations require a reachable contact number.
  // `User.phone` remains nullable for historical accounts; this is a write-
  // boundary rule, not a destructive schema backfill.
  phone,
  sex: z.enum(['female', 'male']),
  /**
   * **R130 — optional HERE and required by the arm that admits a beneficiary.**
   *
   * `personCore` is shared by the adult applicant and by the parent on a family
   * request, and those two are not the same person in the domain: the adult IS
   * the beneficiary, while the parent is **guardian-only** and is admitted to
   * nothing (R129). Making it required here would demand a date of birth from a
   * woman registering her daughter, which the Owner ruled out in terms.
   *
   * The adult schema's `superRefine` below therefore requires it for a
   * beneficiary applicant and REFUSES it on a staff request — a مؤطِّرة is not
   * admitted to a Level either, so asking would be collecting personal data
   * with no stated purpose.
   */
  birth_date: person.birthDate.optional(),
})
  // `.strict()` for the same reason §20 rule 9 refuses identity fields: an
  // unknown key must be REFUSED, not silently stripped. Revision 39 lets an
  // applicant choose a **Branch** and nothing else organisational — a payload
  // carrying `level_id`, `room_id` or `group_id` is rejected here rather than
  // quietly dropped, because silently ignoring it would let a client believe a
  // placement was recorded when placement happens after approval (§4.1).
  .strict()
  // Name the missing counterpart, not a fixed field: when the family name is
  // the supplied half, marking it invalid would tell the applicant to fix the
  // field that is already complete.
  .superRefine(requireFrenchNamePair);

/**
 * The request-level consent decision (§4.1, §4.1a).
 *
 * Media release is deliberately absent: R62.3b moved that decision onto each
 * child because siblings may have different answers. Accepting a second,
 * request-level copy would give one consent two sources of truth.
 */
/**
 * **The consents, and WHICH WORDING they were given against** (Owner,
 * 2026-09-02).
 *
 * `consent_text_id` is the `LegalConsentText` the form actually rendered.
 * Required, and deliberately not defaulted to *whatever is active*: the whole
 * failure this closes is a Super Admin activating new wording between the
 * moment a form is drawn and the moment it is submitted. A server that fills
 * the blank itself would record agreement to words the person never saw, which
 * is the one outcome §4.1a exists to prevent.
 */
const consents = z
  .object({ data_processing: z.boolean(), consent_text_id: z.uuid() })
  .strict();

/**
 * The branch the applicant chooses (§4.1, Revision 39).
 *
 * **Top-level, not part of `personCore`, and that placement is the design.**
 * One registration expresses one choice: on the parent+child path the parent
 * picks a branch for the family, and it is recorded on the applicant row alone.
 * Putting it inside `personCore` would have produced a parent branch and a
 * child branch — two values to keep in step, for one decision.
 *
 * **Required on this public self-service path**, because the applicant is
 * present to choose. Staff-assisted registration (§4.1) is a different surface
 * and may leave it unset, where a null means *not stated*, never *no branch*.
 *
 * Existence and liveness are **not** checked here: a `uuid()` that names no
 * branch, or a soft-deleted one, is a `VALIDATION_FAILED` raised by the service
 * where the database is in reach. Zod validates shape; the service validates
 * truth.
 */
const branchId = z.uuid();

/**
 * The educational stage the applicant is asking for (Revision 49, proposed).
 *
 * **A request, exactly as `branch_id` is** (R39 — *"a request, not a
 * placement"*). It narrows and preselects the Levels the approver is offered on
 * the §4.1 screen; the approver may choose any Level, and the `Enrollment` is
 * what actually admits the person.
 *
 * **Why it exists at all:** §4.1 step 1 requires the approval screen to
 * preselect *"the first Level of the applicant's Category"*, and nothing
 * recorded a Category — §4.1b step 5 collects a branch and no other
 * organisational value — so that clause was unimplementable. Inferring a
 * Category from the form's `kind` was rejected: Revision 27 makes Categories
 * editable generic stages an administrator may add to, so the mapping would be a
 * guess the specification never authorised.
 *
 * Existence and liveness are checked in the service, where the database is in
 * reach. Zod validates shape; the service validates truth.
 */
const categoryId = z.uuid();

/**
 * What the applicant is asking to become (Revision 49, proposed).
 *
 * **A hint to the §5.6 approver, never an authority.** Nothing is granted by
 * submitting it: the role arrives only when a Super Admin assigns it at
 * approval, and a self-declared value that granted access would be privilege
 * escalation by form submission.
 *
 * **`teacher` is the only accepted value**, deliberately. An applicant may not
 * self-nominate for an administrator role — those accounts arrive through staff
 * pre-provisioning (§4.1, §4.1b step 4b), an authenticated path with a named
 * actor and an existing audit row. Widening this set is an SRS revision, and
 * the database CHECK makes that literally true.
 *
 * **Absent means the ordinary path** — a student or a parent registering a
 * family — which is why it is optional rather than defaulted.
 *
 * **Its branch SCOPE is not collected here**, and that is the load-bearing half
 * of this design. `branch_id` already records the branch the applicant *asked
 * for* (R39 — "a request, not a placement"), but a role's branch scope is an
 * authorization boundary (TD-2): collecting it from the applicant would let a
 * person propose the extent of their own permissions. The approver chooses it,
 * defaulting to the branch requested here.
 */
const requestedRole = z.literal('teacher');

/**
 * General framing capability for a هيئة التأطير request.
 *
 * `all_branches: true` is a future-inclusive semantic flag, never a synthetic
 * branch id and never expanded into today's catalogue. Online-only carries no
 * physical branch data at all. The strict nested union makes stale hidden
 * values a refusal rather than something silently persisted.
 */
const explicitBranchWillingness = z
  .object({
    all_branches: z.literal(false),
    branch_ids: z.array(z.uuid()).min(1).max(100),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.branch_ids).size !== value.branch_ids.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['branch_ids'],
        message: 'branch_ids must not contain duplicates',
      });
    }
  });

const allBranchWillingness = z
  .object({ all_branches: z.literal(true) })
  .strict();

const physicalFraming = (mode: 'in_person' | 'both') =>
  z
    .object({
      mode: z.literal(mode),
      willingness: z.discriminatedUnion('all_branches', [
        allBranchWillingness,
        explicitBranchWillingness,
      ]),
    })
    .strict();

const framingPreference = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('online') }).strict(),
  physicalFraming('in_person'),
  physicalFraming('both'),
]);

/**
 * Adult self-registration (§4.1). No child, no media release.
 *
 * **The staff request rides on this path rather than on a third `kind`.** A
 * teacher applying is an adult registering themselves; the only difference is
 * what they are asking to become, and that is one optional field. A separate
 * `kind: 'staff'` would have duplicated every name, consent and branch rule for
 * a form that is otherwise identical — and §4.1b step 4c names exactly two
 * forms, so a third would be a flow the SRS does not describe.
 */
export const adultRegistrationSchema = z
  .object({
    kind: z.literal('adult'),
    applicant: personCore,
    branch_id: branchId.optional(),
    /**
     * **Required for a student, absent for a staff request.** A teacher is not
     * admitted to a Level (§4.1), so asking them for an educational stage would
     * be asking a question with no answer — and accepting one would put a
     * Category on a record no approval will ever enrol.
     */
    category_id: categoryId.optional(),
    requested_role: requestedRole.optional(),
    framing: framingPreference.optional(),
    consents,
  })
  .strict()
  .superRefine((value, ctx) => {
    const staff = value.requested_role === 'teacher';
    if (staff) {
      if (value.applicant.birth_date !== undefined) {
        // R130 — a staff request is not a beneficiary admission, and this path
        // is shared infrastructure rather than a statement about the person.
        // Accepting a date here would collect a beneficiary's personal datum
        // from somebody who is not one.
        ctx.addIssue({
          code: 'custom',
          path: ['applicant', 'birth_date'],
          message: 'a staff request is not a beneficiary admission, so it takes no birth_date',
        });
      }
      if (value.category_id !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['category_id'],
          message: 'a staff request is not admitted to a Level, so it takes no category_id',
        });
      }
      if (value.branch_id !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['branch_id'],
          message: 'a staff request records framing willingness, not one requested branch',
        });
      }
      if (value.framing === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['framing'],
          message: 'framing is required for a staff request',
        });
      }
      return;
    }

    if (value.applicant.birth_date === undefined) {
      // R130 — on this path the applicant IS the beneficiary, and every
      // beneficiary carries a full date of birth.
      ctx.addIssue({
        code: 'custom',
        path: ['applicant', 'birth_date'],
        message: 'birth_date is required for a beneficiary (R130)',
      });
    }
    if (value.branch_id === undefined) {
      ctx.addIssue({ code: 'custom', path: ['branch_id'], message: 'branch_id is required' });
    }
    if (value.category_id === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['category_id'],
        message: 'category_id is required unless this is a staff request (§4.1, R49)',
      });
    }
    if (value.framing !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['framing'],
        message: 'framing is only accepted for a staff request',
      });
    }
  });

/**
 * One child on a registration request (SRS Revision 62).
 *
 * **Deliberately narrower than `personCore`.** A `ChildApplication` carries
 * names, sex and schooling stage — and nothing else — so the fields
 * `personCore` offers that a child has no use for simply have nowhere to go:
 *
 * * **`phone`** — a minor reached only through a `FamilyLink` has no telephone
 *   of their own, and the parent's is already on the request;
 * * **`notes`** — free text about a child, with no stated purpose and no reader,
 *   is where a diagnosis or a custody arrangement gets written in good faith.
 *
 * Both were flagged in the personal-data audit. Neither is *removed* here —
 * `User` still carries them for adults and staff — they are simply absent from
 * the shape R62.1 declared, which is the honest way for a field to stop being
 * collected.
 */
const childCore = z
  .object({
    first_name_arabic: namePart,
    last_name_arabic: namePart,
    first_name_french: namePart.optional(),
    last_name_french: namePart.optional(),
    nickname: nickname.optional(),
    sex: z.enum(['female', 'male']),
    /**
     * **R130 — required, per child, and never inherited from a sibling.**
     *
     * Every child on a family request is a beneficiary, so each carries her own
     * date. The application holds it because the child `User` does not exist
     * until approval (R62), which then materialises this exact calendar date.
     */
    birth_date: person.birthDate,
    /**
     * R62.6 — **informs placement and gates nothing.** No validation here or
     * anywhere may refuse a category because of it: a student older than the
     * usual high-school age still belongs in اليافعون if she is still in high
     * school.
     */
    schooling_stage: z
      .enum(['pre_primary', 'primary', 'middle', 'high', 'post_secondary', 'not_in_school'])
      .optional(),
    /**
     * R62.3b — **per child.** A parent may permit photographs of one child and
     * refuse for another, so this cannot live on the request beside
     * `data_processing`.
     */
    consent_media_release: z.boolean(),
    /**
     * R67 — **the branch and the stage this CHILD is asking for.**
     *
     * They used to sit on the request, one for the whole family, and were
     * copied onto every application — so a parent could not ask for الطفل at
     * تاركة for one child and اليافعون at أمرشيش for another, though the rows
     * have held both per child since R62/R64.
     *
     * **Required**, because they always were: moving a mandatory question does
     * not make it answerable by silence, and an approver must know for EACH
     * child what was asked (§4.1 step 1 preselects a Level from the Category;
     * R39 makes the branch what the §14.2 queue filters on).
     *
     * **A request, never a placement** (R39, unchanged).
     */
    requested_branch_id: branchId,
    requested_category_id: categoryId,
  })
  .strict()
  // The child and adult shapes share the same R41 rule. The browser already
  // enforces it per sibling; repeating it at the wire boundary keeps a forged
  // child payload from storing half a French name.
  .superRefine(requireFrenchNamePair);

/**
 * Unified Parent + Child registration (§4.1, as amended by Revision 62).
 *
 * **One request, one or more children.** The children arrive as
 * `ChildApplication` rows and their `User` records are created **at approval**,
 * one child at a time — so a refused child leaves no account behind and an
 * approver can accept one sibling while refusing another.
 */
export const parentChildRegistrationSchema = z
  .object({
    kind: z.literal('parent_child'),
    parent: personCore,
    /** R62 — one or more. Twelve is a bound, not an expectation. */
    children: z.array(childCore).min(1).max(12),
    /**
     * **R67 — `branch_id` and `category_id` are gone from this path.** They were
     * the family's single answer, copied onto every child; both are now on each
     * child, where the questions actually belong. The applicant's own
     * `intended_branch_id` is taken from the first child's requested branch
     * (R67.3), because a parent enrols in nothing and the branch they are
     * associated with is wherever their children go — asking separately would
     * put a request-level branch back on the form this revision removes it
     * from. The ADULT path keeps both top-level: there the applicant IS the
     * student.
     */
    consents,
  })
  .strict();

export const registrationSchema = z.discriminatedUnion('kind', [
  adultRegistrationSchema,
  parentChildRegistrationSchema,
]);

export type RegistrationInput = z.infer<typeof registrationSchema>;
