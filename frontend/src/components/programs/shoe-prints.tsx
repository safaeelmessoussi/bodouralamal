import type { ReactNode } from 'react';

/**
 * **Shoe prints** (R180 §2) — a shoe's sole, not a bare foot: a rounded toe,
 * a waist, a heel. Drawn once as a symbol (`<ShoePrintSymbol>` renders it
 * into the page) and stamped along a path with `<use>`.
 *
 * The symbol points UP (toward −y); each print is rotated to the direction of
 * travel, and left and right prints straddle the line by a small offset, so a
 * run of them reads as somebody walking from one Level toward the next.
 */
export const SHOE_SYMBOL_ID = 'bodour-shoe-print';

export function ShoePrintSymbol(): ReactNode {
  return (
    <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: 'absolute' }}>
      <symbol id={SHOE_SYMBOL_ID} viewBox="-6 -12 12 24">
        {/* Sole: toe cap, a slight waist, then the heel — one closed path. */}
        <path d="M0 -11.5 C3.6 -11.5 5.4 -8.5 5 -4.6 C4.7 -1.8 3.2 0.2 3.4 3 C3.6 6.2 3.8 9 2.4 10.6 C1.2 11.9 -1.2 11.9 -2.4 10.6 C-3.8 9 -3.6 6.2 -3.4 3 C-3.2 0.2 -4.7 -1.8 -5 -4.6 C-5.4 -8.5 -3.6 -11.5 0 -11.5 Z" />
        {/* The heel's separate pad, so it reads as a shoe at a glance. */}
        <path d="M-2.2 6.2 h4.4" strokeWidth="1.1" stroke="currentColor" opacity="0.55" />
      </symbol>
    </svg>
  );
}

export interface PrintPathProps {
  /** Start and end of the walk, in the SVG's own units. */
  from: { x: number; y: number };
  to: { x: number; y: number };
  /** Distance between two prints along the line. */
  stride?: number;
  /** Half the gap between the left and the right foot. */
  straddle?: number;
  /** Print height (the symbol scales with it). */
  size?: number;
  /** The SVG's box. */
  width: number;
  height: number;
  className?: string;
}

/**
 * Prints along a straight line from `from` to `to`, alternating left and
 * right, each rotated to face `to`. `--i` on every print is what the CSS
 * reveal keys its delay on (`programs.css`), so the walk appears print by
 * print rather than all at once.
 */
export function PrintPath({
  from,
  to,
  stride = 30,
  straddle = 7,
  size = 22,
  width,
  height,
  className,
}: PrintPathProps): ReactNode {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return null;
  const ux = dx / length;
  const uy = dy / length;
  // Perpendicular, for the left/right straddle.
  const px = -uy;
  const py = ux;
  // The symbol points up (−y); rotate it to the direction of travel.
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
  const count = Math.max(2, Math.floor((length - stride) / stride) + 1);
  const prints: ReactNode[] = [];
  for (let i = 0; i < count; i += 1) {
    const along = stride / 2 + i * stride;
    if (along > length - stride / 4) break;
    const side = i % 2 === 0 ? 1 : -1;
    const x = from.x + ux * along + px * straddle * side;
    const y = from.y + uy * along + py * straddle * side;
    prints.push(
      <use
        key={i}
        href={`#${SHOE_SYMBOL_ID}`}
        className="journey__print"
        style={{ ['--i' as string]: i }}
        width={size / 2}
        height={size}
        x={-size / 4}
        y={-size / 2}
        transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${angle.toFixed(1)})${side < 0 ? ' scale(-1 1)' : ''}`}
      />,
    );
  }
  return (
    <svg
      className={className}
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      aria-hidden="true"
      focusable="false"
    >
      {prints}
    </svg>
  );
}
