import { useEffect, useRef, type ReactNode } from 'react';

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
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}): ReactNode {
  const ref = useRef<HTMLDialogElement>(null);

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
      className="dialog"
      aria-labelledby="dialog-title"
      // Clicking the backdrop dismisses. The check is on the target being the
      // dialog itself: a click inside the panel bubbles to it otherwise.
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
    >
      <div className="dialog__panel">
        <div className="dialog__head">
          <h2 id="dialog-title" className="dialog__title">
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
