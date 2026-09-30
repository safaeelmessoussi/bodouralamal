import { useEffect, useRef, useState, type ReactNode } from 'react';

import type { PublicProgramLevel } from '../../adapters/programs.js';
import { t } from '../../i18n/index.js';
import { Button } from '../ui/button.js';
import { Icon } from '../ui/icon.js';
import { ArrowheadDefs, DirectionArrow } from './direction-arrow.js';
import {
  ageWords,
  levelAgeWords,
  type Journey,
  type JourneyCategory,
  type JourneyStep,
} from './journey-model.js';
import { LevelCard } from './level-card.js';
import { ProgramsShow } from './programs-show.js';
import { SummitFigure } from './summit-figure.js';
import { Trophy } from './trophy.js';

/**
 * **The walked journey** (SRS Revision 180 §1–§2, §5–§9, §11; reshaped by
 * Revision 181 §3–§5 and Revision 182).
 *
 * One road inside a panel that scrolls sideways, right to left as the page
 * reads. Each Category is a STAGE — a card bearing the Category's name above
 * its Levels — and inside it the Levels climb like stairs: every step stands
 * `--journey-rise` higher than the one before, one rising ARROW leads from
 * each step to the next (R182 §6), and the trophy of the Category stands
 * above its last step. Every stage stands one terrace higher than the one
 * before, so the road climbs from the first Category's first step to the
 * summit, where the graduation attire waits. The page itself stays short:
 * the journey is as wide as the catalogue, never as tall as it.
 *
 * Each arrow is drawn on as its walk comes into view (an
 * `IntersectionObserver` on the panel) and simply stands there under
 * `prefers-reduced-motion` or without JavaScript. The panel opens on the
 * adult Category (R182 §7) — most visitors are women — and the road before
 * it is a swipe away.
 *
 * The ways in that come from outside the road — the direct entry into a
 * Category after the first (§5, into its FIRST step only) and a preparatory
 * programme (§6) — stand together in one small «مداخل أخرى» note at the
 * start of the stage (R182 §2), in the road's flow.
 */
