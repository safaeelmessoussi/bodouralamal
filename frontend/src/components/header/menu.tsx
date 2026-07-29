import { useEffect, useRef, useState, type ReactNode } from 'react';

import { Icon } from '../ui/icon.js';

/**
 * The dropdown behaviour shared by every header menu — user, role, child.
 *
 * Written once because the *behaviour* is the hard part, not the markup:
 * closing on outside click, closing on Escape, returning focus to the trigger,
 * and `aria-expanded` staying truthful. Three copies of that would each drift,
 * and the one that drifted would fail silently for keyboard users only.
 *
 * `inline` renders the panel in flow instead of as a popover, which is what the
 * mobile sheet needs — a popover inside a sheet would be a layer over a layer.
 */
export function Menu({
  label,
  triggerLabel,
  inline = false,
  children,
}: {
  label: string;
  triggerLabel: string;
  inline?: boolean;
  children: (close: () => void) => ReactNode;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open || inline) return;

    const onPointerDown = (event: PointerEvent): void => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      // Escape must not strand focus on a panel that no longer exists.
      trigger.current?.focus();
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, inline]);

  const panelId = `menu-${label}`;
  return (
    <div className="menu" ref={root}>
      <button
        ref={trigger}
        type="button"
        className="menu__trigger"
        aria-expanded={open}
        aria-controls={panelId}
        aria-haspopup="true"
        onClick={() => setOpen((was) => !was)}
      >
        <span className="visually-hidden">{label}</span>
        <span className="menu__label">{triggerLabel}</span>
        <Icon name="chevron" size={16} />
      </button>
      {open ? (
        <div className="menu__panel" id={panelId} role="group" aria-label={label}>
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * A single-choice option. `role="menuitemradio"` with `aria-checked` is what
 * tells a screen-reader user which role or child is currently active — a bold
 * font alone conveys nothing.
 */
export function MenuOption({
  label,
  selected,
  onSelect,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
}): ReactNode {
  return (
    <button
      type="button"
      className="menu__option"
      role="menuitemradio"
      aria-checked={selected}
      onClick={onSelect}
    >
      <span className="menu__label">{label}</span>
      {selected ? (
        <span className="menu__check">
          <Icon name="check" size={16} />
        </span>
      ) : null}
    </button>
  );
}
