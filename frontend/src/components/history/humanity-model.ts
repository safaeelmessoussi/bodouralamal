/**
 * **SRS Revision 203 — «نظرة شاملة» (R204; «مسيرة البشرية» before), the shape
 * of the diagram.**
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
  /** A Surah's axes drawn as trees (R204), after its own lines. */
  diagrams?: HistoryDiagram[];
  children?: HistoryNode[];
}

/** The colour of a box in a diagram — the board's five families. */
export type DiagramTone = 'gold' | 'blue' | 'violet' | 'orange' | 'green';

/** One box of a diagram: a short label, an optional sentence, its branches. */
export interface DiagramNode {
  label: string;
  text?: string;
  /** Inherited from the parent box when absent. */
  tone?: DiagramTone;
  children?: DiagramNode[];
}

export interface HistoryDiagram {
  title: string;
  root: DiagramNode;
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

/** Every box of a diagram, itself included. */
export function diagramSize(node: DiagramNode): number {
  return 1 + (node.children ?? []).reduce((sum, child) => sum + diagramSize(child), 0);
}

/**
 * **Which boxes start open** (R204), by address (`0`, `0/2`…). A diagram of
 * up to `whole` boxes opens whole, so it reads at a glance like the Owner's
 * drawings; a larger one opens two levels, and each box opens on a click.
 */
export function initiallyOpen(root: DiagramNode, whole = 40): Set<string> {
  const open = new Set<string>();
  const all = diagramSize(root) <= whole;
  const walk = (node: DiagramNode, key: string, depth: number): void => {
    if (!node.children?.length) return;
    if (all || depth < 2) open.add(key);
    node.children.forEach((child, i) => walk(child, `${key}/${String(i)}`, depth + 1));
  };
  walk(root, '0', 0);
  return open;
}

/** The addresses of every box that has branches — for «فتح الكل». */
export function branchKeys(root: DiagramNode): string[] {
  const keys: string[] = [];
  const walk = (node: DiagramNode, key: string): void => {
    if (!node.children?.length) return;
    keys.push(key);
    node.children.forEach((child, i) => walk(child, `${key}/${String(i)}`));
  };
  walk(root, '0');
  return keys;
}
