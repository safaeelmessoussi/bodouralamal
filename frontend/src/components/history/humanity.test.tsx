import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { t } from '../../i18n/index.js';
import { HUMANITY, TIMELINE } from './humanity-data.js';
import {
  descendantCount,
  detailSections,
  parsePath,
  resolvePath,
  verseRuns,
  type HistoryNode,
} from './humanity-model.js';
import { HumanityTimeline } from './humanity-timeline.js';

/** Every node, depth first. */
function all(node: HistoryNode): HistoryNode[] {
  return [node, ...(node.children ?? []).flatMap(all)];
}

describe('R203 — «مسيرة البشرية», the content from the Owner’s board', () => {
  it('holds the three eras, in order, and every node has a title', () => {
    expect((HUMANITY.children ?? []).map((era) => era.id)).toEqual(['prophets', 'seal', 'ummah']);
    for (const node of all(HUMANITY)) expect(node.title.trim().length).toBeGreaterThan(0);
  });

  it('lists the 23 prophets of the board in its own numbered order', () => {
    const prophets = all(HUMANITY.children![0]!).filter((n) => n.when?.order !== undefined);
    expect(prophets.map((p) => p.when!.order)).toEqual(Array.from({ length: 23 }, (_, i) => i + 1));
    expect(prophets[0]!.title).toBe('آدم عليه السلام');
    expect(prophets[22]!.title).toContain('عيسى');
  });

  it('links every Surah to «حسب السورة» on a real Surah number', () => {
    const surahs = all(HUMANITY).filter((n) => n.surah !== undefined);
    expect(surahs.map((s) => s.surah).sort((a, b) => a! - b!)).toEqual([1, 2, 3, 4, 5, 6, 8, 9, 10]);
    for (const s of surahs) expect(s.surah! >= 1 && s.surah! <= 114).toBe(true);
  });

  it('opens a real node from every station of the timeline', () => {
    for (const marker of TIMELINE.filter((m) => m.node)) {
      const ids = marker.node!.split('/');
      expect(resolvePath(HUMANITY, ids).length, marker.label).toBe(ids.length + 1);
    }
    expect(TIMELINE.at(-1)!.label).toBe('اليوم');
  });

  it('keeps ids unique among siblings, so every address is one node', () => {
    for (const node of all(HUMANITY)) {
      const ids = (node.children ?? []).map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

describe('R203 — the rules of the diagram', () => {
  it('resolves an address as far as it goes, and drops what does not resolve', () => {
    expect(resolvePath(HUMANITY, ['seal', 'makki', 'al-fatiha']).map((n) => n.id)).toEqual(['root', 'seal', 'makki', 'al-fatiha']);
    expect(parsePath(HUMANITY, 'seal/nowhere/al-fatiha')).toEqual(['seal']);
    expect(parsePath(HUMANITY, null)).toEqual([]);
  });

  it('counts what is beneath a node', () => {
    expect(descendantCount({ id: 'a', title: 'a', tone: 'root', children: [{ id: 'b', title: 'b', tone: 'root', children: [{ id: 'c', title: 'c', tone: 'root' }] }] })).toBe(2);
  });

  it('reads a board text as headed sections and labelled lines, never changing it', () => {
    const sections = detailSections(['المكان: مكة المكرمة', 'المحاور الكبرى:', 'التوحيد', '1. الأول', 'نص']);
    expect(sections).toEqual([
      { heading: null, lines: [{ kind: 'pair', label: 'المكان', text: 'مكة المكرمة' }] },
      { heading: 'المحاور الكبرى', lines: [{ kind: 'text', text: 'التوحيد' }] },
      { heading: '1. الأول', lines: [{ kind: 'text', text: 'نص' }] },
    ]);
  });

  it('draws a Quranic quotation as one run', () => {
    expect(verseRuns('قال ﴿اقْرَأْ﴾ ثم')).toEqual([
      { verse: false, text: 'قال ' },
      { verse: true, text: '﴿اقْرَأْ﴾' },
      { verse: false, text: ' ثم' },
    ]);
  });
});

describe('R203 — the page', () => {
  afterEach(() => vi.unstubAllGlobals());
  const at = (search: string) =>
    vi.stubGlobal('window', {
      location: { search, href: `https://x/resources${search}` },
      history: { pushState: () => undefined },
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    });

  it('opens on the timeline with both calendars and the three eras', () => {
    at('?view=history');
    const html = renderToStaticMarkup(<HumanityTimeline />);
    for (const marker of TIMELINE) expect(html).toContain(marker.label);
    expect(html).toContain('1448 هـ');
    expect(html).toContain('2026م');
    expect(html).toContain(t('content.history.erasTitle'));
    expect(html.match(/class="humanity__era /g)?.length).toBe(3);
  });

  it('opens a Surah with its ideas and a link to «حسب السورة» on it', () => {
    at('?view=history&node=seal/makki/al-fatiha');
    const html = renderToStaticMarkup(<HumanityTimeline />);
    expect(html).toContain('سورة الفاتحة');
    expect(html).toContain('href="/resources?surah=1"');
    expect(html).toContain('أم القرآن والسبع المثاني');
  });
});
