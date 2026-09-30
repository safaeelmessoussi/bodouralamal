import type { Journey, JourneyCategory } from './journey-model.js';

/**
 * **The full-screen show** (SRS Revision 185 §5) — the journey told one
 * screen at a time: the Categories to choose from; the chosen Category's
 * Levels, one card after another; its graduation under falling confetti;
 * then the one question, «متى يحين دورُك؟», over everything.
 *
 * The walk is a pure state machine on the same `Journey` the road reads, so
 * what the show says about a Category is what the road says.
 */
export type ShowState =
  | { kind: 'categories' }
  | { kind: 'level'; categoryId: string; index: number }
  | { kind: 'graduation'; categoryId: string }
  | { kind: 'question'; categoryId: string };

export const SHOW_START: ShowState = { kind: 'categories' };

export function showCategory(journey: Journey, id: string): JourneyCategory | undefined {
  return journey.categories.find((category) => category.id === id);
}

/** Choosing a Category: its first step, or straight to its graduation when it
 *  has none (a Category with only a preparatory programme). */
export function enterCategory(journey: Journey, categoryId: string): ShowState {
  const category = showCategory(journey, categoryId);
  if (!category) return SHOW_START;
  return category.steps.length > 0
    ? { kind: 'level', categoryId, index: 0 }
    : { kind: 'graduation', categoryId };
}

/** One tap forward: the next Level, then the graduation, then the question,
 *  then back to the Categories. */
export function advance(journey: Journey, state: ShowState): ShowState {
  switch (state.kind) {
    case 'categories':
      return state;
    case 'level': {
      const category = showCategory(journey, state.categoryId);
      if (!category) return SHOW_START;
      return state.index + 1 < category.steps.length
        ? { kind: 'level', categoryId: state.categoryId, index: state.index + 1 }
        : { kind: 'graduation', categoryId: state.categoryId };
    }
    case 'graduation':
      return { kind: 'question', categoryId: state.categoryId };
    case 'question':
      return SHOW_START;
  }
}
