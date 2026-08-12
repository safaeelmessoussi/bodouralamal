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
  /** Revision 41 — optional as a PAIR: both or neither. */
  first_name_french?: string;
  last_name_french?: string;
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
  /**
   * What the applicant is asking to *become* (Revision 49) — `'teacher'`, or
   * absent for the ordinary path.
   *
   * **A hint to the approver, never an authority.** Nothing is granted by
   * sending it: the role arrives only when a Super Admin assigns it at
   * approval. `'teacher'` is the only accepted value — administrator accounts
   * are created by staff pre-provisioning, an authenticated path.
   *
   * **Its branch SCOPE is deliberately not collected**: `branch_id` above says
   * where the applicant wants to study or teach, while a role's scope is an
   * authorization boundary the approver decides.
   */
  requested_role?: 'teacher';
  /**
   * The educational stage the applicant is asking for (Revision 49).
   *
   * **Required for a student, absent for a staff request** — a teacher is
   * admitted to no Level (§4.1), so the server refuses the pair together. Like
   * `branch_id` it is a **request**: it narrows and preselects the Levels the
   * approver is offered, and the enrolment is what actually admits the person.
   */
  category_id?: string;
  consents: { data_processing: boolean };
}

/**
 * A child on a registration (R62.1) — **deliberately not `PersonInput`.**
 *
 * The two shapes differ, and the difference is the point: a child has no
 * `phone` and no free-text `notes`. The server's `childCore` schema does not
 * accept either, so sending them is a `400`, not a field quietly dropped. That
 * is R62 narrowing what is collected about a minor to what the platform can say
 * it needs — reusing `PersonInput` here would put both fields back on the form.
 */
export interface ChildInput {
  first_name_arabic: string;
  last_name_arabic: string;
  first_name_french?: string;
  last_name_french?: string;
  nickname?: string;
  sex: 'female' | 'male';
  /**
   * R62.7 — what the child is currently studying, which **informs** an
   * administrator's placement decision and gates nothing. Optional: a parent
   * who does not answer still registers, and nothing may refuse a placement on
   * it or on an age derived from it.
   */
  schooling_stage?:
    | 'pre_primary'
    | 'primary'
    | 'middle'
    | 'high'
    | 'post_secondary'
    | 'not_in_school';
  /**
   * R67 — **the branch and stage this CHILD asks for. Required.**
   *
   * They were optional while `/register` supplied one of each for the family
   * and the server copied them onto every application. Both are collected per
   * child now, so a parent can ask for الطفل at تاركة for one and اليافعون at
   * أمرشيش for another. Still **requests, never placements** — nothing reads
   * either to choose, validate or refuse (R39).
   */
  requested_branch_id: string;
  requested_category_id: string;
  /**
   * R62.3b — **per child**, because a parent may permit photographs of one
   * child and refuse for another. A required *decision*; `false` is valid and
   * is stored as a real record, because BR-1 reads an absent record as refusal
   * and a declined release must be distinguishable from an unanswered one.
   */
  consent_media_release: boolean;
}

export interface ParentChildRegistration {
  kind: 'parent_child';
  parent: PersonInput;
  /**
   * R62.1 — **one request, one or more children**, decided one at a time. It
   * used to be a single `child`, which forced a parent of three to register
   * three times and forced an administrator to approve or reject the whole
   * family at once.
   */
  children: ChildInput[];
  /**
   * **R67 — no `branch_id` and no `category_id` here.** They were the family's
   * single answer; both live on each child now. The applicant's own
   * `intended_branch_id` is derived server-side from the first child's, because
   * a parent enrols in nothing and asking separately would put a request-level
   * branch back on the form this revision removes it from.
   */
  consents: { data_processing: boolean };
}

export type RegistrationInput = AdultRegistration | ParentChildRegistration;

export interface RegistrationResult {
  applicant_id: string;
  /**
   * R62 — the applications the request created, `[]` on an adult registration.
   *
   * It replaced `child_id`, and the rename records a real change: **no child
   * account exists yet.** Creating one at submission is what forced the
   * all-or-nothing bundle, so a rejected child now leaves no `User` row and no
   * `FamilyLink` at all.
   */
  child_application_ids: string[];
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
  /** R62.1 — the server's ceiling on one request. A bound rather than a policy:
   *  it stops a runaway client, and no family is expected to reach it. */
  childrenPerRequest: 12,
  nameFrench: 120,
  nickname: 60,
  phoneMin: 5,
  phoneMax: 20,
  notes: 2000,
} as const;

/** TD-9: digits, `+` and spaces only. Non-unique — families share phones. */
export const PHONE_PATTERN = /^[0-9+ ]+$/;
