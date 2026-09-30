import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';

import { t } from '../../i18n/index.js';
import { Icon } from '../ui/icon.js';
import { ageWords, type Journey, type JourneyCategory } from './journey-model.js';
import { LevelCard } from './level-card.js';
import { SHOW_START, advance, enterCategory, showCategory, type ShowState } from './show-model.js';
import { SummitFigure } from './summit-figure.js';

/**
 * **The journey, full screen** (SRS Revision 185 §5). One screen at a time:
 *
 * 1. the Categories, as cards with their details — choose one (it zooms in);
 * 2. that Category's Levels, one card per tap, first to last;
 * 3. its graduation — the attire under confetti filling the screen;
 * 4. the question, «متى يحين دورُك؟», large over everything else, blurred.
 *
 * A tap anywhere on a screen moves on (a control on the card — «…», «عرض
 * أقل» — does not); so does the visible «التالي» button, for a keyboard.
 * Escape, the «×» and leaving the browser's full screen all close it. Under
 * `prefers-reduced-motion` nothing zooms or falls and nothing advances by
 * itself: every step is a tap.
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
  }, [open, onClose, initialState]);

  // The graduation lingers under its confetti, then the question comes by
  // itself — unless motion is reduced, when it waits for the tap.
  useEffect(() => {
    if (!open || state.kind !== 'graduation' || reduced) return;
    const timer = window.setTimeout(() => setState((s) => advance(journey, s)), 3200);
    return () => window.clearTimeout(timer);
  }, [open, state, reduced, journey]);

  if (!open) return null;

  const next = (): void => setState((s) => advance(journey, s));
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
  const category = state.kind === 'categories' ? null : showCategory(journey, state.categoryId);

  return (
    <div
      ref={root}
      className={`show show--${state.kind}`}
      role="dialog"
      aria-modal="true"
      aria-label={t('programs.show.title')}
      tabIndex={-1}
    >
      <div className="show__bar">
        <p className="show__title">
          {category
            ? t('programs.journey.categoryTitle').replace('{name}', category.name)
            : t('programs.show.title')}
        </p>
        <button
          type="button"
          className="show__close"
          onClick={onClose}
          aria-label={t('programs.show.close')}
        >
          <Icon name="close" size={22} />
        </button>
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

      {state.kind === 'level' && category ? (
        <div className="show__screen show__screen--level" onClick={onScreenClick}>
          <LevelCard
            key={category.steps[state.index]!.level.id}
            level={category.steps[state.index]!.level}
            idPrefix="show-level"
            className="show__card"
          />
          <ol className="show__dots" aria-hidden="true">
            {category.steps.map((step, at) => (
              <li
                key={step.level.id}
                className={`show__dot${at < state.index ? ' is-done' : ''}${at === state.index ? ' is-current' : ''}`}
              />
            ))}
          </ol>
          <button type="button" className="show__next" onClick={next}>
            {t('programs.show.next')}
          </button>
        </div>
      ) : null}

      {(state.kind === 'graduation' || state.kind === 'question') && category ? (
        <div
          className={`show__screen show__screen--graduation${state.kind === 'question' ? ' is-asked' : ''}`}
          onClick={onScreenClick}
        >
          <Confetti still={reduced} />
          <div className="show__graduation">
            <p className="journey__milestoneTitle">{t('programs.journey.graduation')}</p>
            <p className="journey__milestoneText">
              {t('programs.journey.graduationTextLast').replace('{category}', category.name)}
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

/** A Category to choose: «فئة X», its ages, its description, its Subjects. */
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
      <span className="show__categoryTitle">
        {t('programs.journey.categoryTitle').replace('{name}', category.name)}
      </span>
      {ages ? <span className="show__categoryAge">{ages}</span> : null}
      {category.description ? (
        <span className="show__categoryText">{category.description}</span>
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
