import { useEffect, useRef, useState, type RefObject } from 'react';

/**
 * Open/close state for an inline trigger-and-panel control, collapsed by
 * default. `NotificationBell` already built this exact behaviour — Escape and
 * a click outside both close it — for the header's own popover; this is that
 * same expectation, factored out so a second and third control (R137 item 8's
 * searchable and multi-select dropdowns) do not reinvent it with their own
 * slightly different `mousedown`/`keydown` wiring.
 *
 * `containerRef` is meant to wrap BOTH the trigger and the panel: a click
 * anywhere inside either one is not "outside," including a click on the
 * trigger itself re-closing what it just opened via its own `onClick`.
 */
export function useDisclosure<T extends HTMLElement>(): {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  containerRef: RefObject<T | null>;
} {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<T>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onClick = (e: MouseEvent): void => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  return { open, setOpen, toggle: () => setOpen((v) => !v), containerRef };
}
