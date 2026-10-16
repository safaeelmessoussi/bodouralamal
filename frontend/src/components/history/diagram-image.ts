import type { DiagramNode, DiagramTone, HistoryDiagram } from './humanity-model.js';

/**
 * **SRS Revision 223 — a Surah's diagram saved as an image, every branch
 * open** (the Owner, 2026-10-16: «allow downloading the خطاطات السورة as an
 * image showing the diagram all expanded»).
 *
 * Drawn on a canvas rather than by photographing the page: the page shows a
 * tree half closed and cut by its own scroller, and the libraries that turn
 * HTML into a picture load it as a `data:` image, which the platform's CSP
 * (`img-src 'self'`) refuses. The canvas shapes Arabic itself (`direction`),
 * and every colour and font is read from the page's own tokens at the moment
 * of drawing, so the picture is the screen's, light or dark.
 *
 * The tree reads from the start side, as on a laptop: the root in the first
 * column, each level of branches in the next, a branch's boxes stacked and the
 * parent centred on them, joined by elbow lines.
 */

const TONE_CLASS: Record<DiagramTone, string> = {
  gold: 'tone-prophets',
  violet: 'tone-seal',
  blue: 'tone-ummah',
  orange: 'tone-makki',
  green: 'tone-madani',
};
const CYCLE: DiagramTone[] = ['blue', 'orange', 'green', 'violet', 'gold'];

const BOX = 280;
const COLUMN_GAP = 48;
const ROW_GAP = 14;
const PAD = 12;
const MARGIN = 32;
const LABEL_SIZE = 16;
const TEXT_SIZE = 14;
const LINE = 1.5;
const SCALE = 2;

interface Palette {
  page: string;
  ink: string;
  muted: string;
  line: string;
  tones: Record<DiagramTone | 'none', { tone: string; soft: string; line: string }>;
  font: string;
}

interface Laid {
  node: DiagramNode;
  tone: DiagramTone | 'none';
  depth: number;
  label: string[];
  text: string[];
  height: number;
  /** The subtree's own height, this box or its branches, whichever is taller. */
  span: number;
  y: number;
  children: Laid[];
}

/** Reads a token the way the page resolves it, for a class or the root. */
function readTokens(): Palette {
  const probe = document.createElement('div');
  probe.style.display = 'none';
  document.body.appendChild(probe);
  const read = (name: string, className = ''): string => {
    probe.className = className;
    return getComputedStyle(probe).getPropertyValue(name).trim();
  };
  const tone = (className: string): { tone: string; soft: string; line: string } => ({
    tone: read('--tone', className) || read('--color-primary'),
    soft: read('--tone-soft', className) || read('--color-primary-soft'),
    line: read('--tone-line', className) || read('--color-border'),
  });
  const palette: Palette = {
    page: read('--color-surface-raised') || read('--color-surface'),
    ink: read('--color-text'),
    muted: read('--color-text-secondary'),
    line: read('--color-border-strong') || read('--color-border'),
    tones: {
      none: { tone: read('--color-primary'), soft: read('--color-primary-soft'), line: read('--color-border') },
      gold: tone(TONE_CLASS.gold),
      violet: tone(TONE_CLASS.violet),
      blue: tone(TONE_CLASS.blue),
      orange: tone(TONE_CLASS.orange),
      green: tone(TONE_CLASS.green),
    },
    font: getComputedStyle(document.body).fontFamily,
  };
  probe.remove();
  return palette;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = line === '' ? word : `${line} ${word}`;
      if (line !== '' && ctx.measureText(next).width > width) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    if (line !== '') lines.push(line);
  }
  return lines;
}

function layout(
  ctx: CanvasRenderingContext2D,
  font: string,
  node: DiagramNode,
  depth: number,
  index: number,
  inherited: DiagramTone | 'none',
): Laid {
  const tone = node.tone ?? (depth === 1 ? CYCLE[index % CYCLE.length]! : inherited);
  const inner = BOX - 2 * PAD - 4;
  const numbered = depth === 1 ? `${String(index + 1)}. ` : '';
  ctx.font = `700 ${String(LABEL_SIZE)}px ${font}`;
  const label = wrap(ctx, numbered + node.label, inner);
  ctx.font = `400 ${String(TEXT_SIZE)}px ${font}`;
  const text = node.text ? wrap(ctx, node.text, inner) : [];
  const height =
    2 * PAD + label.length * LABEL_SIZE * LINE + (text.length > 0 ? 4 + text.length * TEXT_SIZE * LINE : 0);
  const children = (node.children ?? []).map((child, i) => layout(ctx, font, child, depth + 1, i, tone));
  const stacked = children.reduce((sum, c) => sum + c.span, 0) + ROW_GAP * Math.max(0, children.length - 1);
  return { node, tone, depth, label, text, height, span: Math.max(height, stacked), y: 0, children };
}

