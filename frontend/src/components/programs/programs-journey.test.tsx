import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { PublicProgramCategory } from '../../adapters/programs.js';
import { buildJourney } from './journey-model.js';
import { ProgramsJourney } from './programs-journey.js';
import { ProgramsTextView } from './programs-text-view.js';
import JOURNEY_SOURCE from './programs-journey.tsx?raw';

/**
 * **SRS Revision 180 — the road, rendered.** A static render (no
 * IntersectionObserver, no window): what the markup must carry whatever the
 * browser does with it — every step, prints between them, a graduation after
 * each Category's last step, the ways in, the summit — and the text view
 * reading the same journey.
 */
const catalogue: PublicProgramCategory[] = [
  {
    id: 'kids',
    name: 'الطفل',
    description: 'برنامج الطفل',
    min_age: 6,
    max_age: 12,
    levels: [
      { id: 'k1', name: 'كتاكيت الأمل', description: 'المستوى 0', min_age: 6, max_age: 7, journey_role: 'step', subjects: [{ id: 's1', name: 'حفظ القرآن' }], surahs: [{ id: 1, name: 'الفاتحة' }] },
      { id: 'k2', name: 'براعم الأمل', description: null, min_age: 8, max_age: 12, journey_role: 'step', subjects: [], surahs: [] },
    ],
  },
  {
    id: 'women',
    name: 'المرأة',
    description: null,
    min_age: 18,
    max_age: null,
    levels: [
      { id: 'lit', name: 'فرصة أمل', description: 'محاربة الأمية', min_age: null, max_age: null, journey_role: 'preparatory', subjects: [], surahs: [] },
      { id: 'w1', name: 'وميض الأمل', description: null, min_age: 18, max_age: null, journey_role: 'step', subjects: [], surahs: [] },
    ],
  },
  { id: 'empty', name: 'فئة بلا مستويات', description: null, min_age: null, max_age: null, levels: [] },
];
const journey = buildJourney(catalogue);
const html = renderToStaticMarkup(<ProgramsJourney journey={journey} onDetails={() => undefined} />);

describe('ProgramsJourney', () => {
  it('walks every step in order, right to left, each standing one higher than the last', () => {
    const order = ['كتاكيت الأمل', 'براعم الأمل', 'وميض الأمل'].map((name) => html.indexOf(name));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // Cells climb: the first stop stands at 1, the summit highest.
    const steps = [...html.matchAll(/--step:(\d+)/g)].map((m) => Number(m[1]));
    expect(steps[0]).toBe(0);
    expect(steps[steps.length - 1]).toBe(Math.max(...steps));
    expect(html.split('journey__cell--stop').length - 1).toBe(3);
  });

  it('puts shoe prints between the stops, and a graduation hut after each Category\'s last step', () => {
    expect(html).toContain('id="bodour-shoe-print"');
    expect(html.split('journey__cell--walk').length - 1).toBeGreaterThanOrEqual(3);
    expect(html.split('journey__cell--graduation').length - 1).toBe(2);
    expect(html).toContain('إتمام فئة الطفل');
    expect(html).toContain('إتمام فئة المرأة');
    expect(html.split('journey__cell--summit').length - 1).toBe(1);
    // The graduation follows the last step, never a middle one.
    expect(html.indexOf('براعم الأمل')).toBeLessThan(html.indexOf('إتمام فئة الطفل'));
    expect(html.indexOf('إتمام فئة الطفل')).toBeLessThan(html.indexOf('وميض الأمل'));
  });

  it('offers a direct entry into every Category after the first, into its first step only', () => {
    expect(html.split('class="journey__entry journey__walk"').length - 1).toBe(1);
    expect(html.indexOf('التحاق مباشر بالمستوى الأول')).toBeGreaterThan(html.indexOf('إتمام فئة الطفل'));
    expect(html.indexOf('التحاق مباشر بالمستوى الأول')).toBeLessThan(html.indexOf('وميض الأمل'));
    expect(html).toContain('ابدئي هنا');
  });

  it('draws a preparatory programme beside the road, leading into the first step (R180 §6)', () => {
    expect(html.split('journey__prep').length - 1).toBe(1);
    expect(html).toContain('برنامج تمهيدي');
    expect(html).toContain('يقود إلى «وميض الأمل»');
    // Not a step: no ordinal of its own.
    expect(html).not.toContain('المستوى 2</span><span class="journey__cardCategory">المرأة');
  });

  it('says what a Level is: its ages, category, description, Subjects and «مقرر الحفظ»', () => {
    expect(html).toContain('من 6 إلى 7 سنة');
    expect(html).toContain('من 18 سنة');
    expect(html).toContain('حفظ القرآن');
    expect(html).toContain('مقرر الحفظ: 1 سور');
    expect(html).toContain('المستوى 0');
  });

  it('names the Category on its sign with its derived range, and keeps an empty Category off the road', () => {
    expect(html).toContain('من 6 إلى 12 سنة');
    expect(html).not.toContain('فئة بلا مستويات');
  });

  it('animates only once the browser has said it can, and never under reduced motion', () => {
    // The stylesheet's side is `scripts/ci/check-journey-css.sh` (`?raw` on
    // a .css file reads nothing here).
    expect(html).not.toContain('journey--animate');
    expect(JOURNEY_SOURCE).toContain("window.matchMedia('(prefers-reduced-motion: reduce)').matches");
    expect(JOURNEY_SOURCE).toContain("entry.target.classList.add('is-walked')");
  });
});

describe('ProgramsTextView — the same journey, to scan', () => {
  const text = renderToStaticMarkup(
    <ProgramsTextView open onClose={() => undefined} journey={journey} categories={catalogue} focusLevelId="w1" />,
  );
  it('lists every Category in journey order with its range, every Level in order, and the empty one honestly', () => {
    for (const name of ['الطفل', 'من 6 إلى 12 سنة', 'كتاكيت الأمل', 'براعم الأمل', 'المرأة', 'من 18 سنة', 'فرصة أمل', 'وميض الأمل']) {
      expect(text).toContain(name);
    }
    expect(text.indexOf('الطفل')).toBeLessThan(text.indexOf('المرأة'));
    expect(text).toContain('فئة بلا مستويات');
    expect(text).toContain('لم تُسجَّل مستويات لهذه الفئة بعد.');
    expect(text).toContain('id="programs-text-level-w1"');
    expect(text).toContain('programs-text__level--focus');
    expect(text).toContain('الفاتحة');
  });
});
