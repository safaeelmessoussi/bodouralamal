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
 *
 * ## `dismissible` — the backdrop and Escape, and why they are configurable
 *
 * A dialog that only *shows* something should close the moment you click away:
 * that is the fastest possible dismissal and losing nothing is the point. A
 * dialog **holding a half-filled form** must not, and the reason is the defect
 * this option was added for (2026-08-17): a stray click on the backdrop threw
 * away everything typed, with no warning and no undo.
 *
 * So the *decision* is the caller's — a read-only dialog stays dismissible, a
 * form does not — and the **mechanism is here**, once, rather than each form
 * reimplementing `onClick` guards and `cancel` handlers it would get subtly
 * wrong. `FormDialog` sets it from its own dirty state.
 *
 * **Escape is treated exactly like the backdrop.** The native `cancel` event
 * fires for it, and it is prevented for a non-dismissible dialog — because
 * losing a form to a mis-keyed Escape is the same defect as losing it to a
 * mis-aimed click. The **explicit close button always works**: it routes through
 * `onClose`, which is where a form puts its confirmation, so there is never a
 * dialog a keyboard user cannot leave.
 */
export function Dialog({
  open,
  onClose,
  title,
  wide = false,
  dismissible = true,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  wide?: boolean;
  /**
   * Whether the backdrop and `Escape` dismiss it.
   *
   * `false` leaves the close button and any explicit cancel as the only ways
   * out — for a dialog whose content would be lost. Defaults to `true`, so every
   * existing read-only dialog is unchanged.
   */
  dismissible?: boolean;
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

  /**
   * **Escape, intercepted before the browser closes the dialog.**
   *
   * The native `cancel` event precedes `close`, so preventing it stops the
   * dismissal outright — which is what a non-dismissible dialog needs. Letting
   * `close` fire and then reopening would flash the dialog shut and back, and
   * would lose focus placement on the way.
   */
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const handle = (event: Event): void => {
      if (!dismissible) {
        event.preventDefault();
        // Routed through `onClose` anyway, so a form's confirmation is offered
        // rather than the key doing nothing at all — a dead key teaches nothing.
        onClose();
      }
    };
    element.addEventListener('cancel', handle);
    return () => element.removeEventListener('cancel', handle);
  }, [dismissible, onClose]);

  return (
    <dialog
      ref={ref}
      className={wide ? 'dialog dialog--wide' : 'dialog'}
      aria-labelledby={titleId}
      // Clicking the backdrop dismisses **a dismissible dialog**. The check is on
      // the target being the dialog itself: a click inside the panel bubbles to
      // it otherwise. A non-dismissible one ignores the backdrop entirely — see
      // the note above `dismissible`.
      onClick={(event) => {
        if (dismissible && event.target === ref.current) onClose();
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
