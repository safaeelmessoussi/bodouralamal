import { api } from '../lib/api.js';
import type { QrMatrix } from '../components/ui/user-qr.js';

/**
 * `GET /students/me` — the Student Dashboard's identity block (R62.10, R63).
 *
 * **`me` is the ACTING student, not the account.** With `X-Active-Child-ID` set
 * this returns the child; without it, a student's own record. `GET /me` answers
 * a different question — *which account is this* — and for a parent the two
 * name different people, which is why the client never derives one from the
 * other.
 *
 * The header is passed through the one API caller rather than assembled here:
 * §4.3 makes it a per-request credential verified server-side, and this client
 * has exactly one place that may set it.
 */
export interface StudentEnrollment {
  category: { id: string; name: string };
  level: { id: string; name: string };
  branch: { id: string; name: string };
}

export interface StudentIdentity {
  id: string;
  name_arabic: string;
  /** `null` for an adult student and for accounts predating R62 (R62.6). */
  reference_code: string | null;
  /** R96 — this person's stable QR identity. Identifies; never authenticates. */
  qr: QrMatrix;
  /** A list because a student may hold one enrolment per Level; the screen
   *  renders the first and stays honest when there are two. */
  enrollments: StudentEnrollment[];
}

export async function fetchStudentIdentity(
  token: string | null,
  activeChildId: string | null,
): Promise<StudentIdentity> {
  return api<StudentIdentity>('/students/me', { token, activeChildId });
}
