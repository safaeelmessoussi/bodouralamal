import type { ReactNode } from 'react';

/**
 * A small status label.
 *
 * §14.3's registry names `VisibilityBadge` and `ConsentStatusBadge` — two
 * *entities* wearing the same *concept*. Per constitution §2.1 the concept is
 * what gets a component: this one, configured by tone, with those two becoming
 * callers rather than copies.
 *
 * **State is carried in words, never in colour alone.** The tone tints an
 * existing label; it never replaces one. That rule is why this component takes
 * `children` and not a `status` enum it could render as a coloured dot.
 *
 * Extracted on the second use, not the third (§2.7): the Hijri calendar had
 * been writing `className="badge badge--warn"` inline, and the approval queue
 * needed the same thing for its item types.
 */
export type BadgeTone = 'neutral' | 'ok' | 'warn';

export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: BadgeTone;
  children: ReactNode;
}): ReactNode {
  return <span className={tone === 'neutral' ? 'badge' : `badge badge--${tone}`}>{children}</span>;
}
