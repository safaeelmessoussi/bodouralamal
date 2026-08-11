import type { Request, Response } from 'express';

import type { PrismaClient } from '../generated/prisma/client.js';
import { requireActingStudent } from '../middleware/child-context.js';
import { getStudentIdentity } from '../services/student.service.js';

/**
 * `GET /students/me` — the Student Dashboard's identity block (TD-3.3, §5.3,
 * R62.10, Revision 63).
 *
 * **`me` here is the ACTING student, not the account.** `GET /me` answers *which
 * account is this*; this answers *which student am I acting for*, and for a
 * parent those name different people. R63 records that the two are not to be
 * harmonised into one endpoint that would have to mean both.
 *
 * **The route carries no `{id}`, and that is the security property**: the
 * subject comes from `childContext`, which read it from an approved
 * `FamilyLink` or from the JWT `sub`. There is nowhere in this request for a
 * caller to name a different student.
 */
export function me(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const acting = requireActingStudent(req);
    const identity = await getStudentIdentity(prisma, acting.studentId);

    res.json({
      id: identity.id,
      name_arabic: identity.nameArabic,
      reference_code: identity.referenceCode,
      enrollments: identity.enrollments.map((enrollment) => ({
        category: enrollment.category,
        level: enrollment.level,
        branch: enrollment.branch,
      })),
    });
  };
}