/** Top of each box: branches stacked inside the subtree's span, the parent centred on them. */
function place(laid: Laid, top: number): void {
  const stacked =
    laid.children.reduce((sum, c) => sum + c.span, 0) + ROW_GAP * Math.max(0, laid.children.length - 1);
  let y = top + (laid.span - stacked) / 2;
  for (const child of laid.children) {
    place(child, y);
    y += child.span + ROW_GAP;
  }
  laid.y = top + (laid.span - laid.height) / 2;
}

function depthOf(laid: Laid): number {
  return Math.max(laid.depth, ...laid.children.map(depthOf));
}

/** Draws the whole tree, every branch open, and returns it as a PNG. */
export async function diagramPng(diagram: HistoryDiagram): Promise<Blob> {
  await document.fonts.ready;
  const palette = readTokens();
  const rtl = (document.documentElement.dir || 'rtl') === 'rtl';
  const measure = document.createElement('canvas').getContext('2d')!;
  measure.direction = rtl ? 'rtl' : 'ltr';
  const tree = layout(measure, palette.font, diagram.root, 0, 0, 'none');
  const titleHeight = 30 + 16;
  place(tree, MARGIN + titleHeight);

  const columns = depthOf(tree) + 1;
  const width = 2 * MARGIN + columns * BOX + (columns - 1) * COLUMN_GAP;
  const height = 2 * MARGIN + titleHeight + tree.span;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width * SCALE);
  canvas.height = Math.ceil(height * SCALE);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(SCALE, SCALE);
  ctx.direction = rtl ? 'rtl' : 'ltr';
  ctx.textBaseline = 'top';
  ctx.fillStyle = palette.page;
  ctx.fillRect(0, 0, width, height);

  // The start edge of a column: the right for Arabic, the left otherwise.
  const startOf = (depth: number): number =>
    rtl ? width - MARGIN - depth * (BOX + COLUMN_GAP) : MARGIN + depth * (BOX + COLUMN_GAP);
  const leftOf = (depth: number): number => (rtl ? startOf(depth) - BOX : startOf(depth));

  ctx.fillStyle = palette.ink;
  ctx.font = `700 22px ${palette.font}`;
  ctx.textAlign = rtl ? 'right' : 'left';
  ctx.fillText(diagram.title, rtl ? width - MARGIN : MARGIN, MARGIN);

  const draw = (laid: Laid): void => {
    const colours = palette.tones[laid.tone];
    const left = leftOf(laid.depth);
    // The joins first, so the boxes sit on top of them.
    for (const child of laid.children) {
      const fromX = rtl ? left : left + BOX;
      const toX = rtl ? leftOf(child.depth) + BOX : leftOf(child.depth);
      const midX = (fromX + toX) / 2;
      const fromY = laid.y + laid.height / 2;
      const toY = child.y + child.height / 2;
      ctx.strokeStyle = palette.tones[child.tone].line || palette.line;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(fromX, fromY);
      ctx.lineTo(midX, fromY);
      ctx.lineTo(midX, toY);
      ctx.lineTo(toX, toY);
      ctx.stroke();
    }
    ctx.fillStyle = colours.soft;
    ctx.strokeStyle = colours.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(left, laid.y, BOX, laid.height, 8);
    ctx.fill();
    ctx.stroke();
    // The tone's thick edge on the start side, as on the screen.
    ctx.fillStyle = colours.tone;
    ctx.fillRect(rtl ? left + BOX - 4 : left, laid.y + 1, 4, laid.height - 2);

    const textX = rtl ? left + BOX - PAD - 4 : left + PAD + 4;
    let y = laid.y + PAD;
    ctx.textAlign = rtl ? 'right' : 'left';
    ctx.fillStyle = colours.tone;
    ctx.font = `700 ${String(LABEL_SIZE)}px ${palette.font}`;
    for (const line of laid.label) {
      ctx.fillText(line, textX, y);
      y += LABEL_SIZE * LINE;
    }
    if (laid.text.length > 0) {
      y += 4;
      ctx.fillStyle = palette.muted;
      ctx.font = `400 ${String(TEXT_SIZE)}px ${palette.font}`;
      for (const line of laid.text) {
        ctx.fillText(line, textX, y);
        y += TEXT_SIZE * LINE;
      }
    }
    laid.children.forEach(draw);
  };
  draw(tree);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('canvas is empty'))), 'image/png');
  });
}

/** Saves the PNG under the diagram's title. */
export async function downloadDiagram(diagram: HistoryDiagram): Promise<void> {
  const blob = await diagramPng(diagram);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${diagram.title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'diagram'}.png`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
