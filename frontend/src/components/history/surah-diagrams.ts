import { EXPEDITIONS, HUMANITY, PHASES, TIMELINE } from './humanity-data.js';
import { humanityDictionary, localiseHumanity } from './humanity-i18n.js';
import type { HistoryDiagram, HistoryNode } from './humanity-model.js';

/**
 * **SRS Revision 210 — a Surah's diagrams, for «حسب السورة» too; R212 — and
 * what «نظرة شاملة» says of it.** Everything the tree holds about a Surah, by
 * Surah number, in the page's language, so one Surah page («حسب السورة» and
 * «نظرة شاملة» alike) reads the same: its title and subtitle, its lines
 * («نوع السورة»، «المحاور الأساس»…) and its diagrams. The name is the Arabic
 * tree's title without «سورة», as the library's own Surah names read.
 */
export interface SurahDiagrams {
  surah: number;
  name: string;
  /** The tree's title in the page's language («سورة البقرة», «Surat al-Baqarah»). */
  title: string;
  subtitle?: string;
  lines: string[];
  diagrams: HistoryDiagram[];
}

function collect(node: HistoryNode, out: Map<number, HistoryNode>): Map<number, HistoryNode> {
  if (node.surah !== undefined) out.set(node.surah, node);
  for (const child of node.children ?? []) collect(child, out);
  return out;
}

const ARABIC = collect(HUMANITY, new Map());
const SHOWN = collect(
  localiseHumanity(
    { root: HUMANITY, timeline: TIMELINE, phases: PHASES, expeditions: EXPEDITIONS },
    humanityDictionary(),
  ).root,
  new Map(),
);

export const SURAH_DIAGRAMS: ReadonlyMap<number, SurahDiagrams> = new Map(
  [...ARABIC.entries()].map(([surah, node]) => {
    const shown = SHOWN.get(surah) ?? node;
    return [
      surah,
      {
        surah,
        name: node.title.replace(/^سورة\s+/, ''),
        title: shown.title,
        ...(shown.subtitle ? { subtitle: shown.subtitle } : {}),
        lines: shown.lines ?? [],
        diagrams: shown.diagrams ?? [],
      },
    ];
  }),
);
