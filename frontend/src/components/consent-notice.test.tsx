import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ApiError } from '../lib/api.js';
import { explainFailure } from '../pages/register.js';
import { ConsentNotice } from './consent-notice.js';

/**
 * The consent notice, and the failure explainer beside it.
 *
 * Both exist because of the same complaint: the form told people things that
 * were true but useless — a statute number with no explanation, and *"try again
 * later"* for a fault that waiting could never fix.
 */

const render = (over: Partial<Parameters<typeof ConsentNotice>[0]> = {}) =>
  renderToStaticMarkup(
    <ConsentNotice checked={false} onChange={() => undefined} {...over} />,
  );

describe('ConsentNotice — informed consent, not a cited statute', () => {
  it('makes the law reference a real button, not decorative text', () => {
    // A `<span>` with a click handler is invisible to keyboard and screen
    // reader users, who are exactly the people least able to go looking for the
    // explanation elsewhere.
    const html = render();
    expect(html).toContain('<button');
    expect(html).toContain('القانون 09-08');
  });

  it('explains all five things a reader needs, in the dialog', () => {
    const html = render();
    // Why it is collected, what is stored, who can see it, that it is used only
    // for running the association, and which rights the law grants.
    expect(html).toContain('لماذا نجمع هذه البيانات؟');
    expect(html).toContain('ما الذي نحتفظ به؟');
    expect(html).toContain('من يمكنه الاطّلاع عليها؟');
    expect(html).toContain('هل تُستعمل لغرض آخر؟');
    expect(html).toContain('ما هي حقوقك؟');
  });

  it('names the three rights the law actually grants', () => {
    const html = render();
    expect(html).toContain('الاطّلاع على بياناتك');
    expect(html).toContain('تصحيح');
    expect(html).toContain('الاعتراض');
  });

  it('uses the shared native <dialog>, not a second modal implementation', () => {
    // §14.3: one modal. A `<div>` overlay would have to re-earn focus trapping,
    // Escape, page inertness and top-layer stacking, and usually gets one wrong.
    expect(render()).toContain('<dialog');
  });

  it('announces a consent error rather than only colouring the box', () => {
    const html = render({ error: 'مطلوب' });
    expect(html).toContain('role="alert"');
    expect(html).toContain('مطلوب');
  });

  it('reflects the checked state it is given', () => {
    expect(render({ checked: true })).toContain('checked');
  });
});

describe('explainFailure — never "try again" for a cause that is known', () => {
  const envelope = (code: string, details: Record<string, unknown> = {}) =>
    new ApiError(500, {
      code,
      message_key: 'k',
      message: 'm',
      details,
      request_id: 'r1',
    });

  it('names the missing configuration instead of blaming the network', () => {
    // THE REGRESSION. The server said `SERVICE_UNAVAILABLE` with
    // `reason: CONSENT_TEXT_VERSION_NOT_CONFIGURED`; the form said "try again
    // later" — advice that could never work, because no amount of waiting
    // writes a missing SystemSetting row.
    const message = explainFailure(
      envelope('SERVICE_UNAVAILABLE', { reason: 'CONSENT_TEXT_VERSION_NOT_CONFIGURED' }),
    );
    expect(message).toContain('legal.consent_text_version');
    expect(message).not.toContain('يرجى المحاولة بعد قليل');
  });

  it('tells a spent token to start again, not to retry the form', () => {
    // The onboarding token is single-use (§4.1b): resubmitting cannot help.
    expect(explainFailure(envelope('STATE_CONFLICT'))).toContain('من جديد عبر Google');
    expect(explainFailure(envelope('AUTH_REQUIRED'))).toContain('من جديد عبر Google');
  });

  it('surfaces a validation refusal as a validation refusal', () => {
    expect(explainFailure(envelope('VALIDATION_FAILED'))).toContain('مراجعة الحقول');
  });

  it('reports a refused consent as a consent problem', () => {
    expect(explainFailure(envelope('CONSENT_REQUIRED'))).toContain('الموافقة');
  });

  it('falls back on the STATUS when there is no envelope at all', () => {
    // A gateway error page carries no TD-3.8 body; the status is all there is,
    // and guessing beyond it would be inventing a diagnosis.
    expect(explainFailure(new ApiError(401))).toContain('من جديد عبر Google');
    expect(explainFailure(new ApiError(400))).toContain('مراجعة الحقول');
    expect(explainFailure(new ApiError(500))).toContain('يرجى المحاولة بعد قليل');
  });

  it('falls back for a non-API error rather than throwing', () => {
    expect(explainFailure(new Error('boom'))).toContain('يرجى المحاولة بعد قليل');
  });
});
