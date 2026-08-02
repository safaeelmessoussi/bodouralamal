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
 */
export function ConsentNotice({
  checked,
  onChange,
  error,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  error?: string | null;
}): ReactNode {
  const [open, setOpen] = useState(false);

  return (
    <>
      <label className="check">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span>
          {t('register.consentDataProcessingPrefix')}{' '}
          <button type="button" className="link-button" onClick={() => setOpen(true)}>
            {t('register.consentLawName')}
          </button>
          {t('register.consentDataProcessingSuffix')}
        </span>
      </label>

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
