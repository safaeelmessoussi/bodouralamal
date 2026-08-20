import type { PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import { qrMatrixFor, type QrMatrix } from '../lib/qr-identity.js';

/**
 * The acting student's identity block (SRS §5.3, R62.10, Revision 63).
 *
 * **This service takes an already-VERIFIED student id and never resolves one.**
 * The resolution is `resolveActingStudent`'s job (§4.3): header present → an
 * approved `FamilyLink` matching both the JWT parent and the header child;
 * header absent + Student role → the caller. TD-12 forbids trusting a student
 * identifier from the request, so accepting one here — from a body, a query or
 * a path — would reintroduce exactly what the middleware exists to prevent.
 *
 * **Exactly R62.10's five fields.** Name, reference code, Category, Level,
 * branch. No sex, no schooling stage, no French name, no consent state, no
 * account status, no dates: this is a screen a parent looks at, and every field
 * added to it publishes personal data to one more surface for no stated purpose.
 * A `select` rather than a whole row is what makes that a property of the code
 * instead of an intention.
 */
export interface StudentIdentity {
  id: string;
  nameArabic: string;
  /** R62.6 — `null` for adult students and for accounts predating R62, which is
   *  a real answer rather than a missing one. */
  referenceCode: string | null;
  /**
   * **R96 — the ACTING student's QR identity.**
   *
   * The subject is whoever `childContext` resolved (§4.3): a beneficiary
   * reading her own dashboard gets hers; a parent acting for a child gets **the
   * child's**, which is the point — a guardian looking at her child's account
   * must see the child's card, not her own. Her own lives on `/profile`.
   *
   * It is the SAME identity the child would see logging in herself, because it
   * belongs to the person and not to the surface it is read from.
   */
  qr: QrMatrix;
  enrollments: {
    category: { id: string; name: string };
    level: { id: string; name: string };
    branch: { id: string; name: string };
  }[];
}

export async function getStudentIdentity(
  prisma: PrismaClient,
  studentId: string,
): Promise<StudentIdentity> {
  const student = await prisma.user.findFirst({
    where: { id: studentId, deletedAt: null },
    select: {
      id: true,
      nameArabic: true,
      referenceCode: true,
      qrRef: true,
      // The relation is `levelEnrollments` on `User` (R43) — one row per
      // Level, not per group.
      levelEnrollments: {
        where: { deletedAt: null },
        select: {
          // R43's chain, walked in one query: the Level carries the Category,
          // and the Administrative Group carries the branch. Neither is copied
          // onto `Enrollment`, and the composite FK on
          // `(administrative_group_id, level_id)` is what keeps the two halves
          // from disagreeing (§7).
          level: { select: { id: true, name: true, category: { select: { id: true, name: true } } } },
          // R66 — the enrolment's own branch. It used to be read through the
          // Administrative Group, so a student in an unsubdivided Level would
          // have shown no branch at all on their own dashboard.
          branch: { select: { id: true, name: true } },
        },
        // §2.2 ordering. Deterministic rather than incidental: the screen
        // renders the first, so which one is first must not depend on the plan
        // PostgreSQL happens to pick.
        orderBy: [{ enrolledAt: 'asc' }, { id: 'asc' }],
      },
    },
  });

  // Reachable only for a self-acting caller whose account was soft-deleted
  // mid-session: the parent path already excluded a deleted child inside the
  // `FamilyLink` lookup. Same uniform answer either way (§20 rule 17).
  if (!student) throw new AppError('NOT_FOUND', 'no such student');

  return {
    id: student.id,
    nameArabic: student.nameArabic,
    referenceCode: student.referenceCode,
    qr: await qrMatrixFor(student.qrRef),
    enrollments: student.levelEnrollments.map((enrollment) => ({
      category: enrollment.level.category,
      level: { id: enrollment.level.id, name: enrollment.level.name },
      branch: enrollment.branch,
    })),
  };
}
