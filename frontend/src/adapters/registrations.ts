import { api } from '../lib/api.js';

/**
 * Unified registration — `POST /registrations` (§4.1, §4.1b step 5, TD-4.1).
 *
 * **Identity is not in this payload and cannot be.** The server takes `email`
 * and `provider_subject_id` exclusively from the signed onboarding token, and
 * its schema does not even accept them — a body carrying either is *rejected*,
 * not ignored (§20 rule 9). That is why the types below have no identity fields:
 * the shape here mirrors what the contract accepts, so a client that tried to
 * substitute an identity would not typecheck before it failed at the boundary.
 *
 * **`name_arabic` is not in this payload and must not be.** Revision 40 has the
 * client collect الاسم الشخصي and الاسم العائلي; the *server* composes the full
 * name from them (§1.1), and `.strict()` rejects a client-supplied `name_arabic`
 * rather than ignoring it — otherwise the client would be the authority on how
 * a person's name reads.
 *
 * **The applicant chooses a Branch and nothing else organisational (Revision
 * 39).** No Level, Room or Group — those are administrative decisions taken
 * after approval, and `.strict()` refuses them server-side rather than dropping
 * them, so a client cannot believe a placement was recorded.
 */

export interface PersonInput {
  /** الاسم الشخصي (Revision 40). */
  first_name_arabic: string;
  /** الاسم العائلي (Revision 40). */
  last_name_arabic: string;
  name_french?: string;
  nickname?: string;
  phone?: string;
  notes?: string;
  /** Required for every person created (§4.1b step 5, Revision 27) — the
   *  person-side half of `Level.gender_restriction`. */
  sex: 'female' | 'male';
}

export interface AdultRegistration {
  kind: 'adult';
  applicant: PersonInput;
  /** The branch the applicant asked for — a request, not a placement (R39). */
  branch_id: string;
  consents: { data_processing: boolean };
}

export interface ParentChildRegistration {
  kind: 'parent_child';
  parent: PersonInput;
  child: PersonInput;
  branch_id: string;
  /** `media_release` is a required *decision* for a minor; `false` is valid and
   *  is stored as a real record, because BR-1 reads an absent record as refusal
   *  and a declined release must be distinguishable from an unanswered one. */
  consents: { data_processing: boolean; media_release: boolean };
}

export type RegistrationInput = AdultRegistration | ParentChildRegistration;

export interface RegistrationResult {
  applicant_id: string;
  child_id: string | null;
  account_status: string;
}

export async function submitRegistration(
  input: RegistrationInput,
  onboardingToken: string,
): Promise<RegistrationResult> {
  return api<RegistrationResult>('/registrations', {
    method: 'POST',
    onboardingToken,
    body: input,
  });
}

/** TD-9 limits, mirrored for immediate feedback. The server validates for
 *  correctness (§1.1) — these two are not redundant, and a client that skipped
 *  a check the server enforces would be the buggy one. */
export const LIMITS = {
  /** TD-9, Revision 40: each Arabic name part, so the composed name fits 120. */
  namePart: 60,
  nameFrench: 120,
  nickname: 60,
  phoneMin: 5,
  phoneMax: 20,
  notes: 2000,
} as const;

/** TD-9: digits, `+` and spaces only. Non-unique — families share phones. */
export const PHONE_PATTERN = /^[0-9+ ]+$/;
