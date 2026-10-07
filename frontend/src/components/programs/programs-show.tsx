import { Fragment, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';

import { t } from '../../i18n/index.js';
import { Icon } from '../ui/icon.js';
import { DirectionArrow } from './direction-arrow.js';
import { ageWords, type Journey, type JourneyCategory } from './journey-model.js';
import { LevelCard } from './level-card.js';
import {
  SHOW_START,
  advance,
  enterCategory,
  retreat,
  walkSequence,
  type ShowSlide,
  type ShowState,
} from './show-model.js';
import { SummitFigure } from './summit-figure.js';
import { Trophy } from './trophy.js';

/**
 * **The journey, full screen** (SRS Revision 185 §5; reshaped by Revision
 * 186). One screen at a time:
 *
 * 1. the Categories, as cards with their details — choose one (it zooms in);
 * 2. the STRIP: from that Category's first Level, every tap moves the cards
 *    along and appends the next one with an arrow between — each Level, a
 *    milestone at the end of a Category, on into the next Category — to the
 *    last Level of the LAST Category;
 * 3. then the graduation — the attire under confetti filling the screen;
 * 4. then the question, «متى يحين دورُك؟», large over everything else, blurred.
 *
 * A tap anywhere on a screen moves on (a control on a card — «…», «عرض أقل»
 * — does not); so does the visible «انقري للمتابعة» button, for a keyboard;
 * «السابق» (and the ArrowRight key — back, as the page reads) steps back one
 * screen at a time, to the Categories (R188 §5). Escape, the «×» and leaving
 * the browser's full screen all close it. Under
 * `prefers-reduced-motion` nothing zooms, slides or falls and nothing
 * advances by itself: every step is a tap.
 *
 * The state is `show-model.ts`'s machine over the road's own `Journey`.
 */
export function ProgramsShow({
  journey,
  open,
  onClose,
  initialState = SHOW_START,
}: {
  journey: Journey;
  open: boolean;
  onClose: () => void;
  /** Where to start — a test's way of rendering one screen. */
  initialState?: ShowState;
}): ReactNode {
  const [state, setState] = useState<ShowState>(initialState);
  const [zooming, setZooming] = useState<string | null>(null);
  const [reduced, setReduced] = useState(false);
  const root = useRef<HTMLDivElement | null>(null);
  const strip = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setState(initialState);
    setReduced(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    // The page behind must not scroll; Escape closes; leaving the browser's
    // full screen (the Owner's own «×» or the system's) closes too.
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
      // As the page reads: left is forward, right is back.
      if (event.key === 'ArrowLeft') setState((s) => advance(journey, s));
      if (event.key === 'ArrowRight') setState((s) => retreat(journey, s));
    };
    const onFullscreen = (): void => {
      if (!document.fullscreenElement) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onFullscreen);
    root.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onFullscreen);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
  }, [open, onClose, initialState, journey]);

  // R186 — the strip moves along so the card just appended is in view (the
  // earlier ones shift to the right, where the road began).
  useEffect(() => {
    if (!open || state.kind !== 'walk') return;
    const node = strip.current;
    if (!node) return;
    node.scrollTo({ left: -node.scrollWidth, behavior: reduced ? 'auto' : 'smooth' });
  }, [open, state, reduced]);

  // The graduation lingers under its confetti, then the question comes by
  // itself — unless motion is reduced, when it waits for the tap.
  useEffect(() => {
    if (!open || state.kind !== 'graduation' || reduced) return;
    const timer = window.setTimeout(() => setState((s) => advance(journey, s)), 3200);
    return () => window.clearTimeout(timer);
  }, [open, state, reduced, journey]);

  if (!open) return null;

  const next = (): void => setState((s) => advance(journey, s));
  const back = (): void => setState((s) => retreat(journey, s));
  const pick = (categoryId: string): void => {
    if (reduced) {
      setState(enterCategory(journey, categoryId));
      return;
    }
    setZooming(categoryId);
    window.setTimeout(() => {
      setZooming(null);
      setState(enterCategory(journey, categoryId));
    }, 360);
  };
  // A tap on the screen moves on; a tap on a control within it does not.
  const onScreenClick = (event: MouseEvent<HTMLElement>): void => {
    if ((event.target as HTMLElement).closest('button')) return;
    next();
  };
  const slides = state.kind === 'walk' ? walkSequence(journey, state.start) : [];
  const current = state.kind === 'walk' ? slides[state.at] : undefined;
  const currentCategory =
    current?.category ?? (state.kind === 'walk' ? undefined : journey.categories.at(-1));
  const last = journey.categories.at(-1);

  return (
    <div
      ref={root}
      className={`show show--${state.kind}`}
      role="dialog"
      aria-modal="true"
      aria-label={t('programs.show.title')}
      tabIndex={-1}
    >
      <ShowBackdrop />
      <div className="show__bar">
        <p className="show__title">
          <span className="show__titleMark" aria-hidden="true" />
          {state.kind === 'categories' || !currentCategory
            ? t('programs.show.title')
            : t('programs.journey.categoryTitle').replace('{name}', currentCategory.name)}
        </p>
        <div className="show__barActions">
          {state.kind !== 'categories' ? (
            <button type="button" className="show__back" onClick={back}>
              <Icon name="chevron" size={18} />
              {t('programs.show.back')}
            </button>
          ) : null}
          <button
            type="button"
            className="show__close"
            onClick={onClose}
            aria-label={t('programs.show.close')}
          >
            <Icon name="close" size={22} />
          </button>
        </div>
      </div>

      {state.kind === 'categories' ? (
        <div className="show__screen show__screen--categories">
          <p className="show__lede">{t('programs.show.pickCategory')}</p>
          <ul className="show__grid">
            {journey.categories.map((item) => (
              <li key={item.id}>
                <CategoryCard
                  category={item}
                  zooming={zooming === item.id}
                  fading={zooming !== null && zooming !== item.id}
                  onPick={() => pick(item.id)}
                />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {state.kind === 'walk' ? (
        <div className="show__screen show__screen--walk" onClick={onScreenClick}>
          <div className="show__strip" ref={strip}>
            {slides.slice(0, state.at + 1).map((slide, index) => (
              <Fragment key={slideKey(slide)}>
                {index > 0 ? <StripArrow /> : null}
                <Slide slide={slide} current={index === state.at} />
              </Fragment>
            ))}
          </div>
          <ol className="show__dots" aria-hidden="true">
            {slides.map((slide, index) => (
              <li
                key={slideKey(slide)}
                className={`show__dot${slide.kind === 'milestone' ? ' show__dot--milestone' : ''}${index < state.at ? ' is-done' : ''}${index === state.at ? ' is-current' : ''}`}
              />
            ))}
          </ol>
          <button type="button" className="show__next" onClick={next}>
            {t('programs.show.next')}
          </button>
        </div>
      ) : null}

      {(state.kind === 'graduation' || state.kind === 'question') && last ? (
        <div
          className={`show__screen show__screen--graduation${state.kind === 'question' ? ' is-asked' : ''}`}
          onClick={onScreenClick}
        >
          <Confetti still={reduced} />
          <div className="show__graduation">
            <p className="journey__milestoneTitle">{t('programs.journey.graduation')}</p>
            <p className="journey__milestoneText">
              {t('programs.journey.graduationTextLast').replace('{category}', last.name)}
            </p>
            <SummitFigure sizes="(max-width: 44rem) 14rem, 20rem" />
          </div>
          {state.kind === 'question' ? (
            <p className="show__question">{t('programs.journey.summitQuestion')}</p>
          ) : null}
          <button type="button" className="show__next" onClick={next}>
            {state.kind === 'question' ? t('programs.show.again') : t('programs.show.next')}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function slideKey(slide: ShowSlide): string {
  return slide.kind === 'level' ? `level-${slide.level.id}` : `milestone-${slide.category.id}`;
}

/** One card of the strip: a Level (with its Category named above the first
 *  of each Category), or a Category's milestone. */
function Slide({ slide, current }: { slide: ShowSlide; current: boolean }): ReactNode {
  if (slide.kind === 'milestone') {
    return (
      <div className={`show__slide show__slide--milestone${current ? ' is-current' : ''}`}>
        <div className="show__milestone">
          <Trophy />
          <p className="journey__milestoneTitle">
            {t('programs.journey.graduationLabel').replace('{category}', slide.category.name)}
          </p>
          <p className="journey__milestoneText">
            {t('programs.journey.graduationText').replace('{category}', slide.category.name)}
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className={`show__slide${current ? ' is-current' : ''}`}>
      {slide.firstOfCategory ? (
        <p className="show__slideCategory">
          {t('programs.journey.categoryTitle').replace('{name}', slide.category.name)}
        </p>
      ) : null}
      <LevelCard level={slide.level} idPrefix="show-level" className="show__card" surahsInFull />
    </div>
  );
}

/** The arrow from one card to the next — drawn on as it is appended (the
 *  road's own arrow, `is-walked` from the start). */
function StripArrow(): ReactNode {
  return (
    <span className="show__link is-walked" aria-hidden="true">
      <DirectionArrow
        className="journey__arrow show__linkArrow"
        accent
        width={120}
        height={56}
        from={{ x: 112, y: 28 }}
        to={{ x: 10, y: 28 }}
        chevrons={3}
      />
    </span>
  );
}

/** A Category to choose: «فئة X», its ages, its description, its Subjects,
 *  and the way through it — its Levels' names in order. */
function CategoryCard({
  category,
  zooming,
  fading,
  onPick,
}: {
  category: JourneyCategory;
  zooming: boolean;
  fading: boolean;
  onPick: () => void;
}): ReactNode {
  const ages = ageWords(category, t);
  return (
    <button
      type="button"
      className={`show__category${zooming ? ' is-zooming' : ''}${fading ? ' is-fading' : ''}`}
      onClick={onPick}
    >
      <span className="show__categoryOrnament" aria-hidden="true">
        <Ornament />
      </span>
      <span className="show__categoryTitle">
        {t('programs.journey.categoryTitle').replace('{name}', category.name)}
      </span>
      {ages ? <span className="show__categoryAge">{ages}</span> : null}
      {category.description ? (
        <span className="show__categoryText">{category.description}</span>
      ) : null}
      {category.steps.length > 0 ? (
        <span className="show__categoryPath">
          {category.steps.map((step, index) => (
            <Fragment key={step.level.id}>
              {index > 0 ? <span className="show__categoryPathArrow">←</span> : null}
              <span className="show__categoryStep">{step.level.name}</span>
            </Fragment>
          ))}
        </span>
      ) : null}
      {category.sharedSubjects.length > 0 ? (
        <span className="show__categoryRow">
          <b>{t('programs.journey.sharedSubjects')}</b>{' '}
          {category.sharedSubjects.map((subject) => subject.name).join('، ')}
        </span>
      ) : null}
      {category.seasonalSubjects.length > 0 ? (
        <span className="show__categoryRow show__categoryRow--seasonal">
          <b>{t('programs.seasonalLabel')}</b>{' '}
          {category.seasonalSubjects.map((subject) => subject.name).join('، ')}
        </span>
      ) : null}
    </button>
  );
}

/** An eight-point star — the ornament on a Category card. */
function Ornament(): ReactNode {
  return (
    <svg viewBox="0 0 40 40" width="40" height="40" focusable="false">
      <path
        className="show__ornamentStar"
        d="M20 2 L24.5 12.5 L35.5 8.5 L31.5 19.5 L38 20 L31.5 20.5 L35.5 31.5 L24.5 27.5 L20 38 L15.5 27.5 L4.5 31.5 L8.5 20.5 L2 20 L8.5 19.5 L4.5 8.5 L15.5 12.5 Z"
      />
      <circle className="show__ornamentDot" cx="20" cy="20" r="4" />
    </svg>
  );
}

/** The far country behind every screen: a sun and three ridges, the road's
 *  own backdrop. */
function ShowBackdrop(): ReactNode {
  return (
    <div className="show__backdrop" aria-hidden="true">
      <span className="show__sun" />
      <svg
        className="show__ridges"
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
    </div>
  );
}

/**
 * Confetti filling the screen: a few dozen pieces in the palette's own
 * colours, each with its own place, delay, size and drift, falling by a
 * stylesheet keyframe. Deterministic (a small generator on the index), so a
 * render is the same twice. `still` (reduced motion) scatters them and lets
 * them stand.
 */
const PIECES = 64;
function Confetti({ still }: { still: boolean }): ReactNode {
  const pieces: ReactNode[] = [];
  let seed = 7;
  const rand = (): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (let i = 0; i < PIECES; i += 1) {
    const style = {
      ['--x' as string]: `${(rand() * 100).toFixed(1)}%`,
      ['--y' as string]: `${(rand() * 100).toFixed(1)}%`,
      ['--delay' as string]: `${(rand() * 4).toFixed(2)}s`,
      ['--dur' as string]: `${(4 + rand() * 4).toFixed(2)}s`,
      ['--size' as string]: `${Math.round(6 + rand() * 8)}px`,
      ['--drift' as string]: `${Math.round(rand() * 160 - 80)}px`,
      ['--spin' as string]: `${Math.round(rand() * 720 - 360)}deg`,
    };
    pieces.push(
      <i key={i} className={`show__piece show__piece--${'abcd'[i % 4]}`} style={style} />,
    );
  }
  return (
    <div className={`show__confetti${still ? ' is-still' : ''}`} aria-hidden="true">
      {pieces}
    </div>
  );
}
