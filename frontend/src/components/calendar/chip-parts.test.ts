import { describe, expect, it } from 'vitest';

import type { Occurrence } from '../../adapters/calendar.js';
import { chipTaxonomy, chipText, hiddenChipParts, type ChipDetail } from './chip-parts.js';

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
    category_ids: ['women'],
    category_names: ['المرأة'],
    level_id: 'l1',
    level_name: 'وميض الأمل',
    level_ids: ['l1'],
    level_names: ['وميض الأمل'],
    lead_name: 'فاطمة بوخبزى',
    branch_name: 'مقر أمرشيش',
    branch_names: ['مقر أمرشيش'],
    scheduling_type_name: 'حصة',
    ...over,
  }) as Occurrence;

const texts = (details: ChipDetail[]): string[] => details.map((d) => d.text);
const parts = (details: ChipDetail[]): string[] => details.map((d) => d.part);

describe('hiddenChipParts — one rule for every calendar surface', () => {
  it('hides nothing with no filter, and each part under its own filter', () => {
    expect([...hiddenChipParts({})]).toEqual([]);
    expect([...hiddenChipParts({ branchId: 'b' })]).toEqual(['branch']);
    expect([...hiddenChipParts({ levelId: 'l' })]).toEqual(['level', 'category']);
    expect([...hiddenChipParts({ categoryId: 'c' })]).toEqual(['category']);
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
  it('a class: Subject, then «سورة X» each, the circle, the Level, who leads, the branch — each part typed', () => {
    const text = chipText(session(), new Set());
    expect(text.head).toBe('أحكام التجويد');
    expect(texts(text.details)).toEqual(['سورة الفاتحة', 'سورة البقرة', 'الحلقة 1', 'وميض الأمل', 'فاطمة بوخبزى', 'مقر أمرشيش']);
    expect(parts(text.details)).toEqual(['surah', 'surah', 'audience', 'level', 'lead', 'branch']);
  });

  it('drops the filtered parts, and leads with the next one when the Subject is filtered', () => {
    expect(texts(chipText(session(), new Set(['branch', 'level'])).details)).toEqual([
      'سورة الفاتحة',
      'سورة البقرة',
      'الحلقة 1',
      'فاطمة بوخبزى',
    ]);
    expect(chipText(session(), new Set(['subject', 'surah'])).head).toBe('الحلقة 1');
  });

  /**
   * **R179 §9 (Owner, 2026-09-29) — every Level of a Category reads as the
   * Category.** The taxonomy comes from the surface's own bootstrap; without
   * one, Levels are listed as they come.
   */
  it('names the Category in place of its Levels when the occurrence covers them all', () => {
    const taxonomy = chipTaxonomy(
      [
        { id: 'l1', category_id: 'women' },
        { id: 'l2', category_id: 'women' },
        { id: 'k1', category_id: 'kids' },
      ],
      [
        { id: 'women', name: 'المرأة' },
        { id: 'kids', name: 'الأطفال' },
      ],
    );
    const whole = session({ level_ids: ['l1', 'l2'], level_names: ['وميض الأمل', 'نور الأمل'] });
    expect(texts(chipText(whole, new Set(), taxonomy).details)).toEqual(['سورة الفاتحة', 'سورة البقرة', 'الحلقة 1', 'المرأة', 'فاطمة بوخبزى', 'مقر أمرشيش']);
    expect(parts(chipText(whole, new Set(), taxonomy).details)).toContain('category');
    // One Level short of the Category: the Levels stay listed.
    expect(texts(chipText(session(), new Set(), taxonomy).details)).toContain('وميض الأمل');
    expect(texts(chipText(session(), new Set(), taxonomy).details)).not.toContain('المرأة');
    // Two Categories whole, and one Level of a third, at once.
    const mixed = session({
      category_ids: ['women', 'kids'],
      level_ids: ['l1', 'l2', 'k1', 'x1'],
      level_names: ['وميض الأمل', 'نور الأمل', 'براعم', 'مستوى آخر'],
    });
    expect(texts(chipText(mixed, new Set(), taxonomy).details)).toEqual(['سورة الفاتحة', 'سورة البقرة', 'الحلقة 1', 'المرأة', 'الأطفال', 'مستوى آخر', 'فاطمة بوخبزى', 'مقر أمرشيش']);
    // A Category filter hides the collapsed word; a Level filter hides both.
    expect(texts(chipText(whole, hiddenChipParts({ categoryId: 'women' }), taxonomy).details)).not.toContain('المرأة');
    expect(parts(chipText(mixed, hiddenChipParts({ levelId: 'l1' }), taxonomy).details)).not.toContain('level');
    // No taxonomy: listed as they come.
    expect(texts(chipText(whole, new Set()).details)).toContain('نور الأمل');
  });

  it('a class with nothing but its Subject says its Subject; one with nothing at all keeps its title', () => {
    expect(
      chipText(
        session({ surah_names: [], audience_name: null, level_name: null, level_ids: [], level_names: [], category_ids: [], category_names: [], lead_name: null, branch_name: null, branch_names: [] }),
        new Set(),
      ),
    ).toEqual({ head: 'أحكام التجويد', details: [] });
    expect(chipText(session({ subject_name: null, surah_names: [], audience_name: null, level_name: null, level_ids: [], level_names: [], category_ids: [], category_names: [], lead_name: null, branch_name: null, branch_names: [] }), new Set())).toEqual({
      head: 'أحكام التجويد — الحلقة 1',
      details: [],
    });
  });

  it('an exam leads with its type word, then reads as a class; the word goes under a type filter', () => {
    const exam = session({ kind: 'exam', scheduling_type_name: 'اختبار', surah_names: ['الفاتحة'], lead_name: 'منى حريكي' });
    expect(chipText(exam, new Set()).head).toBe('اختبار');
    expect(texts(chipText(exam, new Set()).details)).toEqual(['أحكام التجويد', 'سورة الفاتحة', 'الحلقة 1', 'وميض الأمل', 'منى حريكي', 'مقر أمرشيش']);
    expect(chipText(exam, new Set(['kind'])).head).toBe('أحكام التجويد');
    // A sitting from before the catalogue still says what it is.
    expect(chipText(session({ kind: 'exam', scheduling_type_name: null }), new Set()).head).toBe('اختبار');
  });

  it('an activity keeps its own title and adds only its Levels (or its Category, when scoped to one) and branches', () => {
    const activity = session({
      kind: 'event',
      title: 'حفل ختم القرآن',
      subject_name: null,
      surah_names: [],
      audience_name: null,
      lead_name: null,
      level_ids: ['l1', 'l2'],
      level_names: ['وميض الأمل', 'نور الأمل'],
      branch_names: ['مقر أمرشيش', 'مقر تاركة'],
    });
    expect(chipText(activity, new Set()).head).toBe('حفل ختم القرآن');
    expect(texts(chipText(activity, new Set()).details)).toEqual(['وميض الأمل', 'نور الأمل', 'مقر أمرشيش', 'مقر تاركة']);
    expect(texts(chipText(activity, new Set(['branch'])).details)).toEqual(['وميض الأمل', 'نور الأمل']);
    // Scoped to the Category itself, with no Level: the Category is named.
    const forWomen = session({ ...activity, level_ids: [], level_names: [], level_name: null });
    expect(texts(chipText(forWomen, new Set()).details)).toEqual(['المرأة', 'مقر أمرشيش', 'مقر تاركة']);
    expect(texts(chipText(forWomen, hiddenChipParts({ categoryId: 'women' })).details)).toEqual(['مقر أمرشيش', 'مقر تاركة']);
  });

  it('reads the singular name where a server sends no plural list', () => {
    expect(texts(chipText(session({ level_ids: [], level_names: [], branch_names: [] }), new Set()).details)).toContain('وميض الأمل');
    expect(texts(chipText(session({ level_ids: [], level_names: [], branch_names: [] }), new Set()).details)).toContain('مقر أمرشيش');
  });
});
