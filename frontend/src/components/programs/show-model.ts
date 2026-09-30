import type { PublicProgramLevel } from '../../adapters/programs.js';
import type { Journey, JourneyCategory } from './journey-model.js';

/**
 * **The full-screen show** (SRS Revision 185 §5, reshaped by Revision 186) —
 * the journey told a tap at a time: the Categories to choose from; then,
 * from the chosen one, a strip of cards that grows by one per tap — each
 * Level, a milestone at the end of each Category, on into the next Category
 * — to the end of the LAST Category, where the attire and the one question
 * stand over everything.
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
 * The slides from a Category to the end of the road: its steps, then — when a
 * Category follows — its milestone, then the next Category's steps, and so
 * on. The last Category has no milestone slide: the graduation screen is it.
 */
export function walkSequence(journey: Journey, start: string): ShowSlide[] {
  const from = journey.categories.findIndex((category) => category.id === start);
  if (from < 0) return [];
  const slides: ShowSlide[] = [];
  journey.categories.slice(from).forEach((category, offset, rest) => {
    category.steps.forEach((step, at) => {
      slides.push({ kind: 'level', level: step.level, category, firstOfCategory: at === 0 });
    });
    if (offset < rest.length - 1) slides.push({ kind: 'milestone', category });
  });
  return slides;
}

/** Choosing a Category: its first slide, or straight to the graduation when
 *  the road from it holds no step at all. */
export function enterCategory(journey: Journey, categoryId: string): ShowState {
  if (!showCategory(journey, categoryId)) return SHOW_START;
  return walkSequence(journey, categoryId).length > 0
    ? { kind: 'walk', start: categoryId, at: 0 }
    : { kind: 'graduation' };
}

/** One tap forward: the next slide, then the graduation, then the question,
 *  then back to the Categories. */
export function advance(journey: Journey, state: ShowState): ShowState {
  switch (state.kind) {
    case 'categories':
      return state;
    case 'walk': {
      const length = walkSequence(journey, state.start).length;
      if (length === 0) return SHOW_START;
      return state.at + 1 < length
        ? { kind: 'walk', start: state.start, at: state.at + 1 }
        : { kind: 'graduation' };
    }
    case 'graduation':
      return { kind: 'question' };
    case 'question':
      return SHOW_START;
  }
}
