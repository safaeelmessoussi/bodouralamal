import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { t } from '../../i18n/index.js';
import { EXPEDITIONS, HUMANITY, PHASES, TIMELINE } from './humanity-data.js';
import {
  branchKeys,
  descendantCount,
  detailSections,
  parsePath,
  resolvePath,
  verseRuns,
  type DiagramNode,
  type HistoryNode,
} from './humanity-model.js';
import { HumanityDiagram } from './humanity-diagram.js';
import { HumanityTimeline } from './humanity-timeline.js';

/** Every node, depth first. */
function all(node: HistoryNode): HistoryNode[] {
  return [node, ...(node.children ?? []).flatMap(all)];
}

/** Every box of a diagram, depth first. */
function boxes(node: DiagramNode): DiagramNode[] {
  return [node, ...(node.children ?? []).flatMap(boxes)];
}

/** Every text the page can show, joined. */
function everything(node: HistoryNode): string {
  return all(node)
    .map((n) =>
      [
        n.title,
        n.subtitle ?? '',
        n.summary ?? '',
        ...(n.lines ?? []),
        ...(n.diagrams ?? []).flatMap((d) => [d.title, ...boxes(d.root).map((b) => `${b.label} ${b.text ?? ''}`)]),
      ].join('\n'),
    )
    .join('\n');
}

