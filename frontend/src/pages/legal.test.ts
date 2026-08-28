import { describe, expect, it } from 'vitest';

import PAGE from './legal.tsx?raw';
import { ar } from '../i18n/ar.js';

/**
 * **NEW P — what the legal pages must NOT do.**
 *
 * The failure mode these guard against is not a broken page; it is a plausible
 * one. A privacy policy that states a retention period nobody decided, or names
 * a legal entity nobody supplied, is **trusted and wrong** — which is worse than
 * an obviously missing line, because nothing about it invites correction.
 */
describe('the legal pages invent nothing', () => {
  it('marks every Owner/legal input visibly rather than filling it in', () => {
    // The marker is a real, translated string a reader sees — not a code comment
    // and not a `TODO` that ships silently.
    expect(ar.legal.ownerInput).toContain('⚠');
    expect(ar.legal.ownerInput).toContain('الجمعية');
    expect(PAGE).toContain("t('legal.ownerInput')");
  });

  it('states the retention period as UNDECIDED, because it is', () => {
    // OD-06: no legal or operational retention rule is established. R111 keeps
    // the records; it does not claim they are kept forever, and this page must
    // not claim it either.
    expect(ar.legal.privacyRetentionPending).toContain('⚠');
    expect(ar.legal.privacyRetentionPending).toContain('لم تُحدَّد');
  });

  it('names the three Google scopes the code actually requests, and no others', () => {
    /**
     * Google requires the policy to explain how the app accesses and uses Google
     * user data. The check that matters is that the page and `oauth.ts` agree —
     * a policy naming a scope the app does not request is as wrong as one
     * omitting a scope it does.
     */
    const body = ar.legal.privacyGoogleBody;
    for (const scope of ['openid', 'email', 'profile']) {
      expect(body, `the policy must name the ${scope} scope`).toContain(scope);
    }
    // The ones it must not claim.
    for (const absent of ['drive', 'calendar', 'contacts', 'gmail']) {
      expect(body.toLowerCase()).not.toContain(absent);
    }
  });

  it('says plainly that the educational and safeguarding record survives deletion', () => {
    /**
     * **The one genuinely unacceptable outcome** R111 names: an interface that
     * promises deletion while §4 retains the record. The policy is where that
     * promise is made or broken.
     */
    const body = ar.legal.privacyDeletionBody;
    expect(body).toContain('لا يُحذف');
    expect(body).toContain('الموافقة');
  });

  it('promises no sale and no advertising, which is what the platform does', () => {
    expect(ar.legal.privacyNoSaleBody).toContain('لا نبيع');
  });
});
