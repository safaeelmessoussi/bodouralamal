import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';

import { t } from '../../i18n/index.js';
import { Button } from './button.js';
import { IconButton } from './icon-button.js';

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
 *
 * ## R248 — a dialog guards what was typed in it, by itself
 *
 * A dialog that is NOT given `dismissible` watches its own fields: once any
 * field inside it — however deep in a child form — has been typed in or
 * changed (`input`/`change`, which bubble), the backdrop is ignored and
 * `Escape` or ✕ ask «تجاهل التغييرات؟» before closing (`useUnsavedGuard`'s
 * rule). The Owner lost a half-filled «رفع ملف» to a click beside it: that
 * dialog wraps a form component, so the per-file opt-in never reached it. A
 * caller that passes `dismissible` keeps its own guard (`FormDialog`,
 * `useUnsavedGuard`); a field marked `data-unsaved-ignore` (a search box) is
 * not work. Closing from the code (`open` false, after a save) never asks.
 */
/** R248 — «إلغاء» inside a guarding dialog asks first; elsewhere it just proceeds. */
const DiscardCheck = createContext<((proceed: () => void) => void) | null>(null);

/**
 * **R248 — for a form's own «إلغاء»** inside a dialog that guards itself: the
 * same question as ✕ when something was typed, then `proceed`. Outside such a
 * dialog (or with nothing typed) it simply proceeds.
 */
export function useDiscardCheck(): (proceed: () => void) => void {
  return useContext(DiscardCheck) ?? ((proceed) => proceed());
}

export function Dialog({
  open,
  onClose,
  title,
  wide = false,
  full = false,
  dismissible: dismissibleProp,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  wide?: boolean;
  /** R242 — the whole page: a preview of content, the document or the video as large as the screen. */
  full?: boolean;
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
  // R248 — no `dismissible` given: the dialog guards what was typed in it.
  const auto = dismissibleProp === undefined;
  const [touched, setTouched] = useState(false);
  const [asking, setAsking] = useState(false);
  const holding = auto && touched;
  const dismissible = auto ? !holding : dismissibleProp;
  /** What to do once the reader agrees to discard: close, or a form's own «إلغاء». */
  const pending = useRef<() => void>(onClose);
  const check = (proceed: () => void): void => {
    if (!holding) return proceed();
    pending.current = proceed;
    setAsking(true);
  };
  const requestClose = (): void => check(onClose);

  useEffect(() => {
    setTouched(false);
    setAsking(false);
  }, [open]);

  useEffect(() => {
    const element = ref.current;
    if (!element || !auto) return;
    const mark = (event: Event): void => {
      const target = event.target as Element | null;
      if (target?.closest('[data-unsaved-ignore]')) return;
      // A nested dialog (this one's own question) is its own business.
      if (target?.closest('dialog') !== element) return;
      setTouched(true);
    };
    element.addEventListener('input', mark);
    element.addEventListener('change', mark);
    return () => {
      element.removeEventListener('input', mark);
      element.removeEventListener('change', mark);
    };
  }, [auto]);

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
        requestClose();
      }
    };
    element.addEventListener('cancel', handle);
    return () => element.removeEventListener('cancel', handle);
  }, [dismissible, onClose, holding]);

  return (
    <dialog
      ref={ref}
      className={full ? 'dialog dialog--full' : wide ? 'dialog dialog--wide' : 'dialog'}
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
          <IconButton
            icon="close"
            label={t('common.close')}
            onClick={requestClose}
            className="dialog__close"
          />
        </div>
        <div className="dialog__body">
          {auto ? <DiscardCheck.Provider value={check}>{children}</DiscardCheck.Provider> : children}
        </div>
      </div>
      {auto && asking ? (
        /* R248 — the shared question («إغلاق النموذج؟»), in this dialog's top layer;
           mounted only while asked, so no closed dialog carries a second one. */
        <Dialog open={asking} onClose={() => setAsking(false)} title={t('common.discardTitle')} dismissible>
          <div className="confirm">
            <p className="confirm__body">{t('common.discardBody')}</p>
            <div className="confirm__actions">
              <Button variant="secondary" onClick={() => setAsking(false)}>
                {t('common.cancel')}
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  setAsking(false);
                  setTouched(false);
                  pending.current();
                }}
              >
                {t('common.discardConfirm')}
              </Button>
            </div>
          </div>
        </Dialog>
      ) : null}
    </dialog>
  );
}
