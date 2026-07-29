import { useEffect, useId, useRef, type ReactNode } from 'react';

import { t } from '../../i18n/index.js';
import { Icon } from './icon.js';

/**
 * The platform dialog, built on the **native `<dialog>`** element.
 *
 * `showModal()` gives focus trapping, `Escape` to close, inertness of the page
 * behind, and top-layer stacking — four behaviours that a `<div>` overlay has to
 * reimplement and usually gets subtly wrong for keyboard users. Reaching for the
 * platform control here is the same call the branch `<select>` gets.
 *
 * Focus returns to whatever opened it, because the browser restores it to the
 * element that called `showModal()` — which is why the caller renders a real
 * button rather than a click handler on a div.
 *
 * **The heading id is generated per instance.** A native dialog must sit in the
 * DOM to be openable, so a page with two of them — the calendar has a day
 * dialog and an event dialog — keeps both mounted at all times. A hardcoded
 * `aria-labelledby` target therefore produced *two elements with the same id*,
 * and a screen reader resolving the reference finds whichever comes first: on
 * the calendar, the event dialog would have announced the day dialog's title.
 * `useId` is what makes that structurally impossible rather than a rule to
 * remember.
 *
 * `wide` is for dialogs carrying a list rather than prose. The default width is
 * a reading measure, which is right for the event record and too narrow for a
 * day's timetable.
 */
export function Dialog({
  open,
  onClose,
  title,
  wide = false,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  wide?: boolean;
  children: ReactNode;
}): ReactNode {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  // `close` fires for Escape as well as for our own button, so one listener
  // keeps React's state in step however the dialog was dismissed.
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const handle = (): void => onClose();
    element.addEventListener('close', handle);
    return () => element.removeEventListener('close', handle);
  }, [onClose]);

  return (
    <dialog
      ref={ref}
      className={wide ? 'dialog dialog--wide' : 'dialog'}
      aria-labelledby={titleId}
      // Clicking the backdrop dismisses. The check is on the target being the
      // dialog itself: a click inside the panel bubbles to it otherwise.
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
    >
      <div className="dialog__panel">
        <div className="dialog__head">
          <h2 id={titleId} className="dialog__title">
            {title}
          </h2>
          <button type="button" className="dialog__close" onClick={onClose}>
            <span className="visually-hidden">{t('common.close')}</span>
            <Icon name="close" size={20} />
          </button>
        </div>
        <div className="dialog__body">{children}</div>
      </div>
    </dialog>
  );
}
