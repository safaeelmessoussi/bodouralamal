import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { DatePicker, dayDisabled, monthDisabled, yearDisabled } from './date-picker.js';
import { DateField } from './field.js';
import { ar } from '../../i18n/ar.js';

/**
 * **What a static render can hold, and what it cannot.**
 *
 * This project renders tests with `renderToStaticMarkup` — no jsdom, no event
 * simulation (see `atomic-components.test.tsx`'s note on the same
 * constraint for `FormDialog`). `DatePicker` always mounts CLOSED, so what is
 * asserted here is the closed-state markup and the pure range logic; opening
 * the panel, choosing a day, and the keyboard behaviour are verified in the
 * running application by `scripts/dev/browser/verify-date-picker.sh` — the
 * same division of labour the unsaved-form-guard tests already state.
 */
describe('the closed control', () => {
  it('shows the Arabic placeholder when empty, never mm/dd/yyyy', () => {
    const html = renderToStaticMarkup(<DatePicker value="" onChange={() => {}} />);
    expect(html).toContain(ar.datePicker.placeholder);
    expect(html).not.toMatch(/mm|dd|yyyy/i);
  });

  it('shows the chosen date in Arabic, with Western digits', () => {
    const html = renderToStaticMarkup(<DatePicker value="2026-06-12" onChange={() => {}} />);
    expect(html).toContain('12');
    expect(html).toContain('2026');
    expect(html).not.toContain(ar.datePicker.placeholder);
    // No Arabic-Indic digit slipped in from a locale-aware formatter.
    expect(html).not.toMatch(/[٠-٩۰-۹]/);
  });

  it('renders no calendar markup at all until opened', () => {
    const html = renderToStaticMarkup(<DatePicker value="" onChange={() => {}} />);
    expect(html).not.toContain(ar.calendar.months[0]);
    expect(html).not.toContain(ar.calendar.weekdaysShort[0]);
  });

  it('carries aria-haspopup and a closed aria-expanded', () => {
    const html = renderToStaticMarkup(<DatePicker value="" onChange={() => {}} />);
    expect(html).toContain('aria-haspopup="true"');
    expect(html).toContain('aria-expanded="false"');
  });

  it('marks itself required and disabled exactly as asked', () => {
    const required = renderToStaticMarkup(<DatePicker value="" onChange={() => {}} required />);
    expect(required).toContain('aria-required="true"');

    const disabled = renderToStaticMarkup(<DatePicker value="" onChange={() => {}} disabled />);
    expect(disabled).toContain('disabled=""');
  });

  it('a bare usage takes its accessible name from aria-label, never from a hidden default', () => {
    const html = renderToStaticMarkup(
      <DatePicker value="" onChange={() => {}} ariaLabel="بداية الشهر" />,
    );
    expect(html).toContain('aria-label="بداية الشهر"');
  });
});

describe('DateField — the labelled wrapper every form uses', () => {
  it('renders a real <label> associated with the trigger, like every other field', () => {
    const html = renderToStaticMarkup(
      <DateField label="تاريخ الميلاد" value="" onChange={() => {}} />,
    );
    const forMatch = /<label[^>]*for="([^"]+)"/.exec(html);
    expect(forMatch, html).not.toBeNull();
    expect(html).toContain(`id="${forMatch![1]}"`);
    expect(html).toContain('تاريخ الميلاد');
  });

  it('marks a required field visually and programmatically, same as every other field', () => {
    const html = renderToStaticMarkup(
      <DateField label="تاريخ الميلاد" value="" onChange={() => {}} required />,
    );
    expect(html).toContain('field__required');
    expect(html).toContain('aria-required="true"');
  });

  it('announces an error exactly as the other fields do — role="alert", linked by aria-describedby', () => {
    const html = renderToStaticMarkup(
      <DateField
        label="تاريخ الميلاد"
        value=""
        onChange={() => {}}
        error="هذا الحقل مطلوب."
      />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain('هذا الحقل مطلوب.');
    expect(html).toMatch(/aria-describedby="[^"]*-error"/);
  });

  it('carries no automatic hint any more — the placeholder inside the control says the format now', () => {
    // R66's old auto-injected `common.dateFormatHint` duplicated what the
    // control's own placeholder now says visually; asserting its absence pins
    // that the duplicate was actually removed and not merely left unused.
    const html = renderToStaticMarkup(
      <DateField label="تاريخ الميلاد" value="" onChange={() => {}} />,
    );
    expect(html).not.toContain('التاريخ بصيغة');
  });
});

describe('the range logic — the courtesy that replaced the native min/max', () => {
  it('a day outside [min, max] is disabled; a day inside is not', () => {
    expect(dayDisabled('2026-06-01', '2026-06-05', '2026-06-20')).toBe(true);
    expect(dayDisabled('2026-06-25', '2026-06-05', '2026-06-20')).toBe(true);
    expect(dayDisabled('2026-06-12', '2026-06-05', '2026-06-20')).toBe(false);
    expect(dayDisabled('2026-06-12')).toBe(false);
  });

  it('a month is disabled only once its WHOLE span is out of range', () => {
    // June entirely before a July minimum.
    expect(monthDisabled(2026, 5, '2026-07-01', undefined)).toBe(true);
    // June straddling a mid-June minimum stays pickable — the day grid narrows it.
    expect(monthDisabled(2026, 5, '2026-06-15', undefined)).toBe(false);
    // June entirely after a May maximum.
    expect(monthDisabled(2026, 5, undefined, '2026-05-31')).toBe(true);
  });

  it('a year is disabled only once its WHOLE span is out of range', () => {
    expect(yearDisabled(2025, '2026-01-01', undefined)).toBe(true);
    expect(yearDisabled(2026, '2026-06-15', undefined)).toBe(false);
    expect(yearDisabled(2027, undefined, '2026-12-31')).toBe(true);
  });
});
