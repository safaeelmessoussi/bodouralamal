import { describe, expect, it } from 'vitest';

import PAGE from './settings.tsx?raw';
import AR from '../../i18n/ar.ts?raw';

/**
 * **`إعدادات المنصة` manages wordings, not a string** (R119, rule BE).
 *
 * The screen it replaces offered a text box for `legal.consent_text_version`
 * while the wording it claimed to version lived in `i18n/ar.ts`. Typing in that
 * box changed nothing anybody read; editing the Arabic changed nothing anybody
 * recorded. **The control was not the defect — the model was, and the control
 * made it look managed.**
 *
 * Asserted against the source, because what is being pinned is *which shape the
 * screen has*: a rendering test would need the whole admin shell, a session and
 * four network reads to say something the source says directly.
 */
const source = PAGE.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

describe('the screen manages versions, not a detached identifier', () => {
  it('reads the versions and offers activation as its own action', () => {
    expect(source).toContain('listConsentTexts');
    // Activation is a separate call, not a `status` field on the edit: folding
    // it in would make *correcting a draft* and *deciding what every future
    // applicant is held to* the same request.
    expect(source).toContain('activateConsentText');
    expect(source).toContain('createConsentText');
  });

  it('renders the exact wording, not a summary of it', () => {
    // A management surface that lists labels without their text reproduces the
    // detached string it replaces.
    expect(source).toContain('body_arabic');
  });

  it('never asks the administrator to look at a digest', () => {
    // The Owner's instruction: no hash and no database identifier is presented
    // as something to manage. The digest travels on the wire for a support
    // engineer; it is not on the screen.
    expect(source).not.toContain('body_digest');
  });

  it('shows the history, and does not hide it behind a disclosure', () => {
    expect(source).toContain('historyTitle');
  });
});

describe('the retired setting leaves no trace in the copy', () => {
  const catalogue = AR.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

  /**
   * **Rule M.** The key named a `SystemSetting` on a screen a beneficiary
   * reads, and after the cutover it is neither the authority nor the remedy.
   */
  it('names no setting key in any user-facing string', () => {
    expect(catalogue).not.toContain('legal.consent_text_version');
  });

  it('drops the three keys that used to compose the consent sentence', () => {
    // The wording is a stored record now, rendered verbatim. Templating around
    // legal text is how a notice ends up saying something nobody approved.
    for (const key of [
      'consentDataProcessingPrefix',
      'consentDataProcessingSuffix',
      'consentLawName:',
    ]) {
      expect(catalogue).not.toContain(key);
    }
  });
});
