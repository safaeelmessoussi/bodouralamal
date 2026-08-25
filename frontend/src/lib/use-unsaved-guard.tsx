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

  const requestClose = (): void => {
    if (dirty && !busy) setConfirming(true);
    else onCancel();
  };

  return {
    dismissible: !dirty,
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
