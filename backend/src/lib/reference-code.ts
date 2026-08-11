import { randomInt } from 'node:crypto';

/**
 * Student reference codes (SRS Revision 62.5).
 *
 * A short, stable, **non-personal** identifier — a row id made pronounceable.
 * It exists so staff and parents can say *which* child they mean without
 * speaking a name aloud, which is what «محمد العلوي» in a waiting room costs.
 *
 * ## It identifies; it never authorises
 *
 * **Normative (R62.5).** A lookup by code must run exactly the same
 * authorization as a lookup by id. The code is not secret, so any endpoint that
 * treated it as proof of anything would have turned it into a bearer token by
 * accident — and knowing a child's code would then grant something.
 *
 * ## Random, never sequential
 *
 * A sequence leaks enrolment order and headcount, and invites enumeration: given
 * `BA-00042` anybody can try `BA-00041`. Random draws from a large space make
 * guessing another student's code useless rather than merely difficult — useless
 * because, by the rule above, holding one grants nothing anyway.
 *
 * ## The alphabet is chosen for the ear and the hand
 *
 * `0/O` and `1/I/L` are removed because this value is read down a telephone and
 * copied onto paper. `randomInt` rather than `Math.random`: the cost is nil and
 * a predictable identifier space is not worth defending later.
 */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const BODY_LENGTH = 5;
export const REFERENCE_CODE_PREFIX = 'BA';

/** e.g. `BA-7K4M2`. */
export function generateReferenceCode(): string {
  let body = '';
  for (let i = 0; i < BODY_LENGTH; i += 1) {
    body += ALPHABET[randomInt(ALPHABET.length)];
  }
  return `${REFERENCE_CODE_PREFIX}-${body}`;
}

/**
 * Draws until the code is unused.
 *
 * The space is 31^5 ≈ 28.6 million, so at any realistic roll a collision is
 * rare — but *rare* is not *impossible*, and a unique index would turn one into
 * a failed registration. Retrying is cheaper than explaining that.
 */
export async function allocateReferenceCode(
  isTaken: (code: string) => Promise<boolean>,
  attempts = 5,
): Promise<string> {
  for (let i = 0; i < attempts; i += 1) {
    const code = generateReferenceCode();
    if (!(await isTaken(code))) return code;
  }
  // Five collisions in a 28-million space means something is wrong with the
  // generator, not with luck. Failing loudly is better than looping forever.
  throw new Error('could not allocate a unique reference code');
}
