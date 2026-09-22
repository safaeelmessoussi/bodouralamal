import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';

/**
 * **A Category says who holds the login, and a request must agree with it**
 * (SRS Revision 170 §6 — closing the gap Revision 64 (7) recorded).
 *
 * §2.1 has always said adults hold their own accounts and minors never do. No
 * form could enforce it, because R27 made the Categories renameable rows and
 * nothing distinguished the adult one; a woman registering HERSELF could ask
 * for «الطفل», and a child application could ask for the adults' Category — a
 * login-less «adult» whose consent was given by somebody else.
 *
 * | `Category.holds_own_login` | a woman registering herself | a child application |
 * |---|---|---|
 * | `true`  | offered | **refused** — `CATEGORY_HOLDS_OWN_LOGIN` |
 * | `false` | **refused** — `CATEGORY_IS_GUARDIAN_MANAGED` | offered |
 * | `null` (not stated) | offered | offered |
 *
 * **`null` restricts nothing, on purpose**: a Category nobody has answered the
 * question for behaves exactly as before this revision.
 *
 * **It binds the REQUEST, never the placement.** Where a person is finally
 * placed stays the approver's decision (R39, R66.5). And it is **not an age
 * gate** (R64.7): it turns on who holds the login, never on a birth date — the
 * Category's age range is shown and gates nothing.
 *
 * A Category that does not exist or is deleted is not this rule's business: each
 * caller already refuses it in its own words.
 */
export async function assertCategoryFitsApplicant(
  db: PrismaClient | Prisma.TransactionClient,
  categoryId: string | null | undefined,
  applicant: 'self' | 'child',
): Promise<void> {
  if (!categoryId) return;
  const category = await db.category.findFirst({
    where: { id: categoryId, deletedAt: null },
    select: { holdsOwnLogin: true },
  });
  if (!category || category.holdsOwnLogin === null) return;

  if (applicant === 'self' && !category.holdsOwnLogin) {
    throw new AppError(
      'VALIDATION_FAILED',
      'this category is for beneficiaries registered by a guardian (§2.1)',
      { reason: 'CATEGORY_IS_GUARDIAN_MANAGED' },
    );
  }
  if (applicant === 'child' && category.holdsOwnLogin) {
    throw new AppError(
      'VALIDATION_FAILED',
      'this category is for beneficiaries who hold their own account (§2.1)',
      { reason: 'CATEGORY_HOLDS_OWN_LOGIN' },
    );
  }
}
