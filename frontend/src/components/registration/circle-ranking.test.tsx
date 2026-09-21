import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { CircleSlots } from '../../adapters/registrations.js';
import { CircleRanking, circleLabel, meetingLabel, moveCircle, toggleCircle } from './circle-ranking.js';

/**
 * SRS Revision 168 §1 — «رتّبي الحلقات التي تناسبك». What is on offer is the
 * server's (scheduled classes, integration-tested); these hold the control to
 * keeping HER order and to asking nothing where there is nothing to choose.
 */
const targa: CircleSlots = {
  level: { id: 'l1', name: 'المستوى الأول' },
  circles: [
    { teaching_group_id: 'tue', name: 'حلقة الثلاثاء', meetings: [{ weekdays: ['tuesday'], start_time: '15:00', end_time: '20:00' }] },
    { teaching_group_id: 'thu', name: 'حلقة الخميس', meetings: [{ weekdays: ['thursday'], start_time: '09:00', end_time: '12:00' }] },
    { teaching_group_id: 'sat', name: 'حلقة السبت', meetings: [{ weekdays: ['saturday'], start_time: '15:00', end_time: '20:00' }] },
  ],
  fixed: [{ subject_name: 'تفسير القرآن', weekdays: ['wednesday'], start_time: '09:00', end_time: '12:00' }],
};

describe('a circle is named by when it meets', () => {
  it('in her words: the day, then the hours', () => {
    expect(meetingLabel(targa.circles[0]!.meetings[0]!)).toBe('الثلاثاء 15:00–20:00');
    expect(circleLabel(targa.circles[1]!)).toBe('حلقة الخميس — الخميس 09:00–12:00');
  });
});

describe('her order is hers', () => {
  it('ticking adds at the END, unticking removes, and nothing is ever ranked twice', () => {
    expect(toggleCircle([], 'thu', true)).toEqual(['thu']);
    expect(toggleCircle(['thu'], 'tue', true)).toEqual(['thu', 'tue']);
    expect(toggleCircle(['thu', 'tue'], 'thu', true)).toEqual(['thu', 'tue']);
    expect(toggleCircle(['thu', 'tue'], 'thu', false)).toEqual(['tue']);
  });

  it('↑ and ↓ move one place and stop at the ends', () => {
    expect(moveCircle(['a', 'b', 'c'], 'c', -1)).toEqual(['a', 'c', 'b']);
    expect(moveCircle(['a', 'b', 'c'], 'a', 1)).toEqual(['b', 'a', 'c']);
    expect(moveCircle(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c']);
    expect(moveCircle(['a', 'b', 'c'], 'c', 1)).toEqual(['a', 'b', 'c']);
  });
});

describe('the control', () => {
  const render = (slots: CircleSlots, value: string[]): string =>
    renderToStaticMarkup(<CircleRanking slots={slots} value={value} onChange={() => {}} error={null} />);

  it('shows her order numbered, the rest as choices, and the fixed class as information — not a choice', () => {
    const html = render(targa, ['thu', 'tue']);
    expect(html.indexOf('حلقة الخميس')).toBeLessThan(html.indexOf('حلقة الثلاثاء'));
    expect(html).toContain('data-ranked-circle="thu"');
    expect(html).toContain('حلقة السبت');
    expect(html).toContain('تفسير القرآن — الأربعاء 09:00–12:00');
    // The fixed class is never something she can tick.
    expect(html.match(/type="checkbox"/g)).toHaveLength(1);
  });

  it('asks NOTHING where there is nothing to choose between', () => {
    expect(render({ ...targa, circles: targa.circles.slice(0, 1) }, [])).toBe('');
    expect(render({ level: null, circles: [], fixed: [] }, [])).toBe('');
  });
});
