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
    // R182 §1 — Category-wide Subjects come once, on the Category; R183 §1 —
    // a seasonal course among them is said apart.
    subjects: [
      { id: 's3', name: 'التربية الإسلامية', works_by_surah: false, seasonal: false },
      { id: 's4', name: 'مادة قصيرة', works_by_surah: false, seasonal: true },
    ],
    holds_own_login: false,
    levels: [
      {
        id: 'k1',
        name: 'كتاكيت الأمل',
        description: 'المستوى 0',
        min_age: 6,
        max_age: 7,
        journey_role: 'step',
        memorisation_hizb: null,
        subjects: [
          { id: 's1', name: 'حفظ القرآن', works_by_surah: true, seasonal: false },
          // R183 §1 — a seasonal course by Surah counts for nothing in «حفظ: …».
          { id: 's5', name: 'مادة قصيرة بالسور', works_by_surah: true, seasonal: true },
        ],
        surahs: [{ id: 1, name: 'الفاتحة' }],
      },
      {
        id: 'k2',
        name: 'براعم الأمل',
        description: null,
        min_age: 8,
        max_age: 12,
        journey_role: 'step',
        memorisation_hizb: 5,
        subjects: [],
        surahs: [],
      },
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
      {
        id: 'lit',
        name: 'فرصة أمل',
        description: 'محاربة الأمية',
        min_age: null,
        max_age: null,
        journey_role: 'preparatory',
        memorisation_hizb: null,
        subjects: [{ id: 's9', name: 'القراءة', works_by_surah: false, seasonal: false }],
        surahs: [],
      },
      {
        id: 'w1',
        name: 'وميض الأمل',
        description: null,
        min_age: 18,
        max_age: null,
        journey_role: 'step',
        memorisation_hizb: 10,
        subjects: [
          { id: 's1', name: 'حفظ القرآن', works_by_surah: true, seasonal: false },
          { id: 's2', name: 'تفسير القرآن', works_by_surah: true, seasonal: false },
        ],
        surahs: [1, 2, 3, 4, 5, 6, 7, 8].map((id) => ({ id, name: `سورة ${id}` })),
      },
    ],
  },
  {
    id: 'empty',
    name: 'فئة بلا مستويات',
    description: null,
    min_age: null,
    max_age: null,
    subjects: [],
    holds_own_login: false,
    levels: [],
  },
];
const journey = buildJourney(catalogue);
const html = renderToStaticMarkup(
  <ProgramsJourney journey={journey} onTextView={() => undefined} />,
);

