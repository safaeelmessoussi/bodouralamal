import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { PublicProgramCategory } from '../../adapters/programs.js';
import { buildJourney } from './journey-model.js';
import { ProgramsJourney } from './programs-journey.js';
import { ProgramsTextView } from './programs-text-view.js';
import JOURNEY_SOURCE from './programs-journey.tsx?raw';

/**
 * **SRS Revision 180/181/182 — the road, rendered.** A static render (no
 * IntersectionObserver, no window): what the markup must carry whatever the
 * browser does with it — a stage per Category bearing its name and its shared
 * Subjects above its Levels, every step, one arrow up to the next, the trophy
 * after the last step, the entrances note with the ways in, the summit — and
 * the text view reading the same journey.
 */
const catalogue: PublicProgramCategory[] = [
  {
    id: 'kids',
    name: 'الطفل',
    description: 'برنامج الطفل',
    min_age: 6,
    max_age: 12,
    // R182 §1 — Category-wide Subjects come once, on the Category.
    subjects: [{ id: 's3', name: 'التربية الإسلامية', works_by_surah: false }],
    holds_own_login: false,
    levels: [
      { id: 'k1', name: 'كتاكيت الأمل', description: 'المستوى 0', min_age: 6, max_age: 7, journey_role: 'step', memorisation_hizb: null, gender_restriction: 'any', subjects: [{ id: 's1', name: 'حفظ القرآن', works_by_surah: true }], surahs: [{ id: 1, name: 'الفاتحة' }] },
      { id: 'k2', name: 'براعم الأمل', description: null, min_age: 8, max_age: 12, journey_role: 'step', memorisation_hizb: 5, gender_restriction: 'any', subjects: [], surahs: [] },
    ],
  },
  {
    id: 'women',
    name: 'المرأة',
    description: null,
    min_age: 18,
    max_age: null,
    subjects: [],
    holds_own_login: true,
    levels: [
      { id: 'lit', name: 'فرصة أمل', description: 'محاربة الأمية', min_age: null, max_age: null, journey_role: 'preparatory', memorisation_hizb: null, gender_restriction: 'girls_only', subjects: [{ id: 's9', name: 'القراءة', works_by_surah: false }], surahs: [] },
      {
        id: 'w1', name: 'وميض الأمل', description: null, min_age: 18, max_age: null, journey_role: 'step', memorisation_hizb: 10, gender_restriction: 'girls_only',
        subjects: [{ id: 's1', name: 'حفظ القرآن', works_by_surah: true }, { id: 's2', name: 'تفسير القرآن', works_by_surah: true }],
        surahs: [1, 2, 3, 4, 5, 6, 7, 8].map((id) => ({ id, name: `سورة ${id}` })),
      },
    ],
  },
  { id: 'empty', name: 'فئة بلا مستويات', description: null, min_age: null, max_age: null, subjects: [], holds_own_login: false, levels: [] },
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

  it('puts one rising arrow between the steps (R182 §6), and the trophy after each Category\'s last step', () => {
    expect(html).toContain('id="bodour-arrowhead"');
    expect(html).not.toContain('bodour-shoe-print');
    // The start, the entry, and a walk after every step (to the next one or
    // to the trophy): each one arrow, drawn on by the stylesheet.
    expect(html.split('class="journey__arrowLine"').length - 1).toBe(5);
    expect(html.split('class="journey__chevron"').length - 1).toBeGreaterThanOrEqual(4);
    expect(html.split('stage__cell stage__cell--prize').length - 1).toBe(2);
    expect(html.split('journey__trophy"').length - 1).toBe(2);
    expect(html).toContain('إتمام فئة الطفل');
    expect(html.indexOf('براعم الأمل')).toBeLessThan(html.indexOf('إتمام فئة الطفل'));
    expect(html.indexOf('إتمام فئة الطفل')).toBeLessThan(html.indexOf('وميض الأمل'));
    // The prize stands one step above the last Level.
    expect(html).toContain('class="stage__cell stage__cell--prize" style="--step:2"');
  });

  it('gathers the ways in — direct entry and the preparatory programme — in one note before the first step (R181 §5, R182 §2)', () => {
    expect(html.split('class="entrances journey__walk"').length - 1).toBe(1);
    const from = html.indexOf('class="entrances journey__walk"');
    const block = html.slice(from, html.indexOf('stage__cell stage__cell--stop', from));
    expect(block).toContain('مداخل أخرى إلى هذه الفئة');
    expect(block).toContain('التحاق مباشر بـ«وميض الأمل»');
    // R182 §5 — an adult Category says «للنساء», never «للفتيات».
    expect(block).toContain('للنساء فقط');
    expect(block).not.toContain('للفتيات');
    expect(block).toContain('من 18 سنة');
    expect(block).toContain('برنامج تمهيدي');
    expect(block).toContain('فرصة أمل');
    expect(block).toContain('محاربة الأمية');
    expect(block).toContain('يقود إلى «وميض الأمل»');
    expect(block).toContain('class="entrances__more"');
    expect(block).toContain('journey__arrow journey__arrow--entry');
    expect(block).toContain('bodour-arrowhead-accent');
    // The first Category has no entrances block, only the neutral start marker.
    expect(html).toContain('نقطة الانطلاق');
    expect(html).not.toContain('ابدئي هنا');
  });

  it('says what a Level is: its ages, description, own Subjects, «حفظ وتفسير: N أحزاب» and its Surahs (R182 §3)', () => {
    expect(html).toContain('من 6 إلى 7 سنة');
    expect(html).toContain('حفظ القرآن');
    expect(html).toContain('حفظ: 1 سور');
    expect(html).toContain('مقرر الحفظ: 5 أحزاب'); // nothing by Surah → the generic words
    expect(html).toContain('حفظ وتفسير: 10 أحزاب');
    expect(html).not.toContain('مقرر الحفظ: 10');
    expect(html).toContain('المستوى 0');
    // The Surahs under it — whole, with «…» offered only past six (the phone clamps).
    const w1 = html.slice(html.indexOf('id="journey-level-w1"'), html.indexOf('إتمام فئة المرأة'));
    expect(w1).toContain('سورة 1، سورة 2');
    expect(w1).toContain('سورة 8');
    expect(w1).toContain('class="journey__surahsMore"');
    const k1 = html.slice(html.indexOf('id="journey-level-k1"'), html.indexOf('id="journey-level-k2"'));
    expect(k1).toContain('الفاتحة');
    expect(k1).not.toContain('journey__surahsMore');
  });

  it('names each Category with its derived range, its audience and its shared Subjects (R182 §1), and keeps an empty Category off the road', () => {
    expect(html).toContain('من 6 إلى 12 سنة');
    expect(html).toContain('للبنات والبنين');
    expect(html).not.toContain('فئة بلا مستويات');
    const head = html.slice(html.indexOf('id="stage-kids-title"'), html.indexOf('id="journey-level-k1"'));
    expect(head).toContain('مواد مشتركة في كل المستويات:');
    expect(head).toContain('التربية الإسلامية');
    // …and not again on each of its Levels.
    expect(html.split('التربية الإسلامية').length - 1).toBe(1);
    expect(html).not.toContain('stage__shared">'.repeat(2));
  });

  it('ends at the summit with the attire the Owner gave — its caption, no title above it (R182 §4) — and a layered backdrop', () => {
    expect(html).toContain('src="/journey/graduation-attire.jpg"');
    expect(html).toContain('متى يحين دورُك؟');
    expect(html).not.toContain('>قمة الرحلة<');
    expect(html).toContain('journey__backdrop');
    expect(html.split('journey__ridge ').length - 1).toBe(3);
  });

  it('opens on the adult Category (R182 §7) — the effect reads the marker, never a name', () => {
    expect(JOURNEY_SOURCE).toContain('journey.categories.find((category) => category.adult)');
    expect(html).toContain('data-journey-category="women"');
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
    expect(text).toContain('للنساء فقط');
    expect(text).not.toContain('للفتيات');
    expect(text).toContain('فئة بلا مستويات');
    expect(text).toContain('لم تُسجَّل مستويات لهذه الفئة بعد.');
    expect(text).toContain('id="programs-text-level-w1"');
    expect(text).toContain('programs-text__level--focus');
    expect(text).toContain('الفاتحة');
    expect(text).toContain('حفظ وتفسير: 10 أحزاب');
    expect(text).toContain('سورة 8');
    // R182 §1 — the shared Subject once, under the Category's name.
    expect(text.split('التربية الإسلامية').length - 1).toBe(1);
    expect(text).toContain('مواد مشتركة في كل المستويات:');
  });
});
