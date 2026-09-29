import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import type { PublicProgramLevel } from '../../adapters/programs.js';
import { t } from '../../i18n/index.js';
import { Badge } from '../ui/badge.js';
import { Button } from '../ui/button.js';
import { Icon } from '../ui/icon.js';
import { ageWords, levelAgeWords, type Journey, type JourneyCategory, type JourneyStep } from './journey-model.js';
import { PrintPath, ShoePrintSymbol } from './shoe-prints.js';

/**
 * **The walked journey** (SRS Revision 180 §1–§2, §5–§9, §11).
 *
 * One road, climbing from right to left (the page reads right to left) inside
 * a panel that scrolls sideways — so the ascent is real on every width: each
 * stop stands a little higher than the one before, the graduation of a
 * Category stands above its last step, the next Category climbs on from
 * there, and the summit is the highest point. The page itself stays short:
 * the journey is as wide as the catalogue, never as tall as it.
 *
 * Between stops, shoe prints walk from the lower stop up to the next. They
 * appear print by print as a link comes into view (an `IntersectionObserver`
 * on the panel), and all at once — or simply stand there — under
 * `prefers-reduced-motion` or without JavaScript.
 *
 * Beside the road, at every Category after the first, prints arrive from
 * OUTSIDE into the first step (§5, a direct entry — never into a later step),
 * and a preparatory programme (§6) stands below the road with its own prints
 * up into that same first step.
 */