export function ProgramsJourney({ journey }: { journey: Journey }): ReactNode {
  const scroller = useRef<HTMLDivElement | null>(null);
  const rise = useRise();
  // R185 §5 — the full-screen show, opened from the road's own controls.
  const [showOpen, setShowOpen] = useState(false);
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

  // R182 §7 — most visitors are women: the panel opens on the adult Category
  // (the one whose beneficiaries hold their own login, R170 §6 — a marker,
  // never a name) when there is one; the road before it is a swipe away.
  // R184 §3 — at its FIRST STEP's card, not at the «مداخل أخرى» note that
  // precedes it: the stage's stuck head stays in view above the card.
  useEffect(() => {
    const root = scroller.current;
    const adult = journey.categories.find((category) => category.adult);
    if (!root || !adult) return;
    const firstStep = adult.steps[0]?.level.id;
    const target =
      (firstStep ? root.querySelector<HTMLElement>(`#journey-level-${firstStep}`) : null) ??
      root.querySelector<HTMLElement>(`[data-journey-category="${adult.id}"]`);
    if (!target) return;
    // Bring its start (right) edge flush to the panel's, without moving the
    // page: nothing of the cell before it shows (R184 §3).
    root.scrollLeft += target.getBoundingClientRect().right - root.getBoundingClientRect().right;
  }, [journey]);

  // R183 §3 — the landing page OPENS on the journey: on a fresh arrival at
  // «/» (no hash, nothing scrolled yet, not a back/forward return) the page
  // is brought to the road so the first thing seen is المرأة's first step
  // under the chips. Once per mount; a visitor who has already scrolled, or
  // who came for another anchor, is never moved.
  const opened = useRef(false);
  useEffect(() => {
    const root = scroller.current;
    if (!root || opened.current || journey.categories.length === 0) return;
    if (window.location.hash !== '' || window.scrollY > 8) return;
    const navigation = performance.getEntriesByType('navigation')[0] as
      PerformanceNavigationTiming | undefined;
    if (navigation?.type === 'back_forward') return;
    opened.current = true;
    const journeyRoot = root.closest<HTMLElement>('.journey');
    if (!journeyRoot) return;
    const header =
      parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-height')) ||
      0;
    const headerPx =
      header * parseFloat(getComputedStyle(document.documentElement).fontSize || '16');
    const top = window.scrollY + journeyRoot.getBoundingClientRect().top - headerPx - 12;
    window.scrollTo({ top: Math.max(0, top), behavior: 'auto' });
  }, [journey]);

  function scrollBy(direction: 1 | -1): void {
    const root = scroller.current;
    if (!root) return;
    // RTL: scrolling "forward" along the road means a more negative scrollLeft.
    root.scrollBy({
      left: -direction * root.clientWidth * 0.8,
      behavior: 'smooth',
    });
  }
  function jumpTo(categoryId: string): void {
    const root = scroller.current;
    const target = root?.querySelector<HTMLElement>(`[data-journey-category="${categoryId}"]`);
    target?.scrollIntoView({
      behavior: 'smooth',
      inline: 'start',
      block: 'nearest',
    });
  }

  return (
    <div className={`journey${animated ? ' journey--animate' : ''}`}>
      <ArrowheadDefs />
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
          {/* R185 §5 — the journey as a full-screen show. The browser's full
              screen is asked for HERE, inside the tap (it is refused
              otherwise); the overlay covers the page either way. */}
          <Button
            variant="secondary"
            className="journey__show"
            icon="expand"
            onClick={() => {
              setShowOpen(true);
              void document.documentElement.requestFullscreen?.().catch(() => undefined);
            }}
          >
            {t('programs.show.open')}
          </Button>
        </div>
      </nav>
      <ProgramsShow journey={journey} open={showOpen} onClose={() => setShowOpen(false)} />

      <div
        ref={scroller}
        className="journey__panel"
        role="region"
        aria-label={t('programs.journey.panelLabel')}
        tabIndex={0}
      >
        <ol className="journey__road" style={{ ['--journey-rise-px' as string]: `${rise}px` }}>
          <Backdrop />
          {journey.categories.map((category, index) => (
            <li
              key={category.id}
              className="journey__stage"
              style={{ ['--terrace' as string]: index }}
              data-journey-category={category.id}
            >
              <Stage category={category} first={index === 0} rise={rise} />
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

/* ── A stage: one Category, its Levels as stairs ────────────────────────── */

function Stage({
  category,
  first,
  rise,
}: {
  category: JourneyCategory;
  first: boolean;
  rise: number;
}): ReactNode {
  const ages = ageWords(category, t);
  const entrances = !first || category.preparatory.length > 0;
  return (
    <section className="stage" aria-labelledby={`stage-${category.id}-title`}>
      {/* The Category's name ABOVE its Levels (R181 §3), and it stays in view
          while the stage scrolls (sticky at the start edge). */}
      <header className="stage__head">
        {/* R184 §2 — «فئة الطفل», then the ages and the Super Admin's own
            description; no ordinal and no audience words of the page's. */}
        <h3 className="stage__title" id={`stage-${category.id}-title`}>
          {t('programs.journey.categoryTitle').replace('{name}', category.name)}
        </h3>
        {ages ? (
          <p className="stage__meta">
            <span className="stage__age">{ages}</span>
          </p>
        ) : null}
        {category.description ? <p className="stage__text">{category.description}</p> : null}
      </header>
      {/* R182 §1 / R183 §2 — the Subjects every step shares, said once, as an
          annexe UNDER the card (the card itself stays small); R183 §1 — the
          seasonal courses on their own line, apart from the programme. */}
      {category.sharedSubjects.length > 0 || category.seasonalSubjects.length > 0 ? (
        <div className="stage__annex">
          {category.sharedSubjects.length > 0 ? (
            <p className="stage__shared">
              <span className="stage__sharedLabel">{t('programs.journey.sharedSubjects')}</span>{' '}
              {category.sharedSubjects.map((subject) => subject.name).join('، ')}
            </p>
          ) : null}
          {category.seasonalSubjects.length > 0 ? (
            <p className="stage__shared stage__shared--seasonal">
              <span className="stage__sharedLabel">{t('programs.seasonalLabel')}</span>{' '}
              {category.seasonalSubjects.map((subject) => subject.name).join('، ')}
            </p>
          ) : null}
        </div>
      ) : null}

      <ol className="stage__body">
        {first ? (
          <li className="stage__cell stage__cell--start" style={{ ['--step' as string]: 0 }}>
            <div className="journey__walk stage__start">
              <p className="stage__startFlag">{t('programs.journey.start')}</p>
              <DirectionArrow
                className="journey__arrow"
                width={84}
                height={rise + 40}
                from={{ x: 78, y: rise + 30 }}
                to={{ x: 10, y: 10 }}
                chevrons={1}
              />
            </div>
          </li>
        ) : null}
        {entrances ? (
          <li className="stage__cell stage__cell--entrances" style={{ ['--step' as string]: 0 }}>
            <Entrances category={category} first={first} rise={rise} />
          </li>
        ) : null}
        {category.steps.map((step, at) => (
          <StepCell key={step.level.id} step={step} at={at} rise={rise} />
        ))}
        <li
          className="stage__cell stage__cell--walk"
          style={{
            ['--step' as string]: Math.max(0, category.steps.length - 1),
          }}
        >
          <Walk rise={rise} />
        </li>
        {/* R185 §3 — on the last Category the road ends: «إتمام الفئة» and
            the attire itself, in place of the trophy. */}
        <li
          className={`stage__cell stage__cell--prize${category.last ? ' stage__cell--summit' : ''}`}
          style={{ ['--step' as string]: category.steps.length }}
        >
          <Prize category={category} />
        </li>
      </ol>
    </section>
  );
}

function StepCell({ step, at, rise }: { step: JourneyStep; at: number; rise: number }): ReactNode {
  return (
    <>
      {at > 0 ? (
        <li className="stage__cell stage__cell--walk" style={{ ['--step' as string]: at - 1 }}>
          <Walk rise={rise} />
        </li>
      ) : null}
      <li className="stage__cell stage__cell--stop" style={{ ['--step' as string]: at }}>
        <LevelCard level={step.level} />
      </li>
    </>
  );
}

/** The way up from one step's foot to the next one's (R182 §6): one rising
 *  arrow, drawn on as its stretch of road comes into view. */
function Walk({ rise }: { rise: number }): ReactNode {
  const width = 84;
  const height = rise + 40;
  return (
    <div className="journey__walk">
      <DirectionArrow
        className="journey__arrow"
        width={width}
        height={height}
        from={{ x: width - 6, y: height - 10 }}
        to={{ x: 8, y: 12 }}
        chevrons={2}
      />
    </div>
  );
}

/**
 * R181 §5 — the ways in that come from OUTSIDE the road, together and in the
 * road's flow, right before the first step: the direct entry (§5 — into the
 * first step only, with who may take it and from what age) and any
 * preparatory programme (§6), then one arrow toward the first step.
 */
function Entrances({
  category,
  first,
  rise,
}: {
  category: JourneyCategory;
  first: boolean;
  rise: number;
}): ReactNode {
  const firstStep = category.steps[0]?.level.name ?? category.name;
  return (
    <div
      className="entrances journey__walk"
      role="group"
      aria-label={t('programs.journey.entrancesLabel')}
    >
      {/* R182 §2 — a note, not a panel: each way in is one or two lines,
          and one arrow from the note to the first step. */}
      <div className="entrances__words">
        <p className="entrances__title">{t('programs.journey.entrancesLabel')}</p>
        {!first ? (
          <p className="entrances__item">
            <span className="entrances__lead">
              {t('programs.journey.directEntryShort').replace('{step}', firstStep)}
            </span>
            {category.minAge !== null ? (
              <span className="entrances__note">
                {t('admin.taxonomy.ageFrom').replace('{min}', String(category.minAge))}
              </span>
            ) : null}
          </p>
        ) : null}
        {category.preparatory.map((level) => (
          <PreparatoryNote key={level.id} level={level} category={category} />
        ))}
      </div>
      <DirectionArrow
        className="journey__arrow journey__arrow--entry"
        accent
        width={64}
        height={rise + 24}
        from={{ x: 58, y: rise + 18 }}
        to={{ x: 8, y: 8 }}
        chevrons={1}
      />
    </div>
  );
}

/** R182 §2 — the preparatory programme as a note: its name, its ages, what
 *  it is and what it leads to (the text view carries it whole). */
function PreparatoryNote({
  level,
  category,
}: {
  level: PublicProgramLevel;
  category: JourneyCategory;
}): ReactNode {
  const ages = levelAgeWords(level, t);
  return (
    <p className="entrances__item" id={`journey-level-${level.id}`}>
      <span className="entrances__lead">
        <span className="journey__cardOrdinal journey__cardOrdinal--prep">
          {t('programs.journey.preparatory')}
        </span>{' '}
        {level.name}
        {ages ? <span className="entrances__age"> — {ages}</span> : null}
      </span>
      <span className="entrances__note">
        {level.description ? `${level.description}. ` : ''}
        {t('programs.journey.preparatoryLeadsTo').replace(
          '{step}',
          category.steps[0]?.level.name ?? category.name,
        )}
      </span>
    </p>
  );
}

/** §8 / R181 §4 — the trophy after a Category's last step; on the LAST
 *  Category (R185 §1/§3) the words end the road («…برنامج المرأة.», no
 *  «وتواصل الرحلة») and the attire stands under them in the trophy's place. */
function Prize({ category }: { category: JourneyCategory }): ReactNode {
  if (category.last) {
    return (
      <div
        className="journey__milestone journey__milestone--summit"
        role="group"
        aria-label={t('programs.journey.graduationLabel').replace('{category}', category.name)}
      >
        <p className="journey__milestoneTitle">{t('programs.journey.graduation')}</p>
        <p className="journey__milestoneText">
          {t('programs.journey.graduationTextLast').replace('{category}', category.name)}
        </p>
        <SummitFigure />
      </div>
    );
  }
  return (
    <div
      className="journey__milestone"
      role="group"
      aria-label={t('programs.journey.graduationLabel').replace('{category}', category.name)}
    >
      <Trophy />
      <p className="journey__milestoneTitle">{t('programs.journey.graduation')}</p>
      <p className="journey__milestoneText">
        {t('programs.journey.graduationText').replace('{category}', category.name)}
      </p>
    </div>
  );
}

/** Layered ridges rising toward the summit (the left, where the road ends),
 *  and a sun — the far country the road climbs through. */
function Backdrop(): ReactNode {
  return (
    <li className="journey__backdropCell" aria-hidden="true">
      <span className="journey__sun" />
      <svg
        className="journey__backdrop"
        viewBox="0 0 1200 400"
        preserveAspectRatio="none"
        focusable="false"
      >
        <path
          d="M0 150 L80 120 L150 160 L240 100 L330 150 L420 110 L520 170 L610 130 L700 175 L800 150 L900 200 L1000 180 L1100 230 L1200 210 L1200 400 L0 400 Z"
          className="journey__ridge journey__ridge--far"
        />
        <path
          d="M0 220 L60 200 L140 240 L230 190 L300 240 L390 210 L470 260 L560 225 L650 270 L740 250 L830 290 L920 270 L1010 310 L1100 300 L1200 330 L1200 400 L0 400 Z"
          className="journey__ridge journey__ridge--mid"
        />
        <path
          d="M0 300 L70 280 L150 320 L250 290 L340 330 L430 310 L520 350 L610 330 L700 360 L790 345 L880 375 L980 360 L1080 385 L1200 375 L1200 400 L0 400 Z"
          className="journey__ridge journey__ridge--near"
        />
      </svg>
    </li>
  );
}

/**
 * How much higher each step stands than the last, per width (§11). Fixed per
 * width since R181 §3: a stage holds one Category's Levels, so the climb
 * inside it is short enough to be steep.
 */
function useRise(): number {
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 44rem)').matches,
  );
  useEffect(() => {
    const query = window.matchMedia('(max-width: 44rem)');
    const update = (): void => setNarrow(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return narrow ? 20 : 26;
}