describe('ProgramsJourney', () => {
  it("is a stage per Category, each bearing the Category's name ABOVE its Levels, each a terrace higher", () => {
    expect(html.split('class="journey__stage"').length - 1).toBe(2);
    // R184 §2 — «فئة الطفل»: the name the Super Admin entered, no ordinal.
    expect(html.indexOf('stage__title" id="stage-kids-title">فئة الطفل')).toBeLessThan(
      html.indexOf('كتاكيت الأمل'),
    );
    expect(html.indexOf('stage__title" id="stage-women-title">فئة المرأة')).toBeLessThan(
      html.indexOf('وميض الأمل'),
    );
    expect(html).not.toContain('الفئة 1');
    expect(html).not.toContain('stage__ordinal');
    expect(html).toContain('--terrace:0');
    expect(html).toContain('--terrace:1');
    // R185 §3 — no summit stage of its own: the road ends inside the last Category.
    expect(html).not.toContain('journey__stage--summit');
  });

  it('walks every step in order, right to left, each standing one higher than the last', () => {
    const order = ['كتاكيت الأمل', 'براعم الأمل', 'وميض الأمل'].map((name) => html.indexOf(name));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(html.split('stage__cell stage__cell--stop').length - 1).toBe(3);
    expect(html).toContain('class="stage__cell stage__cell--stop" style="--step:1"');
  });

  it("puts one rising arrow between the steps (R182 §6), and the trophy after each Category's last step", () => {
    expect(html).toContain('id="bodour-arrowhead"');
    expect(html).not.toContain('bodour-shoe-print');
    // The start, the entry, and a walk after every step (to the next one or
    // to the trophy): each one arrow, drawn on by the stylesheet.
    expect(html.split('class="journey__arrowLine"').length - 1).toBe(5);
    expect(html.split('class="journey__chevron"').length - 1).toBeGreaterThanOrEqual(4);
    expect(html.split('stage__cell stage__cell--prize').length - 1).toBe(2);
    expect(html.split('journey__trophy"').length - 1).toBe(1); // R185 §3 — the last Category holds the attire instead
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
    // R184 §2 — no audience words of the page's; the age stays.
    expect(block).not.toContain('للنساء');
    expect(block).not.toContain('للفتيات');
    expect(block).toContain('من 18 سنة');
    expect(block).toContain('برنامج تمهيدي');
    expect(block).toContain('فرصة أمل');
    expect(block).toContain('محاربة الأمية');
    expect(block).toContain('يقود إلى «وميض الأمل»');
    expect(block).toContain('journey__arrow journey__arrow--entry');
    expect(block).toContain('bodour-arrowhead-accent');
    // The first Category has no entrances block, only the neutral start marker.
    expect(html).toContain('نقطة الانطلاق');
    expect(html).not.toContain('ابدئي هنا');
  });

  it('says what a Level is: its ages, description, own Subjects, «حفظ وتفسير: N أحزاب» and its Surahs (R182 §3)', () => {
    expect(html).toContain('من 6 إلى 7 سنوات');
    expect(html).toContain('حفظ القرآن');
    expect(html).toContain('حفظ: سورة واحدة');
    expect(html).toContain('مقرر الحفظ: 5 أحزاب'); // nothing by Surah → the generic words
    expect(html).toContain('حفظ وتفسير: 10 أحزاب');
    expect(html).not.toContain('مقرر الحفظ: 10');
    expect(html).toContain('المستوى 0'); // the Super Admin's description, not a number of the page's
    // R184 §1 — the card is titled by the Level's NAME; no «المستوى N» of the page's.
    const k1 = html.slice(
      html.indexOf('id="journey-level-k1"'),
      html.indexOf('id="journey-level-k2"'),
    );
    expect(k1).toContain('journey__cardTitle" id="journey-level-k1-title">كتاكيت الأمل');
    expect(k1).not.toContain('journey__cardOrdinal');
    expect(html).not.toContain('المستوى 1');
    expect(html).not.toContain('المستوى 2');
    // …the preparatory programme alone keeps its role kicker (a column, R180 §6).
    expect(html.split('journey__cardOrdinal journey__cardOrdinal--prep').length - 1).toBe(1);
    // The Surahs under it — all in the markup; the stylesheet clamps the lines
    // and «…» / «عرض أقل» are offered by measurement in a browser (R185 §2), so
    // a static render carries neither.
    const w1 = html.slice(html.indexOf('id="journey-level-w1"'), html.indexOf('إتمام فئة المرأة'));
    expect(w1).toContain('سورة 1، سورة 2');
    expect(w1).toContain('سورة 8');
    expect(html).not.toContain('journey__surahsMore');
    expect(k1).toContain('الفاتحة');
    // R185 §4 — no «التفاصيل»: everything a reader can know is on the card.
    expect(html).not.toContain('التفاصيل');
    expect(html).not.toContain('journey__more');
  });

  it('names each Category with its derived range and its own description — no audience words (R184 §2) — its shared Subjects in an annexe UNDER the card (R182 §1, R183 §2), and keeps an empty Category off the road', () => {
    expect(html).toContain('من 6 إلى 12 سنة');
    expect(html).not.toContain('للبنات والبنين');
    expect(html).toContain('برنامج الطفل');
    expect(html).not.toContain('فئة بلا مستويات');
    const card = html.slice(html.indexOf('id="stage-kids-title"'), html.indexOf('</header>'));
    // The card keeps only the name, the ages and the description.
    expect(card).not.toContain('مواد مشتركة');
    const annex = html.slice(
      html.indexOf('class="stage__annex"'),
      html.indexOf('id="journey-level-k1"'),
    );
    expect(annex).toContain('مواد مشتركة في كل المستويات:');
    expect(annex).toContain('التربية الإسلامية');
    // R183 §1 — the seasonal course on its own line, never among the programme's.
    expect(annex).toContain('دورات موسمية:');
    expect(annex.indexOf('التربية الإسلامية')).toBeLessThan(annex.indexOf('دورات موسمية:'));
    expect(annex.indexOf('دورات موسمية:')).toBeLessThan(annex.indexOf('مادة قصيرة'));
    // …and not again on each of its Levels.
    expect(html.split('التربية الإسلامية').length - 1).toBe(1);
    expect(html.split('class="stage__annex"').length - 1).toBe(1);
  });

  it("keeps a seasonal course out of a Level's programme and its «حفظ» label (R183 §1)", () => {
    const k1 = html.slice(
      html.indexOf('id="journey-level-k1"'),
      html.indexOf('id="journey-level-k2"'),
    );
    expect(k1).toContain('حفظ: سورة واحدة'); // not «حفظ ومادة قصيرة بالسور»
    expect(k1).toContain('journey__cardRow journey__cardRow--seasonal');
    expect(k1.indexOf('حفظ القرآن')).toBeLessThan(k1.indexOf('دورات موسمية:'));
    expect(k1.indexOf('دورات موسمية:')).toBeLessThan(k1.indexOf('مادة قصيرة بالسور'));
  });

  it('ends inside the last Category: «إتمام الفئة» without «وتواصل الرحلة», then the attire (R185 §1/§3) — and a layered backdrop', () => {
    expect(html).toContain('src="/journey/graduation-attire.jpg"');
    expect(html.split('src="/journey/graduation-attire.jpg"').length - 1).toBe(1);
    // R188 §3 — the attire alone on the road: no caption, no line under it.
    expect(html).not.toContain('متى يحين دورُك؟');
    expect(html).not.toContain('في نهاية الرحلة');
    expect(html).not.toContain('>قمة الرحلة<');
    // The first Category's graduation continues the road; the last one's ends it.
    expect(html).toContain('تُتمّ المتعلّمة برنامج الطفل وتواصل الرحلة.');
    expect(html).toContain('تُتمّ المتعلّمة برنامج المرأة.');
    expect(html).not.toContain('برنامج المرأة وتواصل');
    // R189 — a card like a Level's, in the trophy's cell, on the last stage only:
    // «إتمام الفئة» in the title pill, its words, then the attire.
    const women = html.slice(html.indexOf('data-journey-category="women"'));
    const summitCell = women.slice(women.indexOf('stage__cell--prize stage__cell--summit'));
    // R190 §1 — the same words and style as every other milestone, the whole
    // outfit under them, unframed (no card, no caption).
    expect(summitCell).toContain('class="journey__milestone journey__milestone--summit"');
    expect(summitCell).toContain('journey__milestoneTitle">إتمام الفئة');
    expect(summitCell).not.toContain('journey__attireCaption');
    expect(summitCell.indexOf('تُتمّ المتعلّمة برنامج المرأة.')).toBeLessThan(
      summitCell.indexOf('journey__attire'),
    );
    expect(summitCell).not.toContain('journey__trophy"');
    expect(html.split('stage__cell--summit').length - 1).toBe(1);
    expect(html.split('journey__trophy"').length - 1).toBe(1); // the first Category keeps its trophy
    expect(html).toContain('journey__backdrop');
    expect(html.split('journey__ridge ').length - 1).toBe(3);
  });

  it('offers the full-screen show and the text view beside the arrows (R185 §5, R187 §3), the show closed until asked', () => {
    expect(html).toContain('journey__show');
    expect(html).toContain('عرض بملء الشاشة');
    expect(html).toContain('journey__text');
    // R188 §4 — DOM order is the phone's: the actions, then the chips, then the arrows.
    expect(html.indexOf('journey__actions')).toBeLessThan(html.indexOf('journey__chips'));
    expect(html.indexOf('journey__chips')).toBeLessThan(html.indexOf('journey__arrows'));
    expect(html).not.toContain('class="show ');
  });

  it('fits the road to the viewport on a laptop, never on a phone (R187 §2)', () => {
    expect(JOURNEY_SOURCE).toContain("road.style.zoom = zoom < 0.999 ? zoom.toFixed(3) : ''");
    expect(JOURNEY_SOURCE).toContain("if (window.matchMedia('(max-width: 44rem)').matches) {");
    expect(JOURNEY_SOURCE).toContain("window.addEventListener('resize', fit)");
  });

  it('opens on the adult Category (R182 §7) — the effect reads the marker, never a name', () => {
    expect(JOURNEY_SOURCE).toContain('journey.categories.find((category) => category.adult)');
    expect(html).toContain('data-journey-category="women"');
  });

  it('never moves the page on arrival — the landing page opens at its top (R192 §3)', () => {
    // R183 §3's scroll to the road on a fresh arrival is withdrawn; the road
    // itself still opens on the adult Category (R182 §7), inside its panel.
    expect(JOURNEY_SOURCE).not.toContain('window.scrollTo(');
    expect(JOURNEY_SOURCE).not.toContain("navigation?.type === 'back_forward'");
  });

  it('animates only once the browser has said it can, and never under reduced motion', () => {
    // The stylesheet's side is `scripts/ci/check-journey-css.sh` (`?raw` on
    // a .css file reads nothing here).
    expect(html).not.toContain('journey--animate');
    expect(JOURNEY_SOURCE).toContain(
      "window.matchMedia('(prefers-reduced-motion: reduce)').matches",
    );
    expect(JOURNEY_SOURCE).toContain("entry.target.classList.add('is-walked')");
  });
});

