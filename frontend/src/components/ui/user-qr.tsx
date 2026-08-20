import type { ReactNode } from 'react';

import { t } from '../../i18n/index.js';

export interface QrMatrix {
  payload: string;
  size: number;
  /** One string per row, `'1'` for a dark module. */
  modules: string[];
}

/**
 * **One QR component for every person on the platform** (R96, rule C).
 *
 * A beneficiary, a child, a teenager, a guardian, a مؤطِّرة, an assistant, an
 * Admin and a Super Admin all see their identity through this one component.
 * Four portal-shaped copies would have drifted into four different squares
 * saying four different things about the same rule — and the rule is the part
 * that matters here.
 *
 * ## It renders what the server encoded; it encodes nothing
 *
 * The module matrix is computed server-side, so there is exactly one encoder and
 * a printed badge can later be produced from the same one. This draws `<rect>`s
 * from that matrix — **not** `dangerouslySetInnerHTML` on server markup, and not
 * an `<img src>` to an endpoint that could not carry the bearer token anyway.
 *
 * ## What it must never become
 *
 * **This identifies; it never authenticates.** The payload is not a credential,
 * not a session, not a bearer token, and it grants no operation. It carries a
 * version and one opaque reference — **no name, no contact detail, no sex, no
 * branch, no enrolment and no role**. Roles change while the identity does not,
 * so a role in the payload would be both a disclosure and, soon enough, a lie.
 *
 * ## Whose identity
 *
 * **The caller decides, and the component never guesses** (rule O). It renders
 * the matrix it is handed. `/profile` hands it the account holder's; the
 * beneficiary dashboard hands it the acting student's, which under child context
 * is the child's. A component that resolved the subject itself is exactly how a
 * parent's card ends up printed for her daughter.
 */
export function UserQr({
  qr,
  caption,
}: {
  qr: QrMatrix;
  /** Whose identity this is — required, because an unlabelled card in a family
   *  of several is not identifiable by looking at it. */
  caption: string;
}): ReactNode {
  // A quiet zone is part of the symbol, not decoration: scanners need the
  // margin to find the finder patterns at all.
  const QUIET = 4;
  const side = qr.size + QUIET * 2;

  return (
    <figure className="user-qr">
      <svg
        className="user-qr__code"
        viewBox={`0 0 ${side} ${side}`}
        role="img"
        aria-label={caption}
        shapeRendering="crispEdges"
      >
        <rect width={side} height={side} fill="var(--color-qr-light)" />
        {qr.modules.map((row, y) =>
          [...row].map((module, x) =>
            module === '1' ? (
              <rect
                key={`${y}-${x}`}
                x={x + QUIET}
                y={y + QUIET}
                width={1}
                height={1}
                fill="var(--color-qr-dark)"
              />
            ) : null,
          ),
        )}
      </svg>
      <figcaption className="user-qr__caption">
        <span>{caption}</span>
        {/* The payload as text too. A square nobody can read is impossible to
            check, to quote down a telephone, or to debug when a scanner fails. */}
        <code className="user-qr__payload">{qr.payload}</code>
        <span className="user-qr__note">{t('qr.identifiesOnly')}</span>
      </figcaption>
    </figure>
  );
}
