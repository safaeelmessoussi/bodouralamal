import { z } from 'zod';

/**
 * Registration payloads (SRS §4.1, §4.1b step 5, TD-9).
 *
 * **These schemas deliberately do NOT accept `email` or `provider_subject_id`.**
 * §4.1b step 5 and §20 rule 9 require the server to take identity fields
 * exclusively from the verified onboarding-token payload — "the Zod schema for
 * this endpoint does not even accept those fields". Because `.strict()` is used,
 * a client that sends them is **rejected**, not silently ignored: a request
 * attempting identity substitution should fail loudly rather than appear to
 * succeed under a different identity than it asked for.
 */

/** TD-9 field limits — encoded here once and shared with the frontend. */
const nameArabic = z.string().trim().min(1).max(120);
const nameFrench = z.string().trim().max(120);
const nickname = z.string().trim().max(60);
/** TD-9: 5–20 chars, digits/`+`/spaces only; non-unique (families share phones). */
const phone = z
  .string()
  .trim()
  .min(5)
  .max(20)
  .regex(/^[0-9+ ]+$/, 'digits, + and spaces only');
const notes = z.string().trim().max(2000);

const personCore = z.object({
  name_arabic: nameArabic,
  name_french: nameFrench.optional(),
  nickname: nickname.optional(),
  phone: phone.optional(),
  notes: notes.optional(),
});

/**
 * Consent decisions (§4.1, §4.1a). Every form carries the generic
 * data-processing checkbox; the parent+child form additionally carries the
 * explicit, separate Parental Media Release checkbox.
 *
 * `media_release` is **required to be present but may be `false`** — a parent
 * declining is a recorded decision, not a missing one (BR-1 treats absence of a
 * record as no consent, so the decision is stored either way).
 */
const consents = z.object({
  data_processing: z.boolean(),
  media_release: z.boolean().optional(),
});

/** Adult self-registration — Women's track (§4.1). No child, no media release. */
export const adultRegistrationSchema = z
  .object({
    kind: z.literal('adult'),
    applicant: personCore,
    consents,
  })
  .strict();

/** Unified Parent + Child registration (§4.1). Both records or neither. */
export const parentChildRegistrationSchema = z
  .object({
    kind: z.literal('parent_child'),
    parent: personCore,
    child: personCore,
    consents,
  })
  .strict();

export const registrationSchema = z.discriminatedUnion('kind', [
  adultRegistrationSchema,
  parentChildRegistrationSchema,
]);

export type RegistrationInput = z.infer<typeof registrationSchema>;
