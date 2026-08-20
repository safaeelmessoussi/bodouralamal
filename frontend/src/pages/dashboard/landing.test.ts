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
describe('the beneficiary’s landing is title + lede only', () => {
  it('prints the heading once — the layout owns it', () => {
    const landing = code(STUDENT).slice(0, code(STUDENT).indexOf('function'));
    expect(code(STUDENT)).toContain('<StudentLayout title={t(\'studentDashboard.title\')} lede=');
    // The duplicate: an `<h1>` repeating the layout's own title.
    expect(landing).not.toContain("<h1>{t('studentDashboard.title')}</h1>");
  });

  it('offers no second copy of the menu', () => {
    // R85 gave her a portal menu; links to حفظي and نقاطي beside it were the
    // same navigation twice, which makes one of the two the wrong place to look.
    expect(code(STUDENT)).not.toContain('studentDashboard.sections');
    expect(code(STUDENT)).not.toContain("href=\"/dashboard/student/quran\"");
  });

  it('and its lede names where the menu leads', () => {
    expect(ar.studentDashboard.landing).toBe(
      'من القائمة تصلين إلى تقويمك ونقاط الامتحانات والمحتوى.',
    );
  });
});

describe('the مؤطرة’s landing promises nothing', () => {
  it('keeps its lede', () => {
    expect(ar.teacher.homeLede).toBe(
      'من القائمة تصلين إلى تقويمك وجداولك ونقاط الامتحانات والمحتوى وإدخال الحفظ.',
    );
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
