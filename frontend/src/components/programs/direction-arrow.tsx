import type { ReactNode } from 'react';

/**
 * **The way from one step to the next** (R182 §6 — the shoe prints, which
 * did not convince the Owner, are replaced): a single rising line from the
 * lower step's foot to the next step's foot, ending in an arrowhead, with
 * chevrons along it that all point the same way. Read at a glance, in one
 * direction, on every width.
 *
 * `pathLength="100"` normalises the line so the stylesheet can draw it on
 * (`stroke-dashoffset` 100 → 0) when its stretch of road comes into view;
 * under `prefers-reduced-motion`, or without JavaScript, it simply stands.
 */
export const ARROWHEAD_ID = 'bodour-arrowhead';
/** The same head in the accent colour, for the ways in from outside the road. */
export const ARROWHEAD_ACCENT_ID = 'bodour-arrowhead-accent';

export function ArrowheadDefs(): ReactNode {
  return (
    <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: 'absolute' }}>
      <defs>
        {[ARROWHEAD_ID, ARROWHEAD_ACCENT_ID].map((id) => (
          <marker
            key={id}
            id={id}
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path
              d="M0 0 L10 5 L0 10 Z"
              className={`journey__arrowhead${id === ARROWHEAD_ACCENT_ID ? ' journey__arrowhead--accent' : ''}`}
            />
          </marker>
        ))}
      </defs>
    </svg>
  );
}

export interface DirectionArrowProps {
  /** Start (the lower step) and end (the higher one), in the SVG's own units. */
  from: { x: number; y: number };
  to: { x: number; y: number };
  width: number;
  height: number;
  /** How many chevrons stand along the line. */
  chevrons?: number;
  /** In the accent colour (a way in), rather than the road's own. */
  accent?: boolean;
  className?: string;
}

export function DirectionArrow({
  from,
  to,
  width,
  height,
  chevrons = 2,
  accent = false,
  className,
}: DirectionArrowProps): ReactNode {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return null;
  const ux = dx / length;
  const uy = dy / length;
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  const marks: ReactNode[] = [];
  for (let i = 1; i <= chevrons; i += 1) {
    const along = (length * i) / (chevrons + 1);
    const x = from.x + ux * along;
    const y = from.y + uy * along;
    marks.push(
      <path
        key={i}
        d="M-4 -5 L2 0 L-4 5"
        className="journey__chevron"
        style={{ ['--i' as string]: i }}
        transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${angle.toFixed(1)})`}
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
      <path
        d={`M${from.x} ${from.y} L${to.x} ${to.y}`}
        pathLength={100}
        className="journey__arrowLine"
        markerEnd={`url(#${accent ? ARROWHEAD_ACCENT_ID : ARROWHEAD_ID})`}
      />
      {marks}
    </svg>
  );
}
