import { describe, expect, it } from 'vitest';

import STUDENT from './student.tsx?raw';
import TEACHER from '../teacher/index.tsx?raw';
import { ar } from '../../i18n/ar.js';

function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/**
 * **A landing page carries a title and a lede, and nothing else.**
 *
 * Both portals' homes had accumulated the two things a placeholder always
 * accumulates: a heading printed twice, and copy promising a screen nobody had
 * designed. The beneficiary's showed «لوحة المستفيدة» from its layout and again
 * as its own `<h1>`, followed by links duplicating the menu beside them; the
 * مؤطرة's said «ستُضاف لوحة مختصرة هنا لاحقاً».
 */
describe('the beneficiary’s landing is its title only (R250)', () => {
  it('R256 — is withdrawn: its address leads to «تقويمي»', () => {
    expect(code(STUDENT)).toContain('/dashboard/student/calendar');
    expect(code(STUDENT)).not.toContain("title={t('studentDashboard.title')}");
  });

  it('offers no second copy of the menu', () => {
    // R85 gave her a portal menu; links to حفظي and نقاطي beside it were the
    // same navigation twice, which makes one of the two the wrong place to look.
    expect(code(STUDENT)).not.toContain('studentDashboard.sections');
    expect(code(STUDENT)).not.toContain("href=\"/dashboard/student/quran\"");
  });

  // R250 (the Owner): «remove any text that is not very valuable … to the
  // navigation» — the sentence repeating what the menu holds is gone.
  it('and no sentence repeats what the menu holds', () => {
    expect('landing' in (ar.studentDashboard as Record<string, unknown>)).toBe(false);
  });
});

describe('the مؤطرة’s landing promises nothing', () => {
  it('says nothing the menu already says (R250)', () => {
    expect('homeLede' in (ar.teacher as Record<string, unknown>)).toBe(false);
  });

  it('and the placeholder is gone from the page AND the catalogue', () => {
    // A dead catalogue entry is not harmless — it ships in the bundle and is
    // exactly what a future screen picks up and renders.
    expect(code(TEACHER)).not.toContain('homeBody');
    expect('homeBody' in (ar.teacher as Record<string, unknown>)).toBe(false);
  });

  it('and no future-placeholder phrasing survives anywhere in the catalogue', () => {
    expect(JSON.stringify(ar)).not.toContain('ستُضاف');
    expect(JSON.stringify(ar)).not.toContain('حتى ذلك الحين');
  });
});
