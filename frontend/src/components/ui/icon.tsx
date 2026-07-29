import type { ReactNode } from 'react';

/**
 * Inline icon set.
 *
 * Inline SVG rather than an icon package or a sprite request: §3.1's CSP allows
 * no external host, and every avoided request matters on the weak connections
 * §2.2 targets. Each icon is decorative — the accessible name always comes from
 * the control that contains it, so they are hidden from assistive technology.
 */
export type IconName = 'menu' | 'close' | 'check' | 'chevron' | 'user' | 'book' | 'shield' | 'signal';

const PATHS: Record<IconName, string> = {
  menu: 'M4 7h16M4 12h16M4 17h16',
  close: 'M6 6l12 12M18 6L6 18',
  check: 'M20 6L9 17l-5-5',
  chevron: 'M6 9l6 6 6-6',
  user: 'M4 20a8 8 0 0 1 16 0M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  book: 'M4 4h11a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3V4zM18 20a2 2 0 0 0 2-2V6',
  shield: 'M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6l7-3z',
  signal: 'M4 18h3v-5H4v5zm6 0h3V8h-3v10zm6 0h3V4h-3v14z',
};

export function Icon({ name, size = 20 }: { name: IconName; size?: number }): ReactNode {
  return (
    <svg
      className="btn__icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
