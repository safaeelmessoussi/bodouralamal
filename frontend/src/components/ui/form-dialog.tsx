import { type ReactNode } from 'react';

import { Button } from './button.js';
import { Dialog } from './dialog.js';
import { t } from '../../i18n/index.js';
import { Feedback } from './feedback.js';
import { useUnsavedGuard } from '../../lib/use-unsaved-guard.js';

/**
 * **The shape every form dialog in the back office shares.**
 *
 * ## The drift this ends
 *
 * `Dialog` gave the frame and nothing else, so each form assembled the rest by
 * hand — and they diverged in ways no single screen looked wrong for:
 *
 * | | Events form | Sessions form |
 * |---|---|---|
 * | Field wrapper | `<div className="form">` | **none** — so every field's spacing differed |
 * | Save button | `variant="primary"` | default (`secondary`) — the save action was not the emphasised one |
 * | Result message | *(none in the dialog)* | bare `<p role="status">`, unstyled |
 *
 * None of that is a decision anybody took. It is what happens when the frame is
 * shared and the *contents* are not, which is precisely the gap this component
 * closes: a form supplies its fields, and the dialog owns the wrapper, the
 * spacing, the notice, and the two buttons that end every form the same way.
 *
 * **`submitLabel` defaults to *save*** because that is what nearly every form
 * does; a screen overrides it only where the action genuinely has another name.
 *
 * ## Unsaved work is not thrown away by a stray click (2026-08-17)
 *
 * **The defect:** a filled-in form, one mis-aimed click on the backdrop, and
 * everything typed was gone — no warning, no undo, no way to tell it had
 * happened except by noticing the dialog was shut. Escape did the same.
 *
 * **The fix is here and not in any screen**, because a per-form implementation
 * is a rule applied unevenly: the one form that forgot it would be the one
 * somebody loses a roster in.
 *
 * | Way out | With unsaved changes | Without |
 * |---|---|---|
 * | Backdrop click | ignored | closes |
 * | `Escape` | asks | closes |
 * | Close / إلغاء | asks | closes |
 * | Successful save | closes — the caller unmounts it | — |
 *
 * **Why the backdrop is ignored rather than asking.** A backdrop click is very
 * often not an intention at all, so answering it with a question trains the
 * reader to dismiss questions. `Escape` and the close button *are* intentions, so
 * they get the confirmation. The dialog is never inescapable: the close button
 * always leads out in at most two clicks.
 *
 * **`dirty` is the caller's to report**, because only the form knows whether its
 * current values differ from what it opened with. Callers that do not pass it get
 * the old behaviour exactly — nothing regresses by omission — and the guard in
 * `atomic-components.test.ts` is what keeps new forms from quietly opting out.
 */
export interface FormDialogProps {
  open: boolean;
  title: string;
  /** Forms carrying a list or a two-column row need the wider measure; a short
   *  form reads better at the default reading width. */
  wide?: boolean;
  /** A result or refusal from the last attempt. Rendered in the shared notice
   *  style rather than as whatever paragraph each screen reached for. */
  notice?: string | null;
  busy?: boolean;
  /** Blocks submission — the form's own completeness rule, which only it knows. */
  disabled?: boolean;
  submitLabel?: string;
  /**
   * Whether the form holds unsaved changes.
   *
   * Only the form can answer this — it is the comparison between what is in its
   * fields and what it opened with. When `true`, the backdrop stops dismissing
   * and any deliberate close asks first.
   */
  dirty?: boolean;
  onSubmit: () => void;
  onCancel: () => void;
  children: ReactNode;
}

export function FormDialog({
  open,
  title,
  wide = false,
  notice = null,
  busy = false,
  disabled = false,
  submitLabel,
  dirty = false,
  onSubmit,
  onCancel,
  children,
}: FormDialogProps): ReactNode {
  /**
   * **The behaviour is `useUnsavedGuard`'s now, not this component's.**
   *
   * It lived here, which meant it reached only the dialogs built on this
   * component — and six production dialogs are assembled from a bare `Dialog`,
   * `＋إضافة مقر` among them. Moving it to a hook lets a dialog of any shape
   * adopt the same rule instead of cloning an approximation of it.
   */
  const guard = useUnsavedGuard({ open, dirty, busy, onCancel });
  const { requestClose } = guard;

  return (
    <>
      <Dialog
        open={open}
        onClose={requestClose}
        title={title}
        wide={wide}
        // A form with unsaved work is not dismissible by backdrop or Escape; the
        // `Dialog` owns the mechanism and the guard owns the decision.
        dismissible={guard.dismissible}
      >
        {notice ? (
          <Feedback>
            {notice}
          </Feedback>
        ) : null}

        {/* The wrapper the fields' spacing comes from. A form that omitted it —
            and one did — laid its controls out on nothing but their own margins. */}
        <div className="form">{children}</div>

        <div className="form__actions">
          <Button variant="secondary" onClick={requestClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" disabled={busy || disabled} onClick={onSubmit}>
            {submitLabel ?? t('common.save')}
          </Button>
        </div>
      </Dialog>

      {guard.confirmation}
    </>
  );
}

/**
 * A dialog whose whole content is one list — conflicts, a roster, anything the
 * server answers with a set.
 *
 * Extracted because the sessions screen carried two of these written out
 * longhand, each with its own lede, its own empty case and its own `<ul>`. The
 * **empty case is the part worth sharing**: an empty list means *there are
 * none*, which is a real and often reassuring answer (no conflicts), and a
 * dialog that rendered an empty `<ul>` would leave a reader unsure whether it
 * had loaded.
 */
export function ListDialog<T>({
  open,
  title,
  lede,
  emptyLabel,
  items,
  itemKey,
  renderItem,
  onClose,
}: {
  open: boolean;
  title: string;
  lede?: string;
  emptyLabel: string;
  items: readonly T[] | null;
  itemKey: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  onClose: () => void;
}): ReactNode {
  return (
    <Dialog open={open} onClose={onClose} title={title}>
      {lede ? <p className="lede">{lede}</p> : null}
      {items !== null && items.length === 0 ? (
        <p className="muted">{emptyLabel}</p>
      ) : (
        <ul className="dialog__list">
          {(items ?? []).map((item) => (
            <li key={itemKey(item)}>{renderItem(item)}</li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
