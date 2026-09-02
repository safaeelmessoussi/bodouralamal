import { useState, type ReactNode } from 'react';

import { t } from '../i18n/index.js';
import { Button } from './ui/button.js';
import { Dialog } from './ui/dialog.js';

/**
 * The data-processing consent line, with **Law 09-08 explained on demand**.
 *
 * A consent checkbox that names a statute and explains nothing is a checkbox
 * people tick without understanding — which is precisely what a consent regime
 * exists to prevent. §4.1 requires the decision be *informed*, and Law 09-08
 * gives data subjects rights they cannot exercise if nobody tells them they
 * have them.
 *
 * The explanation opens in the **shared `Dialog`** (§14.3): the platform has one
 * modal, built on the native `<dialog>` for focus trapping, `Escape`, page
 * inertness and top-layer stacking. A second implementation here would have to
 * re-earn all four, and would get one of them subtly wrong for keyboard users.
 *
 * **The statute reference is a real `<button>`, not a styled `<span>`.** Focus
 * returns to it when the dialog closes, because the browser restores focus to
 * whatever called `showModal()` — and a keyboard user who opened the
 * explanation must land back on the checkbox they were reading, not at the top
 * of the form.
 *
 * The copy is deliberately plain Arabic rather than legal language: an
 * explanation nobody can read is not an explanation.
 *
 * ## R119 — the wording is DATA, the explanation is interface
 *
 * `text` is the exact stored `LegalConsentText` this form is about to record,
 * fetched with its id from `GET /registration/consent-text`. It is rendered
 * **verbatim and never composed with**: the old version built the sentence from
 * three i18n keys with the statute's name as an inline button in the middle,
 * which cannot survive the wording becoming a single stored string — and
 * templating around legal text is how a notice ends up saying something nobody
 * approved.
 *
 * So the statute explanation moved **below** the checkbox, as its own link. The
 * boundary this draws is the one the Owner asked for: what a person **agrees
 * to** comes from the versioned record; the headings, the link, the dialog's
 * plain-language explanation of Law 09-08 and the buttons stay in `i18n`,
 * because they are interface, not the statement being accepted.
 *
 * `text === null` is **fail-closed**: no wording in force, or the read failed.
 * The checkbox is not rendered at all, because a tick against nothing is not a
 * consent — and offering one would let a person believe they had agreed to
 * something.
 *
 * ## The wording is COLLAPSED by default (Owner, 2026-09-02)
 *
 * A full legal notice beside the checkbox dominated the registration page and
 * made the rest of the form hard to scan. It is now behind an inline
 * disclosure: the checkbox carries the consent's **name**, a line of help says
 * to read the wording before submitting, and a button reveals it in place.
 *
 * **Collapsing changes what is SHOWN, never what is recorded.** The invariant
 * R119 exists for is untouched: the wording revealed here and the id the form
 * submits come from the same `ActiveConsentText` the page holds — there is no
 * second source, and opening or closing the disclosure touches no consent
 * state.
 *
 * **`register.consentTitle` is a LABEL, not the statement agreed to.** It names
 * *which* consent this is, the way a field label names a field; the statement
 * is the stored wording below it, which is never summarised, truncated,
 * rewritten or composed with. A future reader looking for *what the applicant
 * agreed to* must look at `LegalConsentText`, never at this key.
 *
 * **Inline, not a modal.** The applicant is deciding about this text right
 * here; a dialog would take the checkbox off screen at the moment they need to
 * compare the two. The Law 09-08 explanation stays a modal because it is
 * *background* — reference material, not the thing being agreed to.
 */
/**
 * Stable ids: `aria-controls` and `aria-describedby` need them, and the notice
 * appears once per form — `/register` and `تسجيل طفل` each render one.
 */
const TEXT_ID = 'consent-text-full';
const HINT_ID = 'consent-text-hint';

export function ConsentNotice({
  checked,
  onChange,
  error,
  text,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  error?: string | null;
  /** The exact stored wording; `null` while unavailable — see the docstring. */
  text: string | null;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      {text === null ? (
        // Rule AH — a page-level condition, in place of the content it replaces.
        <p className="field__error" role="alert">
          {t('register.consentVersionMissing')}
        </p>
      ) : (
        <div className="consent-notice">
          <label className="check">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => onChange(e.target.checked)}
              /* The help line is part of what this control means, so it is
                 announced with it rather than left for a reader to find. */
              aria-describedby={HINT_ID}
            />
            <span>{t('register.consentTitle')}</span>
          </label>

          <p id={HINT_ID} className="consent-notice__hint">
            {t('register.consentReadHint')}
          </p>

          {/**
           * **A real disclosure**, not a styled `<span>` and not a link: it is
           * a button with `aria-expanded` and `aria-controls`, so a screen
           * reader announces the state and a keyboard reaches it in order.
           *
           * The label states what the NEXT press does, which is the whole
           * convention: *«قراءة نص الموافقة كاملاً»* when closed, *«إخفاء نص
           * الموافقة»* when open.
           */}
          <p className="consent-notice__disclosure">
            <button
              type="button"
              className="link-button"
              aria-expanded={expanded}
              aria-controls={TEXT_ID}
              onClick={() => setExpanded((was) => !was)}
            >
              {expanded ? t('register.consentTextHide') : t('register.consentTextShow')}
            </button>
          </p>

          {/**
           * **Always in the DOM, hidden with `hidden`** — so `aria-controls`
           * names something that exists in both states.
           *
           * **Nothing here may set `display`** (rule AG): `[hidden]`'s only
           * defence is the UA's `display: none`, and an author rule of any
           * specificity outranks it — one unconditional `display: flex`
           * previously put a permanent `<dialog>` under a table across most of
           * the platform. The CSS for this class sets typography and spacing
           * and no `display` at all, deliberately.
           *
           * `white-space: pre-line` keeps the stored wording's own paragraph
           * breaks: they are part of what was approved.
           */}
          <div id={TEXT_ID} hidden={!expanded} className="consent-notice__text">
            {text}
          </div>
        </div>
      )}

      {/* Interface, not the statement agreed to — so it stays in `i18n` and
          sits BESIDE the wording rather than inside it. */}
      <p className="consent-notice__law">
        <button type="button" className="link-button" onClick={() => setOpen(true)}>
          {t('register.consentLawExplain')}
        </button>
      </p>

      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}

      <Dialog open={open} onClose={() => setOpen(false)} title={t('register.lawTitle')}>
        <div className="prose">
          <p>{t('register.lawIntro')}</p>

          <h3>{t('register.lawWhyTitle')}</h3>
          <p>{t('register.lawWhyBody')}</p>

          <h3>{t('register.lawWhatTitle')}</h3>
          <ul>
            <li>{t('register.lawWhat1')}</li>
            <li>{t('register.lawWhat2')}</li>
            <li>{t('register.lawWhat3')}</li>
            <li>{t('register.lawWhat4')}</li>
          </ul>

          <h3>{t('register.lawWhoTitle')}</h3>
          <p>{t('register.lawWhoBody')}</p>

          <h3>{t('register.lawUseTitle')}</h3>
          <p>{t('register.lawUseBody')}</p>

          <h3>{t('register.lawRightsTitle')}</h3>
          <p>{t('register.lawRightsBody')}</p>
          <ul>
            <li>{t('register.lawRight1')}</li>
            <li>{t('register.lawRight2')}</li>
            <li>{t('register.lawRight3')}</li>
          </ul>
          <p>{t('register.lawContact')}</p>
        </div>

        <div className="confirm__actions">
          <Button variant="primary" onClick={() => setOpen(false)}>
            {t('common.close')}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
