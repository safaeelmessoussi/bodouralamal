import type {
  DiagramNode,
  HistoryDiagram,
  HistoryNode,
  TimelineDetail,
  TimelineMarker,
  TimelineSpan,
} from './humanity-model.js';

/**
 * **SRS Revision 209 — «نظرة شاملة» in the reader's language.**
 *
 * The Arabic tree (`humanity-data.ts`) stays the one source; a translation is
 * a flat dictionary keyed by WHERE a string sits — a node's address and field
 * (`seal/makki/al-fatiha|lines.2`), a diagram box's position
 * (`…|d0|b0.3.1|label`), a station's index (`timeline|4|label`). A key the
 * dictionary lacks reads in Arabic, so an edit to the Arabic text never leaves
 * a hole; the Qur'an's verses (﴿…﴾) are in Arabic in every language.
 *
 * Small on purpose: it holds no content, so the language loader can import it
 * without pulling the tree into the first download.
 */
export type ContentDictionary = Readonly<Record<string, string>>;

let dictionary: ContentDictionary | null = null;

/** Set once, before the page renders (`lib/locale.ts`). */
export function setHumanityDictionary(next: ContentDictionary | null): void {
  dictionary = next;
}

export function humanityDictionary(): ContentDictionary | null {
  return dictionary;
}

export interface HumanityContent {
  root: HistoryNode;
  timeline: TimelineMarker[];
  phases: TimelineSpan[];
  expeditions: TimelineDetail[];
}

/** The content with every string the dictionary has replaced; Arabic otherwise. */
export function localiseHumanity(
  content: HumanityContent,
  dict: ContentDictionary | null,
): HumanityContent {
  if (!dict) return content;
  const say = (key: string, arabic: string): string => dict[key] ?? arabic;

  const box = (node: DiagramNode, key: string): DiagramNode => ({
    ...node,
    label: say(`${key}|label`, node.label),
    ...(node.text ? { text: say(`${key}|text`, node.text) } : {}),
    ...(node.children
      ? { children: node.children.map((child, i) => box(child, `${key}.${String(i)}`)) }
      : {}),
  });

  const walk = (node: HistoryNode, path: string): HistoryNode => {
    const key = path || 'root';
    const out: HistoryNode = { ...node, title: say(`${key}|title`, node.title) };
    if (node.subtitle) out.subtitle = say(`${key}|subtitle`, node.subtitle);
    if (node.summary) out.summary = say(`${key}|summary`, node.summary);
    if (node.badge) out.badge = say(`${key}|badge`, node.badge);
    if (node.when) {
      out.when = {
        ...node.when,
        ...(node.when.gregorian
          ? { gregorian: say(`${key}|when.gregorian`, node.when.gregorian) }
          : {}),
        ...(node.when.hijri ? { hijri: say(`${key}|when.hijri`, node.when.hijri) } : {}),
      };
    }
    if (node.lines) out.lines = node.lines.map((line, i) => say(`${key}|lines.${String(i)}`, line));
    if (node.diagrams) {
      out.diagrams = node.diagrams.map(
        (diagram, i): HistoryDiagram => ({
          title: say(`${key}|d${String(i)}|title`, diagram.title),
          root: box(diagram.root, `${key}|d${String(i)}|b0`),
        }),
      );
    }
    if (node.children) {
      out.children = node.children.map((child) => walk(child, path ? `${path}/${child.id}` : child.id));
    }
    return out;
  };

  return {
    root: walk(content.root, ''),
    timeline: content.timeline.map((marker, i) => ({
      ...marker,
      label: say(`timeline|${String(i)}|label`, marker.label),
      gregorian: marker.gregorian ? say(`timeline|${String(i)}|gregorian`, marker.gregorian) : '',
      hijri: marker.hijri ? say(`timeline|${String(i)}|hijri`, marker.hijri) : '',
    })),
    phases: content.phases.map((phase, i) => ({
      ...phase,
      label: say(`phase|${String(i)}|label`, phase.label),
      sub: say(`phase|${String(i)}|sub`, phase.sub),
    })),
    expeditions: content.expeditions.map((item, i) => ({
      ...item,
      label: say(`expedition|${String(i)}|label`, item.label),
      hijri: say(`expedition|${String(i)}|hijri`, item.hijri),
      gregorian: say(`expedition|${String(i)}|gregorian`, item.gregorian),
    })),
  };
}
