import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ar } from '../../i18n/ar.js';
import { FramingPreferenceValue } from '../../components/teaching/framing-preference-summary.js';

describe('staff approval framing summary', () => {
  it('shows online without inventing a physical branch', () => {
    const html = renderToStaticMarkup(
      <FramingPreferenceValue framing={{ mode: 'online', all_branches: false, branches: [] }} />,
    );
    expect(html).toContain(ar.register.framingMode_online);
    expect(html).not.toContain(ar.framing.allBranches);
  });

  it('shows every explicitly selected branch', () => {
    const html = renderToStaticMarkup(
      <FramingPreferenceValue
        framing={{
          mode: 'both',
          all_branches: false,
          branches: [
            { id: 'b1', name: 'مقر أمرشيش' },
            { id: 'b2', name: 'مقر تاركة' },
          ],
        }}
      />,
    );
    expect(html).toContain(ar.register.framingMode_both);
    expect(html).toContain('مقر أمرشيش، مقر تاركة');
  });

  it('renders the future-inclusive all-branches meaning explicitly', () => {
    const html = renderToStaticMarkup(
      <FramingPreferenceValue
        framing={{ mode: 'in_person', all_branches: true, branches: [] }}
      />,
    );
    expect(html).toContain(ar.framing.allBranches);
  });

  it('keeps legacy requests honest as not stated', () => {
    expect(renderToStaticMarkup(<FramingPreferenceValue framing={null} />)).toContain(
      ar.framing.notStated,
    );
  });
});
