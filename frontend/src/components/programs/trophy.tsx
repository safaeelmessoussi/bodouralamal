import type { ReactNode } from 'react';

/** §8 / R181 §4 — the trophy with its confetti and sparkles: after a
 *  Category's last step on the road, and at a Category's milestone in the
 *  full-screen show (R186). */
export function Trophy(): ReactNode {
  return (
    <svg
      className="journey__trophy"
      viewBox="0 0 120 120"
      width="120"
      height="120"
      aria-hidden="true"
      focusable="false"
    >
      {/* Confetti */}
      <circle cx="14" cy="26" r="3" className="journey__confetti journey__confetti--a" />
      <circle cx="104" cy="18" r="3.5" className="journey__confetti journey__confetti--b" />
      <circle cx="22" cy="70" r="2.5" className="journey__confetti journey__confetti--b" />
      <circle cx="100" cy="66" r="2.5" className="journey__confetti journey__confetti--a" />
      <path d="M30 8 l3 6 -6 0 z" className="journey__confetti journey__confetti--b" />
      <path d="M92 40 l3 6 -6 0 z" className="journey__confetti journey__confetti--a" />
      <path d="M12 48 l4 -2 -1 4 z" className="journey__confetti journey__confetti--a" />
      {/* Sparkles */}
      <path
        d="M60 4 l2.2 6 6 2.2 -6 2.2 -2.2 6 -2.2 -6 -6 -2.2 6 -2.2 z"
        className="journey__sparkle"
      />
      <path
        d="M94 88 l1.5 4 4 1.5 -4 1.5 -1.5 4 -1.5 -4 -4 -1.5 4 -1.5 z"
        className="journey__sparkle"
      />
      {/* Handles, then the cup */}
      <path d="M34 30 C18 30 14 46 26 56 C32 61 38 62 42 62" className="journey__trophyHandle" />
      <path d="M86 30 C102 30 106 46 94 56 C88 61 82 62 78 62" className="journey__trophyHandle" />
      <path
        d="M34 24 H86 V50 C86 66 74 76 60 76 C46 76 34 66 34 50 Z"
        className="journey__trophyCup"
      />
      <path
        d="M40 30 H80 V49 C80 60 71 68 60 68 C49 68 40 60 40 49 Z"
        className="journey__trophyShine"
      />
      {/* Star on the cup */}
      <path
        d="M60 36 l4.2 8.6 9.5 1.4 -6.9 6.7 1.6 9.4 -8.4 -4.4 -8.4 4.4 1.6 -9.4 -6.9 -6.7 9.5 -1.4 z"
        className="journey__trophyStar"
      />
      {/* Stem and base */}
      <path d="M54 76 H66 V88 H54 Z" className="journey__trophyStem" />
      <path
        d="M42 88 H78 C82 88 84 92 84 96 V102 H36 V96 C36 92 38 88 42 88 Z"
        className="journey__trophyBase"
      />
      <path
        d="M40 106 H80 C84 106 86 110 86 114 H34 C34 110 36 106 40 106 Z"
        className="journey__trophyFoot"
      />
    </svg>
  );
}
