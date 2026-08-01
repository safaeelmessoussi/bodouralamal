/**
 * Contract DTOs — the **wire shape** of every response (§16.2, Revision 38).
 *
 * **No endpoint may expose an ORM entity directly.** The API contract is an
 * intentional interface, never an accidental serialisation of database models,
 * and this module is where that intention is written down.
 *
 * Three rules, all enforced by building the object **field by field** rather
 * than by spreading a row:
 *
 * 1. **Allow-list projection.** A column added to a Prisma model must never
 *    appear in a response by default — it appears when someone adds it here,
 *    deliberately. Revision 35 established this for the public branch directory
 *    (*"an endpoint that returns everything except what we remembered to strip
 *    is one careless `select` away from leaking"*) and Revision 38 generalised
 *    it: a staff endpoint leaking `deleted_by` is not a privacy breach, but it
 *    is still a contract nobody designed.
 * 2. **`snake_case`**, matching the field names TD-3 uses throughout. One wire
 *    convention, not one per endpoint.
 * 3. **A TD-11 calendar date is `YYYY-MM-DD`**, never an instant — an instant
 *    invites a timezone conversion in a client, which is the exact class of bug
 *    TD-11 exists to prevent.
 *
 * **Never `...row` in this file.** A spread is how an allow-list silently stops
 * being one.
 */

import type { Page } from '../lib/pagination.js';

/**
 * A `Date` column rendered as a TD-11 calendar date.
 *
 * `toISOString().slice(0, 10)` is correct here specifically because these
 * columns are written as UTC midnight: the date part is the calendar date, with
 * no local-time reinterpretation to get wrong.
 */
function dateOnly(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

/** Applies a DTO across a TD-10 page, leaving `meta` untouched. */
export function pageOf<T, U>(input: Page<T>, project: (row: T) => U): Page<U> {
  return { data: input.data.map(project), meta: input.meta };
}

/* ── Branch (§7, Revision 35 public fields) ──────────────────────────────── */

export interface BranchDto {
  id: string;
  name: string;
  /** TD-11 calendar date, never an instant. */
  operational_start_date: string | null;
  display_order: number | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  opening_hours_ar: string | null;
  google_maps_url: string | null;
  /** TD-15: the client sends this back on edit; a stale one is a `409`. */
  version: number;
}

/**
 * Deliberately **absent**: `created_at`, `updated_at`, `deleted_at`,
 * `deleted_by`. They are operational metadata with no consumer, and the staff
 * screens have never asked for them — the reason they used to ship is that
 * nobody chose the shape at all.
 */
export function branchDto(row: {
  id: string;
  name: string;
  operationalStartDate: Date | null;
  displayOrder: number | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  openingHoursAr: string | null;
  googleMapsUrl: string | null;
  version: number;
}): BranchDto {
  return {
    id: row.id,
    name: row.name,
    operational_start_date: dateOnly(row.operationalStartDate),
    display_order: row.displayOrder,
    address: row.address,
    phone: row.phone,
    email: row.email,
    opening_hours_ar: row.openingHoursAr,
    google_maps_url: row.googleMapsUrl,
    version: row.version,
  };
}

/* ── Room (§7) ───────────────────────────────────────────────────────────── */

export interface RoomDto {
  id: string;
  name: string;
  branch_id: string;
  version: number;
}

export function roomDto(row: {
  id: string;
  name: string;
  branchId: string;
  version: number;
}): RoomDto {
  return { id: row.id, name: row.name, branch_id: row.branchId, version: row.version };
}

/* ── Approval queue (§5.6, §14.2) ────────────────────────────────────────── */

export interface ApprovalDto {
  id: string;
  type: 'registration' | 'family-link';
  /** §14.2 column: Applicant(s). */
  applicants: { id: string; name: string; role: 'applicant' | 'child' | 'parent' }[];
  /** An instant, correctly — a submission is a moment, not a calendar date. */
  submitted_at: string;
  /** §14.2 column: Bundle contents — what approving this will actually change. */
  bundle: { child_count: number; link_count: number };
}

/**
 * The approval queue never returned an ORM model — it returned a hand-built
 * shape in `camelCase`. That is a convention violation rather than a leak, and
 * Revision 38 corrected it in the same pass, because a contract that is *mostly*
 * consistent is the harder kind to remember.
 *
 * `name` rather than `name_arabic`: the field is *the name to display*, and the
 * queue shows staff-facing legal names. The public display-identity invariant
 * (§7) governs **public** surfaces; the approval queue is neither public nor a
 * place where a kunya would be correct.
 */
export function approvalDto(row: {
  id: string;
  type: 'registration' | 'family-link';
  applicants: { id: string; nameArabic: string; role: 'applicant' | 'child' | 'parent' }[];
  submittedAt: Date;
  bundle: { childCount: number; linkCount: number };
}): ApprovalDto {
  return {
    id: row.id,
    type: row.type,
    applicants: row.applicants.map((a) => ({ id: a.id, name: a.nameArabic, role: a.role })),
    submitted_at: row.submittedAt.toISOString(),
    bundle: { child_count: row.bundle.childCount, link_count: row.bundle.linkCount },
  };
}
