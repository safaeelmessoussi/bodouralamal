import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ar } from '../../i18n/ar.js';
import { AvailabilityEditor, DEFAULT_RANGE } from './availability-editor.js';

describe('AvailabilityEditor per-window framing mode', () => {
  it('creates a new range with honest unknown mode rather than an inferred default', () => {
    expect(DEFAULT_RANGE.mode).toBeNull();
  });

  it('offers the three bounded framing modes and the legacy unknown value', () => {
    const html = renderToStaticMarkup(
      <AvailabilityEditor ranges={[DEFAULT_RANGE]} onChange={() => undefined} />,
    );
    expect(html).toContain(ar.admin.teachingProfile.mode);
    expect(html).toContain(ar.admin.teachingProfile.modeUnknown);
    expect(html).toContain(ar.register.framingMode_in_person);
    expect(html).toContain(ar.register.framingMode_online);
    expect(html).toContain(ar.register.framingMode_both);
  });

  it('round-trips an explicit mode as the selected option', () => {
    const html = renderToStaticMarkup(
      <AvailabilityEditor
        ranges={[{ ...DEFAULT_RANGE, mode: 'online' }]}
        onChange={() => undefined}
      />,
    );
    expect(html).toMatch(/<option value="online" selected="">/);
  });
});
