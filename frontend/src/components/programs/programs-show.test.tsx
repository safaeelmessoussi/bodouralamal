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

  it('opens on the Categories as cards with their details, one screen', () => {
    const html = render({ kind: 'categories' });
    expect(html).toContain('role="dialog"');
    expect(html).toContain('اختاري فئة لتبدئي رحلتها');
    expect(html).toContain('class="show__category"');
    expect(html).toContain('فئة الطفل');
    expect(html).toContain('من 6 إلى 12 سنة');
    expect(html).toContain('برنامج الطفل');
    expect(html).toContain('التربية الإسلامية');
    expect(html).toContain('إغلاق');
  });

  it('shows one Level card per step, with its dots and «انقري للمتابعة»', () => {
    const html = render({ kind: 'level', categoryId: 'kids', index: 1 });
    expect(html).toContain('id="show-level-k2"');
    expect(html).not.toContain('id="journey-level-'); // never the road's own ids
    expect(html).toContain('براعم الأمل');
    expect(html).not.toContain('كتاكيت الأمل');
    expect(html).toContain('show__dot is-done');
    expect(html).toContain('show__dot is-current');
    expect(html).toContain('انقري للمتابعة');
    expect(html).toContain('>فئة الطفل<');
  });

  it('ends a Category under confetti with the attire, then asks the question over everything', () => {
    const graduation = render({ kind: 'graduation', categoryId: 'kids' });
    expect(graduation).toContain('show__confetti');
    expect(graduation.split('class="show__piece').length - 1).toBe(64);
    expect(graduation).toContain('تُتمّ المتعلّمة برنامج الطفل.');
    expect(graduation).not.toContain('وتواصل الرحلة');
    expect(graduation).toContain('src="/journey/graduation-attire.jpg"');
    expect(graduation).not.toContain('show__question');
    const question = render({ kind: 'question', categoryId: 'kids' });
    expect(question).toContain('show__screen--graduation is-asked');
    expect(question).toContain('class="show__question">متى يحين دورُك؟');
    expect(question).toContain('العودة إلى الفئات');
  });

  it('never advances by itself under reduced motion, and closes on Escape and on leaving full screen', () => {
    expect(SHOW_SOURCE).toContain("state.kind !== 'graduation' || reduced");
    expect(SHOW_SOURCE).toContain("window.matchMedia('(prefers-reduced-motion: reduce)').matches");
    expect(SHOW_SOURCE).toContain("if (event.key === 'Escape') onClose();");
    expect(SHOW_SOURCE).toContain('if (!document.fullscreenElement) onClose();');
  });
});
