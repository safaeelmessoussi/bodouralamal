import { describe, expect, it } from 'vitest';

import type { Occurrence } from '../../adapters/calendar.js';
import { chipText, hiddenChipParts } from './chip-parts.js';

/**
 * **R179 §6 (Owner, 2026-09-29) — a month chip says everything the
 * occurrence brings, minus what the surface's filters already say.**
 */
const session = (over: Partial<Occurrence> = {}): Occurrence =>
  ({
    kind: 'session',
    id: 's1',
    title: 'أحكام التجويد — الحلقة 1',
    subject_name: 'أحكام التجويد',
    surah_names: ['الفاتحة', 'البقرة'],
    audience_name: 'الحلقة 1',
    level_name: 'وميض الأمل',
    level_names: ['وميض الأمل'],
    lead_name: 'فاطمة بوخبزى',
    branch_name: 'مقر أمرشيش',
    branch_names: ['مقر أمرشيش'],
    scheduling_type_name: 'حصة',
    ...over,
  }) as Occurrence;

describe('hiddenChipParts — one rule for every calendar surface', () => {
  it('hides nothing with no filter, and each part under its own filter', () => {
    expect([...hiddenChipParts({})]).toEqual([]);
    expect([...hiddenChipParts({ branchId: 'b' })]).toEqual(['branch']);
    expect([...hiddenChipParts({ levelId: 'l' })]).toEqual(['level']);
    expect([...hiddenChipParts({ subjectId: 's' })]).toEqual(['subject']);
    expect([...hiddenChipParts({ surahId: '1' })]).toEqual(['surah']);
    expect([...hiddenChipParts({ groupId: 'g' })]).toEqual(['audience']);
    expect([...hiddenChipParts({ circleId: 'c' })]).toEqual(['audience']);
    expect([...hiddenChipParts({ type: 'exam' })]).toEqual(['kind']);
  });

  it('treats an empty string as «الكل», as every filter hook holds it', () => {
    expect([...hiddenChipParts({ branchId: '', levelId: '', subjectId: '' })]).toEqual([]);
  });
});

describe('chipText — the words, in reading order', () => {
  it('a class: Subject, then «سورة X» each, the circle, the Level, who leads, the branch', () => {
    expect(chipText(session(), new Set())).toEqual({
      head: 'أحكام التجويد',
      details: ['سورة الفاتحة', 'سورة البقرة', 'الحلقة 1', 'وميض الأمل', 'فاطمة بوخبزى', 'مقر أمرشيش'],
    });
  });

  it('drops the filtered parts, and leads with the next one when the Subject is filtered', () => {
    expect(chipText(session(), new Set(['branch', 'level'])).details).toEqual([
      'سورة الفاتحة',
      'سورة البقرة',
      'الحلقة 1',
      'فاطمة بوخبزى',
    ]);
    expect(chipText(session(), new Set(['subject', 'surah'])).head).toBe('الحلقة 1');
  });

  it('a class with nothing but its Subject says its Subject; one with nothing at all keeps its title', () => {
    expect(
      chipText(
        session({ surah_names: [], audience_name: null, level_name: null, level_names: [], lead_name: null, branch_name: null, branch_names: [] }),
        new Set(),
      ),
    ).toEqual({ head: 'أحكام التجويد', details: [] });
    expect(chipText(session({ subject_name: null, surah_names: [], audience_name: null, level_name: null, level_names: [], lead_name: null, branch_name: null, branch_names: [] }), new Set())).toEqual({
      head: 'أحكام التجويد — الحلقة 1',
      details: [],
    });
  });

  it('an exam leads with its type word, then reads as a class; the word goes under a type filter', () => {
    const exam = session({ kind: 'exam', scheduling_type_name: 'اختبار', surah_names: ['الفاتحة'], lead_name: 'منى حريكي' });
    expect(chipText(exam, new Set())).toEqual({
      head: 'اختبار',
      details: ['أحكام التجويد', 'سورة الفاتحة', 'الحلقة 1', 'وميض الأمل', 'منى حريكي', 'مقر أمرشيش'],
    });
    expect(chipText(exam, new Set(['kind'])).head).toBe('أحكام التجويد');
    // A sitting from before the catalogue still says what it is.
    expect(chipText(session({ kind: 'exam', scheduling_type_name: null }), new Set()).head).toBe('اختبار');
  });

  it('an activity keeps its own title and adds only its Levels and branches', () => {
    const activity = session({
      kind: 'event',
      title: 'حفل ختم القرآن',
      subject_name: null,
      surah_names: [],
      audience_name: null,
      lead_name: null,
      level_names: ['وميض الأمل', 'نور الأمل'],
      branch_names: ['مقر أمرشيش', 'مقر تاركة'],
    });
    expect(chipText(activity, new Set())).toEqual({
      head: 'حفل ختم القرآن',
      details: ['وميض الأمل', 'نور الأمل', 'مقر أمرشيش', 'مقر تاركة'],
    });
    expect(chipText(activity, new Set(['branch'])).details).toEqual(['وميض الأمل', 'نور الأمل']);
  });

  it('reads the singular name where a server sends no plural list', () => {
    expect(chipText(session({ level_names: [], branch_names: [] }), new Set()).details).toContain('وميض الأمل');
    expect(chipText(session({ level_names: [], branch_names: [] }), new Set()).details).toContain('مقر أمرشيش');
  });
});