describe('ProgramsTextView — the same journey, to scan', () => {
  const text = renderToStaticMarkup(
    <ProgramsTextView
      open
      onClose={() => undefined}
      journey={journey}
      categories={catalogue}
      focusLevelId="w1"
    />,
  );
  it('lists every Category in journey order with its range and audience, every Level in order, and the empty one honestly', () => {
    for (const name of [
      'الطفل',
      'من 6 إلى 12 سنة',
      'كتاكيت الأمل',
      'براعم الأمل',
      'المرأة',
      'من 18 سنة',
      'فرصة أمل',
      'وميض الأمل',
    ]) {
      expect(text).toContain(name);
    }
    expect(text.indexOf('الطفل')).toBeLessThan(text.indexOf('المرأة'));
    expect(text).toContain('فئة المرأة');
    expect(text).not.toContain('للنساء');
    expect(text).not.toContain('للفتيات');
    expect(text).not.toContain('الفئة 1');
    expect(text).toContain('فئة بلا مستويات');
    expect(text).toContain('لم تُسجَّل مستويات لهذه الفئة بعد.');
    expect(text).toContain('id="programs-text-level-w1"');
    expect(text).toContain('programs-text__level--focus');
    expect(text).toContain('الفاتحة');
    expect(text).toContain('حفظ وتفسير: 10 أحزاب');
    expect(text).toContain('سورة 8');
    // R182 §1 — the shared Subject once, under the Category's name; R183 §1 —
    // the seasonal course on its own line, and out of the «حفظ» label.
    expect(text.split('التربية الإسلامية').length - 1).toBe(1);
    expect(text).toContain('مواد مشتركة في كل المستويات:');
    expect(text.split('دورات موسمية:').length - 1).toBe(2);
    expect(text).toContain('حفظ: سورة واحدة');
  });
});
