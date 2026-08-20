import QRCode from 'qrcode';

/**
 * **One stable, opaque QR identity per platform person (SRS Revision 96).**
 *
 * ## What it is
 *
 * A beneficiary, a child, a teenager, a guardian, a مؤطِّرة, an assistant, an
 * Admin, a Super Admin, and somebody holding several of those at once each have
 * exactly one — and it is the same one for the whole life of the person.
 *
 * ## What it deliberately is NOT
 *
 * **It identifies; it never authenticates.** Scanning it resolves *which
 * person*, and nothing else: it is not a credential, not a bearer token, not a
 * session, and it grants no operation. Whatever a scanner does next runs the
 * SCANNER's own authorization, exactly as if the person had been named by `id`.
 *
 * This is R62.5's rule for `referenceCode`, restated deliberately rather than
 * cross-referenced: a second opaque identifier is precisely the thing that
 * quietly acquires different powers, and the rule is cheap to repeat and
 * expensive to rediscover.
 *
 * ## The payload carries NO facts about the person
 *
 * Not a name, not an email, not a phone number, not a sex, not a birth date,
 * not a Branch, not a Level, not an enrolment — **and not a role**. Roles change
 * and the identity does not, so a role inside the payload would be a lie the
 * moment somebody is promoted, and a disclosure in the meantime. A printed card
 * that says who somebody *is* would also have to be reprinted when they stop
 * being it.
 *
 * What it carries is one opaque reference and a version, so a future format can
 * be told from this one without guessing.
 */

/** `bodour:user:v1:<uuid>` — versioned, so v2 is distinguishable, never guessed. */
export const QR_PREFIX = 'bodour:user:v1:';

/**
 * The scheme is `user`, not `beneficiary`.
 *
 * An earlier design scoped this to مستفيدات. It was rejected before
 * implementation: the platform's unit of identity is the **person**, a person is
 * frequently more than one thing at once (R79 — a مؤطِّرة may also be a
 * beneficiary), and a beneficiary-scoped scheme would have had to be reissued
 * the day somebody became staff. The noun in the payload would then have been
 * wrong on every card already printed.
 */
export function qrPayload(qrRef: string): string {
  return `${QR_PREFIX}${qrRef}`;
}

/**
 * The opaque reference inside a payload, or `null` if this is not one of ours.
 *
 * **Returns the reference, never a User.** Resolution is the caller's job and
 * runs the caller's authorization — keeping that out of this pure function is
 * what stops "parse" from turning into "look up and trust".
 */
export function parseQrPayload(payload: string): string | null {
  if (!payload.startsWith(QR_PREFIX)) return null;
  const ref = payload.slice(QR_PREFIX.length);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref)
    ? ref
    : null;
}

export interface QrMatrix {
  /** The payload the modules encode — shown as text beside the square. */
  payload: string;
  /** Modules per side, including the quiet zone the client adds. */
  size: number;
  /** One string per row, `'1'` for a dark module. Compact and JSON-safe. */
  modules: string[];
}

/**
 * Render the payload to a module matrix.
 *
 * **The matrix, not an image.** The server owns the encoding — one
 * implementation, reusable later for a printed badge or a PDF — while the client
 * draws it as `<rect>`s. Returning an `<svg>` string instead would have meant
 * `dangerouslySetInnerHTML` in React for markup the client cannot inspect, and
 * an image endpoint would have needed the bearer token on an `<img src>`, which
 * it cannot carry.
 *
 * Error-correction level **M** (~15%): a card in a bag gets scuffed, and the
 * payload is short enough that the extra modules cost nothing legible.
 */
export async function qrMatrixFor(qrRef: string): Promise<QrMatrix> {
  const payload = qrPayload(qrRef);
  const qr = QRCode.create(payload, { errorCorrectionLevel: 'M' });
  const { size, data } = qr.modules;

  const modules: string[] = [];
  for (let row = 0; row < size; row += 1) {
    let line = '';
    for (let col = 0; col < size; col += 1) line += data[row * size + col] ? '1' : '0';
    modules.push(line);
  }
  return { payload, size, modules };
}
