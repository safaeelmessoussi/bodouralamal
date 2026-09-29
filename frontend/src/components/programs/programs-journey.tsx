import { useEffect, useRef, useState, type ReactNode } from 'react';

import type { PublicProgramLevel } from '../../adapters/programs.js';
import { t } from '../../i18n/index.js';
import { Badge } from '../ui/badge.js';
import { Button } from '../ui/button.js';
import { Icon } from '../ui/icon.js';
import { ArrowheadDefs, DirectionArrow } from './direction-arrow.js';
import {
  ageWords,
  audienceKey,
  levelAgeWords,
  memorisationWords,
  type Journey,
  type JourneyCategory,
  type JourneyStep,
} from './journey-model.js';

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
export function ProgramsJourney({
  journey,
  onDetails,
}: {
  journey: Journey;
  /** Open the text view at this Level (R180 §10). */
  onDetails: (levelId: string | null) => void;
}): ReactNode {
  const scroller = useRef<HTMLDivElement | null>(null);
  const rise = useRise();
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
  useEffect(() => {
    const root = scroller.current;
    const adult = journey.categories.find((category) => category.adult);
    if (!root || !adult) return;
    const target = root.querySelector<HTMLElement>(`[data-journey-category="${adult.id}"]`);
    if (!target) return;
    // Bring its start (right) edge to the panel's, without moving the page.
    root.scrollLeft +=
      target.getBoundingClientRect().right - root.getBoundingClientRect().right + 24;
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
          <Backdrop />
          {journey.categories.map((category, index) => (
            <li
              key={category.id}
              className="journey__stage"
              style={{ ['--terrace' as string]: index }}
              data-journey-category={category.id}
            >
              <Stage category={category} first={index === 0} rise={rise} onDetails={onDetails} />
            </li>
          ))}
          {journey.categories.length > 0 ? (
            <li
              className="journey__stage journey__stage--summit"
              style={{ ['--terrace' as string]: journey.categories.length }}
            >
              <Summit />
            </li>
          ) : null}
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
  onDetails,
}: {
  category: JourneyCategory;
  first: boolean;
  rise: number;
  onDetails: (levelId: string | null) => void;
}): ReactNode {
  const ages = ageWords(category, t);
  const entrances = !first || category.preparatory.length > 0;
  return (
    <section className="stage" aria-labelledby={`stage-${category.id}-title`}>
      {/* The Category's name ABOVE its Levels (R181 §3), and it stays in view
          while the stage scrolls (sticky at the start edge). */}
      <header className="stage__head">
        <p className="stage__ordinal" aria-hidden="true">
          {t('programs.journey.categoryOrdinal').replace('{n}', String(category.position))}
        </p>
        <h3 className="stage__title" id={`stage-${category.id}-title`}>
          {category.name}
        </h3>
        <p className="stage__meta">
          {ages ? <span className="stage__age">{ages}</span> : null}
          <span className="stage__audience">
            {t(`programs.journey.audience.${audienceKey(category)}`)}
          </span>
        </p>
        {category.description ? <p className="stage__text">{category.description}</p> : null}
        {/* R182 §1 — the Subjects every step shares, said once here. */}
        {category.sharedSubjects.length > 0 ? (
          <p className="stage__shared">
            <span className="stage__sharedLabel">{t('programs.journey.sharedSubjects')}</span>{' '}
            {category.sharedSubjects.map((subject) => subject.name).join('، ')}
          </p>
        ) : null}
      </header>

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
            <Entrances category={category} first={first} rise={rise} onDetails={onDetails} />
          </li>
        ) : null}
        {category.steps.map((step, at) => (
          <StepCell key={step.level.id} step={step} at={at} rise={rise} onDetails={onDetails} />
        ))}
        <li
          className="stage__cell stage__cell--walk"
          style={{
            ['--step' as string]: Math.max(0, category.steps.length - 1),
          }}
        >
          <Walk rise={rise} />
        </li>
        <li
          className="stage__cell stage__cell--prize"
          style={{ ['--step' as string]: category.steps.length }}
        >
          <Prize category={category} />
        </li>
      </ol>
    </section>
  );
}