export function ProgramsJourney({
  journey,
  onDetails,
}: {
  journey: Journey;
  /** Open the text view at this Level (R180 §10). */
  onDetails: (levelId: string | null) => void;
}): ReactNode {
  const scroller = useRef<HTMLDivElement | null>(null);
  const stops = useMemo(() => layOut(journey), [journey]);
  // The climb's height in steps (the last cell stands highest), not the cell count.
  const rise = useRise((stops[stops.length - 1]?.step ?? 0) + 1);
  const [animated, setAnimated] = useState(false);

  // §9 — the walk is revealed as the reader scrolls the panel; none of it is
  // animated on load, and none of it moves under reduced motion.
  useEffect(() => {
    const root = scroller.current;
    if (!root || typeof IntersectionObserver === 'undefined') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    setAnimated(true);
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-walked');
            observer.unobserve(entry.target);
          }
        }
      },
      { root, threshold: 0.4 },
    );
    for (const link of root.querySelectorAll('.journey__walk')) observer.observe(link);
    return () => observer.disconnect();
  }, [journey]);

  function scrollBy(direction: 1 | -1): void {
    const root = scroller.current;
    if (!root) return;
    // RTL: scrolling "forward" along the road means a more negative scrollLeft.
    root.scrollBy({ left: -direction * root.clientWidth * 0.8, behavior: 'smooth' });
  }
  function jumpTo(categoryId: string): void {
    const root = scroller.current;
    const target = root?.querySelector<HTMLElement>(`[data-journey-category="${categoryId}"]`);
    target?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
  }

  return (
    <div className={`journey${animated ? ' journey--animate' : ''}`}>
      <ShoePrintSymbol />
      {/* §11 — a way to each Category without swiping through the ones before. */}
      <nav className="journey__nav" aria-label={t('programs.journey.navLabel')}>
        <ul className="journey__chips">
          {journey.categories.map((category) => (
            <li key={category.id}>
              <button type="button" className="journey__chip" onClick={() => jumpTo(category.id)}>
                {category.name}
                {ageWords(category, t) ? (
                  <span className="journey__chipAge">{ageWords(category, t)}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
        <div className="journey__arrows">
          <Button
            variant="secondary"
            className="journey__arrow journey__arrow--back"
            onClick={() => scrollBy(-1)}
            aria-label={t('programs.journey.back')}
          >
            <Icon name="chevron" size={16} />
          </Button>
          <Button
            variant="secondary"
            className="journey__arrow journey__arrow--forward"
            onClick={() => scrollBy(1)}
            aria-label={t('programs.journey.forward')}
          >
            <Icon name="chevron" size={16} />
          </Button>
        </div>
      </nav>

      <div
        ref={scroller}
        className="journey__panel"
        role="region"
        aria-label={t('programs.journey.panelLabel')}
        tabIndex={0}
      >
        <ol className="journey__road" style={{ ['--journey-rise-px' as string]: `${rise}px` }}>
          {stops.map((stop) => (
            <li
              key={stop.key}
              className={`journey__cell journey__cell--${stop.kind}`}
              style={{ ['--step' as string]: stop.step }}
              {...(stop.kind === 'junction' ? { 'data-journey-category': stop.category.id } : {})}
            >
              {stop.kind === 'junction' ? (
                <Junction stop={stop} rise={rise} onDetails={onDetails} />
              ) : stop.kind === 'stop' ? (
                <StepCard step={stop.stepData} onDetails={onDetails} />
              ) : stop.kind === 'walk' ? (
                <Walk rise={rise} />
              ) : stop.kind === 'graduation' ? (
                <Graduation category={stop.category} />
              ) : (
                <Summit />
              )}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

/* ── The road, cell by cell ─────────────────────────────────────────────── */

type Cell =
  | { kind: 'junction'; key: string; step: number; category: JourneyCategory; first: boolean }
  | { kind: 'stop'; key: string; step: number; stepData: JourneyStep }
  | { kind: 'walk'; key: string; step: number }
  | { kind: 'graduation'; key: string; step: number; category: JourneyCategory }
  | { kind: 'summit'; key: string; step: number };

/**
 * One climbing sequence: `step` is how high a cell stands — every stop,
 * graduation and the summit one higher than the last; a walk stands at the
 * height it leaves from and climbs one; a junction likewise.
 */
function layOut(journey: Journey): Cell[] {
  const cells: Cell[] = [];
  let height = 0;
  journey.categories.forEach((category, index) => {
    cells.push({ kind: 'junction', key: `j-${category.id}`, step: height, category, first: index === 0 });
    height += 1;
    category.steps.forEach((step, at) => {
      if (at > 0) {
        cells.push({ kind: 'walk', key: `w-${step.level.id}`, step: height });
        height += 1;
      }
      cells.push({ kind: 'stop', key: `s-${step.level.id}`, step: height, stepData: step });
    });
    cells.push({ kind: 'walk', key: `wg-${category.id}`, step: height });
    height += 1;
    cells.push({ kind: 'graduation', key: `g-${category.id}`, step: height, category });
  });
  if (journey.categories.length > 0) {
    cells.push({ kind: 'walk', key: 'w-summit', step: height });
    height += 1;
    cells.push({ kind: 'summit', key: 'summit', step: height });
  }
  return cells;
}

/** Prints from the previous stop's foot up to the next one's. */
function Walk({ rise }: { rise: number }): ReactNode {
  const width = 96;
  const height = rise + 36;
  return (
    <div className="journey__walk">
      <PrintPath
        className="journey__prints"
        width={width}
        height={height}
        from={{ x: width - 6, y: height - 10 }}
        to={{ x: 6, y: 12 }}
        stride={26}
        size={20}
      />
    </div>
  );
}

/**
 * Where a Category begins: the signpost (name, ages, description), the way in
 * — the start flag for the first Category, prints from outside for every
 * later one (§5) — and any preparatory programme leading into the first step
 * (§6). The road's own prints from the previous graduation pass above.
 */
function Junction({
  stop,
  rise,
  onDetails,
}: {
  stop: Extract<Cell, { kind: 'junction' }>;
  rise: number;
  onDetails: (levelId: string | null) => void;
}): ReactNode {
  const { category, first } = stop;
  const width = 150;
  const roadHeight = rise + 36;
  const entryWidth = 64;
  const entryHeight = 84;
  const ages = ageWords(category, t);
  return (
    <div className="journey__junction">
      {first ? <p className="journey__start">{t('programs.journey.start')}</p> : null}
      <div className="journey__sign">
        <p className="journey__signCategory">
          <span className="journey__signOrdinal" aria-hidden="true">
            {category.position}
          </span>
          {category.name}
        </p>
        {ages ? <p className="journey__signAge">{ages}</p> : null}
        {category.description ? <p className="journey__signText">{category.description}</p> : null}
      </div>
      {first ? (
        <div className="journey__walk journey__walk--start">
          <PrintPath
            className="journey__prints"
            width={width}
            height={roadHeight}
            from={{ x: width - 8, y: roadHeight - 10 }}
            to={{ x: 8, y: 12 }}
            stride={26}
            size={20}
          />
        </div>
      ) : (
        <div className="journey__walk">
          <PrintPath
            className="journey__prints"
            width={width}
            height={roadHeight}
            from={{ x: width - 8, y: roadHeight - 10 }}
            to={{ x: 8, y: 12 }}
            stride={26}
            size={20}
          />
        </div>
      )}
      {!first ? (
        <div className="journey__entry journey__walk">
          <p className="journey__entryText">
            {t('programs.journey.directEntryShort')}
            {category.minAge !== null ? (
              <span className="journey__entryAge">
                {t('admin.taxonomy.ageFrom').replace('{min}', String(category.minAge))}
              </span>
            ) : null}
          </p>
          <PrintPath
            className="journey__prints journey__prints--entry"
            width={entryWidth}
            height={entryHeight}
            from={{ x: entryWidth - 12, y: entryHeight - 6 }}
            to={{ x: 12, y: 10 }}
            stride={24}
            size={18}
          />
        </div>
      ) : null}
      {category.preparatory.map((level) => (
        <PreparatoryCard key={level.id} level={level} category={category} onDetails={onDetails} />
      ))}
    </div>
  );
}

function StepCard({
  step,
  onDetails,
}: {
  step: JourneyStep;
  onDetails: (levelId: string | null) => void;
}): ReactNode {
  const { level, category } = step;
  const ages = levelAgeWords(level, t);
  return (
    <article className="journey__card" id={`journey-level-${level.id}`} aria-labelledby={`journey-level-${level.id}-title`}>
      <p className="journey__cardKicker">
        <span className="journey__cardOrdinal">
          {t('programs.journey.stepOrdinal').replace('{n}', String(step.position))}
        </span>
        <span className="journey__cardCategory">{category.name}</span>
      </p>
      <h4 className="journey__cardTitle" id={`journey-level-${level.id}-title`}>
        {level.name}
      </h4>
      {ages ? <p className="journey__cardAge">{ages}</p> : null}
      {level.description ? <p className="journey__cardText">{level.description}</p> : null}
      {level.subjects.length > 0 ? (
        <p className="journey__cardRow journey__cardRow--wide">
          {level.subjects.map((subject) => (
            <Badge key={subject.id}>{subject.name}</Badge>
          ))}
        </p>
      ) : null}
      {level.surahs.length > 0 ? (
        <p className="journey__cardRow journey__cardRow--muted journey__cardRow--wide">
          {t('programs.journey.surahCount').replace('{n}', String(level.surahs.length))}
        </p>
      ) : null}
      {/* §11 — a phone says how much, and the text view says what. */}
      {level.subjects.length > 0 || level.surahs.length > 0 ? (
        <p className="journey__cardRow journey__cardRow--muted journey__cardSummary">
          {[
            level.subjects.length > 0
              ? t('programs.journey.subjectCount').replace('{n}', String(level.subjects.length))
              : null,
            level.surahs.length > 0
              ? t('programs.journey.surahCount').replace('{n}', String(level.surahs.length))
              : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      ) : null}
      <Button variant="ghost" className="journey__more" onClick={() => onDetails(level.id)}>
        {t('programs.journey.details')}
      </Button>
    </article>
  );
}

function PreparatoryCard({
  level,
  category,
  onDetails,
}: {
  level: PublicProgramLevel;
  category: JourneyCategory;
  onDetails: (levelId: string | null) => void;
}): ReactNode {
  const ages = levelAgeWords(level, t);
  const width = 150;
  const height = 60;
  return (
    <div className="journey__prep journey__walk">
      <PrintPath
        className="journey__prints journey__prints--prep"
        width={width}
        height={height}
        from={{ x: width * 0.5, y: height - 6 }}
        to={{ x: 14, y: 8 }}
        stride={24}
        size={17}
      />
      <article className="journey__card journey__card--prep" id={`journey-level-${level.id}`}>
        <p className="journey__cardKicker">
          <span className="journey__cardOrdinal journey__cardOrdinal--prep">{t('programs.journey.preparatory')}</span>
          <span className="journey__cardCategory">{category.name}</span>
        </p>
        <h4 className="journey__cardTitle">{level.name}</h4>
        {ages ? <p className="journey__cardAge">{ages}</p> : null}
        {level.description ? <p className="journey__cardText">{level.description}</p> : null}
        <p className="journey__cardRow journey__cardRow--muted">
          {t('programs.journey.preparatoryLeadsTo').replace(
            '{step}',
            category.steps[0]?.level.name ?? category.name,
          )}
        </p>
        <Button variant="ghost" className="journey__more" onClick={() => onDetails(level.id)}>
          {t('programs.journey.details')}
        </Button>
      </article>
    </div>
  );
}

/** §8 — the graduation after a Category's last step: a hut with a cap. */
function Graduation({ category }: { category: JourneyCategory }): ReactNode {
  return (
    <div className="journey__milestone" role="group" aria-label={t('programs.journey.graduationLabel').replace('{category}', category.name)}>
      <svg className="journey__hut" viewBox="0 0 96 80" width="96" height="80" aria-hidden="true" focusable="false">
        {/* The hut: a roof, walls, a doorway. */}
        <path d="M8 40 L48 12 L88 40 Z" className="journey__hutRoof" />
        <rect x="18" y="40" width="60" height="34" rx="3" className="journey__hutWall" />
        <rect x="40" y="52" width="16" height="22" rx="2" className="journey__hutDoor" />
        {/* The cap on the roof: the mortarboard and its tassel. */}
        <path d="M32 18 L48 11 L64 18 L48 25 Z" className="journey__cap" />
        <path d="M48 25 v6 M40 21.5 v5 q0 4 8 4 q8 0 8 -4 v-5" className="journey__capBrim" />
      </svg>
      <p className="journey__milestoneTitle">{t('programs.journey.graduation')}</p>
      <p className="journey__milestoneText">
        {t('programs.journey.graduationText').replace('{category}', category.name)}
      </p>
    </div>
  );
}

/** The highest point: what the whole road climbs toward. */
function Summit(): ReactNode {
  return (
    <div className="journey__milestone journey__milestone--summit" role="group" aria-label={t('programs.journey.summit')}>
      <svg className="journey__peak" viewBox="0 0 96 80" width="96" height="80" aria-hidden="true" focusable="false">
        <path d="M6 76 L40 20 L54 40 L66 26 L92 76 Z" className="journey__peakRock" />
        <path d="M40 20 L47 32 L54 40 L58 34 L66 26 L60 44 L46 46 Z" className="journey__peakSnow" />
        <path d="M66 26 v-18 h14 l-4 5 4 5 h-14" className="journey__flag" />
      </svg>
      <p className="journey__milestoneTitle">{t('programs.journey.summit')}</p>
      <p className="journey__milestoneText">{t('programs.journey.summitText')}</p>
    </div>
  );
}

/**
 * How much higher each cell stands than the last (§11): a clear step on a
 * laptop, a smaller one on a phone — and never so much, over a long
 * catalogue, that the panel grows past its climb. Exported for its test.
 */
export function riseFor(steps: number, narrow: boolean): number {
  const budget = narrow ? 220 : 320;
  const ceiling = narrow ? 12 : 16;
  return Math.max(6, Math.min(ceiling, Math.floor(budget / Math.max(1, steps - 1))));
}
function useRise(steps: number): number {
  const narrow = (): boolean =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 44rem)').matches;
  const [isNarrow, setIsNarrow] = useState(narrow);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 44rem)');
    const update = (): void => setIsNarrow(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return riseFor(steps, isNarrow);
}
