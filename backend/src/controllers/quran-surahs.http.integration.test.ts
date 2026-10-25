import { describe, expect, it } from 'vitest';

import { loadConfig } from '../lib/config.js';

/** `GET /quran-surahs` (SRS Revision 240) over real HTTP: public, the 114 with «نوع السورة». */
const config = loadConfig();
const BASE = `${config.PUBLIC_BASE_URL}/api/v1`;

describe('R240 — every Surah with where it was revealed', () => {
  it('answers anonymously with the 114 in Mushaf order, 28 مدنية, cached', async () => {
    const res = await fetch(`${BASE}/quran-surahs`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('max-age=3600');
    const { data } = (await res.json()) as { data: { surah_id: number; surah_name: string; revelation: string }[] };
    expect(data.map((s) => s.surah_id)).toEqual(Array.from({ length: 114 }, (_, i) => i + 1));
    expect(data.filter((s) => s.revelation === 'madani').map((s) => s.surah_id)).toEqual([
      2, 3, 4, 5, 8, 9, 13, 22, 24, 33, 47, 48, 49, 55, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 76, 98, 99, 110,
    ]);
    expect(data[0]).toEqual({ surah_id: 1, surah_name: 'الفاتحة', revelation: 'makki' });
  });
});
