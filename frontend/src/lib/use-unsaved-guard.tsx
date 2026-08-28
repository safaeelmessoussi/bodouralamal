import { useEffect, useState, type ReactNode } from 'react';

import { ConfirmDialog } from '../components/ui/confirm-dialog.js';
import { t } from '../i18n/index.js';

/**
 * **One implementation of *do not throw away my typing*, for every shape of
 * dialog that can hold it.**
 *
 * ## The defect this exists for
 *
 * `FormDialog` has protected unsaved work since 2026-08-17 and does it well.
 * But the protection lived *inside* that component, so it reached exactly the
 * dialogs built on it — and six production dialogs are assembled from a bare
 * `Dialog` instead. `＋إضافة مقر` is one of them: fill it in, click the
 * backdrop, and everything typed is gone without a word, while the identical
 * gesture on `＋تسجيل مستفيدة` asks first.
 *
 * The guard that was supposed to prevent this scoped itself to *"files that
 * render a `<FormDialog`, which is every form dialog on the platform"* — an
 * assumption that was false when it was written. It has never failed because it
 * cannot see the dialogs that opt out by not using the component at all.
 *
 * So the behaviour moves here, where a dialog of any shape can adopt it, and
 * `FormDialog` becomes one of its callers rather than its owner.
 *
 * ## The rule, both halves of it
 *
 * | Way out | Holding changes | Pristine |
 * |---|---|---|
 * | Backdrop | ignored | closes |
 * | `Escape` | asks | closes |
 * | Close / إلغاء | asks | closes |
 *
 * **The backdrop is ignored rather than asked about** because a backdrop click
 * is very often not an intention at all, and answering it with a question
 * trains a reader to dismiss questions. `Escape` and the close button *are*
 * intentions, so they get the confirmation. The way out is never more than two
 * clicks, and the close button always renders.
 *
 * **A pristine form must never ask.** That half matters as much: a dialog that
 * questions somebody who changed nothing is the reason people learn to click
 * through warnings, which is what makes the other half stop working.
 *
 * ## What `dirty` must be
 *
 * The caller's, and computed with `isDirty(current, pristine)` — never a
 * captured-on-open snapshot. These dialogs hydrate in an effect that runs after
 * the first render, so a captured baseline sees the *previous* record and the
 * form reports itself dirty the instant it opens. Comparing against the record
 * also makes *typed a change and undid it* correctly pristine again.
 */
export interface UnsavedGuard {
  /** Pass to `Dialog`: a dialog holding changes is not backdrop/Escape-dismissible. */
  dismissible: boolean;
  /** Every deliberate way out routes through this, so the rule is stated once. */
  requestClose: () => void;
  /** Render inside the dialog's tree; it asks, and closes only on confirmation. */
  confirmation: ReactNode;
}

export function useUnsavedGuard({
  open,
  dirty,
  busy = false,
  onCancel,
}: {
  /** Reopening must not inherit the previous instance's question. */
  open: boolean;
  dirty: boolean;
  busy?: boolean;
  onCancel: () => void;
}): UnsavedGuard {
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!open) setConfirming(false);
  }, [open]);

  /**
   * **A form that is not open holds no unsaved work** (2026-08-28).
   *
   * Not a convenience: it closes a real defect that reached every always-mounted
   * `FormDialog` whose parent clears the record it is editing on close.
   *
   * تعديل المجموعة showed *«هناك تغييرات لم تُحفظ بعد»* on a form nobody had
   * touched, and the sequence is worth recording because nothing in the caller
   * was wrong:
   *
   * 1. the close button calls `requestClose`; `dirty` is **false**, so it calls
   *    `onCancel`;
   * 2. the parent sets its `editing` row to `null`, so `open` becomes false and
   *    the form's `group` prop becomes `null`;
   * 3. the caller derives its pristine values from that prop, so pristine is now
   *    empty — while the field state still holds the loaded values, because the
   *    effect that resets it has not run yet. **`dirty` is spuriously true for
   *    that one render;**
   * 4. `Dialog` closes the native element, whose `close` event calls `onClose`
   *    — **re-entering `requestClose` inside exactly that window**, which opens
   *    the discard question.
   *
   * Fixing it in each caller would mean every form remembering to null-guard its
   * own pristine, which is the per-caller opt-in this hook exists to replace: a
   * behaviour each caller must remember is one that will be missing somewhere.
   * Reading `open` here states the invariant once, where the mechanism already
   * lives.
   */
  const unsaved = open && dirty;

  const requestClose = (): void => {
    if (unsaved && !busy) setConfirming(true);
    else onCancel();
  };

  return {
    dismissible: !unsaved,
    requestClose,
    confirmation: (
      /* **The shared question, not a second one.** `ConfirmDialog` is how this
         platform asks *are you sure* everywhere, and a bespoke one here would
         differ on exactly the surface where a reader is already worried about
         losing work.

         Not `danger`: discarding a draft deletes nothing and is not destructive
         in the R59 sense. The red treatment is reserved for what it means, or it
         stops meaning anything. */
      <ConfirmDialog
        open={confirming}
        title={t('common.discardTitle')}
        body={t('common.discardBody')}
        confirmLabel={t('common.discardConfirm')}
        onConfirm={() => {
          setConfirming(false);
          onCancel();
        }}
        onCancel={() => setConfirming(false)}
      />
    ),
  };
}
