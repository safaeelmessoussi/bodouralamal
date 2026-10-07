/**
 * **SRS Revision 203 — «مسيرة البشرية», the shape of the diagram.**
 *
 * One tree, read from the general to the particular: the root holds the three
 * eras of the Owner's board (the prophets, the Prophet ﷺ, the ummah); every
 * node may hold children (opened by a click) and its own text (`lines`,
 * read as sections). The content is `humanity-data.ts`; this module is only
 * how it is walked and read, so the rules are tested as rules.
 */

/** The colour family a node is drawn in — the board's own palette. */
export type HistoryTone = 'root' | 'prophets' | 'seal' | 'makki' | 'madani' | 'ummah';

export interface HistoryWhen {
  gregorian?: string;
  hijri?: string;
  /** The prophet's place in the board's numbered sequence (1–23). */
  order?: number;
}

export interface HistoryNode {
  /** Unique among its siblings; a node's address is its ids from the root. */
  id: string;
  title: string;
  subtitle?: string;
  tone: HistoryTone;
  when?: HistoryWhen;
  /** One sentence shown above the children. */
  summary?: string;
  /** The board's text, one line per paragraph. */
  lines?: string[];
  /** A Surah: the node links to «حسب السورة» on it. */
  surah?: number;
  /** A book revealed to this prophet («التوراة»…). */
  badge?: string;
  children?: HistoryNode[];
}

export interface TimelineMarker {
  gregorian: string;
  hijri: string;
  label: string;
  tone: HistoryTone;
  /** The node it opens, as `era/child` ids; none for «اليوم». */
  node?: string;
}

/** The nodes from the root to the one addressed by `path` (ids), as far as they resolve. */
export function resolvePath(root: HistoryNode, path: readonly string[]): HistoryNode[] {
  const trail: HistoryNode[] = [root];
  let at = root;
  for (const id of path) {
    const next = at.children?.find((child) => child.id === id);
    if (!next) break;
    trail.push(next);
    at = next;
  }
  return trail;
}

/** `era/child` → `['era','child']`, dropping what does not resolve. */
export function parsePath(root: HistoryNode, raw: string | null): string[] {
  if (!raw) return [];
  const ids = raw.split('/').filter(Boolean);
  return resolvePath(root, ids)
    .slice(1)
    .map((node) => node.id);
}

/** Everything beneath a node, itself excluded — for «{n} عنصرًا» on a card. */
export function descendantCount(node: HistoryNode): number {
  return (node.children ?? []).reduce((sum, child) => sum + 1 + descendantCount(child), 0);
}

/** One line of a detail text: a heading, a «label: value» pair, or a sentence. */
export type DetailLine =
  | { kind: 'text'; text: string }
  | { kind: 'pair'; label: string; text: string };

export interface DetailSection {
  heading: string | null;
  lines: DetailLine[];
}

/**
 * **A board text, read as sections.** A line ending with «:» (or opening
 * «1.») starts a section; «المكان والصفة: …» is a labelled line when the
 * label is short and carries no verse; everything else is a sentence. The
 * text itself is never changed.
 */
export function detailSections(lines: readonly string[]): DetailSection[] {
  const sections: DetailSection[] = [];
  let current: DetailSection = { heading: null, lines: [] };
  for (const raw of lines) {
    const line = raw.trim();
    if (line === '') continue;
    const heading = /[:：]$/.test(line) || /^\d+\.\s/.test(line);
    if (heading) {
      if (current.heading !== null || current.lines.length > 0) sections.push(current);
      current = { heading: line.replace(/[:：]$/, '').trim(), lines: [] };
      continue;
    }
    const colon = line.indexOf(':');
    const label = colon > 0 ? line.slice(0, colon).trim() : '';
    if (colon > 0 && label.length <= 32 && !label.includes('﴿') && !label.includes('«')) {
      current.lines.push({ kind: 'pair', label, text: line.slice(colon + 1).trim() });
    } else {
      current.lines.push({ kind: 'text', text: line });
    }
  }
  if (current.heading !== null || current.lines.length > 0) sections.push(current);
  return sections;
}

/** A sentence cut into plain text and Quranic quotations ﴿…﴾, so a verse is drawn as one. */
export function verseRuns(text: string): { verse: boolean; text: string }[] {
  const runs: { verse: boolean; text: string }[] = [];
  const pattern = /﴿[^﴾]*﴾/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const at = match.index ?? 0;
    if (at > last) runs.push({ verse: false, text: text.slice(last, at) });
    runs.push({ verse: true, text: match[0] });
    last = at + match[0].length;
  }
  if (last < text.length) runs.push({ verse: false, text: text.slice(last) });
  return runs;
}
