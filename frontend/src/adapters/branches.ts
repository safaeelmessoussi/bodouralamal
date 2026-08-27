import { api } from '../lib/api.js';

/**
 * The public branch directory (`GET /branches`, TD-3.9 / Revision 35).
 *
 * A thin typed read of the endpoint — not an adapter papering over a missing
 * backend, which is what `adapters/children` is. The shape below is exactly the
 * contract's projection, so a field the API stops sending becomes a type error
 * here rather than an empty line on the page.
 */
export interface PublicBranch {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  /** NEW I — published on the public list for the same reason `phone` is (R35):
   *  a branch that answers on its mobile is exactly this field's case. */
  phone_secondary: string | null;
  email: string | null;
  opening_hours_ar: string | null;
  google_maps_url: string | null;
  display_order: number | null;
}

interface BranchPage {
  data: PublicBranch[];
  meta: { page: number; page_size: number; total: number };
}

/**
 * The endpoint is paginated (TD-10). The landing page wants the whole
 * directory, and §2.4 puts the design ceiling at ten branches — comfortably
 * inside one page — so this asks for the maximum page and does not paginate the
 * section. If the association ever exceeds 100 premises, that is a product
 * conversation, not a silent truncation.
 */
export async function fetchBranches(): Promise<PublicBranch[]> {
  const page = await api<BranchPage>('/branches?page_size=100');
  return page.data;
}