function StepCell({
  step,
  at,
  rise,
  onDetails,
}: {
  step: JourneyStep;
  at: number;
  rise: number;
  onDetails: (levelId: string | null) => void;
}): ReactNode {
  return (
    <>
      {at > 0 ? (
        <li className="stage__cell stage__cell--walk" style={{ ['--step' as string]: at - 1 }}>
          <Walk rise={rise} />
        </li>
      ) : null}
      <li className="stage__cell stage__cell--stop" style={{ ['--step' as string]: at }}>
        <StepCard step={step} onDetails={onDetails} />
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
  onDetails,
}: {
  category: JourneyCategory;
  first: boolean;
  rise: number;
  onDetails: (levelId: string | null) => void;
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
            <span className="entrances__note">
              {t(`programs.journey.audienceEntry.${audienceKey(category)}`)}
              {category.minAge !== null
                ? ` — ${t('admin.taxonomy.ageFrom').replace('{min}', String(category.minAge))}`
                : ''}
            </span>
          </p>
        ) : null}
        {category.preparatory.map((level) => (
          <PreparatoryNote key={level.id} level={level} category={category} onDetails={onDetails} />
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
 *  it is, and «التفاصيل» for the rest (the text view carries it whole). */
function PreparatoryNote({
  level,
  category,
  onDetails,
}: {
  level: PublicProgramLevel;
  category: JourneyCategory;
  onDetails: (levelId: string | null) => void;
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
        )}{' '}
        <button type="button" className="entrances__more" onClick={() => onDetails(level.id)}>
          {t('programs.journey.details')}
        </button>
      </span>
    </p>
  );
}

function StepCard({
  step,
  onDetails,
}: {
  step: JourneyStep;
  onDetails: (levelId: string | null) => void;
}): ReactNode {
  const { level } = step;
  const ages = levelAgeWords(level, t);
  const memorisation = memorisationWords(level, t);
  return (
    <article
      className="journey__card"
      id={`journey-level-${level.id}`}
      aria-labelledby={`journey-level-${level.id}-title`}
    >
      <p className="journey__cardKicker">
        <span className="journey__cardOrdinal">
          {t('programs.journey.stepOrdinal').replace('{n}', String(step.position))}
        </span>
        {ages ? <span className="journey__cardAge">{ages}</span> : null}
      </p>
      <h4 className="journey__cardTitle" id={`journey-level-${level.id}-title`}>
        {level.name}
      </h4>
      {level.description ? <p className="journey__cardText">{level.description}</p> : null}
      {level.subjects.length > 0 ? (
        <p className="journey__cardRow">
          <span className="journey__cardRowLabel">{t('programs.subjectsLabel')}</span>
          {level.subjects.map((subject) => (
            <Badge key={subject.id}>{subject.name}</Badge>
          ))}
        </p>
      ) : null}
      {memorisation ? <p className="journey__cardMemo">{memorisation}</p> : null}
      <SurahList level={level} />
      <Button variant="ghost" className="journey__more" onClick={() => onDetails(level.id)}>
        {t('programs.journey.details')}
      </Button>
    </article>
  );
}

/**
 * R182 §3 — the Level's Surahs under «حفظ وتفسير: N أحزاب», whole on a
 * laptop; on a phone the first lines, then «…» which opens the rest.
 */
function SurahList({ level }: { level: PublicProgramLevel }): ReactNode {
  const [expanded, setExpanded] = useState(false);
  if (level.surahs.length === 0) return null;
  return (
    <p className={`journey__surahs${expanded ? ' is-expanded' : ''}`}>
      <span className="journey__surahsText">{level.surahs.map((s) => s.name).join('، ')}</span>
      {!expanded && level.surahs.length > 6 ? (
        <button
          type="button"
          className="journey__surahsMore"
          aria-label={t('programs.journey.surahsMore')}
          onClick={() => setExpanded(true)}
        >
          …
        </button>
      ) : null}
    </p>
  );
}

/** §8 / R181 §4 — the trophy after a Category's last step. */
function Prize({ category }: { category: JourneyCategory }): ReactNode {
  return (
    <div
      className="journey__milestone"
      role="group"
      aria-label={t('programs.journey.graduationLabel').replace('{category}', category.name)}
    >
      <svg
        className="journey__trophy"
        viewBox="0 0 120 120"
        width="120"
        height="120"
        aria-hidden="true"
        focusable="false"
      >
        {/* Confetti */}
        <circle cx="14" cy="26" r="3" className="journey__confetti journey__confetti--a" />
        <circle cx="104" cy="18" r="3.5" className="journey__confetti journey__confetti--b" />
        <circle cx="22" cy="70" r="2.5" className="journey__confetti journey__confetti--b" />
        <circle cx="100" cy="66" r="2.5" className="journey__confetti journey__confetti--a" />
        <path d="M30 8 l3 6 -6 0 z" className="journey__confetti journey__confetti--b" />
        <path d="M92 40 l3 6 -6 0 z" className="journey__confetti journey__confetti--a" />
        <path d="M12 48 l4 -2 -1 4 z" className="journey__confetti journey__confetti--a" />
        {/* Sparkles */}
        <path
          d="M60 4 l2.2 6 6 2.2 -6 2.2 -2.2 6 -2.2 -6 -6 -2.2 6 -2.2 z"
          className="journey__sparkle"
        />
        <path
          d="M94 88 l1.5 4 4 1.5 -4 1.5 -1.5 4 -1.5 -4 -4 -1.5 4 -1.5 z"
          className="journey__sparkle"
        />
        {/* Handles, then the cup */}
        <path d="M34 30 C18 30 14 46 26 56 C32 61 38 62 42 62" className="journey__trophyHandle" />
        <path
          d="M86 30 C102 30 106 46 94 56 C88 61 82 62 78 62"
          className="journey__trophyHandle"
        />
        <path
          d="M34 24 H86 V50 C86 66 74 76 60 76 C46 76 34 66 34 50 Z"
          className="journey__trophyCup"
        />
        <path
          d="M40 30 H80 V49 C80 60 71 68 60 68 C49 68 40 60 40 49 Z"
          className="journey__trophyShine"
        />
        {/* Star on the cup */}
        <path
          d="M60 36 l4.2 8.6 9.5 1.4 -6.9 6.7 1.6 9.4 -8.4 -4.4 -8.4 4.4 1.6 -9.4 -6.9 -6.7 9.5 -1.4 z"
          className="journey__trophyStar"
        />
        {/* Stem and base */}
        <path d="M54 76 H66 V88 H54 Z" className="journey__trophyStem" />
        <path
          d="M42 88 H78 C82 88 84 92 84 96 V102 H36 V96 C36 92 38 88 42 88 Z"
          className="journey__trophyBase"
        />
        <path
          d="M40 106 H80 C84 106 86 110 86 114 H34 C34 110 36 106 40 106 Z"
          className="journey__trophyFoot"
        />
      </svg>
      <p className="journey__milestoneTitle">{t('programs.journey.graduation')}</p>
      <p className="journey__milestoneText">
        {t('programs.journey.graduationText').replace('{category}', category.name)}
      </p>
    </div>
  );
}

/** The highest point: the graduation attire the whole road climbs toward. */
function Summit(): ReactNode {
  return (
    <div className="journey__summit" role="group" aria-label={t('programs.journey.summit')}>
      <figure className="journey__attire">
        <img
          src="/journey/graduation-attire.jpg"
          srcSet="/journey/graduation-attire.jpg 720w, /journey/graduation-attire-2x.jpg 1200w"
          sizes="(max-width: 44rem) 14rem, 17rem"
          alt={t('programs.journey.attireAlt')}
          loading="lazy"
          decoding="async"
        />
        <figcaption className="journey__attireCaption">
          {t('programs.journey.summitQuestion')}
        </figcaption>
      </figure>
      <p className="journey__milestoneText">{t('programs.journey.summitText')}</p>
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
