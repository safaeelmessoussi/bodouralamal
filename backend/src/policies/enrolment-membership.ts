import type { Prisma } from '../generated/prisma/client.js';

/**
 * **Who is actually in a group** — one predicate, for every question that asks.
 *
 * ## The defect this exists to make impossible
 *
 * Deleting a group answered *«لا يمكن حذف هذه المجموعة … تسجيلات مستفيدات (2)»*
 * while the group's own roster read *«لا توجد مستفيدات في هذه المجموعة»*. Both
 * were counting `Enrollment` rows; they disagreed because they used **two
 * different predicates for one question**:
 *
 * * the roster required `student: { deletedAt: null }` — a live beneficiary;
 * * the deletion blocker, and the `member_count` column beside it, required only
 *   `deletedAt: null` on the enrolment itself.
 *
 * The rows that fell between them are **R111's doing, and are correct**: account
 * deletion deliberately **preserves the enrolment** (§3.2 — the educational
 * record outlives the account) while the person becomes «حساب محذوف». So a
 * group whose only members had deleted their accounts held two live enrolment
 * rows and no beneficiaries, and the platform said both things at once.
 *
 * ## Which answer is authoritative
 *
 * The roster's. *«Are there beneficiaries in this group»* is a question about
 * **people**, and a de-identified tombstone is not a beneficiary. The deletion
 * refusal now means what the roster shows, so a group whose members have all
 * left can be closed — and one holding a live student is refused exactly as
 * before.
 *
 * **Invested records still block, and are reported by their own name.** A
 * `Grade` is a mark somebody was awarded and is never tidied away to let a
 * reference row be deleted; it blocks under `grades`, whoever the student is
 * now. Preserving history and counting present membership are different
 * questions, and this file only answers the second.
 *
 * ## Why a policy rather than a helper in either service
 *
 * Both `enrollment.service` and `administrative-group.service` ask it, and
 * neither owns the other. Put in one of them, the second would have kept a copy
 * — which is how the two predicates came to differ in the first place.
 */
export const liveMemberEnrolment: Prisma.EnrollmentWhereInput = {
  deletedAt: null,
  student: { deletedAt: null },
};

/** The same predicate, narrowed to one group. */
export function liveMembersOfGroup(
  administrativeGroupId: string,
): Prisma.EnrollmentWhereInput {
  return { administrativeGroupId, ...liveMemberEnrolment };
}
