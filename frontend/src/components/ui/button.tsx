import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { Icon, type IconName } from './icon.js';

/**
 * The one button. Every call-to-action in the platform renders through it, so
 * focus, spacing and the variant palette are defined once (see the project rule
 * on stating a shared decision in a single place).
 *
 * Rendered as `<a>` when `href` is present and `<button>` otherwise, because a
 * navigation dressed as a button breaks middle-click, "open in new tab" and the
 * screen-reader role — the element has to match the action.
 */
/**
 * `danger` is a **variant, not a second component** (constitution §2.5). Every
 * destructive action in the platform renders through it, so "this one is
 * irreversible" looks the same everywhere.
 *
 * `add` is the same argument for the opposite act. **Creating a record looked
 * different on every screen that did it** — seven pages rendered a bare-label
 * primary button while the shared multi-select prefixed its own add control with
 * `＋`, so the platform held two conventions and applied the documented one
 * only inside a component nobody reads as an example. `add` renders **as a
 * primary button carrying the `＋`**: one variant, so the glyph cannot be
 * remembered on six screens and forgotten on the seventh.
 */
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'add';

/** The one add/create marker. Exported so a *guard* can assert the convention
 *  without hardcoding a glyph of its own, and so a caller never types it. */
export const ADD_GLYPH = '＋';

interface CommonProps {
  children: ReactNode;
  variant?: Variant;
  icon?: IconName;
  block?: boolean;
  className?: string;
}

export function Button({
  children,
  variant = 'secondary',
  icon,
  block = false,
  className = '',
  ...rest
}: CommonProps & ButtonHTMLAttributes<HTMLButtonElement>): ReactNode {
  return (
    <button className={classes(variant, block, className)} {...rest}>
      {icon ? <Icon name={icon} /> : null}
      {label(variant, children)}
    </button>
  );
}

export function ButtonLink({
  children,
  href,
  variant = 'secondary',
  icon,
  block = false,
  className = '',
}: CommonProps & { href: string }): ReactNode {
  return (
    <a className={classes(variant, block, className)} href={href}>
      {icon ? <Icon name={icon} /> : null}
      {label(variant, children)}
    </a>
  );
}

/**
 * The `＋` is added **here**, not by the caller.
 *
 * A caller that types the glyph into its own label is a caller that can forget
 * it, and the whole point of the variant is that the convention cannot be
 * applied unevenly. It is `aria-hidden` because it is decoration: the accessible
 * name is the label, and a screen reader announcing "plus sign إضافة حلقة" is
 * reading punctuation aloud.
 */
function label(variant: Variant, children: ReactNode): ReactNode {
  if (variant !== 'add') return children;
  return (
    <>
      <span aria-hidden="true">{ADD_GLYPH}</span>
      {children}
    </>
  );
}

/** `add` is `primary` **plus** a modifier rather than a palette of its own: it is
 *  the same emphasis, and giving it separate colours would make "the page's
 *  main action" mean two different things visually. */
function classes(variant: Variant, block: boolean, extra: string): string {
  const variantClasses =
    variant === 'add' ? ['btn--primary', 'btn--add'] : [`btn--${variant}`];
  return ['btn', ...variantClasses, block ? 'btn--block' : '', extra]
    .filter(Boolean)
    .join(' ');
}
