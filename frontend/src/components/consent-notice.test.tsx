import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import REGISTER_SOURCE from '../pages/register.tsx?raw';
import CHILD_SOURCE from '../pages/profile/register-child.tsx?raw';
import { ApiError } from '../lib/api.js';
import { explainFailure, mapServerIssues } from '../pages/register.js';
import { ConsentNotice } from './consent-notice.js';

/**
 * The consent notice, and the failure explainer beside it.
 *
 * Both exist because of the same complaint: the form told people things that
 * were true but useless — a statute number with no explanation, and *"try again
 * later"* for a fault that waiting could never fix.
 */

/**
 * R119 — the wording is DATA now, so a default stands in for the stored
 * `LegalConsentText` a caller passes. **Not the real notice**: nothing in this
 * repository holds the approved Arabic wording, and a fixture that looked like
 * it would be the first step toward one being deployed.
 */
const WORDING = 'نص تجريبي — أوافق على معالجة بياناتي الشخصية.';

const render = (over: Partial<Parameters<typeof ConsentNotice>[0]> = {}) =>
  renderToStaticMarkup(
    <ConsentNotice checked={false} onChange={() => undefined} text={WORDING} {...over} />,
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

  /* ── R119 — the wording is the record's, and only the record's ────────── */

  it('renders the stored wording verbatim, and composes nothing around it', () => {
    // The sentence used to be built from three i18n keys with the statute name
    // as an inline button in the middle. Templating around legal text is how a
    // notice ends up saying something nobody approved.
    expect(render()).toContain(WORDING);
  });

  /* ── Collapsed by default (Owner, 2026-09-02) ──────────────────────────── */

  it('ships the wording COLLAPSED, so the form can be scanned', () => {
    // A full legal notice beside the checkbox dominated the registration page.
    // `hidden` rather than absent, so `aria-controls` names a real element in
    // both states — and **no CSS may set `display` on it** (rule AG), which the
    // browser harness measures because a stylesheet cannot prove it.
    const html = render();
    expect(html).toMatch(/id="consent-text-full"[^>]*hidden/);
  });

  it('carries the wording in the DOM even while collapsed', () => {
    // Collapsing is presentation. The text is still there, still exact, and
    // still the one the submitted id belongs to.
    expect(render()).toContain(WORDING);
  });

  it('labels the checkbox with the consent NAME, not the legal statement', () => {
    // `register.consentTitle` names *which* consent this is, the way a field
    // label names a field. Anybody asking what was agreed to reads the stored
    // wording, never this key.
    expect(render()).toContain('الموافقة على معالجة المعطيات ذات الطابع الشخصي');
  });

  it('tells the applicant to read the wording before submitting', () => {
    const html = render();
    expect(html).toContain('قبل إرسال الطلب');
    // Announced with the control it qualifies, rather than left to be found.
    expect(html).toContain('aria-describedby="consent-text-hint"');
  });

  it('opens with a real disclosure button that announces its state', () => {
    // Not a styled span and not a link: a keyboard reaches it in order and a
    // screen reader is told whether the region is open.
    const html = render();
    expect(html).toMatch(/<button[^>]*type="button"[^>]*aria-expanded="false"/);
    expect(html).toContain('aria-controls="consent-text-full"');
    expect(html).toContain('قراءة نص الموافقة كاملاً');
  });

  it('keeps the Law 09-08 explanation separate from the wording', () => {
    // Background reference, not the statement being accepted — so it stays in
    // i18n, stays a modal, and is reachable whether or not the wording is open.
    expect(render()).toContain('القانون 09-08');
  });

  it('offers NO checkbox when no wording is in force — fail closed', () => {
    // A tick against nothing is not a consent, and offering one would let a
    // person believe they had agreed to something.
    const html = render({ text: null });
    expect(html).not.toContain('type="checkbox"');
    expect(html).toContain('role="alert"');
  });

  it('keeps the statute explanation reachable even with no wording', () => {
    // It is interface, not the statement being accepted — so its availability
    // does not depend on a version being in force.
    expect(render({ text: null })).toContain('القانون 09-08');
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
    // activates a legal wording nobody has approved.
    //
    // **R119 removed the setting KEY from this message.** It named
    // `legal.consent_text_version` on a screen a beneficiary reads (rule M),
    // and after the cutover it was the wrong remedy as well as the wrong
    // register. What it must still do is send the reader somewhere real, and
    // never to a retry.
    const message = explainFailure(
      envelope('SERVICE_UNAVAILABLE', { reason: 'CONSENT_TEXT_VERSION_NOT_CONFIGURED' }),
    );
    expect(message).toContain('إعدادات المنصة');
    expect(message).not.toContain('legal.consent_text_version');
    expect(message).not.toContain('يرجى المحاولة بعد قليل');
  });

  it('tells a reader whose wording changed to read it again, not to retry', () => {
    // R119. A Super Admin activated new wording while the form was open, so the
    // server refused the stale version rather than recording agreement to words
    // this person never saw. That is not a fault they can retry past.
    const message = explainFailure(
      envelope('STATE_CONFLICT', { reason: 'CONSENT_TEXT_SUPERSEDED' }),
    );
    expect(message).toContain('تحديث');
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

describe('mapServerIssues — the user learns WHICH field, not "review the fields"', () => {
  const withIssues = (issues: { path: string; message: string }[]) =>
    new ApiError(400, {
      code: 'VALIDATION_FAILED',
      message_key: 'k',
      message: 'm',
      details: { issues },
      request_id: 'r1',
    });

  it('marks the exact field the server named', () => {
    // THE REGRESSION. The backend had always sent `path` per failure; the form
    // threw it away and rendered one sentence, so a rejected submission said
    // "review the fields" without saying which.
    const { fields } = mapServerIssues(
      withIssues([{ path: 'applicant.first_name_arabic', message: 'Required' }]),
    );
    expect(fields).toHaveProperty('applicant.firstNameArabic');
  });

  it('maps the server\'s "parent" onto the form\'s "applicant"', () => {
    // The parent+child payload calls the first person `parent`; this form calls
    // the same person `applicant`. Without the translation the error would be
    // computed and then attached to nothing.
    const { fields } = mapServerIssues(
      withIssues([{ path: 'parent.last_name_arabic', message: 'Required' }]),
    );
    expect(fields).toHaveProperty('applicant.lastNameArabic');
  });

  it('marks the right CHILD separately from the applicant (R62)', () => {
    // The index is part of the identity now: a request may carry several
    // children, and marking the wrong fieldset is worse than marking none.
    const { fields } = mapServerIssues(
      withIssues([{ path: 'children.1.first_name_arabic', message: 'Required' }]),
    );
    expect(fields).toHaveProperty('children.1.firstNameArabic');
    expect(fields).not.toHaveProperty('children.0.firstNameArabic');
    expect(fields).not.toHaveProperty('applicant.firstNameArabic');
  });

  it('does not mistake a bare `children` issue for a field on a child', () => {
    // `children: Array must contain at least 1 element` has no index and no
    // field. Inventing one would light up a fieldset at random; surfacing the
    // message verbatim is what the unmapped list is for.
    const { fields, unmapped } = mapServerIssues(
      withIssues([{ path: 'children', message: 'Too small: expected array to have >=1 items' }]),
    );
    expect(fields).toEqual({});
    expect(unmapped).toHaveLength(1);
  });

  it('maps the R41 half-a-French-name refusal onto the missing half', () => {
    const { fields } = mapServerIssues(
      withIssues([
        { path: 'applicant.last_name_french', message: 'both French name parts are required' },
      ]),
    );
    expect(fields).toHaveProperty('applicant.lastNameFrench');
  });

  it('maps branch and consent failures to their controls', () => {
    const { fields } = mapServerIssues(
      withIssues([
        { path: 'branch_id', message: 'Required' },
        { path: 'consents.data_processing', message: 'Required' },
      ]),
    );
    expect(fields).toHaveProperty('branch');
    expect(fields).toHaveProperty('dataProcessing');
  });

  it('SURFACES an issue it cannot place rather than dropping it', () => {
    // An `Unrecognized key` is exactly the signal that a stale client is
    // talking to a newer server — the shape of the very bug being fixed. A
    // message nobody anticipated is the one most worth showing.
    const { fields, unmapped } = mapServerIssues(
      withIssues([{ path: 'applicant', message: 'Unrecognized key: "name_arabic"' }]),
    );
    expect(Object.keys(fields)).toHaveLength(0);
    expect(unmapped).toHaveLength(1);
    expect(unmapped[0]).toContain('name_arabic');
  });

  it('returns nothing for an error carrying no issues', () => {
    expect(mapServerIssues(new ApiError(500)).fields).toEqual({});
    expect(mapServerIssues(new Error('boom')).unmapped).toEqual([]);
  });
});

/**
 * **The R119 invariant, pinned at the source** (Owner, 2026-09-02).
 *
 * Collapsing the wording changes what is shown and must not change what is
 * recorded: the text revealed by the disclosure and the id the form submits
 * have to come from the **same** `ActiveConsentText`. A rendering test cannot
 * see that — it would pass just as happily with two independent sources, which
 * is precisely the *«frontend text X, separately fetched version Y»* race R119
 * exists to close.
 */
describe('the wording shown and the version submitted are ONE source', () => {
  const sources: [string, string][] = [
    ['/register', REGISTER_SOURCE],
    ['تسجيل طفل', CHILD_SOURCE],
  ];

  it.each(sources)('%s reads both halves off the same state', (_name, source) => {
    const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    // One piece of state holds the pair.
    expect(code).toContain('consentText?.body_arabic');
    expect(code).toContain('consentText!.id');
    // And nothing fetches the wording a second time — the CALL, not the
    // import beside it.
    expect(code.split('fetchActiveConsentText(').length - 1).toBe(1);
    // Exactly one place holds the pair, so the two halves cannot diverge.
    expect(code.split('setConsentText(').length - 1).toBe(2);
  });

  it.each(sources)('%s never sources the wording from i18n', (_name, source) => {
    // The retired keys composed the accepted sentence on the client. A
    // reappearance would be a second source for the thing being agreed to.
    for (const key of ['consentDataProcessingPrefix', 'consentDataProcessingSuffix']) {
      expect(source).not.toContain(key);
    }
  });
});
