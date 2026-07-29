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
type Variant = 'primary' | 'secondary' | 'ghost';

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
      {children}
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
      {children}
    </a>
  );
}

function classes(variant: Variant, block: boolean, extra: string): string {
  return ['btn', `btn--${variant}`, block ? 'btn--block' : '', extra].filter(Boolean).join(' ');
}
