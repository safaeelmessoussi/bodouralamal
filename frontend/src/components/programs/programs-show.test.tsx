import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { PublicProgramCategory } from '../../adapters/programs.js';
import { buildJourney } from './journey-model.js';
import { ProgramsShow } from './programs-show.js';
import SHOW_SOURCE from './programs-show.tsx?raw';

/**
 * **R185 §5 — the full-screen show, one screen per state.** Static renders
 * from a given state (the browser walk is `scripts/dev/browser/`): the
 * Categories as cards, a Level card with its dots, the graduation under
 * confetti, and the question over it.
 */
const catalogue: PublicProgramCategory[] = [
  {
    id: 'kids',
    name: 'الطفل',
    description: 'برنامج الطفل',
    min_age: 6,
    max_age: 12,
    subjects: [{ id: 's3', name: 'التربية الإسلامية', works_by_surah: false, seasonal: false }],
    holds_own_login: false,
    levels: [
      {
        id: 'k1',
        name: 'كتاكيت الأمل',
        description: 'السنة 1',
        min_age: 6,
        max_age: 7,
        journey_role: 'step',
        memorisation_hizb: 5,
        subjects: [{ id: 's1', name: 'حفظ القرآن', works_by_surah: true, seasonal: false }],
        surahs: [{ id: 1, name: 'الفاتحة' }],
      },
      {
        id: 'k2',
        name: 'براعم الأمل',
        description: null,
        min_age: 8,
        max_age: 12,
        journey_role: 'step',
        memorisation_hizb: null,
        subjects: [],
        surahs: [],
      },
    ],
  },
];
const journey = buildJourney(catalogue);
const render = (initialState: Parameters<typeof ProgramsShow>[0]['initialState']) =>
  renderToStaticMarkup(
    <ProgramsShow journey={journey} open onClose={() => undefined} initialState={initialState} />,
  );

describe('ProgramsShow', () => {
  it('renders nothing while closed', () => {
    expect(
      renderToStaticMarkup(
        <ProgramsShow journey={journey} open={false} onClose={() => undefined} />,
      ),
    ).toBe('');
  });

  it('opens on the Categories as ornamented cards with their details and their path, under the sky', () => {
    const html = render({ kind: 'categories' });
    expect(html).toContain('role="dialog"');
    expect(html).toContain('show__backdrop');
    expect(html.split('journey__ridge ').length - 1).toBe(3);
    expect(html).toContain('اختاري فئة لتبدئي رحلتها');
    expect(html).toContain('class="show__category"');
    expect(html).toContain('show__ornamentStar');
    expect(html).toContain('فئة الطفل');
    expect(html).toContain('من 6 إلى 12 سنة');
    expect(html).toContain('برنامج الطفل');
    // R186 — the way through: the Levels' names in order.
    expect(html.indexOf('show__categoryStep">كتاكيت الأمل')).toBeLessThan(
      html.indexOf('show__categoryStep">براعم الأمل'),
    );
    expect(html).toContain('التربية الإسلامية');
    // R188 §5 — no «ابدئي من هنا» on a card (the card itself is the choice), and
    // no «السابق» on the first screen.
    expect(html).not.toContain('ابدئي من هنا');
    expect(html).not.toContain('class="show__back"');
    expect(html).toContain('إغلاق');
  });

  it('the strip holds every card walked so far, an arrow between, the newest current (R186)', () => {
    const one = render({ kind: 'walk', start: 'kids', at: 0 });
    expect(one).toContain('id="show-level-k1"');
    expect(one).not.toContain('id="show-level-k2"');
    expect(one).not.toContain('show__link');
    expect(one).toContain('show__slideCategory">فئة الطفل');
    expect(one).toContain('show__slide is-current');
    const two = render({ kind: 'walk', start: 'kids', at: 1 });
    expect(two.indexOf('id="show-level-k1"')).toBeLessThan(two.indexOf('id="show-level-k2"'));
    expect(two.split('class="show__link is-walked"').length - 1).toBe(1);
    expect(two).toContain('journey__arrowLine');
    expect(two).not.toContain('id="journey-level-'); // never the road's own ids
    // The first card is no longer current; the second is.
    expect(two.indexOf('show__slide is-current')).toBeGreaterThan(
      two.indexOf('id="show-level-k1"'),
    );
    expect(two).toContain('show__dot is-done');
    expect(two).toContain('show__dot is-current');
    expect(two).toContain('انقري للمتابعة');
    // R188 §5 — «السابق» on every screen after the first.
    expect(two).toContain('class="show__back"');
    expect(two).toContain('السابق');
    expect(render({ kind: 'question' })).toContain('class="show__back"');
  });

  it('ends only after the last Category: confetti, «إتمام الفئة», the attire, then the question', () => {
    const graduation = render({ kind: 'graduation' });
    expect(graduation).toContain('show__confetti');
    expect(graduation.split('class="show__piece').length - 1).toBe(64);
    expect(graduation).toContain('تُتمّ المتعلّمة برنامج الطفل.');
    expect(graduation).not.toContain('وتواصل الرحلة');
    expect(graduation).toContain('src="/journey/graduation-attire.jpg"');
    expect(graduation).not.toContain('show__question');
    const question = render({ kind: 'question' });
    expect(question).toContain('show__screen--graduation is-asked');
    expect(question).toContain('class="show__question">متى يحين دورُك؟');
    expect(question).toContain('العودة إلى الفئات');
  });

  it('never advances by itself under reduced motion, and closes on Escape and on leaving full screen', () => {
    expect(SHOW_SOURCE).toContain("state.kind !== 'graduation' || reduced");
    expect(SHOW_SOURCE).toContain("window.matchMedia('(prefers-reduced-motion: reduce)').matches");
    expect(SHOW_SOURCE).toContain("if (event.key === 'Escape') onClose();");
    expect(SHOW_SOURCE).toContain('if (!document.fullscreenElement) onClose();');
    // R188 §5 — the keys, as the page reads: left forward, right back.
    expect(SHOW_SOURCE).toContain(
      "if (event.key === 'ArrowLeft') setState((s) => advance(journey, s));",
    );
    expect(SHOW_SOURCE).toContain(
      "if (event.key === 'ArrowRight') setState((s) => retreat(journey, s));",
    );
    // R186 — the strip moves to the card just appended.
    expect(SHOW_SOURCE).toContain(
      "node.scrollTo({ left: -node.scrollWidth, behavior: reduced ? 'auto' : 'smooth' });",
    );
  });
});
