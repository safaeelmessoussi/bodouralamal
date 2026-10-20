import type { PublicProgramLevel } from '../../adapters/programs.js';
import type { Journey, JourneyCategory } from './journey-model.js';

/**
 * **The full-screen show** (SRS Revision 185 §5, reshaped by Revision 186) —
 * the journey told a tap at a time: the Categories to choose from; then,
 * from the chosen one, a strip of cards that grows by one per tap — each of
 * its Levels, then «إتمام فئة X» — and the next tap goes back to the
 * Categories (R234: no arrow on into the next Category). The LAST Category
 * keeps its ending: the attire and the one question over everything.
 *
 * The walk is a pure state machine on the same `Journey` the road reads, so
 * what the show says about a Category is what the road says.
 */
export type ShowSlide =
  | {
      kind: 'level';
      level: PublicProgramLevel;
      category: JourneyCategory;
      firstOfCategory: boolean;
    }
  /** «إتمام فئة X» — after a Category's last Level, when another follows. */
  | { kind: 'milestone'; category: JourneyCategory };

export type ShowState =
  | { kind: 'categories' }
  /** The strip: every slide of `walkSequence(start)` up to `at`, inclusive. */
  | { kind: 'walk'; start: string; at: number }
  | { kind: 'graduation' }
  | { kind: 'question' };

export const SHOW_START: ShowState = { kind: 'categories' };

export function showCategory(journey: Journey, id: string): JourneyCategory | undefined {
  return journey.categories.find((category) => category.id === id);
}

/**
 * **R234 — one Category's slides**: its steps, then its milestone. The road
 * goes no further (the Owner, 2026-10-20: «remove the arrow to the next
 * category's first level and after إتمام فئة … go back to the page listing
 * the categories»). The last Category has no milestone slide: the graduation
 * screen is its ending, as before.
 */
export function walkSequence(journey: Journey, start: string): ShowSlide[] {
  const category = showCategory(journey, start);
  if (!category) return [];
  const slides: ShowSlide[] = category.steps.map((step, at) => ({
    kind: 'level',
    level: step.level,
    category,
    firstOfCategory: at === 0,
  }));
  if (!category.last) slides.push({ kind: 'milestone', category });
  return slides;
}

/** Choosing a Category: its first slide, or straight to the graduation when
 *  the last Category holds no step at all. */
export function enterCategory(journey: Journey, categoryId: string): ShowState {
  if (!showCategory(journey, categoryId)) return SHOW_START;
  return walkSequence(journey, categoryId).length > 0
    ? { kind: 'walk', start: categoryId, at: 0 }
    : { kind: 'graduation' };
}

/** R188 §5 — one step back: the previous slide; from the first slide, the
 *  Categories; from the graduation, the last slide; from the question, the
 *  graduation. */
export function retreat(journey: Journey, state: ShowState): ShowState {
  switch (state.kind) {
    case 'categories':
      return state;
    case 'walk':
      return state.at > 0 ? { kind: 'walk', start: state.start, at: state.at - 1 } : SHOW_START;
    case 'graduation':
      return SHOW_START;
    case 'question':
      return { kind: 'graduation' };
  }
}

/** One tap forward: the next slide; after a Category's milestone, back to
 *  the Categories (R234); after the last Category, the graduation, the
 *  question, then the Categories. */
export function advance(journey: Journey, state: ShowState): ShowState {
  switch (state.kind) {
    case 'categories':
      return state;
    case 'walk': {
      const length = walkSequence(journey, state.start).length;
      if (length === 0) return SHOW_START;
      if (state.at + 1 < length) return { kind: 'walk', start: state.start, at: state.at + 1 };
      return showCategory(journey, state.start)?.last ? { kind: 'graduation' } : SHOW_START;
    }
    case 'graduation':
      return { kind: 'question' };
    case 'question':
      return SHOW_START;
  }
}
