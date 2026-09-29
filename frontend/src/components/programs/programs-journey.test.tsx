import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { PublicProgramCategory } from '../../adapters/programs.js';
import { buildJourney } from './journey-model.js';
import { ProgramsJourney } from './programs-journey.js';
import { ProgramsTextView } from './programs-text-view.js';
import JOURNEY_SOURCE from './programs-journey.tsx?raw';

/**
 * **SRS Revision 180/181 — the road, rendered.** A static render (no
 * IntersectionObserver, no window): what the markup must carry whatever the
 * browser does with it — a stage per Category bearing its name above its
 * Levels, every step, prints up each riser, the trophy after the last step,
 * the entrances block with the ways in, the summit — and the text view
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
      { id: 'k1', name: 'كتاكيت الأمل', description: 'المستوى 0', min_age: 6, max_age: 7, journey_role: 'step', memorisation_hizb: null, gender_restriction: 'any', subjects: [{ id: 's1', name: 'حفظ القرآن' }], surahs: [{ id: 1, name: 'الفاتحة' }] },
      { id: 'k2', name: 'براعم الأمل', description: null, min_age: 8, max_age: 12, journey_role: 'step', memorisation_hizb: 5, gender_restriction: 'any', subjects: [], surahs: [] },
    ],
  },
  {
    id: 'women',
    name: 'المرأة',
    description: null,
    min_age: 18,
    max_age: null,
    levels: [
      { id: 'lit', name: 'فرصة أمل', description: 'محاربة الأمية', min_age: null, max_age: null, journey_role: 'preparatory', memorisation_hizb: null, gender_restriction: 'girls_only', subjects: [{ id: 's9', name: 'القراءة' }], surahs: [] },
      { id: 'w1', name: 'وميض الأمل', description: null, min_age: 18, max_age: null, journey_role: 'step', memorisation_hizb: 10, gender_restriction: 'girls_only', subjects: [], surahs: [] },
    ],
  },
  { id: 'empty', name: 'فئة بلا مستويات', description: null, min_age: null, max_age: null, levels: [] },
];
const journey = buildJourney(catalogue);
const html = renderToStaticMarkup(<ProgramsJourney journey={journey} onDetails={() => undefined} />);

describe('ProgramsJourney', () => {
  it('is a stage per Category, each bearing the Category\'s name ABOVE its Levels, each a terrace higher', () => {
    expect(html.split('class="journey__stage"').length - 1).toBe(2);
    expect(html.indexOf('stage__title" id="stage-kids-title">الطفل')).toBeLessThan(html.indexOf('كتاكيت الأمل'));
    expect(html.indexOf('stage__title" id="stage-women-title">المرأة')).toBeLessThan(html.indexOf('وميض الأمل'));
    expect(html).toContain('--terrace:0');
    expect(html).toContain('--terrace:1');
    expect(html).toContain('journey__stage journey__stage--summit');
  });

  it('walks every step in order, right to left, each standing one higher than the last', () => {
    const order = ['كتاكيت الأمل', 'براعم الأمل', 'وميض الأمل'].map((name) => html.indexOf(name));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(html.split('stage__cell stage__cell--stop').length - 1).toBe(3);
    expect(html).toContain('class="stage__cell stage__cell--stop" style="--step:1"');
  });

  it('puts shoe prints up a riser between the steps, and the trophy after each Category\'s last step', () => {
    expect(html).toContain('id="bodour-shoe-print"');
    expect(html.split('journey__riser"').length - 1).toBeGreaterThanOrEqual(3);
    expect(html.split('stage__cell stage__cell--prize').length - 1).toBe(2);
    expect(html.split('journey__trophy"').length - 1).toBe(2);
    expect(html).toContain('إتمام فئة الطفل');
    expect(html.indexOf('براعم الأمل')).toBeLessThan(html.indexOf('إتمام فئة الطفل'));
    expect(html.indexOf('إتمام فئة الطفل')).toBeLessThan(html.indexOf('وميض الأمل'));
    // The prize stands one step above the last Level.
    expect(html).toContain('class="stage__cell stage__cell--prize" style="--step:2"');
  });

  it('gathers the ways in — direct entry and the preparatory programme — in one block before the first step (R181 §5)', () => {
    expect(html.split('class="entrances"').length - 1).toBe(1);
    const from = html.indexOf('class="entrances"');
    const block = html.slice(from, html.indexOf('stage__cell stage__cell--stop', from));
    expect(block).toContain('مداخل أخرى إلى هذه الفئة');
    expect(block).toContain('التحاق مباشر بـ«وميض الأمل»');
    expect(block).toContain('للفتيات فقط');
    expect(block).toContain('من 18 سنة');
    expect(block).toContain('برنامج تمهيدي');
    expect(block).toContain('فرصة أمل');
    expect(block).toContain('القراءة');
    expect(block).toContain('يقود إلى «وميض الأمل»');
    // The first Category has no entrances block, only the neutral start marker.
    expect(html).toContain('نقطة الانطلاق');
    expect(html).not.toContain('ابدئي هنا');
  });

  it('says what a Level is: its ages, description, Subjects and «مقرر الحفظ» in Hizb where stated', () => {
    expect(html).toContain('من 6 إلى 7 سنة');
    expect(html).toContain('حفظ القرآن');
    expect(html).toContain('مقرر الحفظ: 1 سور');
    expect(html).toContain('مقرر الحفظ: 5 أحزاب');
    expect(html).toContain('مقرر الحفظ: 10 أحزاب');
    expect(html).toContain('المستوى 0');
  });

  it('names each Category with its derived range and its audience, and keeps an empty Category off the road', () => {
    expect(html).toContain('من 6 إلى 12 سنة');
    expect(html).toContain('للبنات والبنين');
    expect(html).not.toContain('فئة بلا مستويات');
  });

  it('ends at the summit with the attire the Owner gave, and a layered backdrop', () => {
    expect(html).toContain('src="/journey/graduation-attire.jpg"');
    expect(html).toContain('متى يحين دورُك؟');
    expect(html).toContain('journey__backdrop');
    expect(html.split('journey__ridge ').length - 1).toBe(3);
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
  it('lists every Category in journey order with its range and audience, every Level in order, and the empty one honestly', () => {
    for (const name of ['الطفل', 'من 6 إلى 12 سنة', 'كتاكيت الأمل', 'براعم الأمل', 'المرأة', 'من 18 سنة', 'فرصة أمل', 'وميض الأمل']) {
      expect(text).toContain(name);
    }
    expect(text.indexOf('الطفل')).toBeLessThan(text.indexOf('المرأة'));
    expect(text).toContain('للفتيات فقط');
    expect(text).toContain('فئة بلا مستويات');
    expect(text).toContain('لم تُسجَّل مستويات لهذه الفئة بعد.');
    expect(text).toContain('id="programs-text-level-w1"');
    expect(text).toContain('programs-text__level--focus');
    expect(text).toContain('الفاتحة');
    expect(text).toContain('مقرر الحفظ: 10 أحزاب');
  });
});
