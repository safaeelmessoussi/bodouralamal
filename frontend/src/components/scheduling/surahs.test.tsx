import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  SurahField,
  SurahsField,
  subjectWorksBySurah,
  surahChoices,
} from './surahs.js';
import schedulingPage from '../../pages/admin/scheduling.tsx?raw';
import sessionsPage from '../../pages/admin/schedule-sessions.tsx?raw';
import schedulingAdapter from '../../adapters/scheduling.ts?raw';
import { STRUCTURAL_KIND_SPECS } from '../../adapters/scheduling-types.js';

/**
 * SRS Revision 165 §2/§5 — «أي سورة؟». The server owns the rule
 * (`resolveSurahs`, integration-tested); these hold the form to offering what
 * that rule will accept and to the title the Owner asked for.
 */
const FACTS = {
  // A column the server sends — `s-fiqh` is deliberately NAMED like a Quran
  // Subject nowhere, and nothing here reads a name.
  subjectsBySurah: new Set(['s-tafseer', 's-hifz']),
  levelSurahIds: { 'l-1': [2, 1], 'l-2': [2, 3], 'l-empty': [] },
  surahNames: { 1: 'الفاتحة', 2: 'البقرة', 3: 'آل عمران' },
};

describe('which Surahs are on offer', () => {
  it('the «مقرر الحفظ» of the Levels in play — once each, in Mushaf order', () => {
    expect(surahChoices(FACTS, ['l-1', 'l-2'])).toEqual([
      { id: 1, name: 'الفاتحة' },
      { id: 2, name: 'البقرة' },
      { id: 3, name: 'آل عمران' },
    ]);
    expect(surahChoices(FACTS, ['l-2']).map((s) => s.id)).toEqual([2, 3]);
  });

  it('nothing for a Level whose syllabus is empty — and the field says where to fix that', () => {
    expect(surahChoices(FACTS, ['l-empty'])).toEqual([]);
    const html = renderToStaticMarkup(
      <SurahsField facts={FACTS} levelIds={['l-empty']} selected={[]} onChange={() => {}} />,
    );
    expect(html).toContain('مقرر الحفظ');
    expect(html).toContain('مديرة النظام');
  });

  it('is asked by the Subject’s own marker, never by its name', () => {
    expect(subjectWorksBySurah(FACTS, 's-tafseer')).toBe(true);
    expect(subjectWorksBySurah(FACTS, 's-fiqh')).toBe(false);
    expect(subjectWorksBySurah(FACTS, '')).toBe(false);
  });
});

describe('the fields', () => {
  it('a class names one or more — and the trigger names them (R165 §7), not a count', () => {
    const html = renderToStaticMarkup(
      <SurahsField facts={FACTS} levelIds={['l-1', 'l-2']} selected={[3, 1]} onChange={() => {}} />,
    );
    expect(html).toContain('الفاتحة، آل عمران');
    expect(html).not.toContain('محددة');
  });

  it('an exam names exactly one', () => {
    const html = renderToStaticMarkup(
      <SurahField facts={FACTS} levelIds={['l-1']} value={2} onChange={() => {}} />,
    );
    expect(html).toContain('<select');
    expect(html).toContain('البقرة');
    // Any number of sittings may examine the same Surah — said on the field.
    expect(html).toContain('عدة اختبارات للسورة نفسها');
  });
});

describe('SRS Revision 166 §3 — a class and an exam are CALLED what they are; nobody types it', () => {
  it('only an activity and a holiday still have a typed title — theirs is their identity', () => {
    expect(STRUCTURAL_KIND_SPECS.class.hasTitle).toBe(false);
    expect(STRUCTURAL_KIND_SPECS.exam.hasTitle).toBe(false);
    expect(STRUCTURAL_KIND_SPECS.activity.hasTitle).toBe(true);
    expect(STRUCTURAL_KIND_SPECS.holiday.hasTitle).toBe(true);
  });

  it('the form neither suggests nor sends a class title, and asks for one only where the kind has one', () => {
    expect(schedulingPage).not.toContain('titleSuggestion');
    expect(schedulingPage).toContain("if (spec.hasTitle && title.trim() === '') return t('scheduling.invalid.title');");
    // The class branches of the one save build no `title` key at all.
    const classBranch = schedulingAdapter.slice(
      schedulingAdapter.indexOf("if (input.type === 'class') {"),
      schedulingAdapter.indexOf("if (input.type === 'exam') {"),
    );
    expect(classBranch).not.toContain('title:');
  });

  it('«تعديل الحصة» SHOWS the composed title and asks for «الوصف» instead', () => {
    expect(sessionsPage).toContain("<strong>{t('scheduling.title')}:</strong> {session.title}");
    expect(sessionsPage).not.toContain("<TextField label={t('scheduling.title')}");
  });
});

describe('the forms that ask', () => {
  it('«إضافة عنصر» requires a Surah of a by-Surah class and exam', () => {
    expect(schedulingPage).toContain("if (asksSurahs && surahIds.length === 0) return t('scheduling.invalid.surahs');");
    expect(schedulingPage).toContain("return t('scheduling.invalid.examSurah');");
    // Sent only for the kind that owns the key, and only when it was asked.
    expect(schedulingPage).toContain("type === 'class' && asksSurahs ? { surahIds }");
    expect(schedulingPage).toContain("type === 'exam' && asksSurahs ? { examSurahId: surahIds[0] ?? null }");
  });

  it('the occurrence editor offers «السور» on all three scopes, and an unchanged choice is not an override', () => {
    expect(sessionsPage).toContain('{token && asksSurahs ? (');
    expect(sessionsPage).toContain("surah_ids: scope === 'this_session' && sameAsClass ? [] : surahIds");
    // A class scheduled before the rule, at a Level with no syllabus yet, stays
    // editable: nothing is asked of it and nothing is sent.
    expect(sessionsPage).toContain('const sendsSurahs = token !== null && asksSurahs && surahsOnOffer;');
  });
});
