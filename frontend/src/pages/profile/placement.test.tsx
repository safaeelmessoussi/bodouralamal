import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { OwnProfile } from '../../adapters/profile.js';
import { ar } from '../../i18n/ar.js';
import { PlacementSection } from './index.js';

/** R214 — «مساري» says where she stands in each Level, and since / until when. */
describe('PlacementSection', () => {
  it('names each Level with its status, its start and, once over, its end', () => {
    const level = (id: string, status: 'in_progress' | 'completed' | 'dropped', ended: string | null) => ({
      id,
      category_name: 'المرأة',
      level_name: `مستوى ${id}`,
      branch_name: 'مراكش',
      group_name: null,
      status,
      started_on: '2025-09-01',
      ended_on: ended,
    });
    const profile = {
      enrolments: [level('أ', 'completed', '2026-06-30'), level('ب', 'dropped', '2026-01-15'), level('ج', 'in_progress', null)],
      circles: [],
      guardians: [],
    } as unknown as OwnProfile;
    const html = renderToStaticMarkup(<PlacementSection profile={profile} />);
    expect(html).toContain(ar.profile.journeyStatus.completed);
    expect(html).toContain(ar.profile.journeyStatus.dropped);
    expect(html).toContain(ar.profile.journeyStatus.in_progress);
    expect(html.match(/البداية:/g)?.length).toBe(3);
    // A Level still in progress has no end.
    expect(html.match(/النهاية:/g)?.length).toBe(2);
  });
});
