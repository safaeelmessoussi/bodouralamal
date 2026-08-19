import type { ReactNode } from 'react';

/**
 * Inline icon set.
 *
 * Inline SVG rather than an icon package or a sprite request: §3.1's CSP allows
 * no external host, and every avoided request matters on the weak connections
 * §2.2 targets. Each icon is decorative — the accessible name always comes from
 * the control that contains it, so they are hidden from assistive technology.
 */
export type IconName =
  | 'bell'
  | 'menu'
  | 'close'
  | 'check'
  | 'chevron'
  | 'user'
  | 'book'
  | 'shield'
  | 'signal'
  // Content types (§14.6). One per PREVIEW BEHAVIOUR rather than one per file
  // extension: what a reader needs to know from an icon is whether the thing
  // plays, opens or downloads. `file` is the deliberate catch-all for the
  // download-only class, so an unknown type degrades to a real icon instead of
  // a blank square.
  | 'document'
  | 'video'
  | 'audio'
  | 'image'
  | 'file'
  | 'download'
  | 'search'
  | 'folder';

const PATHS: Record<IconName, string> = {
  menu: 'M4 7h16M4 12h16M4 17h16',
  // A bell: the dome, its rim, and the clapper below — one stroke path, like
  // every other icon here, so it inherits the same size and colour rules.
  bell: 'M12 3a5 5 0 0 0-5 5v3l-2 4h14l-2-4V8a5 5 0 0 0-5-5zM10 19a2 2 0 0 0 4 0',
  close: 'M6 6l12 12M18 6L6 18',
  check: 'M20 6L9 17l-5-5',
  chevron: 'M6 9l6 6 6-6',
  user: 'M4 20a8 8 0 0 1 16 0M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  book: 'M4 4h11a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3V4zM18 20a2 2 0 0 0 2-2V6',
  shield: 'M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6l7-3z',
  signal: 'M4 18h3v-5H4v5zm6 0h3V8h-3v10zm6 0h3V4h-3v14z',
  document: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5zM14 3v5h5M9 13h6M9 17h6',
  video: 'M4 6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6zm11 5l5-3v8l-5-3z',
  audio: 'M11 5L6 9H3v6h3l5 4V5zM16 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12',
  image: 'M4 5h16v14H4V5zm3 9l3-3 3 3 2-2 3 3M9 9a1 1 0 1 1-2 0 1 1 0 0 1 2 0z',
  file: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5zM14 3v5h5',
  download: 'M12 4v10m0 0l-4-4m4 4l4-4M5 19h14',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zm6 -2l4 4',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z',
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
