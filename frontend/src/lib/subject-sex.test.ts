import { afterEach, describe, expect, it } from 'vitest';

import { setTextSubject, t } from '../i18n/index.js';

/** SRS Revision 229 — the portal speaks of its subject in her or his own gender. */
afterEach(() => setTextSubject(null));

describe('R229 — «لوحة المستفيدة» / «لوحة المستفيد»', () => {
  it('reads the subject\'s form where a text has one, and the bracket form without a subject', () => {
    expect(t('studentDashboard.title')).toBe('لوحة المستفيد(ة)');
    setTextSubject('female');
    expect(t('studentDashboard.title')).toBe('لوحة المستفيدة');
    expect(t('student.nav.dashboard')).toBe('لوحة المستفيدة');
    expect(t('student.grades.absent')).toBe('غائبة');
    expect(t('quran.completion.complete')).toBe('أتمّت المستوى');
    setTextSubject('male');
    expect(t('studentDashboard.sections')).toBe('أقسام لوحة المستفيد');
    expect(t('roles.student')).toBe('مستفيد');
  });

  it('leaves every text with no gendered form as it is', () => {
    setTextSubject('female');
    expect(t('common.save')).toBe('حفظ');
  });
});
