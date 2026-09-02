import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { CalendarBootstrap, Occurrence } from '../../adapters/calendar.js';
import { EventChip } from './event-chip.js';
import {
  schedulingTypeOptions,
  schedulingTypeQuery,
  withUnlistedValue,
} from './scheduling-type-filter.js';

/**
 * **The النوع filter speaks the catalogue, and a عطلة reads as one** (R110,
 * Owner 2026-09-02).
 *
 * The client half of the revision. The server half is
 * `backend/src/services/scheduling-type-filter.integration.test.ts`, which pins
 * that two types of one structural kind narrow apart; these pin that the
 * control offers the right values, sends the right parameter, and that the grid
 * marks a holiday **from the row** rather than by matching an Arabic name the
 * administration is free to change.
 */
const bootstrap = (
  types: CalendarBootstrap['scheduling_types'],
): CalendarBootstrap =>
  ({
    hijri: { days: [], months: [] },
    gregorian_months: [],
    categories: [],
    levels: [],
    branches: [],
    subjects: [],
    scheduling_types: types,
  }) as CalendarBootstrap;

const CATALOGUE = [
  { id: 'id-activity', name: 'نشاط', structural_kind: 'activity', display_order: 1 },
  { id: 'id-holiday', name: 'عطلة', structural_kind: 'holiday', display_order: 2 },
];

const occurrence = (over: Partial<Occurrence> = {}): Occurrence =>
  ({
    kind: 'event',
    scheduling_type_id: null,
    scheduling_type_name: null,
    structural_kind: null,
    id: 'o1',
    title: 'رحلة',
    date: '2026-06-15',
    start_time: null,
    end_time: null,
    visibility: 'public',
    branch_id: null,
    description: null,
    recurrence: null,
    branch_name: null,
    room_name: null,
    delivery_mode: null,
    online_media_mode: null,
    category_id: null,
    category_name: null,
    level_id: null,
    level_name: null,
    instructors: [],
    subject_id: null,
    subject_name: null,
    teaching_mode: null,
    audience_label: null,
    status: null,
    hijri_date: null,
    hijri_month_ar: null,
    ...over,
  }) as Occurrence;

describe('the options come from the catalogue, not from a constant', () => {
  it('offers one option per live type, by id', () => {
    expect(schedulingTypeOptions(bootstrap(CATALOGUE))).toEqual([
      { value: 'id-activity', label: 'نشاط' },
      { value: 'id-holiday', label: 'عطلة' },
    ]);
  });

  /**
   * **Not the old three-item array.** A filter that still offered
   * session/event/exam would collapse نشاط and عطلة into one «نشاط», which is
   * the defect the revision exists for.
   */
  it('offers nothing before the bootstrap arrives, rather than a fallback list', () => {
    expect(schedulingTypeOptions(null)).toEqual([]);
  });
});

describe('what the control sends', () => {
  it('sends a catalogue id as `scheduling_type_id`', () => {
    expect(schedulingTypeQuery('id-holiday')).toEqual({ schedulingTypeId: 'id-holiday' });
  });

  /** A link somebody sent before the revision still narrows the same grid. */
  it('sends one of the three storage words as `kind`, unchanged', () => {
    expect(schedulingTypeQuery('event')).toEqual({ kind: 'event' });
    expect(schedulingTypeQuery('session')).toEqual({ kind: 'session' });
  });

  it('sends neither when nothing is chosen', () => {
    expect(schedulingTypeQuery(null)).toEqual({});
    expect(schedulingTypeQuery('')).toEqual({});
  });
});

describe('a saved filter naming a type the catalogue no longer offers', () => {
  /**
   * A `<select>` whose value matches no option renders as *nothing selected*,
   * which reads as **no filter** while the results are in fact still narrowed.
   */
  it('keeps a named option so the control cannot read as unfiltered', () => {
    const options = withUnlistedValue(schedulingTypeOptions(bootstrap(CATALOGUE)), 'id-retired');
    expect(options.map((o) => o.value)).toContain('id-retired');
  });

  it('adds nothing for a value the catalogue does offer', () => {
    expect(withUnlistedValue(schedulingTypeOptions(bootstrap(CATALOGUE)), 'id-holiday')).toHaveLength(2);
  });

  it('adds nothing for a legacy storage word, which is not a missing type', () => {
    expect(withUnlistedValue(schedulingTypeOptions(bootstrap(CATALOGUE)), 'event')).toHaveLength(2);
  });
});

describe('the grid marks a عطلة apart from an activity', () => {
  it('reads the structural kind from the row, never the Arabic name', () => {
    const html = renderToStaticMarkup(
      <EventChip
        occurrence={occurrence({
          title: 'عيد المولد',
          scheduling_type_id: 'id-holiday',
          scheduling_type_name: 'عطلة',
          structural_kind: 'holiday',
        })}
      />,
    );
    expect(html).toContain('event-chip--holiday');
    // **A word, not only a tint** (rule AV): a reader who cannot distinguish
    // the outline still sees what the day is.
    expect(html).toContain('event-chip__tag');
    expect(html).toContain('عطلة');
  });

  it('leaves an ordinary activity alone, though both are stored as an Event', () => {
    const html = renderToStaticMarkup(
      <EventChip
        occurrence={occurrence({
          scheduling_type_id: 'id-activity',
          scheduling_type_name: 'نشاط',
          structural_kind: 'activity',
        })}
      />,
    );
    expect(html).not.toContain('event-chip--holiday');
    expect(html).toContain('event-chip--event');
  });

  it('announces a holiday as what it IS — «نشاط» would be wrong', () => {
    const html = renderToStaticMarkup(
      <EventChip
        occurrence={occurrence({
          title: 'عيد المولد',
          scheduling_type_name: 'عطلة',
          structural_kind: 'holiday',
        })}
        onOpen={() => {}}
      />,
    );
    expect(html).toContain('visually-hidden');
    expect(html).toContain('عطلة');
  });
});
