import { EXPEDITIONS, HUMANITY, PHASES, TIMELINE } from './humanity-data.js';
import { humanityDictionary, localiseHumanity } from './humanity-i18n.js';
import type { HistoryDiagram, HistoryNode } from './humanity-model.js';

/**
 * **SRS Revision 210 — a Surah's diagrams, for «حسب السورة» too.** The same
 * diagrams «نظرة شاملة» draws under a Surah, by Surah number, in the page's
 * language; the name is the Arabic tree's title without «سورة», as the
 * library's own Surah names read.
 */
export interface SurahDiagrams {
  surah: number;
  name: string;
  diagrams: HistoryDiagram[];
}

function collect(node: HistoryNode, out: Map<number, HistoryNode>): Map<number, HistoryNode> {
  if (node.surah !== undefined && node.diagrams?.length) out.set(node.surah, node);
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
  [...ARABIC.entries()].map(([surah, node]) => [
    surah,
    {
      surah,
      name: node.title.replace(/^سورة\s+/, ''),
      diagrams: SHOWN.get(surah)?.diagrams ?? node.diagrams ?? [],
    },
  ]),
);
