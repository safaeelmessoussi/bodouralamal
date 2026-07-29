import type { PrismaClient } from '../generated/prisma/client.js';
import { page, pageWindow, type Page, type PageParams } from '../lib/pagination.js';

/**
 * The public branch directory — SRS Revision 35, TD-3.9, §5.1.
 *
 * Separate from `branch.service` on purpose. That service serves the §5.6 admin
 * screen and reads whatever an Admin is entitled to see; this one serves
 * **anonymous visitors** and must return a fixed, minimal shape. Revision 35 is
 * explicit that widening the admin read would have been the wrong fix: an
 * endpoint's audience is part of its contract, and one endpoint serving two
 * audiences has to get the difference right on every future change.
 *
 * The projection below is the whole security boundary, which is why it is an
 * explicit `select` rather than a `findMany` with fields deleted afterwards — a
 * column added to `Branch` later joins the model, not this response.
 */
export interface PublicBranch {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  openingHoursAr: string | null;
  googleMapsUrl: string | null;
  displayOrder: number | null;
}

export async function listPublicBranches(
  prisma: PrismaClient,
  params: PageParams = {},
): Promise<Page<PublicBranch>> {
  // Soft-deleted branches never appear (Revision 35); a closed premises must
  // not keep advertising an address and a phone number.
  const where = { deletedAt: null };
  const window = pageWindow(params);

  const [rows, total] = await Promise.all([
    prisma.branch.findMany({
      where,
      select: {
        id: true,
        name: true,
        address: true,
        phone: true,
        email: true,
        openingHoursAr: true,
        googleMapsUrl: true,
        displayOrder: true,
      },
      // §2.2/TD-10: admin-defined order first, then `name` — correct Arabic
      // order automatically, because the column is natively `ar-x-icu`
      // collated — then `id` so paging is stable.
      orderBy: [
        { displayOrder: { sort: 'asc', nulls: 'last' } },
        { name: 'asc' },
        { id: 'asc' },
      ],
      skip: window.skip,
      take: window.take,
    }),
    prisma.branch.count({ where }),
  ]);

  return page(rows, window, total);
}
