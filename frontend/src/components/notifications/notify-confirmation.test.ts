import { describe, expect, it } from 'vitest';

import SESSIONS from '../../pages/admin/schedule-sessions.tsx?raw';
import SCHEDULING from '../../pages/admin/scheduling.tsx?raw';
import { ar } from '../../i18n/ar.js';

function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/**
 * **The button a person actually presses.**
 *
 * The notification pipeline was proved end to end in the browser
 * (`verify-notify-ui`), which is the only real proof. These are the source-level
 * properties that would silently rot between browser runs — and the one that
 * would be invisible in a green harness: the **retry**.
 */
describe('«إرسال الإشعار» calls the adapter; «بدون إشعار» calls nothing', () => {
  it('the occurrence screen sends only from onConfirm', () => {
    const body = code(SESSIONS);
    expect(body).toContain('notifySessionChange(');
    // Declining must be the ABSENCE of the request, never a request that sends
    // zero — the distinction R83.3 draws.
    const cancelHandler = body.slice(body.indexOf('onCancel={() => {'));
    expect(cancelHandler.slice(0, 400)).not.toContain('notifySessionChange');
  });

  it('the scheduling form sends only from onConfirm', () => {
    const body = code(SCHEDULING);
    expect(body).toContain('notifyEventChange(');
    const notifyDialog = body.slice(body.indexOf("cancelLabel={t('scheduling.notify.skip')}"));
    const cancelHandler = notifyDialog.slice(notifyDialog.indexOf('onCancel={() => {'));
    expect(cancelHandler.slice(0, 400)).not.toContain('notifyEventChange');
  });

  it('an Event deletion offers the decision only after the delete succeeded', () => {
    const body = code(SCHEDULING);
    const handler = body.slice(
      body.indexOf('async function confirmDelete'),
      body.indexOf('return (', body.indexOf('async function confirmDelete')),
    );
    const deleted = handler.indexOf('await deleteSchedulingItem(');
    const offered = handler.indexOf("change: 'cancelled'");

    expect(handler).toContain("deleted.type === 'activity'");
    expect(deleted).toBeGreaterThanOrEqual(0);
    expect(offered).toBeGreaterThan(deleted);
    expect(body).toContain('notifying.change');
  });
});

/**
 * **A failed notice must be retryable** (2026-08-20).
 *
 * The copy said «يمكنك المحاولة لاحقاً» while `finally` closed the dialog, so
 * the only way back was to cancel the occurrence again — which is not a thing
 * anybody should do to re-send a notice. The dialog now closes on success and
 * stays open on failure.
 */
describe('a failed notice can be retried without redoing the change', () => {
  for (const [name, source] of [
    ['occurrence', SESSIONS],
    ['scheduling', SCHEDULING],
  ] as const) {
    it(`${name}: the dialog is dismissed on success, not in finally`, () => {
      const body = code(source);
      const start = body.indexOf('try {', body.indexOf('onConfirm'));
      const finallyBlock = body.slice(body.indexOf('} finally {', start), body.indexOf('}', body.indexOf('} finally {', start) + 12) + 1);
      expect(finallyBlock).toContain('setBusy(false)');
      // The tell: clearing the dialog in `finally` closes it on failure too.
      expect(finallyBlock).not.toContain('setNotifying(null)');
    });
  }

  it('and the message says the change itself was saved', () => {
    // A generic failure would read as though the cancellation had not happened.
    expect(ar.scheduling.notify.failed).toContain('حُفظ التغيير');
    expect(ar.scheduling.notify.failed).toContain('تعذّر إرسال الإشعار');
  });
});

describe('the notice question is asked in the platform’s own words', () => {
  it('offers exactly the two answers', () => {
    expect(ar.scheduling.notify.send).toBe('إرسال الإشعار');
    expect(ar.scheduling.notify.skip).toBe('بدون إشعار');
  });

  it('and declining says what happened, rather than nothing', () => {
    expect(ar.scheduling.notify.skipped).toContain('بدون إرسال إشعار');
  });
});
