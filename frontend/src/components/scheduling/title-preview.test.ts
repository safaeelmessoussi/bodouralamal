import { describe, expect, it } from 'vitest';

import { composeTitlePreview } from './title-preview.js';
import form from './scheduling-form.tsx?raw';
import page from '../../pages/admin/scheduling.tsx?raw';

/**
 * SRS Revision 167 §1 — the form SHOWS the title the server will compose. These
 * are the same three examples `backend/src/lib/item-title.test.ts` holds the
 * server to, so the preview and the real thing cannot drift apart unnoticed.
 */
const parts = {
  typeName: 'حصة دراسية',
  subjectName: 'تفسير القرآن',
  surahNames: ['الفاتحة', 'البقرة'],
  leadName: 'صفاء',
  // R172 §12 — the server's word, handed to the preview; never a copy here.
  teacherHonorific: 'الأستاذة',
  date: '2026-09-22',
  time: '15:00',
};

describe('the previewed title is the server’s wording', () => {
  it('type — Subject — Surah(s) — الأستاذة + main teacher — when', () => {
    expect(composeTitlePreview(parts)).toBe(
      'حصة دراسية — تفسير القرآن — سورة الفاتحة، سورة البقرة — الأستاذة صفاء — الثلاثاء 22 شتنبر 2026 15:00',
    );
  });

  it('a repeating class’s own row carries its time alone', () => {
    expect(composeTitlePreview({ ...parts, date: null })).toBe(
      'حصة دراسية — تفسير القرآن — سورة الفاتحة، سورة البقرة — الأستاذة صفاء — 15:00',
    );
  });

  it('omits what the item does not have — and the honorific with no name', () => {
    expect(
      composeTitlePreview({
        typeName: null,
        subjectName: 'فقه',
        surahNames: [],
        leadName: null,
        teacherHonorific: 'الأستاذة',
        date: '2026-09-22',
        time: null,
      }),
    ).toBe('فقه — الثلاثاء 22 شتنبر 2026');
  });

  it('R172 §12 — the word is not in this file: the page hands it over from `/me/scope-options`', () => {
    const own = form + page;
    expect(own).not.toContain('الأستاذة');
    expect(page).toContain('teacherHonorific: scope.teacherHonorific,');
    // Until it arrives the preview shows the bare name rather than a guessed word.
    expect(composeTitlePreview({ ...parts, teacherHonorific: '' })).toContain(' — صفاء — ');
  });
});

describe('where it is shown', () => {
  it('in the title’s own place, read-only, with a line saying what «الوصف» is for', () => {
    expect(form).toContain('data-generated-title');
    expect(form).toContain("t('scheduling.generatedTitle.hint')");
    // An <output>, not an input: it cannot be typed into and is announced when it changes.
    expect(form).toContain('<output className="field__control field__control--static" aria-live="polite">');
  });

  it('for the kinds that have no typed title — and a paper’s own title for a sitting scheduled from one', () => {
    expect(page).toContain('{...(spec.hasTitle ? {} : { titlePreview })}');
    expect(page).toContain("type === 'exam' && examSource.sourceId !== ''");
  });
});

describe('R178 §4 — the audience and a repeating class’s weekday, mirrored from the server', () => {
  it('names the circle between the Surahs and the teacher, and a weekday instead of a date', () => {
    expect(
      composeTitlePreview({
        typeName: 'حصة',
        subjectName: 'أحكام التجويد',
        surahNames: [],
        audienceName: 'الحلقة 1',
        leadName: 'منى',
        teacherHonorific: 'الأستاذة',
        date: null,
        weekday: 'الخميس',
        time: '09:00',
      }),
    ).toBe('حصة — أحكام التجويد — الحلقة 1 — الأستاذة منى — الخميس 09:00');
  });
});
