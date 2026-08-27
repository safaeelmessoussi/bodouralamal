import type { Request, Response } from 'express';

import type { PrismaClient } from '../generated/prisma/client.js';
import { pageParamsFrom } from '../lib/pagination.js';
import { listPublicBranches } from '../services/public-branch.service.js';

/**
 * `GET /branches` — TD-3.9 (Revision 35), the §5.1 landing-page branch list.
 *
 * Public and anonymous. It takes no actor at all: there is no tier to resolve
 * and nothing to widen, so unlike `/calendar` it needs no optional
 * authentication — a credential could only ever be ignored here.
 */
export function list(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const result = await listPublicBranches(prisma, pageParamsFrom(req.query));

    res.json({
      data: result.data.map((branch) => ({
        id: branch.id,
        name: branch.name,
        address: branch.address,
        phone: branch.phone,
        /**
         * **NEW I — published, because it is the same fact as `phone`.**
         *
         * R35 put the contact details on this public surface so a visitor can
         * reach the branch; a branch that answers on its mobile and not its
         * landline is exactly the case the second number exists for, and
         * withholding it would publish half a contact list. This route is an
         * **allowlist** (§5.1) and this is a deliberate addition to it, not a
         * column that arrived by widening a `select`.
         */
        phone_secondary: branch.phoneSecondary,
        email: branch.email,
        opening_hours_ar: branch.openingHoursAr,
        google_maps_url: branch.googleMapsUrl,
        display_order: branch.displayOrder,
      })),
      meta: result.meta,
    });
  };
}
