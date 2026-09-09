import { describe, expect, it } from 'vitest';

import PAGE from './legal.tsx?raw';
import { ar } from '../i18n/ar.js';

/**
 * **NEW P — what the legal pages must NOT do**, revised for R138 §12/§13.
 *
 * The failure mode these guard against is not a broken page; it is a
 * plausible one. A privacy policy that states a retention period nobody
 * decided, or names a legal entity nobody supplied, is **trusted and
 * wrong** — worse than an obviously missing line, because nothing about it
 * invites correction.
 *
 * ## What changed
 *
 * `pages/legal.tsx` used to render this exact static i18n content — the
 * assertions below used to check the PAGE for it. R138 made the page
 * dynamic: it now fetches whichever `LegalDocument` version a Super Admin
 * has activated through `/superadmin/settings`, and declares an honest
 * "not yet published" state rather than falling back to hardcoded text when
 * none has been (§14.4) — see `legal.tsx`'s own doc comment for why nothing
 * is auto-seeded either, the same reasoning `PARTNERS` in `production.ts`
 * and `legal-consent-text`'s migration both already state.
 *
 * The `ar.legal.privacy*`/`ar.legal.terms*` strings stay in the catalogue,
 * unused by the page now, as the **recommended initial draft** a Super Admin
 * can paste into the new editor — the same "an unused key costs nothing"
 * reasoning already applied to the removed مسالك التعليم/كيف تنضمّين
 * sections. So the invariant these tests protect has not gone away; it has
 * moved from *"the page never invents X"* to *"the recommended draft never
 * invents X, and the live page never falls back to a hardcoded substitute
 * when nothing is published."*
 */
describe('the recommended draft content invents nothing', () => {
  it('marks every Owner/legal input visibly rather than filling it in', () => {
    // The marker is a real, translated string a reader sees — not a code
    // comment and not a `TODO` that ships silently.
    expect(ar.legal.ownerInput).toContain('⚠');
    expect(ar.legal.ownerInput).toContain('الجمعية');
  });

  it('states the retention period as UNDECIDED, because it is', () => {
    // OD-06: no legal or operational retention rule is established. R111/
    // R133 keep the records; they do not claim they are kept forever, and
    // the recommended draft must not claim it either.
    expect(ar.legal.privacyRetentionPending).toContain('⚠');
    expect(ar.legal.privacyRetentionPending).toContain('لم تُحدَّد');
  });

  it('names the two Google scopes the code actually requests, and no others', () => {
    /**
     * Google requires the policy to explain how the app accesses and uses
     * Google user data. The check that matters is that the draft and
     * `oauth.ts` agree — a policy naming a scope the app does not request is
     * as wrong as one omitting a scope it does.
     */
    const body = ar.legal.privacyGoogleBody;
    for (const scope of ['openid', 'email']) {
      expect(body, `the policy must name the ${scope} scope`).toContain(scope);
    }
    // `profile` joined this list in R121. The draft told applicants the
    // platform asks Google for their name and picture; it no longer does,
    // and a policy claiming a scope the app does not request is as wrong as
    // one omitting a scope it does.
    for (const absent of ['profile', 'drive', 'calendar', 'contacts', 'gmail']) {
      expect(body.toLowerCase()).not.toContain(absent);
    }
  });

  it('says plainly that the educational and safeguarding record survives deletion', () => {
    /**
     * **The one genuinely unacceptable outcome** R111/R133 name: an
     * interface that promises deletion while §4 retains the record. The
     * policy is where that promise is made or broken.
     */
    const body = ar.legal.privacyDeletionBody;
    expect(body).toContain('لا يُحذف');
    expect(body).toContain('الموافقة');
  });

  it('promises no sale and no advertising, which is what the platform does', () => {
    expect(ar.legal.privacyNoSaleBody).toContain('لا نبيع');
  });
});

/**
 * **The live page itself — dynamic, and never a hardcoded fallback.**
 *
 * Source-scanned rather than rendered: `PrivacyPage`/`TermsPage` fetch
 * through `useEffect`, which never runs under `renderToStaticMarkup`
 * (see `landing.test.tsx`'s own note on why this project's component tests
 * carry no DOM), so the meaningful assertions here are about what the
 * SOURCE does and does not reference.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

describe('the live page is dynamic — R138 §12/§13', () => {
  const src = code(PAGE);

  it('fetches the active document by kind, for both privacy_policy and terms_of_use', () => {
    expect(src).toContain('fetchActiveLegalDocument');
    expect(src).toContain('privacy_policy');
    expect(src).toContain('terms_of_use');
  });

  it('declares an honest not-published state rather than a blank page (§14.4)', () => {
    expect(src).toContain('not_published');
    expect(src).toContain("t('legal.notPublished')");
  });

  it('never falls back to the old static section keys — no silent hardcoded substitute', () => {
    // A regression here would mean a Super Admin's activation, or lack of
    // one, stopped being the thing that decides what the public page shows.
    for (const staleKey of [
      'legal.privacyWhoBody',
      'legal.privacyCollectBody',
      'legal.termsWhoBody',
      'legal.termsUseBody',
    ]) {
      expect(PAGE).not.toContain(staleKey);
    }
  });

  it('renders the exact activated text without re-flowing its paragraph breaks', () => {
    expect(src).toContain('legal__body');
    expect(src).toContain('state.body');
  });
});
