import { ApiError } from './api.js';
import { blockingDependencies, type BlockingDependency } from './blocked-by.js';
import { t } from '../i18n/index.js';

/**
 * **What just happened when Delete was clicked** — one classification, used by
 * every screen that deletes something (2026-08-27).
 *
 * ## The defect this ends
 *
 * Each delete screen classified failures itself, and they disagreed. Four
 * screens recognised `blocked_by` and named the dependencies; مجموعات المستويات
 * did not, because its service threw a *different* refusal shape — so it fell
 * through to the generic `STATE_CONFLICT` sentence, *«يرجى تحديث الصفحة»*, and
 * **refreshing can never resolve an enrolled student.** The reader follows the
 * instruction, nothing changes, and the button reads as broken.
 *
 * Worse, **nobody handled `NOT_FOUND` at all.** Deleting a row that is already
 * gone — an open page after somebody else's edit, or after your own earlier
 * delete — reported *«تعذّر الحذف»*, which says the opposite of what happened:
 * the row is gone, which is what was asked for.
 *
 * ## The four outcomes, and why they are four
 *
 * | outcome | what the reader must do |
 * |---|---|
 * | `deleted` | nothing — it worked |
 * | `already-gone` | nothing — it was already deleted; the list is stale |
 * | `blocked` | remove or reassign the named dependencies first |
 * | `stale` | reload; somebody else changed the row (`VERSION_CONFLICT`) |
 * | `failed` | genuinely unknown — keep the `request_id` |
 *
 * **`already-gone` is a SUCCESS for the reader.** The thing she wanted gone is
 * gone. Reporting it as a failure is what made Delete look unreliable.
 *
 * **`request_id` is carried on every outcome**, because the one a person reports
 * to support is the one they could not act on themselves.
 */
export type DeletionOutcome =
  | { kind: 'deleted' }
  | { kind: 'already-gone'; requestId: string | null }
  | { kind: 'blocked'; dependencies: BlockingDependency[]; requestId: string | null }
  | { kind: 'stale'; requestId: string | null }
  | { kind: 'failed'; requestId: string | null };

const requestIdOf = (error: unknown): string | null =>
  error instanceof ApiError ? (error.requestId ?? null) : null;

export function classifyDeletion(error: unknown): DeletionOutcome {
  if (error === null || error === undefined) return { kind: 'deleted' };

  /**
   * **A callback is a misuse, and it must be loud** (2026-08-28).
   *
   * الشركاء called `classifyDeletion(() => deletePartner(id, token))`. The
   * parameter is `unknown`, which a function satisfies, so the type checker had
   * nothing to say — and a function is neither `null` nor an `ApiError`, so it
   * fell through to `failed`. **The deletion was never performed**: no request
   * reached nginx or the API, and the reader was told it had failed. «حذف does
   * nothing» was literally true.
   *
   * Throwing is right where returning `failed` was wrong: a caller that passed
   * an operation has not deleted anything, and reporting a tidy failure hid that
   * for a whole release.
   */
  if (typeof error === 'function') {
    throw new TypeError(
      'classifyDeletion expects the caught error, not a callback — the deletion has not run',
    );
  }

  const requestId = requestIdOf(error);

  // Checked before the generic `STATE_CONFLICT` arm: a blocked deletion is the
  // only failure carrying `details.blocked_by`, which is what makes the two
  // tellable apart at all.
  const dependencies = blockingDependencies(error);
  if (dependencies !== null) return { kind: 'blocked', dependencies, requestId };

  if (error instanceof ApiError) {
    /**
     * **Already gone is not a failure.** The row the reader asked to remove is
     * not there, which is the state she wanted. The caller reloads its list and
     * says so plainly rather than reporting an error for a job already done.
     */
    if (error.status === 404 || error.code === 'NOT_FOUND') {
      return { kind: 'already-gone', requestId };
    }
    // The one case where *«يرجى تحديث الصفحة»* is genuinely the right advice.
    if (error.code === 'VERSION_CONFLICT') return { kind: 'stale', requestId };
  }
  return { kind: 'failed', requestId };
}

/**
 * The sentence for an outcome that is **not** blocked — the blocked case needs a
 * list and gets `BlockedNotice` instead of a sentence.
 */
export function deletionNotice(outcome: DeletionOutcome): string | null {
  switch (outcome.kind) {
    case 'deleted':
      return t('common.deleted');
    case 'already-gone':
      return t('states.err.alreadyDeleted');
    case 'stale':
      return t('common.conflict');
    case 'failed':
      return t('common.deleteFailed');
    default:
      return null;
  }
}