describe('R203 — «نظرة شاملة», the content from the Owner’s board', () => {
  it('holds the four eras, in order, and every node has a title', () => {
    // R212 — «خلافة على منهاج النبوة» is an era of its own, before «امتداد الأمة».
    expect((HUMANITY.children ?? []).map((era) => era.id)).toEqual(['prophets', 'seal', 'rashidun', 'ummah']);
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
    // R205 — «اليوم» opens today's schedule, not a node of the tree.
    expect(TIMELINE.at(-1)!.node).toBe('today');
    for (const marker of TIMELINE.filter((m) => m.node && m.node !== 'today')) {
      const ids = marker.node!.split('/');
      expect(resolvePath(HUMANITY, ids).length, marker.label).toBe(ids.length + 1);
    }
    expect(TIMELINE.at(-1)!.label).toBe('اليوم');
  });

  it('R204 — draws every Surah’s axes as a diagram, al-Fatiha with its seven verses', () => {
    const surahs = all(HUMANITY).filter((n) => n.surah !== undefined);
    for (const s of surahs) {
      expect(s.diagrams?.length, s.title).toBeGreaterThan(0);
      for (const d of s.diagrams!) for (const b of boxes(d.root)) {
        expect(b.label.trim().length).toBeGreaterThan(0);
        // A colour is never read as a box's sentence.
        expect(b.text ?? '', b.label).not.toMatch(/^\||^(gold|blue|violet|orange|green)$/);
      }
      // The axes are no longer listed as text: the diagram says them.
      expect((s.lines ?? []).some((l) => l.startsWith('المحاور')), s.title).toBe(false);
    }
    const fatiha = surahs.find((s) => s.surah === 1)!;
    const verses = fatiha.diagrams![0]!.root.children!.map((v) => v.text);
    expect(verses).toEqual(['الآية 1', 'الآية 2 — الرحمة', 'الآية 3 — المُلك', 'الآية 4', 'الآية 5 — طلب الهداية بصفة الرحمة', 'الآية 6 — أهل العلم والعمل', 'الآية 7']);
    expect(fatiha.diagrams!.map((d) => d.title)).toEqual(['الآيات وما تحتها', 'التوحيد في السورة', 'أقسام الناس', 'مدار الأسماء والصفات', 'الحمد والشكر والتسبيح', 'مراتب العلم']);
  });

  it('R204 — the Owner’s additions: عام الجماعة opens the Umayyad era, al-Nasa’i has his text', () => {
    const umayyad = resolvePath(HUMANITY, ['ummah', 'umayyad']).at(-1)!;
    expect(umayyad.children!.map((c) => c.id)).toEqual(['am-al-jamaa', 'umayyad-1', 'umayyad-2', 'umayyad-3']);
    expect(umayyad.children![0]!.when).toEqual({ gregorian: '661م', hijri: '41 هـ' });
    expect(umayyad.children![0]!.lines!.join(' ')).toContain('حقنًا لدماء المسلمين');
    expect(resolvePath(HUMANITY, ['ummah', 'abbasid', 'hadith-imams', 'nasai']).at(-1)!.lines!.length).toBeGreaterThan(0);
    // R211 — every node now says something (the present era lists modern works).
    const empty = all(HUMANITY).filter((n) => !n.lines?.length && !n.children?.length && !n.diagrams?.length);
    expect(empty.map((n) => n.id)).toEqual([]);
  });

  it('R204 — leaves out what the scholars do not agree upon, and the errors the review found', () => {
    const text = everything(HUMANITY);
    for (const gone of [
      'الذبيح', // which son was to be sacrificed is a known difference
      'خمسون صحيفة',
      'ثلاثون صحيفة',
      'أخنوخ',
      'يوم الجمعة',
      'ثماني عشرة سنة',
      'تلميذ شيخ الإسلام',
      'العدل المطلق',
      'قابيل',
      'سبعون ألف',
      'الوحيدة بين السبع الطوال',
      'الإشاري',
      'الصاوي',
      'إمام مجتهد وموسوعي',
      '633م',
      'الأسطوري',
      'صفين',
      'التقية',
    ]) {
      expect(text, gone).not.toContain(gone);
    }
  });

  it('R205 — the second and third lines: the phases between their stations, the expeditions in the Medinan phase', () => {
    expect(PHASES.map((p) => [p.label, TIMELINE[p.from]!.label, TIMELINE[p.to]!.label])).toEqual([
      ['المرحلة المكية', 'البعثة وبدء الوحي', 'الهجرة'],
      ['المرحلة المدنية', 'الهجرة', 'وفاة النبي ﷺ'],
    ]);
    for (const p of PHASES) expect(resolvePath(HUMANITY, p.node.split('/')).length).toBe(3);
    expect(EXPEDITIONS.map((e) => e.label)).toEqual(['بدر', 'أُحُد', 'بنو النضير', 'الأحزاب', 'فتح مكة', 'حُنَين', 'تبوك']);
    for (const e of EXPEDITIONS) {
      const node = resolvePath(HUMANITY, e.node.split('/')).at(-1)!;
      expect(node.id, e.label).toBe(e.node.split('/').at(-1));
      // Each is tied to the Qur'an by a verse.
      expect(node.lines!.join(' '), e.label).toMatch(/﴿/);
      expect(node.when).toEqual({ gregorian: e.gregorian, hijri: e.hijri });
    }
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

  it('names every box that has branches, for «فتح الكل»', () => {
    const small: DiagramNode = { label: 'r', children: [{ label: 'a', children: [{ label: 'b', children: [{ label: 'c' }] }] }] };
    expect(branchKeys(small)).toEqual(['0', '0/0', '0/0/0']);
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
    expect(html.match(/class="humanity__era /g)?.length).toBe(4);
    // R212 — four bands: «مرحلة النبوة» and «خلافة على منهاج النبوة» among them.
    expect(html.match(/class="humanity__band /g)?.length).toBe(4);
    expect(html).toContain(`>${t('content.history.era.seal')}<`);
    expect(html).toContain(`>${t('content.history.era.rashidun')}<`);
  });

  it('R204 — keeps the line and the cards together: no visible title, no trail on the overview', () => {
    at('?view=history');
    const html = renderToStaticMarkup(<HumanityTimeline />);
    expect(t('content.views.history')).toBe('نظرة شاملة');
    expect(html).toContain(`class="humanity__title visually-hidden"`);
    expect(html).not.toContain('humanity__trail');
    // The calendars are named once, at the start of the line.
    expect(html.indexOf('humanity__legend')).toBeLessThan(html.indexOf('humanity__station '));
    expect(html.match(/>ميلادي</g)?.length).toBe(1);
  });

  it('R205 — draws the three lines, the arrow, and «اليوم» as a station that opens', () => {
    at('?view=history');
    const html = renderToStaticMarkup(<HumanityTimeline />);
    expect(html.match(/class="humanity__phase /g)?.length).toBe(2);
    expect(html.match(/class="humanity__expedition"/g)?.length).toBe(7);
    expect(html).toContain('humanity__zoom');
    expect(html).toMatch(/humanity__station[^"]* is-last/);
    // «اليوم» is a button now: a station that opens.
    expect(html).toMatch(/<button[^>]*is-last[^>]*>(?:(?!<\/button>).)*اليوم/s);
  });

  it('R205 — «اليوم» opens the association’s day', () => {
    at('?view=history&node=today');
    const html = renderToStaticMarkup(<HumanityTimeline />);
    expect(html).toContain(t('content.history.today.title'));
    expect(html).toContain(t('content.history.today.loading'));
    expect(html).toContain('href="/calendar"');
  });

  it('R204 — draws a diagram as a tree whose branches open and close', () => {
    at('?view=history&node=seal/makki/al-fatiha');
    const page = renderToStaticMarkup(<HumanityTimeline />);
    expect(page.match(/<figure class="hdiagram/g)?.length).toBe(6);
    const diagram = { title: 'خطاطة', root: { label: 'ج', children: [{ label: 'أ', text: '﴿اقْرَأْ﴾', tone: 'gold' as const }, { label: 'ب', children: [{ label: 'ت' }] }] } };
    // R212 — a tree opens closed: its trunk, and how many branches it holds.
    const closed = renderToStaticMarkup(<HumanityDiagram diagram={diagram} />);
    expect(closed).toContain('aria-expanded="false"');
    expect(closed).not.toContain('aria-expanded="true"');
    expect(closed).not.toContain('class="tone-prophets"');
    expect(closed).toContain('+2');
    expect(page).not.toContain('aria-expanded="true"');
    const html = renderToStaticMarkup(<HumanityDiagram diagram={diagram} startOpen />);
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('class="tone-prophets"');
    // R205 — the first branches are numbered, and one without a colour takes the next.
    expect(html).toContain('<span class="hdiagram__step" aria-hidden="true">2</span>');
    expect(html).toContain('class="tone-makki"');
    expect(html).toContain(t('content.history.diagram.hint'));
    expect(html).toContain('<span class="humanity__verse" dir="rtl" lang="ar">﴿اقْرَأْ﴾</span>');
    expect(html).toContain(t('content.history.diagram.openAll'));
    // R211 — a trunk whose branches are all leaves (مدار الأسماء والصفات،
    // مراتب العلم) still offers «فتح الكل» and «طيّ الكل».
    const flat = renderToStaticMarkup(
      <HumanityDiagram diagram={{ title: 'مراتب العلم', root: { label: 'مراتب العلم', children: [{ label: 'العلم' }, { label: 'المعرفة' }] } }} />,
    );
    expect(flat).toContain(t('content.history.diagram.openAll'));
    expect(flat).toContain(t('content.history.diagram.closeAll'));
  });

  it('R212 — opens a Surah as «حسب السورة» does: its name, its traits, its diagrams closed', () => {
    at('?view=history&node=seal/makki/al-fatiha');
    const html = renderToStaticMarkup(<HumanityTimeline />);
    expect(html).toContain('class="surah-library__head"');
    expect(html).toContain('سورة الفاتحة');
    expect(html).toContain('أم القرآن والسبع المثاني');
    expect(html).toContain('نوع السورة');
    expect(html).toContain(t('content.bySurah.section.diagrams'));
    expect(html).not.toContain('href="/resources?surah=1"');
    expect(html).not.toContain('humanity__hero');
    // Its neighbours are a step away, as for any node.
    expect(html).toContain('humanity__steps');
  });
});
